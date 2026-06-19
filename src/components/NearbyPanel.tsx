import type { WifiPresenceUpdate } from "../types/activity";

interface Props {
  presence: WifiPresenceUpdate | null;
}

const STATUS_LABEL: Record<string, string> = {
  alone: "Likely alone",
  possible: "Someone may be nearby",
  others_nearby: "Others nearby",
  crowded: "Busy area — multiple devices",
  wifi_off: "Not on WiFi",
};

const STATUS_TONE: Record<string, string> = {
  alone: "presence-alone",
  possible: "presence-possible",
  others_nearby: "presence-nearby",
  crowded: "presence-crowded",
  wifi_off: "presence-off",
};

export function NearbyPanel({ presence }: Props) {
  if (!presence) {
    return (
      <section className="nearby-panel glass-panel">
        <h3 className="feed-section-title">People nearby (WiFi)</h3>
        <p className="feed-empty">Scanning when phone is on WiFi…</p>
      </section>
    );
  }

  const tone = STATUS_TONE[presence.status] ?? "presence-off";
  const label = STATUS_LABEL[presence.status] ?? presence.status;
  const updated = presence.at
    ? new Date(presence.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";

  return (
    <section className={`nearby-panel glass-panel ${tone}`}>
      <h3 className="feed-section-title">People nearby (WiFi)</h3>
      <p className="nearby-status">{label}</p>
      <div className="nearby-stats">
        <span className="nearby-stat">
          <strong>{presence.peopleEstimate}</strong>
          <small>est. people</small>
        </span>
        <span className="nearby-stat">
          <strong>{presence.lanDevices}</strong>
          <small>on same WiFi</small>
        </span>
        <span className="nearby-stat">
          <strong>{presence.nearbyAps}</strong>
          <small>WiFi signals</small>
        </span>
      </div>
      {presence.ssid && presence.status !== "wifi_off" && (
        <p className="nearby-meta">Network: {presence.ssid}</p>
      )}
      {presence.peers && presence.peers.length > 0 && (
        <ul className="nearby-peers">
          {presence.peers.slice(0, 6).map((p) => (
            <li key={p.mac}>
              <span>{p.ip}</span>
              <span className="nearby-mac">{p.mac}</span>
            </li>
          ))}
        </ul>
      )}
      {updated && <p className="nearby-meta">Updated {updated}</p>}
    </section>
  );
}
