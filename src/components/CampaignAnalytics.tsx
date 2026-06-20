import { useCallback, useEffect, useState } from "react";
import {
  exportAnalyticsCsv,
  fetchCampaignAnalytics,
  type Campaign,
  type CampaignFunnel,
} from "../data/campaigns";

interface Props {
  keys: { editKey?: string; marketingKey?: string };
}

function pct(num: number, den: number) {
  if (!den) return "—";
  return `${Math.round((num / den) * 100)}%`;
}

export function CampaignAnalytics({ keys }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [funnels, setFunnels] = useState<CampaignFunnel[]>([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sinceDays, setSinceDays] = useState(30);

  const reload = useCallback(async () => {
    const since = Date.now() - sinceDays * 86_400_000;
    const r = await fetchCampaignAnalytics(keys, since);
    setCampaigns(r.campaigns);
    setFunnels(r.funnels);
    setTotalEvents(r.summary.totalEvents);
  }, [keys, sinceDays]);

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [reload]);

  const exportCsv = async () => {
    const csv = await exportAnalyticsCsv(keys);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campaign-events-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const byId = new Map(funnels.map((f) => [f.campaignId, f]));

  return (
    <div className="glass-panel admin-section campaign-analytics">
      <h2>Campaign analytics</h2>
      <p className="intel-muted">{totalEvents} tracked events in window</p>
      {error && <p className="admin-error">{error}</p>}

      <div className="intel-offer-actions">
        <label>
          Last{" "}
          <select value={sinceDays} onChange={(e) => setSinceDays(parseInt(e.target.value, 10))}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
        <button type="button" onClick={() => void reload()}>Refresh</button>
        <button type="button" onClick={() => void exportCsv()}>Export CSV</button>
      </div>

      <table className="analytics-table">
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Status</th>
            <th>Sent</th>
            <th>Impressions</th>
            <th>Clicks</th>
            <th>Dismiss</th>
            <th>Convert</th>
            <th>CTR</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => {
            const f = byId.get(c.id) ?? {
              campaignId: c.id,
              sent: c.sentCount,
              impressions: 0,
              clicks: 0,
              dismisses: 0,
              conversions: 0,
            };
            return (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.status}</td>
                <td>{f.sent || c.sentCount}</td>
                <td>{f.impressions}</td>
                <td>{f.clicks}</td>
                <td>{f.dismisses}</td>
                <td>{f.conversions}</td>
                <td>{pct(f.clicks, f.impressions)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {campaigns.length === 0 && <p className="intel-muted">No campaigns in this period.</p>}

      <h3>Funnel overview</h3>
      <div className="funnel-bars">
        {funnels.slice(0, 5).map((f) => {
          const c = campaigns.find((x) => x.id === f.campaignId);
          const max = Math.max(f.sent, f.impressions, 1);
          return (
            <div key={f.campaignId} className="funnel-row">
              <span>{c?.name ?? f.campaignId.slice(0, 8)}</span>
              <div className="funnel-track">
                <div className="funnel-sent" style={{ width: `${(f.sent / max) * 100}%` }} title="Sent" />
                <div className="funnel-impression" style={{ width: `${(f.impressions / max) * 100}%` }} title="Impressions" />
                <div className="funnel-click" style={{ width: `${(f.clicks / max) * 100}%` }} title="Clicks" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
