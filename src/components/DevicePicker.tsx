import { useCallback, useEffect, useState } from "react";
import {
  fetchDeviceProfiles,
  type DeviceProfile,
  type DeviceSort,
} from "../data/marketing";

interface Props {
  editKey?: string;
  marketingKey?: string;
  selectedId: string;
  onSelect: (deviceId: string) => void;
}

export function DevicePicker({ editKey, marketingKey, selectedId, onSelect }: Props) {
  const [profiles, setProfiles] = useState<DeviceProfile[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [sort, setSort] = useState<DeviceSort>("area");
  const [area, setArea] = useState("all");
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const keys = { editKey, marketingKey };

  const reload = useCallback(async () => {
    if (!editKey && !marketingKey) return;
    setLoading(true);
    try {
      const data = await fetchDeviceProfiles(keys, {
        sort,
        area: area === "all" ? undefined : area,
        onlineOnly,
        q: q.trim() || undefined,
      });
      setProfiles(data.profiles);
      setAreas(data.areas);
    } catch {
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, [editKey, marketingKey, sort, area, onlineOnly, q]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const fmtTime = (ts: number) => (ts ? new Date(ts).toLocaleString() : "—");

  return (
    <div className="device-picker glass-panel">
      <div className="device-picker-toolbar">
        <input
          placeholder="Search name, email, area, model…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as DeviceSort)}>
          <option value="area">Sort: Area</option>
          <option value="name">Sort: Name</option>
          <option value="activity">Sort: Activity</option>
          <option value="online">Sort: Online first</option>
          <option value="recent">Sort: Recent</option>
        </select>
        <select value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="all">All areas</option>
          {areas.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <label className="admin-check">
          <input type="checkbox" checked={onlineOnly} onChange={(e) => setOnlineOnly(e.target.checked)} />
          Online only
        </label>
        <button type="button" onClick={() => void reload()} disabled={loading}>
          Refresh
        </button>
      </div>

      <p className="intel-muted">{loading ? "Loading phones…" : `${profiles.length} phone(s)`}</p>

      <div className="device-picker-table-wrap">
        <table className="device-picker-table">
          <thead>
            <tr>
              <th></th>
              <th>User / phone</th>
              <th>Area</th>
              <th>Owner</th>
              <th>Activity</th>
              <th>Tags</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr
                key={p.deviceId}
                className={selectedId === p.deviceId ? "selected" : ""}
                onClick={() => onSelect(p.deviceId)}
              >
                <td>
                  <span className={`device-online ${p.online ? "on" : "off"}`} title={p.online ? "Online" : "Offline"} />
                </td>
                <td>
                  <strong>{p.label}</strong>
                  <small>{p.model || p.shortId}</small>
                </td>
                <td>
                  <strong>{p.area}</strong>
                  {p.lat != null && (
                    <small>{p.lat.toFixed(3)}, {p.lng?.toFixed(3)}</small>
                  )}
                </td>
                <td>
                  <span>{p.ownerName || "—"}</span>
                  <small>{p.ownerEmail}</small>
                  {p.ownerPhone && <small>{p.ownerPhone}</small>}
                </td>
                <td>
                  <span>{p.notificationCount} alerts</span>
                  <small>score {p.activityScore}</small>
                </td>
                <td>
                  <div className="intel-tags compact">
                    {p.tags.slice(0, 3).map((t) => (
                      <span key={t} className="intel-tag">{t}</span>
                    ))}
                  </div>
                </td>
                <td><small>{fmtTime(p.lastSeen)}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
        {profiles.length === 0 && !loading && (
          <p className="intel-muted">No phones match filters.</p>
        )}
      </div>
    </div>
  );
}
