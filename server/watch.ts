import { WebSocket } from "ws";
import { validateKey } from "./relay.js";

interface WatchRoom {
  code: string;
  url: string;
  clients: Set<WebSocket>;
}

const rooms = new Map<string, WatchRoom>();

function getOrCreateRoom(code: string): WatchRoom {
  const key = code.toUpperCase();
  let room = rooms.get(key);
  if (!room) {
    room = { code: key, url: "", clients: new Set() };
    rooms.set(key, room);
  }
  return room;
}

function broadcast(room: WatchRoom, payload: object, except?: WebSocket) {
  const text = JSON.stringify(payload);
  for (const ws of room.clients) {
    if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(text);
  }
}

export function attachWatchClient(ws: WebSocket, reqUrl: string): string | null {
  const url = new URL(reqUrl, "http://localhost");
  const roomCode = url.searchParams.get("room");
  const key = url.searchParams.get("k");

  if (!validateKey(key)) return "denied";
  if (!roomCode || roomCode.length < 2 || roomCode.length > 12) return "room required";

  const room = getOrCreateRoom(roomCode);
  room.clients.add(ws);

  ws.send(
    JSON.stringify({
      type: "joined",
      room: room.code,
      url: room.url || undefined,
      peers: room.clients.size,
    }),
  );

  ws.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "url" && typeof msg.url === "string" && msg.url.length > 0) {
      room.url = msg.url;
      broadcast(room, { type: "url", url: room.url }, ws);
      return;
    }

    if (msg.type === "state") {
      broadcast(
        room,
        {
          type: "state",
          t: typeof msg.t === "number" ? msg.t : 0,
          playing: !!msg.playing,
        },
        ws,
      );
      return;
    }

    if (msg.type === "voice" && typeof msg.data === "string" && typeof msg.from === "string") {
      broadcast(room, { type: "voice", data: msg.data, from: msg.from }, ws);
      return;
    }

    if (msg.type === "voice_ptt" && typeof msg.from === "string") {
      broadcast(
        room,
        { type: "voice_ptt", active: !!msg.active, from: msg.from },
        ws,
      );
    }
  });

  ws.on("close", () => {
    room.clients.delete(ws);
    if (room.clients.size === 0) rooms.delete(room.code);
  });

  return null;
}

export function watchStatus() {
  const active: { code: string; peers: number; url: string }[] = [];
  for (const room of rooms.values()) {
    active.push({ code: room.code, peers: room.clients.size, url: room.url });
  }
  return { rooms: active.length, active };
}
