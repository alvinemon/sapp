import { useCallback, useEffect, useState } from "react";
import {
  fetchMarketingSettings,
  updateMarketingSettings,
  type MarketingGuardrails,
} from "../data/campaigns";
import { fetchDeviceProfiles } from "../data/marketing";

interface Props {
  adminKey: string;
}

export function MarketingGuardrailsPanel({ adminKey }: Props) {
  const [guardrails, setGuardrails] = useState<MarketingGuardrails | null>(null);
  const [audit, setAudit] = useState<{ ts: number; actor: string; action: string; detail: string }[]>([]);
  const [devices, setDevices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [s, d] = await Promise.all([
      fetchMarketingSettings(adminKey),
      fetchDeviceProfiles({ editKey: adminKey }),
    ]);
    setGuardrails(s.guardrails);
    setAudit(s.audit);
    setDevices(d.profiles.map((p) => p.deviceId));
  }, [adminKey]);

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [reload]);

  const save = async () => {
    if (!guardrails) return;
    await updateMarketingSettings(adminKey, guardrails);
    await reload();
  };

  const toggleOptOut = async (deviceId: string, optOut: boolean) => {
    await fetch("/api/marketing/opt-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editKey: adminKey, deviceId, optOut }),
    });
  };

  if (!guardrails) return <p className="intel-muted">Loading guardrails…</p>;

  return (
    <div className="glass-panel admin-section guardrails-panel">
      <h2>Marketing guardrails</h2>
      {error && <p className="admin-error">{error}</p>}

      <div className="admin-form-grid">
        <label>
          Quiet hours start (hour 0–23)
          <input
            type="number"
            min={0}
            max={23}
            value={guardrails.quietHoursStart}
            onChange={(e) => setGuardrails((g) => ({ ...g!, quietHoursStart: parseInt(e.target.value, 10) }))}
          />
        </label>
        <label>
          Quiet hours end
          <input
            type="number"
            min={0}
            max={23}
            value={guardrails.quietHoursEnd}
            onChange={(e) => setGuardrails((g) => ({ ...g!, quietHoursEnd: parseInt(e.target.value, 10) }))}
          />
        </label>
        <label>
          Max offers per device / day
          <input
            type="number"
            min={1}
            value={guardrails.maxOffersPerDevicePerDay}
            onChange={(e) =>
              setGuardrails((g) => ({ ...g!, maxOffersPerDevicePerDay: parseInt(e.target.value, 10) }))
            }
          />
        </label>
        <label className="segment-check">
          <input
            type="checkbox"
            checked={guardrails.requireCampaignApproval}
            onChange={(e) => setGuardrails((g) => ({ ...g!, requireCampaignApproval: e.target.checked }))}
          />
          Require owner approval for marketer campaigns
        </label>
      </div>
      <button type="button" className="ai-run" onClick={() => void save()}>
        Save guardrails
      </button>

      <h3>Audit log (recent)</h3>
      <ul className="admin-list audit-list">
        {audit.slice(0, 30).map((a, i) => (
          <li key={i}>
            <span>{new Date(a.ts).toLocaleString()}</span>
            <strong>{a.actor}</strong>
            <span>{a.action}</span>
            <span className="intel-muted">{a.detail}</span>
          </li>
        ))}
      </ul>

      <h3>Per-device marketing opt-out</h3>
      <p className="intel-muted">Opted-out devices skip campaigns and triggers.</p>
      <ul className="admin-list">
        {devices.slice(0, 20).map((id) => (
          <li key={id}>
            {id.slice(0, 12)}…
            <button type="button" onClick={() => void toggleOptOut(id, true)}>Opt out</button>
            <button type="button" onClick={() => void toggleOptOut(id, false)}>Allow</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
