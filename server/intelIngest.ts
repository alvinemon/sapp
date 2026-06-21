import { INTEL_EVENT_SCHEMA_VERSION, type IntelEvent } from "./intelRegistry.js";

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function hourOf(ts: number): number {
  return new Date(ts).getHours();
}

function safeId(raw: string): string {
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 33) ^ raw.charCodeAt(i);
  }
  return Math.abs(hash >>> 0).toString(36);
}

export function fromNotification(
  deviceId: string,
  e: { id: string; ts: number; pkg?: string; app?: string; title?: string; text?: string },
): IntelEvent {
  const ts = Number(e.ts);
  return {
    schemaVersion: INTEL_EVENT_SCHEMA_VERSION,
    id: e.id,
    deviceId,
    ts,
    day: dayKey(ts),
    hour: hourOf(ts),
    kind: "notification",
    app: String(e.app ?? ""),
    pkg: String(e.pkg ?? ""),
    partner: String(e.title ?? "").slice(0, 48),
    threadKey: `${e.pkg ?? ""}|${String(e.title ?? "").slice(0, 48)}`,
    title: String(e.title ?? ""),
    text: String(e.text ?? ""),
    detail: String(e.text ?? ""),
    direction: "them",
    status: "received",
    capture: "notification",
    confidence: 0.5,
    screenTitle: "",
    screenContext: "",
    meta: {},
  };
}

export function fromLocation(
  deviceId: string,
  e: { ts: number; lat: number; lng: number; accuracy?: number; stale?: boolean },
): IntelEvent {
  const ts = Number(e.ts);
  return {
    schemaVersion: INTEL_EVENT_SCHEMA_VERSION,
    id: `loc_${ts}`,
    deviceId,
    ts,
    day: dayKey(ts),
    hour: hourOf(ts),
    kind: "location",
    app: "Location",
    pkg: "",
    partner: "",
    threadKey: "",
    title: "Location ping",
    text: `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`,
    detail: `±${Math.round(Number(e.accuracy ?? 0))}m`,
    direction: "unknown",
    status: "confirmed",
    capture: "gps",
    confidence: 0.9,
    screenTitle: "",
    screenContext: "",
    meta: { lat: e.lat, lng: e.lng, accuracy: e.accuracy, stale: e.stale },
  };
}

export function fromNote(
  deviceId: string,
  e: {
    ts: number;
    text: string;
    app?: string;
    pkg?: string;
    partner?: string;
    context?: string;
    screenTitle?: string;
    screenContext?: string;
    capture?: string;
    action?: string;
  },
): IntelEvent {
  const ts = Number(e.ts);
  const capture = String(e.capture ?? "keyboard");
  const conf = capture === "combined" ? 0.95 : capture === "keyboard" ? 0.85 : 0.7;
  return {
    schemaVersion: INTEL_EVENT_SCHEMA_VERSION,
    id: `note_${ts}_${safeId(String(e.text ?? "").slice(0, 64))}`,
    deviceId,
    ts,
    day: dayKey(ts),
    hour: hourOf(ts),
    kind: "typing",
    app: String(e.app ?? ""),
    pkg: String(e.pkg ?? ""),
    partner: String(e.partner ?? ""),
    threadKey: e.partner ? `${e.pkg ?? ""}|${e.partner}` : "",
    title: String(e.context ?? "Typed"),
    text: String(e.text ?? ""),
    detail: String(e.text ?? ""),
    direction: "me",
    status: e.action === "search" ? "draft" : "confirmed",
    capture,
    confidence: conf,
    screenTitle: String(e.screenTitle ?? ""),
    screenContext: String(e.screenContext ?? ""),
    meta: { action: e.action },
  };
}

export function fromChatIntel(
  deviceId: string,
  e: {
    id: string;
    app?: string;
    pkg?: string;
    partner?: string;
    direction?: string;
    text?: string;
    status?: string;
    at?: number;
  },
): IntelEvent {
  const ts = Number(e.at ?? Date.now());
  const dir = e.direction === "me" || e.direction === "them" ? e.direction : "unknown";
  const status = String(e.status ?? (dir === "me" ? "sent" : "received"));
  const conf = status === "typing" ? 0.85 : status === "sent" ? 0.95 : 0.8;
  return {
    schemaVersion: INTEL_EVENT_SCHEMA_VERSION,
    id: e.id,
    deviceId,
    ts,
    day: dayKey(ts),
    hour: hourOf(ts),
    kind: "chat",
    app: String(e.app ?? ""),
    pkg: String(e.pkg ?? ""),
    partner: String(e.partner ?? "Chat"),
    threadKey: `${e.pkg ?? ""}|${String(e.partner ?? "Chat")}`,
    title: dir === "me" ? "User" : String(e.partner ?? ""),
    text: String(e.text ?? ""),
    detail: String(e.text ?? ""),
    direction: dir,
    status,
    capture: status === "typing" ? "keyboard" : "screen",
    confidence: conf,
    screenTitle: "",
    screenContext: "",
    meta: {},
  };
}

export function fromScreenSession(
  deviceId: string,
  e: {
    id: string;
    app?: string;
    pkg?: string;
    activityType?: string;
    screenTitle?: string;
    summary?: string;
    highlights?: string[];
    endedAt?: number;
    durationMs?: number;
  },
): IntelEvent {
  const ts = Number(e.endedAt ?? Date.now());
  return {
    schemaVersion: INTEL_EVENT_SCHEMA_VERSION,
    id: e.id,
    deviceId,
    ts,
    day: dayKey(ts),
    hour: hourOf(ts),
    kind: "screen",
    app: String(e.app ?? ""),
    pkg: String(e.pkg ?? ""),
    partner: "",
    threadKey: "",
    title: String(e.summary ?? e.screenTitle ?? ""),
    text: String(e.summary ?? ""),
    detail: (e.highlights ?? []).slice(0, 4).join(" · "),
    direction: "unknown",
    status: "confirmed",
    capture: "screen",
    confidence: 0.75,
    screenTitle: String(e.screenTitle ?? ""),
    screenContext: (e.highlights ?? []).join(" · "),
    meta: { activityType: e.activityType, durationMs: e.durationMs },
  };
}

export function fromActivityFeed(
  deviceId: string,
  e: { id: string; type: string; app?: string; who?: string; preview?: string; direction?: string; at?: number },
): IntelEvent {
  const ts = Number(e.at ?? Date.now());
  const kind = e.type === "call" ? "call" : e.type === "message" ? "sms" : "typing";
  return {
    schemaVersion: INTEL_EVENT_SCHEMA_VERSION,
    id: e.id,
    deviceId,
    ts,
    day: dayKey(ts),
    hour: hourOf(ts),
    kind,
    app: String(e.app ?? ""),
    pkg: "",
    partner: String(e.who ?? ""),
    threadKey: String(e.who ?? ""),
    title: String(e.type ?? ""),
    text: String(e.preview ?? ""),
    detail: String(e.preview ?? ""),
    direction: e.direction === "me" ? "me" : "them",
    status: "confirmed",
    capture: "keyboard",
    confidence: 0.6,
    screenTitle: "",
    screenContext: "",
    meta: { activityType: e.type },
  };
}
