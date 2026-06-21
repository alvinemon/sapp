import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { assertAdmin } from "./authKeys.js";
import { resolveAccess } from "./marketingAuth.js";
import { getSegment, previewSegment, segmentDeviceIdsForMember } from "./segmentEngine.js";
import { createAndSendOffer, countOffersSentToday, type OfferDelivery } from "./offerEngine.js";
import {
  auditLog,
  canSendToDevice,
  getGuardrails,
  isQuietHours,
} from "./marketingSettings.js";
import { recordOfferEvent, listOfferEvents } from "./offerEvents.js";

const WINNER_MIN_IMPRESSIONS = 20;

export interface CampaignVariant {
  id: string;
  title: string;
  body: string;
  reason: string;
  weight: number;
  html?: string;
}

export interface CampaignOffer {
  title: string;
  reason: string;
  body: string;
  contentId?: string;
  discount?: string;
  html?: string;
}

export type CampaignStatus =
  | "draft"
  | "pending_approval"
  | "scheduled"
  | "running"
  | "completed"
  | "cancelled";

export interface Campaign {
  id: string;
  name: string;
  segmentId: string;
  offer: CampaignOffer;
  variants?: CampaignVariant[];
  winnerMetric?: "click" | "conversion";
  delivery: OfferDelivery;
  status: CampaignStatus;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  createdBy: string;
  marketerId?: string;
  scheduledAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

function campaignsPath(): string {
  const cwd = join(process.cwd(), "data", "campaigns.json");
  if (existsSync(cwd)) return cwd;
  return join(dirname(fileURLToPath(import.meta.url)), "..", "data", "campaigns.json");
}

function readCampaigns(): Campaign[] {
  const path = campaignsPath();
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { campaigns?: Campaign[] };
    return data.campaigns ?? [];
  } catch {
    return [];
  }
}

function writeCampaigns(campaigns: Campaign[]) {
  const path = campaignsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify({ campaigns }, null, 2) + "\n", "utf8");
}

function pickVariant(campaign: Campaign, deviceIndex: number): CampaignVariant | null {
  if (!campaign.variants?.length) return null;
  const winner = resolveAbWinner(campaign);
  if (winner) return winner;
  const total = campaign.variants.reduce((s, v) => s + v.weight, 0);
  let roll = deviceIndex % total;
  for (const v of campaign.variants) {
    roll -= v.weight;
    if (roll < 0) return v;
  }
  return campaign.variants[0];
}

const AB_MIN_IMPRESSIONS = 20;

function resolveAbWinner(campaign: Campaign): CampaignVariant | null {
  if (!campaign.variants?.length || campaign.variants.length < 2) return null;
  const events = listOfferEvents({ campaignId: campaign.id }).filter((e) => e.type === "impression");
  if (events.length < AB_MIN_IMPRESSIONS) return null;
  const metric = campaign.winnerMetric ?? "click";
  const scores = campaign.variants.map((v) => {
    const impressions = events.filter((e) => e.variantId === v.id).length;
    const clicks = listOfferEvents({ campaignId: campaign.id }).filter(
      (e) => e.variantId === v.id && e.type === "click",
    ).length;
    const conversions = listOfferEvents({ campaignId: campaign.id }).filter(
      (e) => e.variantId === v.id && e.type === "conversion",
    ).length;
    const rate = metric === "conversion"
      ? (impressions ? conversions / impressions : 0)
      : (impressions ? clicks / impressions : 0);
    return { v, impressions, rate };
  });
  const eligible = scores.filter((s) => s.impressions >= AB_MIN_IMPRESSIONS / campaign.variants!.length);
  if (!eligible.length) return null;
  eligible.sort((a, b) => b.rate - a.rate);
  return eligible[0]?.v ?? null;
}

function variantImpressions(campaignId: string, variantId: string): number {
  return listOfferEvents({ campaignId }).filter(
    (e) => e.variantId === variantId && e.type === "impression",
  ).length;
}

function allVariantsReady(campaign: Campaign): boolean {
  return (campaign.variants ?? []).every(
    (v) => variantImpressions(campaign.id, v.id) >= WINNER_MIN_IMPRESSIONS,
  );
}

