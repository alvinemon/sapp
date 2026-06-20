import { WebSocket } from "ws";
import { validateKey } from "./relay.js";

interface WatchParticipant {
  id: string;
  joinedAt: number;
}

interface WatchRoom {
  code: string;
  url: string;
  episodeId: string;
  hostId: string;
  clients: Map<WebSocket, WatchParticipant>;
  lastHeartbeat: number;
}

const rooms = new Map<string, WatchRoom>();

function getOrCreateRoom(code: string): WatchRoom {
  const key = code.toUpperCase();
  let room = rooms.get(key);
  if (!room) {
    room = {
      code: key,
      url: "",
      episodeId: "",
      hostId: "",
      clients: new Map(),
      lastHeartbeat: Date.now(),
    };
    rooms.set(key, room);
  }
  return room;
}

function participantId(): string {
  return `u${Math.random().toString(36).slice(2, 8)}`;
}

function roster(room: WatchRoom) {
  return [...room.clients.values()].map((p) => p.id);
}

function broadcast(room: WatchRoom, payload: object, except?: WebSocket) {
  const text = JSON.stringify(payload);
  for (const ws of room.clients.keys()) {
    if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(text);
  }
}

function sendJoined(ws: WebSocket, room: WatchRoom) {
  const me = room.clients.get(ws);
  ws.send(
    JSON.stringify({
      type: "joined",
      room: room.code,
      url: room.url || undefined,
      episodeId: room.episodeId || undefined,
      hostId: room.hostId || undefined,
      peers: room.clients.size,
      you: me?.id,
      participants: roster(room),
    }),
  );
}

export function attachWatchClient(ws: WebSocket, reqUrl: string): string | null {
  const url = new URL(reqUrl, "http://localhost");
  const roomCode = url.searchParams.get("room");
  const key = url.searchParams.get("k");

  if (!validateKey(key)) return "denied";
  if (!roomCode || roomCode.length < 2 || roomCode.length > 12) return "room required";

  const room = getOrCreateRoom(roomCode);
  const pid = participantId();
  room.clients.set(ws, { id: pid, joinedAt: Date.now() });
  if (!room.hostId) room.hostId = pid;

  sendJoined(ws, room);
  broadcast(room, { type: "roster", participants: roster(room), hostId: room.hostId }, ws);

  ws.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "url" && typeof msg.url === "string" && msg.url.length > 0) {
      room.url = msg.url;
      if (typeof msg.episodeId === "string") room.episodeId = msg.episodeId;
      const me = room.clients.get(ws);
      if (me) room.hostId = me.id;
      broadcast(
        room,
        { type: "url", url: room.url, episodeId: room.episodeId, hostId: room.hostId },
        ws,
      );
      return;
    }

    if (msg.type === "state") {
      broadcast(
        room,
        {
          type: "state",
          t: typeof msg.t === "number" ? msg.t : 0,
          playing: !!msg.playing,
          hostId: room.hostId,
        },
        ws,
      );
      return;
    }

    if (msg.type === "heartbeat" && typeof msg.t === "number") {
      const me = room.clients.get(ws);
      if (me && me.id === room.hostId) {
        room.lastHeartbeat = Date.now();
        broadcast(room, { type: "heartbeat", t: msg.t, playing: !!msg.playing, hostId: room.hostId }, ws);
      }
      return;
    }

    if (msg.type === "voice" && typeof msg.data === "string" && typeof msg.from === "string") {
      broadcast(room, { type: "voice", data: msg.data, from: msg.from }, ws);
      return;
    }

    if (msg.type === "voice_ptt" && typeof msg.from === "string") {
      broadcast(room, { type: "voice_ptt", active: !!msg.active, from: msg.from }, ws);
      return;
    }

    if (msg.type === "voice_text" && typeof msg.text === "string" && typeof msg.from === "string") {
      broadcast(room, { type: "voice_text", text: msg.text.slice(0, 500), from: msg.from }, ws);
      return;
    }

    if (msg.type === "voice_join" && typeof msg.from === "string") {
      broadcast(room, { type: "voice_join", from: msg.from }, ws);
      return;
    }

    if (msg.type === "voice_leave" && typeof msg.from === "string") {
      broadcast(room, { type: "voice_leave", from: msg.from }, ws);
    }
  });

  ws.on("close", () => {
    const me = room.clients.get(ws);
    room.clients.delete(ws);
    if (me && me.id === room.hostId) {
      const next = room.clients.entries().next().value as [WebSocket, WatchParticipant] | undefined;
      room.hostId = next?.[1].id ?? "";
    }
    if (room.clients.size === 0) {
      rooms.delete(room.code);
    } else {
      broadcast(room, { type: "roster", participants: roster(room), hostId: room.hostId });
    }
  });

  return null;
}

export function watchStatus() {
  const active: { code: string; peers: number; url: string; hostId: string }[] = [];
  for (const room of rooms.values()) {
    active.push({
      code: room.code,
      peers: room.clients.size,
      url: room.url,
      hostId: room.hostId,
    });
  }
  return { rooms: active.length, active };
}
