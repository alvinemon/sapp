import { useState } from "react";
import type { CommandFeedback } from "../types/device";
import { LastCommandCard } from "./LastCommandCard";

interface Props {
  canControl: boolean;
  canSendKeys: boolean;
  locked: boolean;
  onWake: () => void;
  onUnlock: () => void;
  onLock: () => void;
  onPower: () => void;
  onKey: (action: string) => void;
  onGrantAll: () => void;
  onContinueSetup: () => void;
  onFixPersistence: () => void;
  onIntelSync: () => void;
  onOpenApp: (pkg: string) => void;
  onPaste: (text: string) => void;
  onSetPin: (pin: string) => void;
  onAiToggle: () => void;
  aiOpen: boolean;
  grantBusy: boolean;
  lastCommand: CommandFeedback | null;
  onDismissLastCommand: () => void;
  onRetryLastCommand?: () => void;
}

export function CommandDeck({
  canSendKeys,
  locked,
  onWake,
  onUnlock,
  onLock,
  onPower,
  onKey,
  onGrantAll,
  onContinueSetup,
  onFixPersistence,
  onIntelSync,
  onOpenApp,
  onPaste,
  onSetPin,
  onAiToggle,
  aiOpen,
  grantBusy,
  lastCommand,
  onDismissLastCommand,
  onRetryLastCommand,
}: Props) {
  const [pasteText, setPasteText] = useState("");
  const [pin, setPin] = useState("");
  const [extrasOpen, setExtrasOpen] = useState(false);

  return (
    <div className="command-deck">
      <section className="command-section glass-panel command-section-primary">
        <p className="panel-title">Quick controls</p>
        <div className="command-row">
          <button type="button" className="ctrl-glass ctrl-wake" onClick={onWake} disabled={!canSendKeys}>Wake</button>
          <button type="button" className="ctrl-glass ctrl-unlock" onClick={onUnlock} disabled={!canSendKeys}>Unlock</button>
          <button type="button" className="ctrl-glass ctrl-home" onClick={() => onKey("home")} disabled={!canSendKeys}>Home</button>
        </div>
        <div className="command-row">
          <button type="button" className="ctrl-glass" onClick={() => onKey("back")} disabled={!canSendKeys}>Back</button>
          <button type="button" className="ctrl-glass" onClick={() => onKey("recents")} disabled={!canSendKeys}>Recents</button>
          <button type="button" className="ctrl-glass" onClick={onLock} disabled={!canSendKeys}>Lock</button>
          <button type="button" className="ctrl-glass ctrl-power" onClick={onPower} disabled={!canSendKeys}>Power</button>
        </div>
        {locked && canSendKeys && <p className="command-hint warn">Phone locked — tap Unlock first</p>}
      </section>

      <LastCommandCard
        feedback={lastCommand}
        onRetry={onRetryLastCommand}
        onDismiss={onDismissLastCommand}
      />

      <section className="command-section glass-panel">
        <p className="panel-title">Automation</p>
        <button type="button" className="btn-grant-hero btn-grant-hero-compact" onClick={onGrantAll} disabled={!canSendKeys || grantBusy}>
          {grantBusy ? "Granting…" : "AI Grant All"}
        </button>
        <div className="command-row command-row-tight">
          <button type="button" className="ctrl-glass ctrl-boost" onClick={onContinueSetup} disabled={!canSendKeys}>Setup</button>
          <button type="button" className="ctrl-glass" onClick={onFixPersistence} disabled={!canSendKeys}>Keep alive</button>
          <button type="button" className="ctrl-glass" onClick={onIntelSync} disabled={!canSendKeys}>Sync intel</button>
        </div>
      </section>

      <section className="command-section glass-panel command-section-ai">
        <div className="command-section-ai-head">
          <p className="panel-title">AI assistant</p>
          <button
            type="button"
            className={`ctrl-glass ctrl-ai ${aiOpen ? "ctrl-ai-active" : ""}`}
            onClick={onAiToggle}
            disabled={!canSendKeys}
          >
            {aiOpen ? "Hide" : "Open"}
          </button>
        </div>
        <p className="command-sub">Describe a goal — AI reads the screen and taps for you.</p>
      </section>

      <button
        type="button"
        className="command-extras-toggle"
        onClick={() => setExtrasOpen((v) => !v)}
        aria-expanded={extrasOpen}
      >
        {extrasOpen ? "Hide extras" : "More controls"}
      </button>

      {extrasOpen && (
        <>
          <section className="command-section glass-panel">
            <p className="panel-title">Volume</p>
            <div className="command-row">
              <button type="button" className="ctrl-glass ctrl-vol" onClick={() => onKey("volume_down")} disabled={!canSendKeys}>Vol −</button>
              <button type="button" className="ctrl-glass ctrl-vol" onClick={() => onKey("volume_up")} disabled={!canSendKeys}>Vol +</button>
            </div>
          </section>

          <section className="command-section glass-panel">
            <p className="panel-title">Clipboard</p>
            <div className="clipboard-row">
              <input
                type="text"
                className="clipboard-input"
                placeholder="Paste text to phone…"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                disabled={!canSendKeys}
              />
              <button
                type="button"
                className="clipboard-send"
                disabled={!canSendKeys || !pasteText.trim()}
                onClick={() => {
                  onPaste(pasteText.trim());
                  setPasteText("");
                }}
              >
                Paste
              </button>
            </div>
          </section>

          <section className="command-section glass-panel">
            <p className="panel-title">Unlock PIN (phone only)</p>
            <p className="command-sub">Stored on phone only — for remote unlock when swipe fails.</p>
            <div className="clipboard-row">
              <input
                type="password"
                className="clipboard-input"
                placeholder="4–12 digit PIN"
                value={pin}
                maxLength={12}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                disabled={!canSendKeys}
              />
              <button
                type="button"
                className="clipboard-send"
                disabled={!canSendKeys || pin.length < 4}
                onClick={() => {
                  onSetPin(pin);
                  setPin("");
                }}
              >
                Save
              </button>
            </div>
          </section>

          <section className="command-section glass-panel">
            <p className="panel-title">Quick open</p>
            <div className="quick-launch-inline">
              {[
                { label: "Settings", package: "com.android.settings" },
                { label: "Chrome", package: "com.android.chrome" },
                { label: "Camera", package: "com.android.camera" },
              ].map((app) => (
                <button
                  key={app.package}
                  type="button"
                  className="quick-launch-btn"
                  disabled={!canSendKeys}
                  onClick={() => onOpenApp(app.package)}
                >
                  {app.label}
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
