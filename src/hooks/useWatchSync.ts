import { useCallback, useEffect, useRef, useState } from "react";
import { siteHost } from "../utils/host";

const LINK_KEY = "2htl_k9";

export interface WatchState {
  t: number;
  playing: boolean;
}

function wsBase(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${siteHost()}`;
}

export function useWatchSync(roomCode: string) {
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState(0);
  const [participants, setParticipants] = useState<string[]>([]);
  const [hostId, setHostId] = useState("");
  const [youId, setYouId] = useState("");
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onStateRef = useRef<((s: WatchState) => void) | null>(null);
  const applyingRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connect = useCallback(() => {
    const code = roomCode.trim().toUpperCase();
    if (!code) return;
    wsRef.current?.close();
    const ws = new WebSocket(`${wsBase()}/ws/watch?room=${encodeURIComponent(code)}&k=${LINK_KEY}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      setTimeout(() => {
        if (roomCode.trim()) connect();
      }, 3000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (ev) => {
      let msg: {
        type: string;
        t?: number;
        playing?: boolean;
        url?: string;
        peers?: number;
        participants?: string[];
        hostId?: string;
        you?: string;
      };
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.type === "joined") {
        setPeers(msg.peers ?? 1);
        if (msg.url) setRemoteUrl(msg.url);
        if (msg.you) setYouId(msg.you);
        if (msg.hostId) setHostId(msg.hostId);
        if (msg.participants) setParticipants(msg.participants);
      }
      if (msg.type === "roster") {
        if (msg.participants) setParticipants(msg.participants);
        if (msg.hostId) setHostId(msg.hostId);
      }
      if (msg.type === "url" && msg.url) {
        setRemoteUrl(msg.url);
        if (msg.hostId) setHostId(msg.hostId);
      }
      if (msg.type === "state" && onStateRef.current && !applyingRef.current) {
        onStateRef.current({ t: msg.t ?? 0, playing: !!msg.playing });
      }
      if (msg.type === "heartbeat" && onStateRef.current && !applyingRef.current && msg.hostId !== youId) {
        onStateRef.current({ t: msg.t ?? 0, playing: !!msg.playing });
      }
    };
  }, [roomCode, youId]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [connect]);

  const sendState = useCallback((state: WatchState) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "state", t: state.t, playing: state.playing }));
  }, []);

  const sendHeartbeat = useCallback((state: WatchState) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "heartbeat", t: state.t, playing: state.playing }));
  }, []);

  const sendUrl = useCallback((url: string, episodeId?: string) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "url", url, episodeId }));
    setRemoteUrl(url);
  }, []);

  const onRemoteState = useCallback((cb: (s: WatchState) => void) => {
    onStateRef.current = cb;
  }, []);

  const withApplying = useCallback((fn: () => void) => {
    applyingRef.current = true;
    fn();
    setTimeout(() => {
      applyingRef.current = false;
    }, 200);
  }, []);

  const startHostHeartbeat = useCallback((getState: () => WatchState) => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      if (youId && hostId === youId) sendHeartbeat(getState());
    }, 2000);
  }, [youId, hostId, sendHeartbeat]);

  return {
    connected,
    peers,
    participants,
    hostId,
    youId,
    remoteUrl,
    sendState,
    sendUrl,
    sendHeartbeat,
    startHostHeartbeat,
    onRemoteState,
    withApplying,
  };
}
