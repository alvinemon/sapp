import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { assertAdmin } from "./authKeys.js";
import { getNotifications, getLocations } from "./intelStore.js";
import { getSegment } from "./segmentEngine.js";
import { createAndSendOffer, countOffersSentToday } from "./offerEngine.js";
import {
  auditLog,
  canSendToDevice,
  isQuietHours,
} from "./marketingSettings.js";
import { recordOfferEvent } from "./offerEvents.js";
import { areaFromCoords } from "./areaLabel.js";
import { listDevices } from "./relay.js";

export type TriggerEvent = "notification" | "location_enter" | "inactive_days";

export interface TriggerWhen {
  event: TriggerEvent;
  match?: { app?: string; keyword?: string; area?: string };
  count?: number;
  windowHours?: number;
}

export interface TriggerThen {
  title: string;
  reason: string;
  body: string;
  contentId?: string;
  discount?: string;
  delivery: "notification" | "popup" | "browse";
  cooldownHours: number;
}

export interface Trigger {
  id: string;
  name: string;
  enabled: boolean;
  when: TriggerWhen;
  then: TriggerThen;
  segmentId?: string;
  lastFiredAt?: number;
  fireCount: number;
  createdAt: number;
}

interface TriggerState {
  deviceId: string;
  triggerId: string;
  lastFiredAt: number;
}

function triggersPath(): string {
  const cwd = join(process.cwd(), "data", "triggers.json");
  if (existsSync(cwd)) return cwd;
  return join(dirname(fileURLToPath(import.meta.url)), "..", "data", "triggers.json");
}

function statePath(): string {
  const cwd = join(process.cwd(), "data", "trigger-state.json");
  if (existsSync(cwd)) return cwd;
  return join(dirname(fileURLToPath(import.meta.url)), "..", "data", "trigger-state.json");
}

function readTriggers(): Trigger[] {
  const path = triggersPath();
  if (!existsSync(path)) return defaultTriggers();
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { triggers?: Trigger[] };
    return data.triggers?.length ? data.triggers : defaultTriggers();
  } catch {
    return defaultTriggers();
  }
}

function defaultTriggers(): Trigger[] {
  const now = Date.now();
  return [
    {
      id: "shop_intent",
      name: "Shopping intent",
      enabled: true,
      when: {
        event: "notification",
        match: { keyword: "order|cart|delivery|shop" },
        count: 2,
        windowHours: 48,
      },
      then: {
        title: "Deal for you",
        reason: "Based on your recent shopping alerts",
        body: "Unlock premium content with a special offer.",
        delivery: "popup",
        cooldownHours: 24,
      },
      fireCount: 0,
      createdAt: now,
    },
  ];
}

function writeTriggers(triggers: Trigger[]) {
  const path = triggersPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify({ triggers }, null, 2) + "\n", "utf8");
}

function readState(): TriggerState[] {
  const path = statePath();
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { states?: TriggerState[] };
    return data.states ?? [];
  } catch {
    return [];
  }
}

function writeState(states: TriggerState[]) {
  const path = statePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify({ states }, null, 2) + "\n", "utf8");
}

function lastFired(deviceId: string, triggerId: string): number {
  return readState().find((s) => s.deviceId === deviceId && s.triggerId === triggerId)?.lastFiredAt ?? 0;
}

function markFired(deviceId: string, triggerId: string) {
  const states = readState().filter((s) => !(s.deviceId === deviceId && s.triggerId === triggerId));
  states.push({ deviceId, triggerId, lastFiredAt: Date.now() });
  writeState(states);
}

function deviceIdsToScan(): string[] {
  const ids = new Set<string>();
  for (const d of listDevices()) ids.add(d.deviceId);
  const notifDir = join(process.cwd(), "data", "notifications");
  if (existsSync(notifDir)) {
    for (const f of readdirSync(notifDir)) {
      if (f.endsWith(".json")) ids.add(f.replace(".json", ""));
    }
  }
  return [...ids];
}

