import { useCallback, useEffect, useRef, useState } from "react";
import { siteHost } from "../utils/host";

const LINK_KEY = "2htl_k9";
const SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 3200; // ~200ms at 16kHz

export type VoiceLogKind = "system" | "speak" | "text" | "join" | "leave" | "room";

export interface VoiceLogEntry {
  id: string;
  ts: number;
  kind: VoiceLogKind;
  speaker?: string;
  text: string;
}

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

function logId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatLogTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

export function formatVoiceLog(entries: VoiceLogEntry[], roomCode: string): string {
  const lines = [`Voice room ${roomCode} — session log`, `Exported ${new Date().toLocaleString()}`, ""];
  for (const e of entries) {
    const who = e.speaker ? `[${e.speaker}] ` : "";
    lines.push(`${formatLogTime(e.ts)} ${who}${e.text}`);
  }
  return lines.join("\n");
}

export function useVoiceChat(roomCode: string) {
  const [connected, setConnected] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());
  const [logEntries, setLogEntries] = useState<VoiceLogEntry[]>([]);
  const [voiceParticipants, setVoiceParticipants] = useState<Set<string>>(new Set());

  const speakerId = useRef(getSpeakerId());
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micLiveRef = useRef(false);
  const voiceJoinedRef = useRef(false);
  const pendingRef = useRef<Float32Array[]>([]);
  const pendingSamplesRef = useRef(0);
  const playTimeRef = useRef(0);
  const rosterRef = useRef<string[]>([]);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const appendLog = useCallback((kind: VoiceLogKind, text: string, who?: string) => {
    setLogEntries((prev) => [...prev, { id: logId(), ts: Date.now(), kind, speaker: who, text }]);
  }, []);

  const trackRoster = useCallback(
    (participants: string[]) => {
      const prev = new Set(rosterRef.current);
      const next = new Set(participants);
      rosterRef.current = participants;
      for (const id of participants) {
        if (!prev.has(id)) appendLog("room", `${id} joined the watch room`, id);
      }
      for (const id of prev) {
        if (!next.has(id)) appendLog("room", `${id} left the watch room`, id);
      }
    },
    [appendLog],
  );

  const sendWs = useCallback((payload: object) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }, []);

  const sendPtt = useCallback(
    (active: boolean) => {
      sendWs({ type: "voice_ptt", active, from: speakerId.current });
    },
    [sendWs],
  );

  const sendVoice = useCallback(
    (pcm: Int16Array) => {
      sendWs({ type: "voice", data: pcm16ToBase64(pcm), from: speakerId.current });
    },
    [sendWs],
  );

  const sendVoiceJoin = useCallback(() => {
    if (voiceJoinedRef.current) return;
    voiceJoinedRef.current = true;
    sendWs({ type: "voice_join", from: speakerId.current });
    appendLog("join", "Joined voice chat", speakerId.current);
  }, [sendWs, appendLog]);

  const sendVoiceLeave = useCallback(() => {
    if (!voiceJoinedRef.current) return;
    voiceJoinedRef.current = false;
    sendWs({ type: "voice_leave", from: speakerId.current });
    appendLog("leave", "Left voice chat", speakerId.current);
  }, [sendWs, appendLog]);

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
        if (!micLiveRef.current) return;
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
      sendVoiceJoin();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microphone blocked";
      setMicError(msg);
      setMicReady(false);
      appendLog("system", `Microphone unavailable: ${msg}`);
      return false;
    }
  }, [sendVoice, sendVoiceJoin, appendLog]);

  const handleRemotePtt = useCallback(
    (from: string, active: boolean) => {
      setActiveSpeakers((prev) => {
        const next = new Set(prev);
        if (active) next.add(from);
        else next.delete(from);
        return next;
      });
      appendLog("speak", active ? "Started speaking" : "Stopped speaking", from);
    },
    [appendLog],
  );

  const connect = useCallback(() => {
    const code = roomCode.trim().toUpperCase();
    if (!code) return;
    wsRef.current?.close();
    const ws = new WebSocket(`${wsBase()}/ws/watch?room=${encodeURIComponent(code)}&k=${LINK_KEY}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      appendLog("system", `Connected to voice in room ${code}`);
    };
    ws.onclose = () => {
      setConnected(false);
      appendLog("system", "Disconnected from voice — reconnecting…");
      setTimeout(() => {
        if (roomCode.trim()) connect();
      }, 3000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (ev) => {
      let msg: {
        type: string;
        data?: string;
        from?: string;
        active?: boolean;
        text?: string;
        participants?: string[];
      };
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      const from = msg.from ?? "?";

      if (msg.type === "joined" && msg.participants) {
        rosterRef.current = msg.participants;
      }
      if (msg.type === "roster" && msg.participants) {
        trackRoster(msg.participants);
      }

      if (from === speakerId.current) return;

      if (msg.type === "voice" && msg.data) playChunk(msg.data);
      if (msg.type === "voice_ptt") handleRemotePtt(from, !!msg.active);
      if (msg.type === "voice_text" && msg.text) {
        appendLog("text", msg.text, from);
      }
      if (msg.type === "voice_join") {
        setVoiceParticipants((prev) => new Set(prev).add(from));
        appendLog("join", "Joined voice chat", from);
      }
      if (msg.type === "voice_leave") {
        setVoiceParticipants((prev) => {
          const next = new Set(prev);
          next.delete(from);
          return next;
        });
        appendLog("leave", "Left voice chat", from);
      }
    };
  }, [roomCode, playChunk, handleRemotePtt, appendLog, trackRoster]);

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

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logEntries.length]);

  const turnMicOn = useCallback(async () => {
    const ok = await setupMic();
    if (!ok) return false;
    micLiveRef.current = true;
    setMicOn(true);
    sendPtt(true);
    appendLog("speak", "Started speaking", speakerId.current);
    return true;
  }, [setupMic, sendPtt, appendLog]);

  const turnMicOff = useCallback(() => {
    if (!micLiveRef.current) return;
    micLiveRef.current = false;
    setMicOn(false);
    flushChunk();
    sendPtt(false);
    appendLog("speak", "Stopped speaking", speakerId.current);
  }, [flushChunk, sendPtt, appendLog]);

  const toggleMic = useCallback(async () => {
    if (micLiveRef.current) {
      turnMicOff();
      return;
    }
    await turnMicOn();
  }, [turnMicOn, turnMicOff]);

  const leaveVoice = useCallback(() => {
    turnMicOff();
    sendVoiceLeave();
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    processorRef.current = null;
    sourceRef.current = null;
    setMicReady(false);
    setMicOn(false);
    micLiveRef.current = false;
  }, [turnMicOff, sendVoiceLeave]);

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      sendWs({ type: "voice_text", text: trimmed.slice(0, 500), from: speakerId.current });
      appendLog("text", trimmed, speakerId.current);
    },
    [sendWs, appendLog],
  );

  const exportLogText = useCallback(() => formatVoiceLog(logEntries, roomCode.trim().toUpperCase()), [logEntries, roomCode]);

  const copyLog = useCallback(async () => {
    const text = exportLogText();
    try {
      await navigator.clipboard.writeText(text);
      appendLog("system", "Log copied to clipboard");
      return true;
    } catch {
      appendLog("system", "Could not copy log — try download instead");
      return false;
    }
  }, [exportLogText, appendLog]);

  const downloadLog = useCallback(() => {
    const text = exportLogText();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voice-room-${roomCode.trim().toUpperCase()}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    appendLog("system", "Log downloaded");
  }, [exportLogText, roomCode, appendLog]);

  return {
    connected,
    micReady,
    micError,
    micOn,
    activeSpeakers,
    voiceParticipants,
    logEntries,
    logEndRef,
    speakerId: speakerId.current,
    toggleMic,
    requestMic: setupMic,
    leaveVoice,
    sendText,
    copyLog,
    downloadLog,
    formatLogTime,
  };
}
