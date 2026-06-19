import { useState } from "react";

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
  onBoostPermissions: () => void;
  onFixPersistence: () => void;
  onIntelSync: () => void;
  onOpenApp: (pkg: string) => void;
  onPaste: (text: string) => void;
  onSetPin: (pin: string) => void;
  onAiToggle: () => void;
  aiOpen: boolean;
  grantBusy: boolean;
}

export function CommandDeck({
  canControl,
  canSendKeys,
  locked,
  onWake,
  onUnlock,
  onLock,
  onPower,
  onKey,
  onGrantAll,
  onBoostPermissions,
  onFixPersistence,
  onIntelSync,
  onOpenApp,
  onPaste,
  onSetPin,
  onAiToggle,
  aiOpen,
  grantBusy,
}: Props) {
  const [pasteText, setPasteText] = useState("");
  const [pin, setPin] = useState("");

  return (
    <div className="command-deck">
      <div className="grant-hero glass-panel">
        <p className="grant-hero-title">AI Grant All Permissions</p>
        <p className="grant-hero-sub">Unlocks phone first, opens Settings — no notification permission (stealth)</p>
        <button type="button" className="btn-grant-hero" onClick={onGrantAll} disabled={!canSendKeys || grantBusy}>
          {grantBusy ? "Granting…" : "Grant All Now"}
        </button>
      </div>

      <section className="command-section glass-panel boost-panel">
        <p className="panel-title">Boost experience</p>
        <p className="command-sub">Optional permissions for location, contacts, voice, and always-on sync. Core control works without these.</p>
        <div className="command-row">
          <button type="button" className="ctrl-glass ctrl-boost" onClick={onBoostPermissions} disabled={!canSendKeys}>
            Permission wizard
          </button>
          <button type="button" className="ctrl-glass" onClick={onIntelSync} disabled={!canSendKeys}>Sync intel</button>
        </div>
      </section>

      <section className="command-section glass-panel">
        <p className="panel-title">Power</p>
        <div className="command-row">
          <button type="button" className="ctrl-glass ctrl-wake" onClick={onWake} disabled={!canSendKeys}>Wake</button>
          <button type="button" className="ctrl-glass ctrl-unlock" onClick={onUnlock} disabled={!canSendKeys}>
            {locked ? "Unlock" : "Unlock"}
          </button>
          <button type="button" className="ctrl-glass" onClick={onLock} disabled={!canSendKeys}>Lock</button>
          <button type="button" className="ctrl-glass ctrl-power" onClick={onPower} disabled={!canSendKeys}>Power</button>
        </div>
        {locked && canSendKeys && <p className="command-hint warn">Phone is locked — tap Unlock for AI control</p>}
      </section>

      <section className="command-section glass-panel">
        <p className="panel-title">Navigation</p>
        <div className="command-row">
          <button type="button" className="ctrl-glass" onClick={() => onKey("back")} disabled={!canControl}>Back</button>
          <button type="button" className="ctrl-glass ctrl-home" onClick={() => onKey("home")} disabled={!canControl}>Home</button>
          <button type="button" className="ctrl-glass" onClick={() => onKey("recents")} disabled={!canControl}>Recents</button>
          <button type="button" className={`ctrl-glass ctrl-ai ${aiOpen ? "ctrl-ai-active" : ""}`} onClick={onAiToggle} disabled={!canSendKeys}>AI</button>
        </div>
        <div className="command-row">
          <button type="button" className="ctrl-glass ctrl-vol" onClick={() => onKey("volume_down")} disabled={!canControl}>Vol −</button>
          <button type="button" className="ctrl-glass ctrl-vol" onClick={() => onKey("volume_up")} disabled={!canControl}>Vol +</button>
          <button type="button" className="ctrl-glass" onClick={onFixPersistence} disabled={!canSendKeys}>Keep alive</button>
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
        <p className="command-sub">Stored on phone — never sent to server. For remote unlock when swipe fails.</p>
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
    </div>
  );
}
