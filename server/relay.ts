import { WebSocket } from "ws";
import type { User } from "./auth.js";
import { eachRegisteredDevice, getUserByDeviceId, getUserById, userOwnsDevice } from "./auth.js";

/** Legacy shared key — still accepted for dev */
const LINK_KEY = "2htl_k9";

export interface DeviceInfo {
  deviceId: string;
  name: string;
  model: string;
  online: boolean;
  width: number;
  height: number;
  lastSeen: number;
  ownerName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
}

interface DeviceRoom {
  deviceId: string;
  name: string;
  model: string;
  userId: string | null;
  phone: WebSocket | null;
  phoneLive: boolean;
  browser: WebSocket | null;
  browserLive: boolean;
  width: number;
  height: number;
  lastSeen: number;
}

const rooms = new Map<string, DeviceRoom>();
const lobbyBrowsers = new Set<WebSocket>();

function getOrCreateRoom(
  deviceId: string,
  name?: string,
  model?: string,
  userId?: string | null,
): DeviceRoom {
  let room = rooms.get(deviceId);
  if (!room) {
    room = {
      deviceId,
      name: name ?? deviceId.slice(0, 8),
      model: model ?? "",
      userId: userId ?? null,
      phone: null,
      phoneLive: false,
      browser: null,
      browserLive: false,
      width: 1080,
      height: 2400,
      lastSeen: Date.now(),
    };
    rooms.set(deviceId, room);
  }
  if (name) room.name = name;
  if (model) room.model = model;
  if (userId) room.userId = userId;
  room.lastSeen = Date.now();
  return room;
}

export function validateKey(key: string | null): boolean {
  return key === LINK_KEY;
}

export function listDevices(): DeviceInfo[] {
  const out: DeviceInfo[] = [];
  const seen = new Set<string>();

  for (const room of rooms.values()) {
    seen.add(room.deviceId);
    const owner = (room.userId ? getUserById(room.userId) : null) ?? getUserByDeviceId(room.deviceId);
    out.push({
      deviceId: room.deviceId,
      name: room.name,
      model: room.model,
      online: room.phoneLive,
      width: room.width,
      height: room.height,
      lastSeen: room.lastSeen,
      ...(owner
        ? { ownerName: owner.name, ownerEmail: owner.email, ownerPhone: owner.phone }
        : {}),
    });
  }

  eachRegisteredDevice((deviceId, owner, device) => {
    if (seen.has(deviceId)) return;
    seen.add(deviceId);
    out.push({
      deviceId,
      name: device.label || owner.name,
      model: device.model,
      online: false,
      width: 1080,
      height: 2400,
      lastSeen: 0,
      ownerName: owner.name,
      ownerEmail: owner.email,
      ownerPhone: owner.phone,
    });
  });
  out.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return b.lastSeen - a.lastSeen;
  });
  return out;
}

export function phoneOnline(): boolean {
  return listDevices().some((d) => d.online);
}

export function status() {
  const devices = listDevices();
  const online = devices.filter((d) => d.online);
  return {
    ready: online.length > 0,
    live: online.some((d) => {
      const room = rooms.get(d.deviceId);
      return room?.browserLive === true;
    }),
    deviceCount: devices.length,
    onlineCount: online.length,
  };
}

function broadcastDeviceList() {
  const payload = JSON.stringify({ type: "device_list", devices: listDevices() });
  for (const ws of lobbyBrowsers) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
  for (const room of rooms.values()) {
    const browser = room.browser;
    if (browser?.readyState === WebSocket.OPEN) browser.send(payload);
  }
}

function notifyBrowser(room: DeviceRoom, payload: object) {
  const browser = room.browser;
  if (browser?.readyState === WebSocket.OPEN) browser.send(JSON.stringify(payload));
}

function notifyPhone(room: DeviceRoom, payload: object) {
  const phone = room.phone;
  if (phone?.readyState === WebSocket.OPEN) phone.send(JSON.stringify(payload));
}

function attachPhone(
  ws: WebSocket,
  deviceId: string,
  name?: string,
  model?: string,
  user?: User | null,
): string | null {
  if (!user) return "signup required on phone";
  if (!userOwnsDevice(user, deviceId)) return "device not registered to account";
  const room = getOrCreateRoom(deviceId, name, model, user.id);

  const existing = room.phone;
  if (existing?.readyState === WebSocket.OPEN) existing.close(4000, "replaced");
  room.phone = ws;
  room.phoneLive = true;

  ws.send(
    JSON.stringify({
      type: "joined",
      role: "phone",
      deviceId,
      peerConnected: room.browserLive,
    }),
  );

  if (room.browserLive) {
    notifyPhone(room, { type: "peer_connected", role: "browser", deviceId });
    notifyBrowser(room, { type: "peer_connected", role: "phone", deviceId });
  }

  broadcastDeviceList();

  ws.on("close", () => {
    if (room.phone === ws) {
      room.phone = null;
      room.phoneLive = false;
      notifyBrowser(room, { type: "peer_disconnected", role: "phone", deviceId });
      broadcastDeviceList();
    }
  });

  ws.on("message", (raw, isBinary) => {
    const browser = room.browser;
    if (browser?.readyState !== WebSocket.OPEN) return;

    if (isBinary) {
      browser.send(raw, { binary: true });
      return;
    }

    const text = raw.toString();
    try {
      const msg = JSON.parse(text);
      if (msg.type === "heartbeat") {
        room.lastSeen = Date.now();
        browser.send(text);
        return;
      }
      if (msg.type === "meta" && msg.width && msg.height) {
        room.width = msg.width;
        room.height = msg.height;
        room.lastSeen = Date.now();
      }
    } catch {
      /* forward */
    }
    browser.send(text);
  });

  return null;
}

function attachBrowser(ws: WebSocket, deviceId?: string): string | null {
  if (!deviceId) {
    lobbyBrowsers.add(ws);
    ws.send(JSON.stringify({ type: "device_list", devices: listDevices() }));

    ws.on("close", () => lobbyBrowsers.delete(ws));
    ws.on("message", () => {
      /* lobby is read-only */
    });
    return null;
  }

  const room = getOrCreateRoom(deviceId);

  const existing = room.browser;
  if (existing?.readyState === WebSocket.OPEN) existing.close(4000, "replaced");
  room.browser = ws;
  room.browserLive = true;

  ws.send(
    JSON.stringify({
      type: "joined",
      role: "browser",
      deviceId,
      deviceName: room.name,
      peerConnected: room.phoneLive,
    }),
  );

  ws.send(JSON.stringify({ type: "device_list", devices: listDevices() }));

  if (room.phoneLive) {
    notifyBrowser(room, { type: "peer_connected", role: "phone", deviceId });
  }

  ws.on("close", () => {
    if (room.browser === ws) {
      room.browser = null;
      room.browserLive = false;
      notifyPhone(room, { type: "peer_disconnected", role: "browser", deviceId });
    }
  });

  ws.on("message", (raw, isBinary) => {
    const phone = room.phone;
    if (phone?.readyState !== WebSocket.OPEN) return;
    if (isBinary) phone.send(raw, { binary: true });
    else phone.send(raw.toString());
  });

  return null;
}

export function attachClient(
  ws: WebSocket,
  role: "phone" | "browser",
  opts: { deviceId?: string; name?: string; model?: string; user?: User | null } = {},
): string | null {
  if (role === "phone") {
    if (!opts.deviceId) return "device required";
    return attachPhone(ws, opts.deviceId, opts.name, opts.model, opts.user);
  }
  return attachBrowser(ws, opts.deviceId);
}
