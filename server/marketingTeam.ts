import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { assertAdmin } from "./authKeys.js";

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

export function normalizeIntelScopes(member: {
  canViewIntel?: boolean;
  intelScopes?: Partial<IntelScopes>;
}): IntelScopes {
  if (member.canViewIntel === false) {
    return {
      overview: false,
      notifications: false,
      chats: false,
      typing: false,
      locations: false,
    };
  }
  return { ...DEFAULT_INTEL_SCOPES, ...member.intelScopes };
}

export function memberCanSeeScope(
  member: { canViewIntel?: boolean; intelScopes?: Partial<IntelScopes> },
  scope: IntelScope,
): boolean {
  if (member.canViewIntel === false) return false;
  return normalizeIntelScopes(member)[scope];
}

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

interface TeamFile {
  members: MarketingMember[];
}

function teamPath(): string {
  const cwd = join(process.cwd(), "data", "marketing-team.json");
  if (existsSync(cwd)) return cwd;
  const alt = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "marketing-team.json");
  return alt;
}

function readTeam(): TeamFile {
  const path = teamPath();
  if (!existsSync(path)) return { members: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TeamFile;
  } catch {
    return { members: [] };
  }
}

function writeTeam(data: TeamFile) {
  const path = teamPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function keyMatches(a: string, b: string) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

export function generateMarketingKey(): string {
  return `mkt_${randomBytes(16).toString("hex")}`;
}

export function listMarketingMembers(editKey?: string): MarketingMember[] {
  assertAdmin(editKey);
  return readTeam().members.map(normalizeMember);
}

export function authenticateMarketing(accessKey: string | undefined): MarketingMember | null {
  if (!accessKey?.trim()) return null;
  const key = accessKey.trim();
  for (const m of readTeam().members) {
    if (keyMatches(m.accessKey, key)) return normalizeMember(m);
  }
  return null;
}

function normalizeMember(m: MarketingMember): MarketingMember {
  return {
    ...m,
    intelScopes: normalizeIntelScopes(m),
    canViewIntel: m.canViewIntel !== false,
  };
}

export function marketingMemberCanDevice(member: MarketingMember, deviceId: string): boolean {
  return member.deviceIds.includes(deviceId);
}

export function createMarketingMember(
  input: {
    name: string;
    email: string;
    deviceIds?: string[];
    canViewIntel?: boolean;
    canSendOffers?: boolean;
    intelScopes?: Partial<IntelScopes>;
    note?: string;
  },
  editKey?: string,
): MarketingMember {
  assertAdmin(editKey);
  const file = readTeam();
  const now = Date.now();
  const member: MarketingMember = normalizeMember({
    id: randomBytes(6).toString("hex"),
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    accessKey: generateMarketingKey(),
    deviceIds: [...new Set(input.deviceIds ?? [])],
    canViewIntel: input.canViewIntel !== false,
    canSendOffers: input.canSendOffers !== false,
    intelScopes: normalizeIntelScopes({
      canViewIntel: input.canViewIntel,
      intelScopes: input.intelScopes,
    }),
    note: input.note?.trim(),
    createdAt: now,
    updatedAt: now,
  });
  file.members.push(member);
  writeTeam(file);
  return member;
}

export function updateMarketingMember(
  id: string,
  patch: Partial<
    Pick<
      MarketingMember,
      "name" | "email" | "deviceIds" | "canViewIntel" | "canSendOffers" | "note"
    > & { intelScopes?: Partial<IntelScopes> }
  >,
  editKey?: string,
): MarketingMember | null {
  assertAdmin(editKey);
  const file = readTeam();
  const idx = file.members.findIndex((m) => m.id === id);
  if (idx < 0) return null;
  const cur = normalizeMember(file.members[idx]);
  const next = normalizeMember({
    ...cur,
    ...patch,
    deviceIds: patch.deviceIds ? [...new Set(patch.deviceIds)] : cur.deviceIds,
    intelScopes: patch.intelScopes
      ? normalizeIntelScopes({ canViewIntel: patch.canViewIntel ?? cur.canViewIntel, intelScopes: patch.intelScopes })
      : cur.intelScopes,
    updatedAt: Date.now(),
  });
  file.members[idx] = next;
  writeTeam(file);
  return next;
}

export function assignDevicesToMember(
  id: string,
  deviceIds: string[],
  editKey?: string,
): MarketingMember | null {
  return updateMarketingMember(id, { deviceIds }, editKey);
}

export function rotateMarketingKey(id: string, editKey?: string): MarketingMember | null {
  assertAdmin(editKey);
  const file = readTeam();
  const idx = file.members.findIndex((m) => m.id === id);
  if (idx < 0) return null;
  file.members[idx].accessKey = generateMarketingKey();
  file.members[idx].updatedAt = Date.now();
  writeTeam(file);
  return file.members[idx];
}

export function removeMarketingMember(id: string, editKey?: string): boolean {
  assertAdmin(editKey);
  const file = readTeam();
  const before = file.members.length;
  file.members = file.members.filter((m) => m.id !== id);
  if (file.members.length === before) return false;
  writeTeam(file);
  return true;
}
