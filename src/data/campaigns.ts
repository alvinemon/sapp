import { authBody, authParams } from "./marketing";

export type CampaignStatus =
  | "draft"
  | "pending_approval"
  | "scheduled"
  | "running"
  | "completed"
  | "cancelled";

export interface CampaignVariant {
  id: string;
  title: string;
  body: string;
  reason: string;
  weight: number;
}

export interface Campaign {
  id: string;
  name: string;
  segmentId: string;
  offer: { title: string; reason: string; body: string; contentId?: string; discount?: string };
  variants?: CampaignVariant[];
  winnerMetric?: "click" | "conversion";
  delivery: "browse" | "notification" | "popup";
  status: CampaignStatus;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  createdBy: string;
  scheduledAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CampaignFunnel {
  campaignId: string;
  sent: number;
  impressions: number;
  clicks: number;
  dismisses: number;
  conversions: number;
}

export interface OfferTemplate {
  id: string;
  name: string;
  title: string;
  reason: string;
  body: string;
  contentId?: string;
  discount?: string;
}

export interface MarketingGuardrails {
  quietHoursStart: number;
  quietHoursEnd: number;
  maxOffersPerDevicePerDay: number;
  requireCampaignApproval: boolean;
}

export async function fetchCampaigns(keys: { editKey?: string; marketingKey?: string }) {
  const res = await fetch(`/api/campaigns?${authParams(keys)}`);
  if (!res.ok) throw new Error("campaigns failed");
  return res.json() as Promise<{ campaigns: Campaign[] }>;
}

export async function createCampaign(
  keys: { editKey?: string; marketingKey?: string },
  input: {
    name: string;
    segmentId: string;
    offer: Campaign["offer"];
    delivery: Campaign["delivery"];
    variants?: Omit<CampaignVariant, "id">[];
    scheduledAt?: number;
  },
) {
  const res = await fetch("/api/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authBody(keys, input)),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<Campaign>;
}

export async function runCampaign(keys: { editKey?: string; marketingKey?: string }, id: string) {
  const res = await fetch(`/api/campaigns/${id}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authBody(keys)),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<Campaign>;
}

export async function approveCampaign(editKey: string, id: string) {
  const res = await fetch(`/api/campaigns/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editKey }),
  });
  if (!res.ok) throw new Error("approve failed");
  return res.json() as Promise<Campaign>;
}

export async function fetchCampaignAnalytics(keys: { editKey?: string; marketingKey?: string }, since?: number) {
  const p = authParams(keys);
  if (since) p.set("since", String(since));
  const res = await fetch(`/api/campaigns/analytics?${p}`);
  if (!res.ok) throw new Error("analytics failed");
  return res.json() as Promise<{
    summary: { totalEvents: number; byCampaign: CampaignFunnel[] };
    funnels: CampaignFunnel[];
    campaigns: Campaign[];
  }>;
}

export async function exportAnalyticsCsv(keys: { editKey?: string; marketingKey?: string }) {
  const res = await fetch(`/api/campaigns/analytics/export.csv?${authParams(keys)}`);
  if (!res.ok) throw new Error("export failed");
  return res.text();
}

export async function fetchOfferTemplates(editKey: string) {
  const res = await fetch(`/api/offer-templates?editKey=${encodeURIComponent(editKey)}`);
  if (!res.ok) throw new Error("templates failed");
  return res.json() as Promise<{ templates: OfferTemplate[] }>;
}

export async function saveOfferTemplate(
  editKey: string,
  input: Omit<OfferTemplate, "id">,
) {
  const res = await fetch("/api/offer-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editKey, ...input }),
  });
  if (!res.ok) throw new Error("save template failed");
  return res.json() as Promise<OfferTemplate>;
}

export async function fetchMarketingSettings(editKey: string) {
  const res = await fetch(`/api/marketing/settings?editKey=${encodeURIComponent(editKey)}`);
  if (!res.ok) throw new Error("settings failed");
  return res.json() as Promise<{ guardrails: MarketingGuardrails; audit: { ts: number; actor: string; action: string; detail: string }[] }>;
}

export async function updateMarketingSettings(editKey: string, guardrails: Partial<MarketingGuardrails>) {
  const res = await fetch("/api/marketing/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editKey, guardrails }),
  });
  if (!res.ok) throw new Error("update settings failed");
  return res.json() as Promise<{ guardrails: MarketingGuardrails }>;
}

export async function recordOfferEvent(
  offerId: string,
  deviceId: string,
  type: "impression" | "click" | "dismiss" | "conversion",
  extra?: { campaignId?: string; triggerId?: string; variantId?: string },
) {
  await fetch(`/api/offers/${encodeURIComponent(offerId)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, type, ...extra }),
  });
}
