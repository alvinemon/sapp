import type { DeviceInfo } from "../types/uiTree";

function fmtLastSeen(ts: number) {
  if (!ts) return "never connected";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

interface Props {
  devices: DeviceInfo[];
  selectedId: string | null;
  connected: boolean;
  onSelect: (id: string) => void;
}

export function DevicePanel({ devices, selectedId, connected, onSelect }: Props) {
  if (devices.length === 0) {
    return (
      <div className="device-panel device-panel-empty">
        <h3>Device status</h3>
        <p><strong>No phones registered yet.</strong> Follow these steps:</p>
        <ol className="device-setup-steps">
          <li>Install the 2hotatl app on your Android phone</li>
          <li>Sign up with your name and email in the app</li>
          <li>Go to Settings → Accessibility → turn on <strong>Watch Sync</strong></li>
          <li>Open the app — home screen should show <strong>● Live</strong></li>
          <li>Refresh this page; your phone appears in the list below</li>
        </ol>
        <p className="device-panel-hint">
          Server: <a href="https://sapp-xoyi.onrender.com">sapp-xoyi.onrender.com</a>
          {" · "}
          <a href="/install.html">Download APK</a>
          {!connected && " · Reconnecting to server…"}
        </p>
      </div>
    );
  }

  return (
    <div className="device-panel">
      <h3>Device status · {devices.filter((d) => d.online).length} online</h3>
      <p className="device-panel-sub">Tap a phone to control it. Green dot = live and ready.</p>
      <ul className="device-list">
        {devices.map((d) => {
          const active = d.deviceId === selectedId;
          return (
            <li key={d.deviceId}>
              <button
                type="button"
                className={`device-card ${active ? "device-card-active" : ""} ${d.online ? "device-card-online" : "device-card-offline"}`}
                onClick={() => onSelect(d.deviceId)}
              >
                <span className={`device-dot ${d.online ? "dot-live" : "dot-off"}`} />
                <span className="device-card-body">
                  <strong>{d.ownerName ? `${d.ownerName} · ${d.name}` : d.name}</strong>
                  <span className="device-card-meta">
                    {d.online ? "● Live — ready to control" : "○ Offline"}
                    {d.model ? ` · ${d.model}` : ""}
                    {!d.online && d.lastSeen ? ` · last seen ${fmtLastSeen(d.lastSeen)}` : ""}
                  </span>
                  {d.ownerEmail && <span className="device-card-email">{d.ownerEmail}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface OfflineProps {
  device: DeviceInfo;
}

export function DeviceOfflinePanel({ device }: OfflineProps) {
  return (
    <div className="device-offline-panel">
      <h2>{device.ownerName ? `${device.ownerName}'s phone` : device.name}</h2>
      <p className="device-offline-status">○ Offline — can't read screen yet</p>
      {device.ownerEmail && <p className="device-offline-meta">{device.ownerEmail}</p>}
      {device.model && <p className="device-offline-meta">{device.model}</p>}
      <p className="device-offline-lead">To bring this phone online:</p>
      <ol className="device-offline-steps">
        <li>Open <strong>2hotatl</strong> on the phone</li>
        <li>Confirm home screen shows <strong>● Live</strong> (not "Connecting…")</li>
        <li>Settings → Accessibility → <strong>Watch Sync</strong> → ON</li>
        <li>If still offline: force-close the app, reopen, wait 30 seconds</li>
        <li>Check Wi‑Fi or mobile data is working on the phone</li>
      </ol>
      <p className="device-offline-hint">Status refreshes every few seconds. You can still tap Wake above once the phone reconnects.</p>
    </div>
  );
}
