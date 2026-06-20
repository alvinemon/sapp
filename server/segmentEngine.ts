import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { assertAdmin } from "./authKeys.js";
import { resolveAccess } from "./marketingAuth.js";
import { getNotifications } from "./intelStore.js";
import { listDeviceProfiles, type DeviceProfile } from "./deviceProfile.js";
import type { MarketingMember } from "./marketingTeam.js";

export interface SegmentRules {
  areas?: string[];
  tags?: string[];
  minActivity?: number;
  onlineOnly?: boolean;
  apps?: string[];
  keywordMatch?: string;
  lastSeenWithinHours?: number;
}

export interface Segment {
  id: string;
  name: string;
  description?: string;
  rules: SegmentRules;
  deviceIds: string[];
  memberCount: number;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
}

function segmentsPath(): string {
  const cwd = join(process.cwd(), "data", "segments.json");
  if (existsSync(cwd)) return cwd;
  const alt = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "segments.json");
  return alt;
}

function readAll(): Segment[] {
  const path = segmentsPath();
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { segments?: Segment[] };
    return data.segments ?? [];
  } catch {
    return [];
  }
}

function writeAll(segments: Segment[]) {
  const path = segmentsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify({ segments }, null, 2) + "\n", "utf8");
}

function weekAgo() {
  return Date.now() - 7 * 86_400_000;
}

function profileMatchesRules(profile: DeviceProfile, rules: SegmentRules): boolean {
  if (rules.areas?.length && !rules.areas.includes(profile.area)) return false;
  if (rules.tags?.length && !rules.tags.some((t) => profile.tags.includes(t))) return false;
  if (rules.minActivity != null && profile.activityScore < rules.minActivity) return false;
  if (rules.onlineOnly && !profile.online) return false;
  if (rules.lastSeenWithinHours != null) {
    const cutoff = Date.now() - rules.lastSeenWithinHours * 3_600_000;
    if (profile.lastSeen < cutoff) return false;
  }

  if (rules.apps?.length || rules.keywordMatch) {
    const notifs = getNotifications(profile.deviceId, weekAgo());
    if (rules.apps?.length) {
      const hit = notifs.some((n) =>
        rules.apps!.some(
          (a) =>
            n.app.toLowerCase().includes(a.toLowerCase()) ||
            n.pkg.toLowerCase().includes(a.toLowerCase()),
        ),
      );
      if (!hit) return false;
    }
    if (rules.keywordMatch) {
      const re = new RegExp(rules.keywordMatch, "i");
      const hit = notifs.some((n) => re.test(`${n.title} ${n.text}`));
      if (!hit) return false;
    }
  }

  return true;
}

export function evaluateSegment(
  rules: SegmentRules,
  scopeDeviceIds?: string[],
): { deviceIds: string[]; count: number } {
  let profiles = listDeviceProfiles(
    scopeDeviceIds?.length ? { deviceIds: scopeDeviceIds } : undefined,
  );
  profiles = profiles.filter((p) => profileMatchesRules(p, rules));
  const deviceIds = profiles.map((p) => p.deviceId);
  return { deviceIds, count: deviceIds.length };
}

function intersect(a: string[], b: string[]): string[] {
  const set = new Set(b);
  return a.filter((id) => set.has(id));
}

export function listSegments(keys?: { editKey?: string; marketingKey?: string }): Segment[] {
  const ctx = keys ? resolveAccess(keys) : null;
  if (keys && !ctx) throw new Error("Access denied");

  let segments = readAll().map((s) => {
    const { deviceIds, count } = evaluateSegment(s.rules);
    return { ...s, deviceIds, memberCount: count, updatedAt: s.updatedAt };
  });

  if (ctx?.role === "marketing") {
    const allowed = new Set(ctx.member.deviceIds);
    segments = segments
      .map((s) => {
        const ids = s.deviceIds.filter((id) => allowed.has(id));
        return { ...s, deviceIds: ids, memberCount: ids.length };
      })
      .filter((s) => s.memberCount > 0 || s.createdBy === ctx.member.id);
  }

  return segments.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSegment(id: string, keys?: { editKey?: string; marketingKey?: string }): Segment | null {
  return listSegments(keys).find((s) => s.id === id) ?? null;
}

export function previewSegment(
  rules: SegmentRules,
  keys?: { editKey?: string; marketingKey?: string },
): { deviceIds: string[]; count: number } {
  const ctx = keys ? resolveAccess(keys) : null;
  if (keys && !ctx) throw new Error("Access denied");
  const scope = ctx?.role === "marketing" ? ctx.member.deviceIds : undefined;
  return evaluateSegment(rules, scope);
}

export function createSegment(
  input: { name: string; description?: string; rules: SegmentRules; createdBy?: string },
  keys?: { editKey?: string; marketingKey?: string },
): Segment {
  const ctx = keys ? resolveAccess(keys) : null;
  if (keys && !ctx) throw new Error("Access denied");
  if (ctx?.role === "admin") {
    assertAdmin(keys!.editKey);
  } else if (ctx?.role !== "marketing") {
    assertAdmin(keys?.editKey);
  }

  const now = Date.now();
  const scope = ctx?.role === "marketing" ? ctx.member.deviceIds : undefined;
  const { deviceIds, count } = evaluateSegment(input.rules, scope);
  const segment: Segment = {
    id: randomBytes(6).toString("hex"),
    name: input.name.trim(),
    description: input.description?.trim(),
    rules: input.rules,
    deviceIds,
    memberCount: count,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy ?? (ctx?.role === "marketing" ? ctx.member.id : "admin"),
  };
  const all = readAll();
  all.unshift(segment);
  writeAll(all);
  return segment;
}

export function updateSegment(
  id: string,
  patch: Partial<Pick<Segment, "name" | "description" | "rules">>,
  editKey?: string,
): Segment | null {
  assertAdmin(editKey);
  const all = readAll();
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const rules = patch.rules ?? all[idx].rules;
  const { deviceIds, count } = evaluateSegment(rules);
  all[idx] = {
    ...all[idx],
    ...patch,
    rules,
    deviceIds,
    memberCount: count,
    updatedAt: Date.now(),
  };
  writeAll(all);
  return all[idx];
}

export function deleteSegment(id: string, editKey?: string): boolean {
  assertAdmin(editKey);
  const all = readAll();
  const before = all.length;
  const next = all.filter((s) => s.id !== id);
  if (next.length === before) return false;
  writeAll(next);
  return true;
}

export function segmentDeviceIdsForMember(
  segmentId: string,
  member: MarketingMember,
): string[] {
  const seg = readAll().find((s) => s.id === segmentId);
  if (!seg) return [];
  const { deviceIds } = evaluateSegment(seg.rules);
  return intersect(deviceIds, member.deviceIds);
}
