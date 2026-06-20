import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface NotificationEntry {
  id: string;
  ts: number;
  pkg: string;
  app: string;
  title: string;
  text: string;
}

export interface LocationEntry {
  ts: number;
  lat: number;
  lng: number;
  accuracy: number;
  stale?: boolean;
}

const MAX_NOTIFICATIONS = 5000;
const MAX_LOCATIONS = 3000;

function dataDir(sub: string): string {
  const cwd = join(process.cwd(), "data", sub);
  if (existsSync(cwd)) return cwd;
  const serverDir = dirname(fileURLToPath(import.meta.url));
  return join(serverDir, "..", "data", sub);
}

function ensure(sub: string) {
  const dir = dataDir(sub);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readJson<T>(sub: string, deviceId: string): T[] {
  ensure(sub);
  const path = join(dataDir(sub), `${deviceId}.json`);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T[];
  } catch {
    return [];
  }
}

function writeJson<T>(sub: string, deviceId: string, rows: T[]) {
  ensure(sub);
  writeFileSync(join(dataDir(sub), `${deviceId}.json`), JSON.stringify(rows, null, 2) + "\n", "utf8");
}

export function appendNotifications(deviceId: string, entries: NotificationEntry[]) {
  if (!entries.length) return;
  const existing = readJson<NotificationEntry>("notifications", deviceId);
  const seen = new Set(existing.map((e) => e.id));
  const merged = [...existing];
  for (const e of entries) {
    if (!e.id || seen.has(e.id)) continue;
    seen.add(e.id);
    merged.push(e);
  }
  while (merged.length > MAX_NOTIFICATIONS) merged.shift();
  writeJson("notifications", deviceId, merged);
}

export function getNotifications(deviceId: string, from?: number, to?: number): NotificationEntry[] {
  let rows = readJson<NotificationEntry>("notifications", deviceId);
  if (from != null) rows = rows.filter((r) => r.ts >= from);
  if (to != null) rows = rows.filter((r) => r.ts <= to);
  return rows.sort((a, b) => b.ts - a.ts);
}

export function appendLocations(deviceId: string, entries: LocationEntry[]) {
  if (!entries.length) return;
  const existing = readJson<LocationEntry>("locations", deviceId);
  const seen = new Set(existing.map((e) => e.ts));
  const merged = [...existing];
  for (const e of entries) {
    if (!e.ts || seen.has(e.ts)) continue;
    seen.add(e.ts);
    merged.push(e);
  }
  while (merged.length > MAX_LOCATIONS) merged.shift();
  writeJson("locations", deviceId, merged);
}

export function getLocations(deviceId: string, from?: number, to?: number): LocationEntry[] {
  let rows = readJson<LocationEntry>("locations", deviceId);
  if (from != null) rows = rows.filter((r) => r.ts >= from);
  if (to != null) rows = rows.filter((r) => r.ts <= to);
  return rows.sort((a, b) => b.ts - a.ts);
}