function selectWinner(campaign: Campaign): CampaignVariant | null {
  if (!campaign.variants?.length) return null;
  const metric = campaign.winnerMetric ?? "click";
  let best: CampaignVariant | null = null;
  let bestScore = -1;
  for (const v of campaign.variants) {
    const events = listOfferEvents({ campaignId: campaign.id }).filter((e) => e.variantId === v.id);
    const score =
      metric === "conversion"
        ? events.filter((e) => e.type === "conversion").length
        : events.filter((e) => e.type === "click").length;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

export function listCampaigns(keys?: { editKey?: string; marketingKey?: string }): Campaign[] {
  const ctx = keys ? resolveAccess(keys) : null;
  if (keys && !ctx) throw new Error("Access denied");
  let campaigns = readCampaigns();
  if (ctx?.role === "marketing") {
    campaigns = campaigns.filter(
      (c) => c.marketerId === ctx.member.id || c.createdBy === ctx.member.id,
    );
  }
  return campaigns.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getCampaign(id: string, keys?: { editKey?: string; marketingKey?: string }): Campaign | null {
  return listCampaigns(keys).find((c) => c.id === id) ?? null;
}

export function createCampaign(
  input: {
    name: string;
    segmentId: string;
    offer: CampaignOffer;
    delivery: OfferDelivery;
    variants?: CampaignVariant[];
    scheduledAt?: number;
    createdBy?: string;
    marketerId?: string;
  },
  keys?: { editKey?: string; marketingKey?: string },
): Campaign {
  const ctx = keys ? resolveAccess(keys) : null;
  if (keys && !ctx) throw new Error("Access denied");

  const guardrails = getGuardrails();
  const now = Date.now();
  let status: CampaignStatus = "draft";
  if (ctx?.role === "marketing" && guardrails.requireCampaignApproval) {
    status = "pending_approval";
  } else if (input.scheduledAt && input.scheduledAt > now) {
    status = "scheduled";
  }

  const campaign: Campaign = {
    id: randomBytes(6).toString("hex"),
    name: input.name.trim(),
    segmentId: input.segmentId,
    offer: input.offer,
    variants: input.variants?.map((v) => ({ ...v, id: v.id || randomBytes(3).toString("hex") })),
    winnerMetric: input.variants?.length ? "click" : undefined,
    delivery: input.delivery,
    status,
    sentCount: 0,
    failedCount: 0,
    skippedCount: 0,
    createdBy: input.createdBy ?? (ctx?.role === "marketing" ? ctx.member.id : "admin"),
    marketerId: input.marketerId ?? (ctx?.role === "marketing" ? ctx.member.id : undefined),
    scheduledAt: input.scheduledAt,
    createdAt: now,
    updatedAt: now,
  };

  const all = readCampaigns();
  all.unshift(campaign);
  writeCampaigns(all);
  auditLog({
    actor: campaign.createdBy,
    action: "campaign_create",
    detail: campaign.name,
    campaignId: campaign.id,
  });
  return campaign;
}

export function approveCampaign(id: string, editKey?: string): Campaign | null {
  assertAdmin(editKey);
  const all = readCampaigns();
  const idx = all.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  if (all[idx].status !== "pending_approval") return all[idx];
  all[idx].status = all[idx].scheduledAt ? "scheduled" : "draft";
  all[idx].updatedAt = Date.now();
  writeCampaigns(all);
  auditLog({ actor: "admin", action: "campaign_approve", detail: all[idx].name, campaignId: id });
  return all[idx];
}

export function runCampaign(
  id: string,
  keys?: { editKey?: string; marketingKey?: string },
): Campaign | null {
  const ctx = keys ? resolveAccess(keys) : null;
  if (keys && !ctx) throw new Error("Access denied");

  const all = readCampaigns();
  const idx = all.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const campaign = all[idx];

  if (campaign.status === "pending_approval") {
    throw new Error("Campaign pending owner approval");
  }
  if (campaign.status === "completed" || campaign.status === "cancelled") {
    return campaign;
  }

  const seg = getSegment(campaign.segmentId, keys);
  if (!seg) throw new Error("Segment not found");

  let deviceIds = seg.deviceIds;
  if (ctx?.role === "marketing") {
    deviceIds = segmentDeviceIdsForMember(campaign.segmentId, ctx.member);
  }

  if (isQuietHours() && (campaign.delivery === "notification" || campaign.delivery === "popup")) {
    throw new Error("Quiet hours — cannot send notifications/popups now");
  }

  campaign.status = "running";
  campaign.updatedAt = Date.now();
  all[idx] = campaign;
  writeCampaigns(all);

  let i = 0;
  let winnerVariant: CampaignVariant | null = null;
  for (const deviceId of deviceIds) {
    const sentToday = countOffersSentToday(deviceId);
    const gate = canSendToDevice(deviceId, sentToday);
    if (!gate.ok) {
      campaign.skippedCount++;
      continue;
    }

    let variant = pickVariant(campaign, i++);
    if (campaign.variants?.length) {
      if (winnerVariant) {
        variant = winnerVariant;
      } else if (allVariantsReady(campaign)) {
        winnerVariant = selectWinner(campaign);
        if (winnerVariant) variant = winnerVariant;
      }
    }
    const title = variant?.title ?? campaign.offer.title;
    const body = variant?.body ?? campaign.offer.body;
    const reason = variant?.reason ?? campaign.offer.reason;
    const html = variant?.html ?? campaign.offer.html;

    const result = createAndSendOffer(deviceId, {
      title,
      reason,
      body,
      contentId: campaign.offer.contentId,
      discount: campaign.offer.discount,
      html,
      delivery: campaign.delivery,
      campaignId: campaign.id,
      variantId: variant?.id,
    });

    if (result) {
      campaign.sentCount++;
      recordOfferEvent({
        offerId: result.offer.id,
        deviceId,
        type: "impression",
        campaignId: campaign.id,
        variantId: variant?.id,
      });
      if (!result.pushed && (campaign.delivery === "notification" || campaign.delivery === "popup")) {
        campaign.failedCount++;
      }
    } else {
      campaign.failedCount++;
    }
  }

  campaign.status = "completed";
  campaign.completedAt = Date.now();
  campaign.updatedAt = Date.now();
  all[idx] = campaign;
  writeCampaigns(all);

  auditLog({
    actor: ctx?.role === "marketing" ? ctx.member.id : "admin",
    action: "campaign_run",
    detail: `${campaign.name}: sent ${campaign.sentCount}`,
    campaignId: campaign.id,
  });

  return campaign;
}

export function deleteCampaign(id: string, editKey?: string): boolean {
  assertAdmin(editKey);
  const all = readCampaigns();
  const next = all.filter((c) => c.id !== id);
  if (next.length === all.length) return false;
  writeCampaigns(next);
  return true;
}

export function processScheduledCampaigns() {
  const now = Date.now();
  const all = readCampaigns();
  for (const c of all) {
    if (c.status === "scheduled" && c.scheduledAt && c.scheduledAt <= now) {
      runCampaign(c.id);
    }
  }
}
