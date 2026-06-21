import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { dataPath } from "./dataPath.js";
import { listDevices } from "./relay.js";
import { listSegments } from "./segmentEngine.js";

export type OfferEventType = "impression" | "click" | "dismiss" | "conversion";

export interface OfferEvent {
  id: string;
  offerId: string;
  deviceId: string;
  campaignId?: string;
  triggerId?: string;
  variantId?: string;
  type: OfferEventType;
  ts: number;
}

const MAX_EVENTS = 50_000;

function eventsPath(): string {
  return dataPath("offer-events.json");
}

function readEvents(): OfferEvent[] {
  const path = eventsPath();
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { events?: OfferEvent[] };
    return data.events ?? [];
  } catch {
    return [];
  }
}

function writeEvents(events: OfferEvent[]) {
  const path = eventsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  while (events.length > MAX_EVENTS) events.shift();
  writeFileSync(path, JSON.stringify({ events }, null, 2) + "\n", "utf8");
}

export function recordOfferEvent(input: {
  offerId: string;
  deviceId: string;
  type: OfferEventType;
  campaignId?: string;
  triggerId?: string;
  variantId?: string;
}): OfferEvent {
  const event: OfferEvent = {
    id: randomBytes(4).toString("hex"),
    offerId: input.offerId,
    deviceId: input.deviceId,
    type: input.type,
    campaignId: input.campaignId,
    triggerId: input.triggerId,
    variantId: input.variantId,
    ts: Date.now(),
  };
  const events = readEvents();
  events.push(event);
  writeEvents(events);
  return event;
}

export function listOfferEvents(filter?: {
  campaignId?: string;
  offerId?: string;
  deviceId?: string;
  since?: number;
}): OfferEvent[] {
  let events = readEvents();
  if (filter?.campaignId) events = events.filter((e) => e.campaignId === filter.campaignId);
  if (filter?.offerId) events = events.filter((e) => e.offerId === filter.offerId);
  if (filter?.deviceId) events = events.filter((e) => e.deviceId === filter.deviceId);
  if (filter?.since) events = events.filter((e) => e.ts >= filter.since!);
  return events;
}

export interface CampaignFunnel {
  campaignId: string;
  sent: number;
  impressions: number;
  clicks: number;
  dismisses: number;
  conversions: number;
}

export function funnelForCampaign(campaignId: string, sentCount: number): CampaignFunnel {
  const events = listOfferEvents({ campaignId });
  return {
    campaignId,
    sent: sentCount,
    impressions: events.filter((e) => e.type === "impression").length,
    clicks: events.filter((e) => e.type === "click").length,
    dismisses: events.filter((e) => e.type === "dismiss").length,
    conversions: events.filter((e) => e.type === "conversion").length,
  };
}

export function analyticsSummary(since?: number) {
  const events = listOfferEvents(since ? { since } : undefined);
  const byCampaign = new Map<string, CampaignFunnel>();
  for (const e of events) {
    const cid = e.campaignId ?? "manual";
    const cur = byCampaign.get(cid) ?? {
      campaignId: cid,
      sent: 0,
      impressions: 0,
      clicks: 0,
      dismisses: 0,
      conversions: 0,
    };
    if (e.type === "impression") cur.impressions++;
    if (e.type === "click") cur.clicks++;
    if (e.type === "dismiss") cur.dismisses++;
    if (e.type === "conversion") cur.conversions++;
    byCampaign.set(cid, cur);
  }
  return {
    totalEvents: events.length,
    byCampaign: [...byCampaign.values()],
  };
}

export function growthPulse(since24h: number) {
  const events = listOfferEvents({ since: since24h });
  const sent = events.filter((e) => e.type === "impression").length;
  const clicks = events.filter((e) => e.type === "click").length;
  const unlocks = events.filter((e) => e.type === "conversion").length;
  const triggerSends = events.filter((e) => e.type === "impression" && e.triggerId).length;
  const automationRate = sent ? Math.round((triggerSends / sent) * 100) : 0;

  const devices = listDevices();
  const activeIds = new Set(devices.filter((d) => d.lastSeen > since24h).map((d) => d.deviceId));
  const segments = listSegments();
  const inSegment = new Set<string>();
  for (const seg of segments) {
    for (const id of seg.deviceIds) {
      if (activeIds.has(id)) inSegment.add(id);
    }
  }
  const coveragePercent = activeIds.size
    ? Math.round((inSegment.size / activeIds.size) * 100)
    : 0;

  return { sent, clicks, unlocks, automationRate, coveragePercent };
}

export function exportEventsCsv(since?: number): string {
  const events = listOfferEvents(since ? { since } : undefined);
  const lines = ["id,offerId,deviceId,campaignId,type,ts"];
  for (const e of events) {
    lines.push(
      [e.id, e.offerId, e.deviceId, e.campaignId ?? "", e.type, e.ts].join(","),
    );
  }
  return lines.join("\n");
}
