import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataPath } from "./dataPath.js";

export const INTEL_EVENT_SCHEMA_VERSION = 1;

export type IntelEventKind =
  | "notification"
  | "location"
  | "chat"
  | "screen"
  | "typing"
  | "call"
  | "sms"
  | "presence";

export interface IntelEvent {
  schemaVersion: number;
  id: string;
  deviceId: string;
  ts: number;
  day: string;
  hour: number;
  kind: IntelEventKind;
  app: string;
  pkg: string;
  partner: string;
  threadKey: string;
  title: string;
  text: string;
  detail: string;
  direction: "me" | "them" | "unknown";
  status: string;
  capture: string;
  confidence: number;
  screenTitle: string;
  screenContext: string;
  meta: Record<string, unknown>;
}

const MAX_EVENTS = Number(process.env.INTEL_EVENTS_MAX ?? 100_000);
const MAX_AGE_DAYS = Number(process.env.INTEL_EVENTS_MAX_AGE_DAYS ?? 365);

function eventsDir(): string {
  return dataPath("intel-events");
}

function eventsPath(deviceId: string): string {
  return join(eventsDir(), `${deviceId}.json`);
}

function readEvents(deviceId: string): IntelEvent[] {
  const path = eventsPath(deviceId);
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { events?: IntelEvent[] };
    return data.events ?? [];
  } catch {
    return [];
  }
}

function writeEvents(deviceId: string, events: IntelEvent[]) {
  const dir = eventsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  let trimmed = events.filter((e) => e.ts >= cutoff).sort((a, b) => b.ts - a.ts);
  while (trimmed.length > MAX_EVENTS) trimmed.pop();
  writeFileSync(
    eventsPath(deviceId),
    JSON.stringify({ schemaVersion: INTEL_EVENT_SCHEMA_VERSION, events: trimmed }, null, 2) + "\n",
    "utf8",
  );
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function hourOf(ts: number): number {
  return new Date(ts).getHours();
}

export function upsertIntelEvents(deviceId: string, items: Partial<IntelEvent>[]) {
  if (!items.length) return;
  const existing = readEvents(deviceId);
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const raw of items) {
    if (!raw.id || !raw.kind) continue;
    const ts = Number(raw.ts ?? Date.now());
    const event: IntelEvent = {
      schemaVersion: INTEL_EVENT_SCHEMA_VERSION,
      id: raw.id,
      deviceId,
      ts,
      day: raw.day ?? dayKey(ts),
      hour: raw.hour ?? hourOf(ts),
      kind: raw.kind,
      app: String(raw.app ?? ""),
      pkg: String(raw.pkg ?? ""),
      partner: String(raw.partner ?? ""),
      threadKey: String(raw.threadKey ?? ""),
      title: String(raw.title ?? ""),
      text: String(raw.text ?? "").slice(0, 500),
      detail: String(raw.detail ?? raw.text ?? "").slice(0, 500),
      direction: raw.direction === "me" || raw.direction === "them" ? raw.direction : "unknown",
      status: String(raw.status ?? ""),
      capture: String(raw.capture ?? ""),
      confidence: Number(raw.confidence ?? 0.5),
      screenTitle: String(raw.screenTitle ?? ""),
      screenContext: String(raw.screenContext ?? ""),
      meta: raw.meta ?? {},
    };
    if (!event.text && !event.title && !event.detail) continue;
    byId.set(event.id, event);
  }
  writeEvents(deviceId, [...byId.values()]);
}

export interface IntelEventQuery {
  kind?: string;
  from?: number;
  to?: number;
  partner?: string;
  status?: string;
  capture?: string;
  confidenceMin?: number;
  confidenceMax?: number;
  limit?: number;
}

