import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { assertAdmin } from "./authKeys.js";

export interface MarketingGuardrails {
  quietHoursStart: number;
  quietHoursEnd: number;
  maxOffersPerDevicePerDay: number;
  requireCampaignApproval: boolean;
}

export interface AuditEntry {
  id: string;
  ts: number;
  actor: string;
  action: string;
  detail: string;
  deviceId?: string;
  campaignId?: string;
}

interface SettingsFile {
  guardrails: MarketingGuardrails;
  optOutDevices: string[];
  audit: AuditEntry[];
}

const DEFAULT_GUARDRAILS: MarketingGuardrails = {
  quietHoursStart: 23,
  quietHoursEnd: 8,
  maxOffersPerDevicePerDay: 3,
  requireCampaignApproval: false,
};

function settingsPath(): string {
  const cwd = join(process.cwd(), "data", "marketing-settings.json");
  if (existsSync(cwd)) return cwd;
  return join(dirname(fileURLToPath(import.meta.url)), "..", "data", "marketing-settings.json");
}

function readSettings(): SettingsFile {
  const path = settingsPath();
  if (!existsSync(path)) {
    return { guardrails: DEFAULT_GUARDRAILS, optOutDevices: [], audit: [] };
  }
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as SettingsFile;
    return {
      guardrails: { ...DEFAULT_GUARDRAILS, ...data.guardrails },
      optOutDevices: data.optOutDevices ?? [],
      audit: data.audit ?? [],
    };
  } catch {
    return { guardrails: DEFAULT_GUARDRAILS, optOutDevices: [], audit: [] };
  }
}

function writeSettings(data: SettingsFile) {
  const path = settingsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  while (data.audit.length > 5000) data.audit.shift();
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function getGuardrails(): MarketingGuardrails {
  return readSettings().guardrails;
}

export function updateGuardrails(patch: Partial<MarketingGuardrails>, editKey?: string) {
  assertAdmin(editKey);
  const data = readSettings();
  data.guardrails = { ...data.guardrails, ...patch };
  writeSettings(data);
  return data.guardrails;
}

export function isDeviceOptOut(deviceId: string): boolean {
  return readSettings().optOutDevices.includes(deviceId);
}

export function setDeviceOptOut(deviceId: string, optOut: boolean, editKey?: string) {
  assertAdmin(editKey);
  const data = readSettings();
  if (optOut && !data.optOutDevices.includes(deviceId)) {
    data.optOutDevices.push(deviceId);
  } else if (!optOut) {
    data.optOutDevices = data.optOutDevices.filter((id) => id !== deviceId);
  }
  writeSettings(data);
}

export function auditLog(entry: Omit<AuditEntry, "id" | "ts">) {
  const data = readSettings();
  data.audit.push({
    id: randomBytes(4).toString("hex"),
    ts: Date.now(),
    ...entry,
  });
  writeSettings(data);
}

export function listAudit(limit = 200): AuditEntry[] {
  return readSettings().audit.slice(-limit).reverse();
}

export function isQuietHours(now = new Date()): boolean {
  const { quietHoursStart, quietHoursEnd } = getGuardrails();
  const h = now.getHours();
  if (quietHoursStart > quietHoursEnd) {
    return h >= quietHoursStart || h < quietHoursEnd;
  }
  return h >= quietHoursStart && h < quietHoursEnd;
}

export function canSendToDevice(deviceId: string, sentToday: number): { ok: boolean; reason?: string } {
  if (isDeviceOptOut(deviceId)) return { ok: false, reason: "opt_out" };
  const caps = getGuardrails();
  if (sentToday >= caps.maxOffersPerDevicePerDay) {
    return { ok: false, reason: "frequency_cap" };
  }
  return { ok: true };
}
