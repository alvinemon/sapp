import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { assertDeviceIntelAccess } from "./marketingAuth.js";
import { buildIntelDigest } from "./intelDigest.js";
import { resolveDeepSeekApiKey } from "./agent.js";
import { listCatalogPublic } from "./catalog.js";
import { pushToPhone } from "./relay.js";
import { canSendToDevice, isQuietHours, auditLog } from "./marketingSettings.js";
import { recordOfferEvent, listOfferEvents } from "./offerEvents.js";
import { dataPath } from "./dataPath.js";

export const OFFER_SCHEMA_VERSION = 1;

export type OfferDelivery = "draft" | "browse" | "notification" | "popup";

export type AccessKeys = { editKey?: string; marketingKey?: string };

export interface Offer {
  id: string;
  deviceId: string;
  title: string;
  reason: string;
  body?: string;
  contentId?: string;
  discount?: string;
  confidence: number;
  delivery: OfferDelivery;
  published: boolean;
  pendingPush: boolean;
  createdAt: number;
  sentAt?: number;
  expiresAt?: number;
  campaignId?: string;
  triggerId?: string;
  variantId?: string;
  html?: string;
  retargetBrowsePublished?: boolean;
  parentOfferId?: string;
}

function offersDir(): string {
  const dir = dataPath("offers");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function readOffers(deviceId: string): Offer[] {
  const path = join(offersDir(), `${deviceId}.json`);
  if (!existsSync(path)) return [];
  try {
    const rows = JSON.parse(readFileSync(path, "utf8")) as Offer[];
    return rows.map(normalizeOffer);
  } catch {
    return [];
  }
}

function normalizeOffer(o: Offer): Offer {
  return {
    ...o,
    delivery: o.delivery ?? (o.published ? "browse" : "draft"),
    pendingPush: o.pendingPush ?? false,
    body: o.body ?? o.reason,
  };
}

function writeOffers(deviceId: string, offers: Offer[]) {
  const dir = offersDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${deviceId}.json`), JSON.stringify(offers, null, 2) + "\n", "utf8");
}

function pushPayload(offer: Offer) {
  return {
    type: "offer_push",
    schemaVersion: OFFER_SCHEMA_VERSION,
    offerId: offer.id,
    title: offer.title,
    body: offer.body ?? offer.reason,
    reason: offer.reason,
    contentId: offer.contentId ?? "",
    discount: offer.discount ?? "",
    delivery: offer.delivery,
    campaignId: offer.campaignId ?? "",
    variantId: offer.variantId ?? "",
    html: offer.html ?? "",
  };
}

const SHOP_KEYWORDS = /order|cart|delivery|shop|buy|purchase|payment|deal/i;

function suggestPremiumFromSignals(
  digest: ReturnType<typeof buildIntelDigest>,
  premium: { id: string; title: string; category?: string }[],
): string | undefined {
  if (!premium.length) return undefined;
  const shopping = digest.notificationFeed.some((n) =>
    SHOP_KEYWORDS.test(`${n.title} ${n.text} ${n.app}`),
  );
  if (shopping) {
    const match = premium.find((p) => /deal|premium|unlock/i.test(p.title)) ?? premium[0];
    return match.id;
  }
  const entertainment = digest.topKeywords.find((k) => /movie|show|watch|video|stream/i.test(k.word));
  if (entertainment) {
    return premium.find((p) => /movie|series|show/i.test(p.title))?.id ?? premium[0]?.id;
  }
  return undefined;
}

export function createAndSendOffer(
  deviceId: string,
  input: {
    title: string;
    reason: string;
    body?: string;
    contentId?: string;
    discount?: string;
    delivery: OfferDelivery;
    campaignId?: string;
    triggerId?: string;
    variantId?: string;
    html?: string;
  },
): { offer: Offer; pushed: boolean } | null {
  if (input.delivery === "draft") return null;
  const now = Date.now();
  const offer: Offer = {
    id: randomBytes(4).toString("hex"),
    deviceId,
    title: input.title.trim(),
    reason: input.reason.trim(),
    body: (input.body ?? input.reason).trim(),
    contentId: input.contentId,
    discount: input.discount,
    html: input.html,
    confidence: 1,
    delivery: input.delivery,
    published: input.delivery === "browse",
    pendingPush: input.delivery === "notification" || input.delivery === "popup",
    createdAt: now,
    sentAt: now,
    expiresAt: now + 14 * 86_400_000,
    campaignId: input.campaignId,
    triggerId: input.triggerId,
    variantId: input.variantId,
  };
  const offers = readOffers(deviceId);
  offers.unshift(offer);
  writeOffers(deviceId, offers.slice(0, 40));

  let pushed = false;
  if (offer.delivery === "notification" || offer.delivery === "popup") {
    pushed = pushToPhone(deviceId, pushPayload(offer));
    if (pushed) {
      offer.pendingPush = false;
      const idx = offers.findIndex((o) => o.id === offer.id);
      if (idx >= 0) {
        offers[idx].pendingPush = false;
        writeOffers(deviceId, offers);
      }
    }
  }
  return { offer, pushed };
}

export function countOffersSentToday(deviceId: string): number {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const since = dayStart.getTime();
  return readOffers(deviceId).filter((o) => (o.sentAt ?? 0) >= since).length;
}

export async function generateOffers(deviceId: string, keys?: AccessKeys): Promise<Offer[]> {
  assertDeviceIntelAccess(deviceId, keys ?? {}, true);
  const catalog = listCatalogPublic();
  const premium = catalog.items.filter((i) => i.locked !== false && !i.free).slice(0, 8);
  const digest = buildIntelDigest(deviceId, "week", keys);
  const summary = digest.aiContext;
  const apiKey = resolveDeepSeekApiKey();

  let suggestions: { title: string; reason: string; contentId?: string; discount?: string }[] = [];

  if (apiKey && premium.length > 0) {
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            {
              role: "system",
              content:
                'Suggest 2-3 personalized content offers as JSON: {"offers":[{"title":"","reason":"","contentId":"","discount":""}]}. Sales-friendly, concise, no raw PII.',
            },
            {
              role: "user",
              content: `Intel digest:\n${summary}\n\nCatalog:\n${premium.map((p) => `${p.id}: ${p.title}`).join("\n")}`,
            },
          ],
          response_format: { type: "json_object" },
          max_tokens: 600,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const raw = data.choices?.[0]?.message?.content ?? "{}";
        const parsed = JSON.parse(raw) as { offers?: typeof suggestions } | typeof suggestions;
        suggestions = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.offers)
            ? parsed.offers
            : [];
      }
    } catch { /* fallback below */ }
  }

  if (suggestions.length === 0 && premium.length > 0) {
    const pick = premium[0];
    const signalContentId = suggestPremiumFromSignals(digest, premium);
    suggestions = [
      {
        title: signalContentId ? `Unlock ${premium.find((p) => p.id === signalContentId)?.title ?? pick.title}` : `Unlock ${pick.title}`,
        reason: digest.tags[0] ? `Because: ${digest.tags[0]}` : "Based on recent activity",
        contentId: signalContentId ?? pick.id,
      },
    ];
  }

  const now = Date.now();
  const offers: Offer[] = suggestions.slice(0, 4).map((s, i) => ({
    id: randomBytes(4).toString("hex"),
    deviceId,
    title: s.title,
    reason: s.reason,
    body: s.reason,
    contentId: s.contentId,
    discount: s.discount,
    confidence: 0.75 - i * 0.08,
    delivery: "draft",
    published: false,
    pendingPush: false,
    createdAt: now,
    expiresAt: now + 7 * 86_400_000,
  }));

  const existing = readOffers(deviceId);
  const merged = [...offers, ...existing].slice(0, 40);
  writeOffers(deviceId, merged);
  return offers;
}

export function createOffer(
  deviceId: string,
  input: {
    title: string;
    reason: string;
    body?: string;
    contentId?: string;
    discount?: string;
    html?: string;
  },
  keys?: AccessKeys,
): Offer {
  assertDeviceIntelAccess(deviceId, keys ?? {}, true);
  const now = Date.now();
  const offer: Offer = {
    id: randomBytes(4).toString("hex"),
    deviceId,
    title: input.title.trim(),
    reason: input.reason.trim(),
    body: (input.body ?? input.reason).trim(),
    contentId: input.contentId,
    discount: input.discount,
    html: input.html,
    confidence: 1,
    delivery: "draft",
    published: false,
    pendingPush: false,
    createdAt: now,
    expiresAt: now + 14 * 86_400_000,
  };
  const offers = readOffers(deviceId);
  offers.unshift(offer);
  writeOffers(deviceId, offers.slice(0, 40));
  return offer;
}

export function updateOffer(
  deviceId: string,
  offerId: string,
  patch: Partial<Pick<Offer, "title" | "reason" | "body" | "contentId" | "discount" | "html">>,
  keys?: AccessKeys,
): Offer | null {
  assertDeviceIntelAccess(deviceId, keys ?? {}, true);
  const offers = readOffers(deviceId);
  const idx = offers.findIndex((o) => o.id === offerId);
  if (idx < 0) return null;
  offers[idx] = { ...offers[idx], ...patch };
  if (patch.reason && !patch.body) offers[idx].body = patch.reason;
  writeOffers(deviceId, offers);
  return offers[idx];
}

export function listOffers(deviceId: string, keys?: AccessKeys): Offer[] {
  assertDeviceIntelAccess(deviceId, keys ?? {});
  return readOffers(deviceId);
}

export function listPublishedOffers(deviceId?: string): Offer[] {
  const dir = offersDir();
  if (!existsSync(dir)) return [];
  const all: Offer[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const id = f.replace(".json", "");
    if (deviceId && id !== deviceId) continue;
    all.push(
      ...readOffers(id).filter(
        (o) => o.published && (o.delivery === "browse" || o.parentOfferId),
      ),
    );
  }
  return all.sort((a, b) => (b.sentAt ?? b.createdAt) - (a.sentAt ?? a.createdAt));
}

export function onOfferDismissed(deviceId: string, offerId: string) {
  const offers = readOffers(deviceId);
  const idx = offers.findIndex((o) => o.id === offerId);
  if (idx < 0) return;
  const offer = offers[idx];
  if (offer.delivery === "browse" || offer.retargetBrowsePublished) return;
  if (offer.delivery !== "popup" && offer.delivery !== "notification") return;

  const now = Date.now();
  const browseOffer: Offer = {
    ...offer,
    id: randomBytes(4).toString("hex"),
    delivery: "browse",
    published: true,
    pendingPush: false,
    parentOfferId: offer.id,
    retargetBrowsePublished: false,
    sentAt: now,
    createdAt: now,
  };
  offers[idx].retargetBrowsePublished = true;
  offers.unshift(browseOffer);
  writeOffers(deviceId, offers.slice(0, 40));
}

export function listPendingPush(deviceId: string): Offer[] {
  return readOffers(deviceId).filter(
    (o) => o.pendingPush && (o.delivery === "notification" || o.delivery === "popup"),
  );
}

export function sendOffer(
  deviceId: string,
  offerId: string,
  delivery: OfferDelivery,
  keys?: AccessKeys,
): { offer: Offer; pushed: boolean } | null {
  assertDeviceIntelAccess(deviceId, keys ?? {}, true);
  if (delivery === "draft") return null;

  const sentToday = countOffersSentToday(deviceId);
  const gate = canSendToDevice(deviceId, sentToday);
  if (!gate.ok) throw new Error(gate.reason ?? "send blocked");
  if (isQuietHours() && (delivery === "notification" || delivery === "popup")) {
    throw new Error("Quiet hours — cannot send notifications/popups now");
  }

  const offers = readOffers(deviceId);
  const idx = offers.findIndex((o) => o.id === offerId);
  if (idx < 0) return null;

  const now = Date.now();
  offers[idx].delivery = delivery;
  offers[idx].sentAt = now;
  if (delivery === "browse") {
    offers[idx].published = true;
    offers[idx].pendingPush = false;
  } else {
    offers[idx].pendingPush = true;
    offers[idx].published = false;
  }
  writeOffers(deviceId, offers);

  const offer = offers[idx];
  const pushed =
    delivery === "notification" || delivery === "popup"
      ? pushToPhone(deviceId, pushPayload(offer))
      : false;
  if (pushed && offer.pendingPush) {
    offers[idx].pendingPush = false;
    writeOffers(deviceId, offers);
  }
  auditLog({
    actor: keys?.marketingKey ? "marketer" : "admin",
    action: "offer_send",
    detail: `${offer.title} → ${delivery}`,
    deviceId,
    campaignId: offer.campaignId,
  });
  recordOfferEvent({
    offerId: offer.id,
    deviceId,
    type: "impression",
    campaignId: offer.campaignId,
    triggerId: offer.triggerId,
    variantId: offer.variantId,
  });
  return { offer: offers[idx], pushed };
}

export function publishOffer(deviceId: string, offerId: string, keys?: AccessKeys): Offer | null {
  const result = sendOffer(deviceId, offerId, "browse", keys);
  return result?.offer ?? null;
}

export function ackOfferDelivery(deviceId: string, offerId: string): boolean {
  const offers = readOffers(deviceId);
  const idx = offers.findIndex((o) => o.id === offerId);
  if (idx < 0) return false;
  offers[idx].pendingPush = false;
  writeOffers(deviceId, offers);
  return true;
}