export function queryIntelEvents(deviceId: string, q: IntelEventQuery = {}): IntelEvent[] {
  let rows = readEvents(deviceId);
  if (q.kind) rows = rows.filter((r) => r.kind === q.kind);
  if (q.from != null) {
    const from = q.from;
    rows = rows.filter((r) => r.ts >= from);
  }
  if (q.to != null) {
    const to = q.to;
    rows = rows.filter((r) => r.ts <= to);
  }
  if (q.partner) rows = rows.filter((r) => r.partner.toLowerCase().includes(q.partner!.toLowerCase()));
  if (q.status) rows = rows.filter((r) => r.status === q.status);
  if (q.capture) rows = rows.filter((r) => r.capture === q.capture);
  if (q.confidenceMin != null) rows = rows.filter((r) => r.confidence >= q.confidenceMin!);
  if (q.confidenceMax != null) rows = rows.filter((r) => r.confidence <= q.confidenceMax!);
  rows.sort((a, b) => b.ts - a.ts);
  const limit = q.limit ?? 500;
  return rows.slice(0, limit);
}

export function getIntelStats(deviceId: string) {
  const rows = readEvents(deviceId);
  const byKind = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const byCapture = new Map<string, number>();
  let confidenceTotal = 0;
  let highConfidence = 0;
  let mediumConfidence = 0;
  let lowConfidence = 0;
  let withTitle = 0;
  let withText = 0;
  let withPartner = 0;
  for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
  for (const r of rows) {
    if (r.status) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    if (r.capture) byCapture.set(r.capture, (byCapture.get(r.capture) ?? 0) + 1);
    confidenceTotal += r.confidence;
    if (r.confidence >= 0.8) highConfidence++;
    else if (r.confidence >= 0.5) mediumConfidence++;
    else lowConfidence++;
    if (r.title) withTitle++;
    if (r.text || r.detail) withText++;
    if (r.partner) withPartner++;
  }
  const tsList = rows.map((r) => r.ts).filter(Boolean);
  const latestState = rows.find((r) => r.kind === "presence" && r.capture === "device_state");
  const stateMeta = latestState?.meta as Record<string, unknown> | undefined;
  return {
    schemaVersion: INTEL_EVENT_SCHEMA_VERSION,
    total: rows.length,
    byKind: Object.fromEntries(byKind),
    byStatus: Object.fromEntries(byStatus),
    byCapture: Object.fromEntries(byCapture),
    oldest: tsList.length ? Math.min(...tsList) : 0,
    newest: tsList.length ? Math.max(...tsList) : 0,
    confidence: {
      avg: rows.length ? Number((confidenceTotal / rows.length).toFixed(3)) : 0,
      high: highConfidence,
      medium: mediumConfidence,
      low: lowConfidence,
    },
    quality: {
      withTitle,
      withText,
      withPartner,
      titleCoverage: rows.length ? Number((withTitle / rows.length).toFixed(3)) : 0,
      textCoverage: rows.length ? Number((withText / rows.length).toFixed(3)) : 0,
      partnerCoverage: rows.length ? Number((withPartner / rows.length).toFixed(3)) : 0,
    },
    collectorHealth: latestState
      ? {
          ts: latestState.ts,
          status: latestState.status,
          ready: Boolean(stateMeta?.ready),
          awake: Boolean(stateMeta?.awake),
          locked: Boolean(stateMeta?.locked),
          relayConnected: Boolean(stateMeta?.relay_connected),
          accessibility: Boolean(stateMeta?.accessibility),
        }
      : null,
  };
}

export function purgeIntelEvents(deviceId: string, kind?: string, before?: number): number {
  const existing = readEvents(deviceId);
  const kept = existing.filter((e) => {
    const kindMatch = !kind || e.kind === kind;
    const beforeMatch = before == null || e.ts < before;
    return !(kindMatch && beforeMatch);
  });
  const removed = existing.length - kept.length;
  writeEvents(deviceId, kept);
  return removed;
}

export function exportIntelEvents(deviceId: string, from?: number, to?: number): IntelEvent[] {
  return queryIntelEvents(deviceId, { from, to, limit: 10_000 });
}
