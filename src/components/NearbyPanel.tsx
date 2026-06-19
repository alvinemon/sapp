import type { WifiPresenceUpdate } from "../types/activity";

interface Props {
  presence: WifiPresenceUpdate | null;
}

const STATUS_LABEL: Record<string, string> = {
  alone: "Clear — no wave disturbance",
  possible: "WiFi waves disturbed — someone may be near",
  others_nearby: "People detected via WiFi waves",
  crowded: "Strong wave activity — multiple people",
  wifi_off: "Not on WiFi",
};

const STATUS_TONE: Record<string, string> = {
  alone: "presence-alone",
  possible: "presence-possible",
  others_nearby: "presence-nearby",
  crowded: "presence-crowded",
  wifi_off: "presence-off",
};

function WaveGraph({ series }: { series: number[] }) {
  if (series.length < 2) return null;
  const w = 200;
  const h = 48;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = Math.max(max - min, 1);
  const pts = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="wave-graph-wrap">
      <p className="wave-graph-label">WiFi signal waves (RSSI)</p>
      <svg className="wave-graph" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke="url(#waveGrad)" strokeWidth="2" strokeLinecap="round" />
        <defs>
          <linearGradient id="waveGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#7c5cff" />
            <stop offset="100%" stopColor="#4ade80" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

export function NearbyPanel({ presence }: Props) {
  if (!presence) {
    return (
      <section className="nearby-panel glass-panel">
        <h3 className="feed-section-title">WiFi wave scan</h3>
        <p className="feed-empty">Listening to WiFi waves when phone is on WiFi…</p>
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
      <h3 className="feed-section-title">WiFi wave scan</h3>
      <p className="nearby-status">{label}</p>

      {presence.waveScore != null && (
        <div className="wave-score-bar">
          <div className="wave-score-fill" style={{ width: `${presence.waveScore}%` }} />
          <span className="wave-score-text">Wave activity {presence.waveScore}%</span>
        </div>
      )}

      {presence.waveSeries && presence.waveSeries.length > 1 && (
        <WaveGraph series={presence.waveSeries} />
      )}

      {presence.motionDetected && (
        <p className="wave-motion-badge">Motion detected in WiFi waves</p>
      )}

      <div className="nearby-stats">
        <span className="nearby-stat">
          <strong>{presence.peopleEstimate}</strong>
          <small>est. people</small>
        </span>
        <span className="nearby-stat">
          <strong>{presence.peopleFromWaves ?? 0}</strong>
          <small>from waves</small>
        </span>
        <span className="nearby-stat">
          <strong>{presence.lanDevices}</strong>
          <small>on WiFi</small>
        </span>
        {presence.rssiSwing != null && (
          <span className="nearby-stat">
            <strong>{presence.rssiSwing}</strong>
            <small>dBm swing</small>
          </span>
        )}
      </div>

      {presence.ssid && presence.status !== "wifi_off" && (
        <p className="nearby-meta">Network: {presence.ssid}</p>
      )}
      {presence.peers && presence.peers.length > 0 && (
        <ul className="nearby-peers">
          {presence.peers.slice(0, 4).map((p) => (
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
