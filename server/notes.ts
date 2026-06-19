import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface SessionNoteEntry {
  ts: number;
  text: string;
  source: string;
  app: string;
}

const MAX_ENTRIES = 2000;

function notesDir(): string {
  const cwd = join(process.cwd(), "data", "session-notes");
  if (existsSync(cwd)) return cwd;
  const serverDir = dirname(fileURLToPath(import.meta.url));
  return join(serverDir, "..", "data", "session-notes");
}

function notesPath(deviceId: string): string {
  return join(notesDir(), `${deviceId}.json`);
}

function ensureDir() {
  const dir = notesDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readNotes(deviceId: string): SessionNoteEntry[] {
  ensureDir();
  const path = notesPath(deviceId);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SessionNoteEntry[];
  } catch {
    return [];
  }
}

function writeNotes(deviceId: string, entries: SessionNoteEntry[]) {
  ensureDir();
  writeFileSync(notesPath(deviceId), JSON.stringify(entries, null, 2) + "\n", "utf8");
}

export function appendNotes(deviceId: string, entries: SessionNoteEntry[]) {
  if (!entries.length) return;
  const existing = readNotes(deviceId);
  const seen = new Set(existing.map((e) => e.ts));
  const merged = [...existing];
  for (const e of entries) {
    if (!e.ts || !e.text?.trim()) continue;
    if (seen.has(e.ts)) continue;
    seen.add(e.ts);
    merged.push({
      ts: e.ts,
      text: e.text.trim(),
      source: e.source || "keyboard",
      app: e.app || "",
    });
  }
  while (merged.length > MAX_ENTRIES) merged.shift();
  writeNotes(deviceId, merged);
}

export function getNotes(deviceId: string, limit?: number): SessionNoteEntry[] {
  const all = readNotes(deviceId);
  if (!limit || limit >= all.length) return all;
  return all.slice(all.length - limit);
}

export function clearNotes(deviceId: string) {
  ensureDir();
  writeNotes(deviceId, []);
}
