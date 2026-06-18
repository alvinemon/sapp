import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface DeviceRecord {
  deviceId: string;
  secret: string;
  label: string;
  model: string;
}

export interface User {
  id: string;
  email: string;
  phone: string;
  name: string;
  devices: DeviceRecord[];
  /** @deprecated migrated to devices */
  deviceIds?: string[];
  createdAt: number;
}

const DATA_DIR = join(process.cwd(), "data");
const USERS_FILE = join(DATA_DIR, "users.json");

let users: User[] = [];

function loadUsers() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    if (!existsSync(USERS_FILE)) {
      users = [];
      return;
    }
    users = JSON.parse(readFileSync(USERS_FILE, "utf8")) as User[];
    let migrated = false;
    for (const user of users) {
      ensureDevices(user);
      if (user.deviceIds?.length) {
        for (const deviceId of user.deviceIds) {
          if (!user.devices.some((d) => d.deviceId === deviceId)) {
            user.devices.push({
              deviceId,
              secret: deviceId,
              label: user.name,
              model: "",
            });
          }
        }
        delete user.deviceIds;
        migrated = true;
      }
    }
    if (migrated) saveUsers();
  } catch {
    users = [];
  }
}

function saveUsers() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

loadUsers();

function normEmail(email: string) {
  return email.trim().toLowerCase();
}

function genSecret() {
  return randomBytes(32).toString("hex");
}

function genUserId() {
  return randomBytes(16).toString("hex");
}

function secretMatches(a: string, b: string) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

function ensureDevices(user: User) {
  if (!Array.isArray(user.devices)) user.devices = [];
}

function findDevice(user: User, deviceId: string) {
  ensureDevices(user);
  return user.devices.find((d) => d.deviceId === deviceId);
}

export function signup(
  email: string,
  name: string,
  deviceId?: string,
  deviceSecret?: string,
  model?: string,
) {
  const e = normEmail(email);
  const n = name.trim();
  const secret = deviceSecret?.trim() ?? "";
  if (!e.includes("@") || n.length < 2) {
    return { ok: false as const, error: "Enter a valid email and name" };
  }
  if (!deviceId) {
    return { ok: false as const, error: "deviceId required" };
  }
  if (secret.length < 8) {
    return { ok: false as const, error: "device secret required" };
  }

  let user = users.find((u) => u.email === e);
  if (!user) {
    user = {
      id: genUserId(),
      email: e,
      phone: "",
      name: n,
      devices: [],
      createdAt: Date.now(),
    };
    users.push(user);
  } else {
    user.name = n;
  }

  let device = findDevice(user, deviceId);
  if (!device) {
    device = {
      deviceId,
      secret,
      label: n,
      model: model?.trim() ?? "",
    };
    user.devices.push(device);
  } else {
    device.label = n;
    device.secret = secret;
    if (model?.trim()) device.model = model.trim();
  }

  saveUsers();

  return {
    ok: true as const,
    deviceSecret: device.secret,
    userId: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    deviceId: device.deviceId,
  };
}

/** Permanent credential — survives server restarts when data/ persists on disk. */
export function authenticateDevice(
  deviceId: string | null | undefined,
  secret: string | null | undefined,
): { user: User; device: DeviceRecord } | null {
  if (!deviceId || !secret) return null;
  for (const user of users) {
    const device = findDevice(user, deviceId);
    if (device && secretMatches(device.secret, secret)) {
      return { user, device };
    }
  }
  return null;
}

export function userOwnsDevice(user: User, deviceId: string) {
  ensureDevices(user);
  return user.devices.some((d) => d.deviceId === deviceId);
}

export function getUserById(userId: string) {
  return users.find((u) => u.id === userId) ?? null;
}

export function getUserByDeviceId(deviceId: string) {
  return users.find((u) => {
    ensureDevices(u);
    return u.devices.some((d) => d.deviceId === deviceId);
  }) ?? null;
}

export function getDeviceRecord(deviceId: string) {
  for (const user of users) {
    const device = findDevice(user, deviceId);
    if (device) return { user, device };
  }
  return null;
}

/** Re-create registration after server redeploy (ephemeral disk) or first connect. */
export function ensureDeviceRegistered(
  email: string,
  name: string,
  deviceId: string,
  secret: string,
  model?: string,
): { user: User; device: DeviceRecord } | null {
  const existing = authenticateDevice(deviceId, secret);
  if (existing) return existing;
  const reg = signup(email, name, deviceId, secret, model);
  if (!reg.ok) return null;
  return authenticateDevice(deviceId, secret);
}

export function eachRegisteredDevice(fn: (deviceId: string, user: User, device: DeviceRecord) => void) {
  for (const user of users) {
    ensureDevices(user);
    for (const device of user.devices) fn(device.deviceId, user, device);
  }
}
