import { useMemo, useRef, useState } from "react";
import { ScreenGuide } from "./components/ScreenGuide";
import { AiPanel } from "./components/AiPanel";
import { SemanticUiView } from "./components/SemanticUiView";
import { DevicePanel, DeviceOfflinePanel } from "./components/DevicePanel";
import { useAgent } from "./hooks/useAgent";
import { useLiveStream } from "./hooks/useRelayStream";
import { clientToDevice } from "./utils/coords";
import { buildScreenGuide } from "./utils/screenGuide";
import type { ScreenAction } from "./utils/screenGuide";

function statusLabel(
  selectedDeviceId: string | null,
  phoneLive: boolean,
  connected: boolean,
  activeName: string,
  deviceName: string,
) {
  if (!selectedDeviceId) return { text: "No device selected", tone: "muted" as const };
  if (phoneLive) return { text: `Live · ${activeName || deviceName}`, tone: "live" as const };
  if (connected) return { text: "Connecting to phone…", tone: "warn" as const };
  return { text: "Server offline", tone: "muted" as const };
}

export default function App() {
  const [showMap, setShowMap] = useState(false);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const rippleId = useRef(0);

  const {
    tree,
    treeTick,
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
  } = useLiveStream();

  const agent = useAgent(send, getTree, waitForTree, getTreeTick);
  const guide = useMemo(() => (tree ? buildScreenGuide(tree) : null), [tree, treeTick]);
  const canControl = connected && !!selectedDeviceId && (!!tree || phoneLive);
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

  const onWake = () => send({ type: "key", action: "wake" });
  const onPower = () => send({ type: "key", action: "power" });

  const onAction = (action: ScreenAction) => {
    send({ type: "tap", x: action.x, y: action.y });
  };

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
    if (!canControl || !showMap) return;
    const coords = toDeviceCoords(e.clientX, e.clientY);
    if (!coords) return;
    dragRef.current = { x: coords.x, y: coords.y, t: Date.now() };
    addRipple(coords.localX, coords.localY);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!canControl || !showMap) return;
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
        duration: Math.min(Math.max(dt, 80), 600),
      });
    }
  };

  return (
    <div className="app app-split">
      <div className="bg-glow bg-glow-1" />
      <div className="bg-glow bg-glow-2" />

      <header className="header">
        <div className="logo">
          <span className="logo-icon">◉</span>
          <div>
            <h1>2hotatl</h1>
            <p className="tagline">remote phone control</p>
          </div>
        </div>
        <div className="status-pills">
          <a className="pill pill-link" href="/watch">watch</a>
          <a className="pill pill-link" href="/install.html">install</a>
          <label className="device-picker">
            <span className="device-picker-label">Phone</span>
            <select value={selectedDeviceId ?? ""} onChange={(e) => selectDevice(e.target.value || null)}>
              <option value="">Choose device…</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.online ? "● " : "○ "}
                  {d.ownerName ? `${d.ownerName} · ` : ""}
                  {d.name}
                  {d.model ? ` (${d.model})` : ""}
                </option>
              ))}
            </select>
          </label>
          <span className={`pill pill-status pill-${status.tone}`} title="Connection to selected phone">
            {status.text}
          </span>
          <button
            type="button"
            className={`pill pill-toggle ${showMap ? "pill-live" : "pill-muted"}`}
            onClick={() => setShowMap((v) => !v)}
            title="Show interactive screen map on the phone preview"
          >
            {showMap ? "Screen map: ON" : "Screen map: OFF"}
          </button>
        </div>
      </header>

      {canSendKeys && !tree && (
        <div className="wake-banner">
          <span>Phone screen asleep or not synced?</span>
          <button type="button" className="btn-wake" onClick={onWake} disabled={!canSendKeys}>
            ⏻ Wake phone
          </button>
        </div>
      )}

      <div className="control-bar">
        <span className="control-bar-label">Screen controls</span>
        <button
          type="button"
          className="ctrl-btn ctrl-wake"
          onClick={onWake}
          disabled={!canSendKeys}
          title="Turn screen on (works even when screen map is empty)"
        >
          ⏻ Wake
        </button>
        <button
          type="button"
          className="ctrl-btn ctrl-power"
          onClick={onPower}
          disabled={!canSendKeys}
          title="Wake if asleep, otherwise open power menu"
        >
          Power
        </button>
        <span className="control-bar-sep" />
        <button type="button" className="ctrl-btn" onClick={() => send({ type: "key", action: "back" })} disabled={!canControl}>← Back</button>
        <button type="button" className="ctrl-btn ctrl-home" onClick={() => send({ type: "key", action: "home" })} disabled={!canControl}>⌂ Home</button>
        <button type="button" className="ctrl-btn" onClick={() => send({ type: "key", action: "recents" })} disabled={!canControl}>▢ Recents</button>
        <span className="control-bar-sep" />
        <button type="button" className="ctrl-btn" onClick={() => send({ type: "key", action: "volume_down" })} disabled={!canControl}>Vol −</button>
        <button type="button" className="ctrl-btn" onClick={() => send({ type: "key", action: "volume_up" })} disabled={!canControl}>Vol +</button>
        {!canSendKeys && (
          <span className="control-bar-hint">Select a phone to enable controls</span>
        )}
      </div>

      <main className="main main-split">
        <aside className="guide-panel">
          <p className="section-label">Your controls</p>
          <DevicePanel
            devices={devices}
            selectedId={selectedDeviceId}
            connected={connected}
            onSelect={(id) => selectDevice(id)}
          />
          {!selectedDeviceId ? (
            <div className="guide-empty">
              <strong>Step 1:</strong> Pick a phone from the list or header dropdown.
              <p className="guide-empty-sub">Install the app, enable Watch Sync, then select your device here.</p>
            </div>
          ) : !phoneLive && selectedDevice ? (
            <DeviceOfflinePanel device={selectedDevice} />
          ) : guide ? (
            <ScreenGuide guide={guide} onAction={onAction} />
          ) : selectedDevice ? (
            <div className="guide-empty">
              <p>Reading screen on <strong>{selectedDevice.name}</strong>…</p>
              <p className="guide-empty-sub">If the screen is black, tap <strong>Wake</strong> in the bar above.</p>
            </div>
          ) : null}
          <AiPanel agent={agent} tree={tree} disabled={!canSendKeys || agent.running} connected={connected} phoneLive={phoneLive} />
        </aside>

        <div className="phone-stage">
          <p className="section-label section-label-center">Remote phone</p>
          <div className="phone-shadow" />
          <div className="phone-frame">
            <div className="phone-notch" />
            <div
              ref={screenRef}
              className={`phone-screen ${!canControl ? "phone-screen-wait" : ""}`}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={() => { dragRef.current = null; }}
            >
              {!selectedDeviceId ? (
                <div className="screen-placeholder">
                  <span className="placeholder-emoji">◉</span>
                  <p>Select a device to start</p>
                  <p className="placeholder-sub">Choose from the list on the left</p>
                </div>
              ) : showMap && canControl && tree ? (
                <SemanticUiView tree={tree} treeTick={treeTick} onActivate={(x, y) => send({ type: "tap", x, y })} />
              ) : canControl && tree?.popup ? (
                <div className="screen-placeholder popup-alert">
                  <span className="placeholder-emoji">⚠</span>
                  <p>Popup open — use the orange list on the left</p>
                </div>
              ) : canControl ? (
                <div className="screen-placeholder">
                  <span className="placeholder-emoji">◉</span>
                  <p>{guide?.title ?? "Connected"}</p>
                  <p className="placeholder-sub">Tap actions on the left, or turn on Screen map</p>
                </div>
              ) : (
                <div className="screen-placeholder">
                  <span className="placeholder-emoji">{phoneLive ? "◉" : "○"}</span>
                  <p>{phoneLive ? "Syncing screen…" : selectedDevice ? `${selectedDevice.name} offline` : "Phone offline"}</p>
                  {!phoneLive && selectedDevice && (
                    <p className="placeholder-sub">Open the app · enable Watch Sync</p>
                  )}
                  {canSendKeys && !phoneLive && (
                    <button type="button" className="btn-wake-inline" onClick={onWake}>Wake phone</button>
                  )}
                </div>
              )}
              {ripples.map((r) => (
                <span key={r.id} className="ripple" style={{ left: r.x, top: r.y }} />
              ))}
            </div>
            <div className="phone-chin" />
          </div>

          <nav className="nav-bar nav-bar-full">
            <button type="button" onClick={onWake} disabled={!canSendKeys} className="nav-wake" title="Turn screen on">⏻ Wake</button>
            <button type="button" onClick={() => send({ type: "key", action: "back" })} disabled={!canControl}>Back</button>
            <button type="button" onClick={() => send({ type: "key", action: "home" })} disabled={!canControl} className="nav-home">Home</button>
            <button type="button" onClick={() => send({ type: "key", action: "recents" })} disabled={!canControl}>Recents</button>
            <button type="button" onClick={onPower} disabled={!canSendKeys} className="nav-power" title="Wake if asleep, else power menu">⏻ Power</button>
            <button type="button" onClick={() => send({ type: "key", action: "volume_down" })} disabled={!canControl}>Vol −</button>
            <button type="button" onClick={() => send({ type: "key", action: "volume_up" })} disabled={!canControl}>Vol +</button>
          </nav>
        </div>
      </main>
    </div>
  );
}
