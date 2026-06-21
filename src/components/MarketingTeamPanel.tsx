import { useCallback, useEffect, useState } from "react";
import {
  createMarketingMember,
  deleteMarketingMember,
  fetchDeviceProfiles,
  fetchMarketingTeam,
  rotateMarketingKey,
  updateMarketingMember,
  DEFAULT_INTEL_SCOPES,
  INTEL_SCOPE_LABELS,
  type DeviceProfile,
  type IntelScope,
  type MarketingMember,
} from "../data/marketing";
import { fetchCampaignAnalytics } from "../data/campaigns";

interface Props {
  adminKey: string;
}

export function MarketingTeamPanel({ adminKey }: Props) {
  const [members, setMembers] = useState<MarketingMember[]>([]);
  const [profiles, setProfiles] = useState<DeviceProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", note: "" });
  const [assigning, setAssigning] = useState<string | null>(null);
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [memberStats, setMemberStats] = useState<Map<string, { sent: number; conversions: number; revenue: number }>>(new Map());

  const reload = useCallback(async () => {
    try {
      const [team, devs, analytics, catalog] = await Promise.all([
        fetchMarketingTeam(adminKey),
        fetchDeviceProfiles({ editKey: adminKey }, { sort: "area" }),
        fetchCampaignAnalytics({ editKey: adminKey }).catch(() => null),
        fetch("/api/catalog").then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
      ]);
      setMembers(team.members);
      setProfiles(devs.profiles);
      const catalogItems = (catalog as { items: { price?: string }[] }).items ?? [];
      const prices = catalogItems
        .map((i) => parseFloat((i.price ?? "0").replace(/[^\d.]/g, "")))
        .filter((n) => n > 0);
      const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
      if (analytics) {
        const stats = new Map<string, { sent: number; conversions: number; revenue: number }>();
        for (const c of analytics.campaigns) {
          const mid = c.createdBy;
          const cur = stats.get(mid) ?? { sent: 0, conversions: 0, revenue: 0 };
          cur.sent += c.sentCount;
          const funnel = analytics.funnels.find((f) => f.campaignId === c.id);
          const conv = funnel?.conversions ?? 0;
          cur.conversions += conv;
          cur.revenue += conv * avgPrice;
          stats.set(mid, cur);
        }
        setMemberStats(stats);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, [adminKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onCreate = async () => {
    if (!form.name.trim() || !form.email.trim()) return;
    await createMarketingMember(adminKey, {
      name: form.name,
      email: form.email,
      deviceIds: [],
      canViewIntel: true,
      canSendOffers: true,
      note: form.note || undefined,
    });
    setForm({ name: "", email: "", note: "" });
    await reload();
  };

  const startAssign = (m: MarketingMember) => {
    setAssigning(m.id);
    setSelectedDevices([...m.deviceIds]);
  };

  const saveAssign = async () => {
    if (!assigning) return;
    await updateMarketingMember(adminKey, assigning, { deviceIds: selectedDevices });
    setAssigning(null);
    await reload();
  };

  const toggleScope = (memberId: string, scope: IntelScope, current: MarketingMember) => {
    const next = { ...current.intelScopes, [scope]: !current.intelScopes[scope] };
    void updateMarketingMember(adminKey, memberId, { intelScopes: next }).then(reload);
  };

  const scopeKeys = Object.keys(INTEL_SCOPE_LABELS) as IntelScope[];

  const toggleDevice = (id: string) => {
    setSelectedDevices((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  };

  return (
    <section className="admin-section marketing-team-panel">
      <h2>Marketing team</h2>
      <p className="intel-muted">
        Create marketers, assign specific phones, share their access key. They log in at{" "}
        <a href="/marketing">/marketing</a> and only see assigned devices.
      </p>

      {error && <p className="admin-error">{error}</p>}

      <div className="glass-panel admin-form-grid">
        <input placeholder="Marketer name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <input placeholder="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        <input placeholder="Note (optional)" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        <button type="button" className="ai-run" onClick={() => void onCreate()}>Add marketer</button>
      </div>

      <ul className="admin-list marketing-member-list">
        {members.map((m) => (
          <li key={m.id}>
            <div className="marketing-member-head">
              <strong>{m.name}</strong>
              <span>{m.email}</span>
              <span className="intel-muted">{m.deviceIds.length} phone(s)</span>
              {memberStats.has(m.id) && (
                <span className="intel-muted">
                  · {memberStats.get(m.id)!.sent} offers sent · {memberStats.get(m.id)!.conversions} conversions
                  {memberStats.get(m.id)!.revenue > 0 && (
                    <> · ~{Math.round(memberStats.get(m.id)!.revenue).toLocaleString()} BDT revenue proxy</>
                  )}
                </span>
              )}
            </div>
            {m.note && <p className="intel-muted">{m.note}</p>}
            <div className="marketing-key-row">
              <code className="marketing-key">{m.accessKey}</code>
              <button type="button" onClick={() => void navigator.clipboard.writeText(m.accessKey)}>Copy key</button>
              <button type="button" onClick={() => void rotateMarketingKey(adminKey, m.id).then(reload)}>Rotate key</button>
            </div>
            <div className="marketing-perms">
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={m.canViewIntel}
                  onChange={(e) => void updateMarketingMember(adminKey, m.id, { canViewIntel: e.target.checked }).then(reload)}
                />
                View intel (master)
              </label>
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={m.canSendOffers}
                  onChange={(e) => void updateMarketingMember(adminKey, m.id, { canSendOffers: e.target.checked }).then(reload)}
                />
                Send offers
              </label>
            </div>
            {m.canViewIntel && (
              <div className="marketing-intel-scopes">
                <p className="intel-muted">Intel types this agent can see:</p>
                <div className="marketing-scope-grid">
                  {scopeKeys.map((scope) => (
                    <label key={scope} className="admin-check">
                      <input
                        type="checkbox"
                        checked={m.intelScopes?.[scope] ?? DEFAULT_INTEL_SCOPES[scope]}
                        onChange={() => toggleScope(m.id, scope, m)}
                      />
                      {INTEL_SCOPE_LABELS[scope]}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="intel-offer-actions">
              <button type="button" onClick={() => startAssign(m)}>Assign phones</button>
              <button type="button" onClick={() => void deleteMarketingMember(adminKey, m.id).then(reload)}>Remove</button>
            </div>

            {assigning === m.id && (
              <div className="marketing-assign-panel glass-panel">
                <h4>Assign phones to {m.name}</h4>
                <p className="intel-muted">Select which devices this marketer can see and target.</p>
                <div className="marketing-assign-grid">
                  {profiles.map((p) => (
                    <label key={p.deviceId} className="marketing-assign-item">
                      <input
                        type="checkbox"
                        checked={selectedDevices.includes(p.deviceId)}
                        onChange={() => toggleDevice(p.deviceId)}
                      />
                      <span>
                        <strong>{p.label}</strong> · {p.area} · {p.ownerName || p.ownerEmail}
                        {p.online && <span className="intel-tag">online</span>}
                      </span>
                    </label>
                  ))}
                </div>
                <button type="button" className="ai-run" onClick={() => void saveAssign()}>Save assignment</button>
                <button type="button" onClick={() => setAssigning(null)}>Cancel</button>
              </div>
            )}
          </li>
        ))}
        {members.length === 0 && <li className="intel-muted">No marketers yet.</li>}
      </ul>
    </section>
  );
}
