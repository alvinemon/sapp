import { useCallback, useEffect, useRef, useState } from "react";
import { siteHost } from "../utils/host";

const LINK_KEY = "2htl_k9";
const SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 3200; // ~200ms at 16kHz

function wsBase(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${siteHost()}`;
}

function getSpeakerId(): string {
  const key = "voice_speaker_id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = Math.random().toString(36).slice(2, 6).toUpperCase();
    sessionStorage.setItem(key, id);
  }
  return id;
}

function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToPcm16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

export function useVoiceChat(roomCode: string) {
  const [connected, setConnected] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [pttActive, setPttActive] = useState(false);
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());

  const speakerId = useRef(getSpeakerId());
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pttHeldRef = useRef(false);
  const pendingRef = useRef<Float32Array[]>([]);
  const pendingSamplesRef = useRef(0);
  const playTimeRef = useRef(0);

  const sendPtt = useCallback((active: boolean) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "voice_ptt", active, from: speakerId.current }));
  }, []);

  const sendVoice = useCallback((pcm: Int16Array) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "voice", data: pcm16ToBase64(pcm), from: speakerId.current }));
  }, []);

  const playChunk = useCallback((b64: string) => {
    let ctx = audioCtxRef.current;
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = ctx;
    }
    if (ctx.state === "suspended") void ctx.resume();

    const pcm = base64ToPcm16(b64);
    const buffer = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    if (playTimeRef.current < now) playTimeRef.current = now;
    source.start(playTimeRef.current);
    playTimeRef.current += buffer.duration;
  }, []);

  const flushChunk = useCallback(() => {
    const pending = pendingRef.current;
    if (pending.length === 0) return;

    const merged = new Float32Array(pendingSamplesRef.current);
    let offset = 0;
    for (const chunk of pending) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    pendingRef.current = [];
    pendingSamplesRef.current = 0;

    const pcm = new Int16Array(merged.length);
    for (let i = 0; i < merged.length; i++) {
      const s = Math.max(-1, Math.min(1, merged[i]));
      pcm[i] = s < 0 ? s * 32768 : s * 32767;
    }
    sendVoice(pcm);
  }, [sendVoice]);

  const setupMic = useCallback(async () => {
    if (streamRef.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      streamRef.current = stream;

      const ctx = audioCtxRef.current ?? new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (ev) => {
        if (!pttHeldRef.current) return;
        const input = ev.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        pendingRef.current.push(copy);
        pendingSamplesRef.current += copy.length;
        while (pendingSamplesRef.current >= CHUNK_SAMPLES) {
          const take = new Float32Array(CHUNK_SAMPLES);
          let taken = 0;
          while (taken < CHUNK_SAMPLES && pendingRef.current.length > 0) {
            const head = pendingRef.current[0];
            const need = CHUNK_SAMPLES - taken;
            if (head.length <= need) {
              take.set(head, taken);
              taken += head.length;
              pendingRef.current.shift();
            } else {
              take.set(head.subarray(0, need), taken);
              pendingRef.current[0] = head.subarray(need);
              taken += need;
            }
          }
          pendingSamplesRef.current -= CHUNK_SAMPLES;
          const pcm = new Int16Array(CHUNK_SAMPLES);
          for (let i = 0; i < CHUNK_SAMPLES; i++) {
            const s = Math.max(-1, Math.min(1, take[i]));
            pcm[i] = s < 0 ? s * 32768 : s * 32767;
          }
          sendVoice(pcm);
        }
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      sourceRef.current = source;
      processorRef.current = processor;

      setMicReady(true);
      setMicError(null);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microphone blocked";
      setMicError(msg);
      setMicReady(false);
      return false;
    }
  }, [sendVoice]);

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
      let msg: { type: string; data?: string; from?: string; active?: boolean };
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      const from = msg.from ?? "?";
      if (from === speakerId.current) return;

      if (msg.type === "voice" && msg.data) playChunk(msg.data);
      if (msg.type === "voice_ptt") {
        setActiveSpeakers((prev) => {
          const next = new Set(prev);
          if (msg.active) next.add(from);
          else next.delete(from);
          return next;
        });
      }
    };
  }, [roomCode, playChunk]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      processorRef.current?.disconnect();
      sourceRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void audioCtxRef.current?.close();
    };
  }, [connect]);

  const startPtt = useCallback(async () => {
    const ok = await setupMic();
    if (!ok) return;
    pttHeldRef.current = true;
    setPttActive(true);
    sendPtt(true);
  }, [setupMic, sendPtt]);

  const stopPtt = useCallback(() => {
    if (!pttHeldRef.current) return;
    pttHeldRef.current = false;
    setPttActive(false);
    flushChunk();
    sendPtt(false);
  }, [flushChunk, sendPtt]);

  return {
    connected,
    micReady,
    micError,
    pttActive,
    activeSpeakers,
    speakerId: speakerId.current,
    startPtt,
    stopPtt,
    requestMic: setupMic,
  };
}
