import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataPath } from "./dataPath.js";

export interface ScreenSession {
  id: string;
  deviceId: string;
  pkg: string;
  app: string;
  activityType: string;
  screenTitle: string;
  summary: string;
  highlights: string[];
  startedAt: number;
  endedAt: number;
  updateCount: number;
  durationMs: number;
}

const MAX_SESSIONS = 10_000;

function sessionsDir(): string {
  return dataPath("screen-sessions");
}

function readSessions(deviceId: string): ScreenSession[] {
  const path = join(sessionsDir(), `${deviceId}.json`);
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { sessions?: ScreenSession[] };
    return data.sessions ?? [];
  } catch {
    return [];
  }
}

function writeSessions(deviceId: string, sessions: ScreenSession[]) {
  const dir = sessionsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  while (sessions.length > MAX_SESSIONS) sessions.shift();
  writeFileSync(
    join(dir, `${deviceId}.json`),
    JSON.stringify({ sessions }, null, 2) + "\n",
    "utf8",
  );
}

export function appendScreenSessions(
  deviceId: string,
  items: {
    id: string;
    pkg?: string;
    app?: string;
    activityType?: string;
    screenTitle?: string;
    summary?: string;
    highlights?: string[];
    startedAt?: number;
    endedAt?: number;
    updateCount?: number;
    durationMs?: number;
  }[],
) {
  if (!items.length) return;
  const existing = readSessions(deviceId);
  const byId = new Map(existing.map((s) => [s.id, s]));

  for (const raw of items) {
    if (!raw.id) continue;
    const startedAt = Number(raw.startedAt ?? Date.now());
    const endedAt = Number(raw.endedAt ?? startedAt);
    const session: ScreenSession = {
      id: raw.id,
      deviceId,
      pkg: String(raw.pkg ?? ""),
      app: String(raw.app ?? raw.pkg ?? "App"),
      activityType: String(raw.activityType ?? "use_app"),
      screenTitle: String(raw.screenTitle ?? ""),
      summary: String(raw.summary ?? ""),
      highlights: Array.isArray(raw.highlights) ? raw.highlights.map(String).slice(0, 12) : [],
      startedAt,
      endedAt,
      updateCount: Number(raw.updateCount ?? 1),
      durationMs: Number(raw.durationMs ?? Math.max(0, endedAt - startedAt)),
    };
    byId.set(session.id, session);
  }

  const merged = [...byId.values()].sort((a, b) => b.endedAt - a.endedAt);
  writeSessions(deviceId, merged);
}

export function getScreenSessions(deviceId: string, from?: number, to?: number): ScreenSession[] {
  let rows = readSessions(deviceId);
  if (from != null) rows = rows.filter((r) => r.endedAt >= from);
  if (to != null) rows = rows.filter((r) => r.startedAt <= to);
  return rows.sort((a, b) => b.endedAt - a.endedAt);
}

export function screenSessionsByType(sessions: ScreenSession[]) {
  const map = new Map<string, { type: string; count: number; totalMs: number; apps: Set<string> }>();
  for (const s of sessions) {
    const cur = map.get(s.activityType) ?? { type: s.activityType, count: 0, totalMs: 0, apps: new Set() };
    cur.count++;
    cur.totalMs += s.durationMs;
    cur.apps.add(s.app);
    map.set(s.activityType, cur);
  }
  return [...map.values()]
    .map((v) => ({ type: v.type, count: v.count, totalMinutes: Math.round(v.totalMs / 60_000), apps: [...v.apps] }))
    .sort((a, b) => b.count - a.count);
}
