import { useVoiceChat } from "../hooks/useVoiceChat";

interface VoiceChatPanelProps {
  roomCode: string;
  compact?: boolean;
}

export function VoiceChatPanel({ roomCode, compact }: VoiceChatPanelProps) {
  const {
    connected,
    micReady,
    micError,
    micOn,
    activeSpeakers,
    speakerId,
    toggleMic,
    requestMic,
  } = useVoiceChat(roomCode);

  const speakers = Array.from(activeSpeakers);
  const talkingLabel =
    speakers.length > 0
      ? speakers.map((s) => `🎙 ${s}`).join(" · ")
      : micOn
        ? "You're talking…"
        : null;

  return (
    <section className={`voice-panel ${compact ? "voice-panel-compact" : ""}`}>
      <div className="voice-panel-head">
        <span className="voice-panel-title">Voice chat</span>
        <span className={`voice-panel-status ${connected ? "voice-live" : ""}`}>
          {connected ? "● live" : "connecting…"}
        </span>
      </div>

      <p className="voice-panel-hint">
        Tap to talk — tap again to mute. Same room as video sync. You are{" "}
        <strong>{speakerId}</strong>.
      </p>

      {micError && (
        <p className="voice-panel-error">
          Mic unavailable — check browser permissions.
          <button type="button" className="voice-retry" onClick={() => void requestMic()}>
            retry
          </button>
        </p>
      )}

      {!micReady && !micError && (
        <button type="button" className="voice-enable-mic" onClick={() => void requestMic()}>
          Enable microphone
        </button>
      )}

      <button
        type="button"
        className={`voice-ptt ${micOn ? "voice-ptt-active" : ""}`}
        disabled={!connected}
        onClick={() => void toggleMic()}
      >
        {micOn ? "Tap to mute" : "Tap to talk"}
      </button>

      {talkingLabel && <p className="voice-talking">{talkingLabel}</p>}
    </section>
  );
}
