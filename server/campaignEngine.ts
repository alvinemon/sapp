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
import { recordOfferEvent } from "./offerEvents.js";

export interface CampaignVariant {
  id: string;
  title: string;
  body: string;
  reason: string;
  weight: number;
}

export interface CampaignOffer {
  title: string;
  reason: string;
  body: string;
  contentId?: string;
  discount?: string;
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
  const total = campaign.variants.reduce((s, v) => s + v.weight, 0);
  let roll = deviceIndex % total;
  for (const v of campaign.variants) {
    roll -= v.weight;
    if (roll < 0) return v;
  }
  return campaign.variants[0];
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
  for (const deviceId of deviceIds) {
    const sentToday = countOffersSentToday(deviceId);
    const gate = canSendToDevice(deviceId, sentToday);
    if (!gate.ok) {
      campaign.skippedCount++;
      continue;
    }

    const variant = pickVariant(campaign, i++);
    const title = variant?.title ?? campaign.offer.title;
    const body = variant?.body ?? campaign.offer.body;
    const reason = variant?.reason ?? campaign.offer.reason;

    const result = createAndSendOffer(deviceId, {
      title,
      reason,
      body,
      contentId: campaign.offer.contentId,
      discount: campaign.offer.discount,
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
