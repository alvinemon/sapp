import { useRef, useState } from "react";
import { useVoiceChat } from "../hooks/useVoiceChat";
import {
  IconCopy,
  IconDownload,
  IconLeave,
  IconLog,
  IconMic,
  IconMicActive,
  IconMicOff,
  IconRetry,
  IconSend,
  IconSignal,
  IconSpeaker,
  IconUsers,
} from "./VoiceIcons";

interface VoiceChatPanelProps {
  roomCode: string;
  compact?: boolean;
  participants?: string[];
  youId?: string;
}

function displayName(id: string, youId?: string): string {
  if (youId && id === youId) return "You";
  return id;
}

export function VoiceChatPanel({ roomCode, compact, participants = [], youId }: VoiceChatPanelProps) {
  const {
    connected,
    micReady,
    micError,
    micOn,
    activeSpeakers,
    voiceParticipants,
    logEntries,
    logEndRef,
    speakerId,
    toggleMic,
    requestMic,
    leaveVoice,
    sendText,
    copyLog,
    downloadLog,
    formatLogTime,
  } = useVoiceChat(roomCode);

  const [draft, setDraft] = useState("");
  const [copiedFlash, setCopiedFlash] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const speakers = Array.from(activeSpeakers);
  const roomCount = participants.length || 1;
  const voiceCount = voiceParticipants.size + (micReady ? 1 : 0);

  const handleCopy = async () => {
    const ok = await copyLog();
    if (ok) {
      setCopiedFlash(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedFlash(false), 1600);
    }
  };

  const handleSend = () => {
    if (!draft.trim()) return;
    sendText(draft);
    setDraft("");
  };

  return (
    <section className={`voice-panel ${compact ? "voice-panel-compact" : ""}`}>
      <div className="voice-panel-head">
        <div className="voice-panel-title-row">
          <IconLog size={18} className="voice-head-icon" />
          <span className="voice-panel-title">Voice chat</span>
        </div>
        <div className="voice-panel-badges">
          <span
            className={`voice-badge ${connected ? "voice-badge-live" : ""}`}
            title={connected ? "Connected to voice relay" : "Connecting…"}
          >
            <IconSignal size={14} />
            {connected ? "Live" : "…"}
          </span>
          <span className="voice-badge" title={`${roomCount} in watch room`}>
            <IconUsers size={14} />
            {roomCount}
          </span>
          {voiceCount > 0 && (
            <span className="voice-badge voice-badge-voice" title={`${voiceCount} on voice`}>
              <IconMic size={14} />
              {voiceCount}
            </span>
          )}
        </div>
      </div>

      {participants.length > 0 && (
        <div className="voice-participant-chips">
          {participants.map((p) => (
            <span
              key={p}
              className={`voice-chip ${p === youId ? "voice-chip-you" : ""} ${activeSpeakers.has(p) || (p === youId && micOn) ? "voice-chip-speaking" : ""}`}
            >
              {(activeSpeakers.has(p) || (p === youId && micOn)) && (
                <IconSpeaker size={12} className="voice-chip-speaker" />
              )}
              {displayName(p, youId)}
            </span>
          ))}
        </div>
      )}

      <p className="voice-panel-hint">
        Tap the mic to talk · You are <strong>{speakerId}</strong>
      </p>

      {micError && (
        <div className="voice-panel-error">
          <span>Mic unavailable</span>
          <button
            type="button"
            className="voice-icon-btn voice-icon-btn-warn"
            onClick={() => void requestMic()}
            aria-label="Retry microphone permission"
            title="Retry microphone"
          >
            <IconRetry />
          </button>
        </div>
      )}

      <div className="voice-toolbar">
        {!micReady && !micError && (
          <button
            type="button"
            className="voice-icon-btn voice-icon-btn-primary"
            onClick={() => void requestMic()}
            aria-label="Enable microphone"
            title="Enable microphone"
          >
            <IconMic />
          </button>
        )}

        {micReady && (
          <button
            type="button"
            className={`voice-icon-btn voice-icon-btn-ptt ${micOn ? "voice-icon-btn-ptt-active" : ""}`}
            disabled={!connected}
            onClick={() => void toggleMic()}
            aria-label={micOn ? "Mute microphone" : "Unmute and talk"}
            title={micOn ? "Tap to mute" : "Tap to talk"}
          >
            {micOn ? <IconMicActive size={24} /> : <IconMicOff size={24} />}
          </button>
        )}

        {speakers.length > 0 && (
          <div className="voice-speaking-indicator" title={`Speaking: ${speakers.join(", ")}`}>
            <IconSpeaker size={18} className="voice-speaking-pulse" />
            <span className="voice-speaking-names">{speakers.join(" · ")}</span>
          </div>
        )}

        {micOn && speakers.length === 0 && (
          <div className="voice-speaking-indicator voice-speaking-you" title="You are speaking">
            <IconSpeaker size={18} className="voice-speaking-pulse" />
            <span className="voice-speaking-names">You</span>
          </div>
        )}

        <div className="voice-toolbar-spacer" />

        {micReady && (
          <button
            type="button"
            className="voice-icon-btn"
            onClick={leaveVoice}
            aria-label="Leave voice chat"
            title="Leave voice"
          >
            <IconLeave />
          </button>
        )}

        <button
          type="button"
          className={`voice-icon-btn ${copiedFlash ? "voice-icon-btn-ok" : ""}`}
          onClick={() => void handleCopy()}
          aria-label="Copy conversation log"
          title="Copy log"
        >
          <IconCopy />
        </button>

        <button
          type="button"
          className="voice-icon-btn"
          onClick={downloadLog}
          aria-label="Download conversation log"
          title="Download log"
        >
          <IconDownload />
        </button>
      </div>

      <form
        className="voice-text-row"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <input
          type="text"
          className="voice-text-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message to the room…"
          maxLength={500}
          disabled={!connected}
          aria-label="Voice room message"
        />
        <button
          type="submit"
          className="voice-icon-btn voice-icon-btn-primary"
          disabled={!connected || !draft.trim()}
          aria-label="Send message"
          title="Send message"
        >
          <IconSend />
        </button>
      </form>

      <div className="voice-log-panel" role="log" aria-live="polite" aria-label="Room conversation log">
        <div className="voice-log-head">
          <IconLog size={16} />
          <span>Room log</span>
          <span className="voice-log-count">{logEntries.length}</span>
        </div>
        <div className={`voice-log-scroll ${compact ? "voice-log-scroll-compact" : ""}`}>
          {logEntries.length === 0 ? (
            <p className="voice-log-empty">Speaking events and messages will appear here.</p>
          ) : (
            logEntries.map((entry) => (
              <div key={entry.id} className={`voice-log-entry voice-log-${entry.kind}`}>
                <time className="voice-log-time" dateTime={new Date(entry.ts).toISOString()}>
                  {formatLogTime(entry.ts)}
                </time>
                {entry.speaker && <span className="voice-log-speaker">{entry.speaker}</span>}
                <span className="voice-log-text">{entry.text}</span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </section>
  );
}
