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
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onStateRef = useRef<((s: WatchState) => void) | null>(null);
  const applyingRef = useRef(false);

  const connect = useCallback(() => {
    const code = roomCode.trim().toUpperCase();
    if (!code) return;
    wsRef.current?.close();
    const ws = new WebSocket(`${wsBase()}/ws/watch?room=${encodeURIComponent(code)}&k=${LINK_KEY}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setTimeout(() => {
        if (roomCode.trim()) connect();
      }, 3000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (ev) => {
      let msg: { type: string; t?: number; playing?: boolean; url?: string; peers?: number };
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.type === "joined") {
        setPeers(msg.peers ?? 1);
        if (msg.url) setRemoteUrl(msg.url);
      }
      if (msg.type === "url" && msg.url) setRemoteUrl(msg.url);
      if (msg.type === "state" && onStateRef.current && !applyingRef.current) {
        onStateRef.current({ t: msg.t ?? 0, playing: !!msg.playing });
      }
    };
  }, [roomCode]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  const sendState = useCallback((state: WatchState) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "state", t: state.t, playing: state.playing }));
  }, []);

  const sendUrl = useCallback((url: string) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "url", url }));
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

  return { connected, peers, remoteUrl, sendState, sendUrl, onRemoteState, withApplying };
}
