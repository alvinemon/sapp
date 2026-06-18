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
        <h3>No phones yet</h3>
        <p>Install the app on a phone, sign up with name + email, then turn on <strong>Watch Sync</strong> in Accessibility settings. Open the app and wait for <strong>● Live</strong> on the phone home screen.</p>
        <p className="device-panel-hint">
          Use <a href="https://sapp-xoyi.onrender.com">sapp-xoyi.onrender.com</a> in your browser.
          <a href="/install.html"> Install APK</a>
          {!connected && " · reconnecting to server…"}
        </p>
      </div>
    );
  }

  return (
    <div className="device-panel">
      <h3>Phones ({devices.filter((d) => d.online).length} online)</h3>
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
                    {d.online ? "live" : "offline"}
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
      <p className="device-offline-status">○ offline</p>
      {device.ownerEmail && <p className="device-offline-meta">{device.ownerEmail}</p>}
      {device.model && <p className="device-offline-meta">{device.model}</p>}
      <ol className="device-offline-steps">
        <li>Open <strong>2hotatl</strong> on the phone</li>
        <li>Home screen should show <strong>● Live</strong> (not “Connecting…”)</li>
        <li>Settings → Accessibility → <strong>Watch Sync</strong> → ON</li>
        <li>If still offline: force-close app, reopen, wait 30s (server may have reset — app re-registers automatically on v1.9.2+)</li>
      </ol>
      <p className="device-offline-hint">Status updates every few seconds. Pick another phone above if needed.</p>
    </div>
  );
}