function matchesNotificationTrigger(deviceId: string, when: TriggerWhen): boolean {
  const windowMs = (when.windowHours ?? 24) * 3_600_000;
  const since = Date.now() - windowMs;
  const notifs = getNotifications(deviceId, since);
  let matched = notifs;
  if (when.match?.app) {
    const app = when.match.app.toLowerCase();
    matched = matched.filter(
      (n) => n.app.toLowerCase().includes(app) || n.pkg.toLowerCase().includes(app),
    );
  }
  if (when.match?.keyword) {
    const re = new RegExp(when.match.keyword, "i");
    matched = matched.filter((n) => re.test(`${n.title} ${n.text}`));
  }
  const need = when.count ?? 1;
  return matched.length >= need;
}

function matchesLocationTrigger(deviceId: string, when: TriggerWhen): boolean {
  if (!when.match?.area) return false;
  const locs = getLocations(deviceId, Date.now() - 3_600_000);
  if (!locs.length) return false;
  const area = areaFromCoords(locs[0].lat, locs[0].lng);
  return area === when.match.area;
}

export function listTriggers(editKey?: string): Trigger[] {
  assertAdmin(editKey);
  return readTriggers();
}

export function saveTrigger(input: Omit<Trigger, "id" | "fireCount" | "createdAt"> & { id?: string }, editKey?: string): Trigger {
  assertAdmin(editKey);
  const all = readTriggers();
  const now = Date.now();
  if (input.id) {
    const idx = all.findIndex((t) => t.id === input.id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...input, id: input.id };
      writeTriggers(all);
      return all[idx];
    }
  }
  const t: Trigger = {
    id: input.id ?? randomBytes(4).toString("hex"),
    name: input.name,
    enabled: input.enabled,
    when: input.when,
    then: input.then,
    segmentId: input.segmentId,
    fireCount: 0,
    createdAt: now,
  };
  all.unshift(t);
  writeTriggers(all);
  return t;
}

export function deleteTrigger(id: string, editKey?: string): boolean {
  assertAdmin(editKey);
  const all = readTriggers();
  const next = all.filter((t) => t.id !== id);
  if (next.length === all.length) return false;
  writeTriggers(next);
  return true;
}

export function runTriggerEngine() {
  if (isQuietHours()) return { fired: 0 };

  const triggers = readTriggers().filter((t) => t.enabled);
  let fired = 0;

  for (const deviceId of deviceIdsToScan()) {
    for (const trigger of triggers) {
      if (trigger.segmentId) {
        const seg = getSegment(trigger.segmentId);
        if (!seg?.deviceIds.includes(deviceId)) continue;
      }

      const cooldownMs = trigger.then.cooldownHours * 3_600_000;
      if (Date.now() - lastFired(deviceId, trigger.id) < cooldownMs) continue;

      let match = false;
      if (trigger.when.event === "notification") {
        match = matchesNotificationTrigger(deviceId, trigger.when);
      } else if (trigger.when.event === "location_enter") {
        match = matchesLocationTrigger(deviceId, trigger.when);
      }

      if (!match) continue;

      const sentToday = countOffersSentToday(deviceId);
      const gate = canSendToDevice(deviceId, sentToday);
      if (!gate.ok) continue;

      const result = createAndSendOffer(deviceId, {
        title: trigger.then.title,
        reason: trigger.then.reason,
        body: trigger.then.body,
        contentId: trigger.then.contentId,
        discount: trigger.then.discount,
        delivery: trigger.then.delivery,
        triggerId: trigger.id,
      });

      if (result) {
        markFired(deviceId, trigger.id);
        trigger.fireCount++;
        fired++;
        recordOfferEvent({
          offerId: result.offer.id,
          deviceId,
          type: "impression",
          triggerId: trigger.id,
        });
        auditLog({
          actor: "trigger",
          action: "trigger_fire",
          detail: trigger.name,
          deviceId,
        });
      }
    }
  }

  if (fired > 0) writeTriggers(triggers);
  return { fired };
}
