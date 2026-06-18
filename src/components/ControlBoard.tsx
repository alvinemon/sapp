interface Props {
  canControl: boolean;
  canSendKeys: boolean;
  phoneLive: boolean;
  onWake: () => void;
  onPower: () => void;
  onSetup: () => void;
  onKey: (action: string) => void;
  onAiToggle: () => void;
  aiOpen: boolean;
}

export function ControlBoard({
  canControl,
  canSendKeys,
  phoneLive,
  onWake,
  onPower,
  onSetup,
  onKey,
  onAiToggle,
  aiOpen,
}: Props) {
  return (
    <aside className="control-board glass-panel">
      <p className="panel-title">Controls</p>
      <div className="control-grid">
        <button type="button" className="ctrl-glass ctrl-wake" onClick={onWake} disabled={!canSendKeys} title="Turn screen on">
          <span className="ctrl-icon">⏻</span>
          <span>Wake</span>
        </button>
        <button type="button" className="ctrl-glass ctrl-power" onClick={onPower} disabled={!canSendKeys} title="Power menu">
          <span className="ctrl-icon">⏻</span>
          <span>Power</span>
        </button>
        <button type="button" className="ctrl-glass" onClick={() => onKey("back")} disabled={!canControl}>
          <span className="ctrl-icon">←</span>
          <span>Back</span>
        </button>
        <button type="button" className="ctrl-glass ctrl-home" onClick={() => onKey("home")} disabled={!canControl}>
          <span className="ctrl-icon">⌂</span>
          <span>Home</span>
        </button>
        <button type="button" className="ctrl-glass" onClick={() => onKey("recents")} disabled={!canControl}>
          <span className="ctrl-icon">▢</span>
          <span>Recents</span>
        </button>
        {phoneLive && (
          <button type="button" className="ctrl-glass ctrl-setup" onClick={onSetup} disabled={!canSendKeys} title="Grant permissions on phone">
            <span className="ctrl-icon">⚙</span>
            <span>Setup</span>
          </button>
        )}
        <button type="button" className={`ctrl-glass ctrl-ai ${aiOpen ? "ctrl-ai-active" : ""}`} onClick={onAiToggle} disabled={!canSendKeys}>
          <span className="ctrl-icon">✦</span>
          <span>AI</span>
        </button>
      </div>
      <div className="control-vol">
        <button type="button" className="ctrl-glass ctrl-vol" onClick={() => onKey("volume_down")} disabled={!canControl}>Vol −</button>
        <button type="button" className="ctrl-glass ctrl-vol" onClick={() => onKey("volume_up")} disabled={!canControl}>Vol +</button>
      </div>
      {!canSendKeys && <p className="control-hint">Select a phone to enable controls</p>}
    </aside>
  );
}
