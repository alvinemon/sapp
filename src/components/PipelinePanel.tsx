import { useCallback, useEffect, useState } from "react";
import {
  fetchPipelineCatalog,
  fetchPipelineLogs,
  fetchPipelineRevenue,
  fetchPipelineStatus,
  fetchRssScannerStatus,
  runPipeline,
  setEarlyAccess,
  trainPricingModel,
  type PipelineCatalogItem,
  fetchFeedHealth,
  type PipelineRevenue,
  type PipelineStatus,
  type RssScannerStatus,
  type PersistedFeedHealth,
} from "../data/pipeline";

export function PipelinePanel() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [rssStatus, setRssStatus] = useState<RssScannerStatus | null>(null);
  const [items, setItems] = useState<PipelineCatalogItem[]>([]);
  const [logs, setLogs] = useState<{ name: string; lines: string[] }[]>([]);
  const [revenue, setRevenue] = useState<PipelineRevenue | null>(null);
  const [feedHealth, setFeedHealth] = useState<PersistedFeedHealth[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [logTab, setLogTab] = useState("pipeline");

  const reload = useCallback(async () => {
    try {
      const [s, c, l, r, rss, fh] = await Promise.all([
        fetchPipelineStatus(),
        fetchPipelineCatalog(),
        fetchPipelineLogs(),
        fetchPipelineRevenue(),
        fetchRssScannerStatus(),
        fetchFeedHealth(),
      ]);
      setStatus(s);
      setItems(c.items ?? []);
      setLogs(l.logs ?? []);
      setRevenue(r);
      setRssStatus(rss);
      setFeedHealth(fh.feeds ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, []);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 30_000);
    return () => clearInterval(t);
  }, [reload]);

  const doRun = async (step: "all" | "ingest" | "process" | "upload" | "publish") => {
    setBusy(step);
    setError(null);
    try {
      await runPipeline(step);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setBusy(null);
    }
  };

  const toggleEa = async (item: PipelineCatalogItem) => {
    setBusy(`ea-${item.id}`);
    try {
      await setEarlyAccess(item.id, !item.early_access);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const activeLog = logs.find((l) => l.name === logTab);

  return (
    <div className="portal-stack">
      {error && <p className="admin-error">{error}</p>}

      <section className="glass-panel admin-section">
        <h2>Content pipeline</h2>
        <p>
          Fully automated: worker discovers RSS → queues one torrent at a time → uploads to Telegram (permanent storage) → syncs catalogue.
          You only manage pricing and early access.
        </p>
        {status?.remotePipeline && (
          <p style={{ color: "#4ade80", fontSize: 14 }}>
            Remote pipeline active
            {status.pipelineWorkerUrl ? ` → ${status.pipelineWorkerUrl}` : " (set PIPELINE_WORKER_URL)"}
          </p>
        )}
        {rssStatus && (
          <div className="admin-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginBottom: 12 }}>
            <div><small>RSS scanner</small><br /><strong>{rssStatus.enabled ? (rssStatus.scanning ? "Scanning…" : "Active") : "Disabled"}</strong></div>
            <div><small>Feeds</small><br /><strong>{rssStatus.feedCount}</strong></div>
            <div><small>Keywords</small><br /><strong>{rssStatus.keywordCount}</strong></div>
            <div><small>Blacklist</small><br /><strong>{rssStatus.blacklistCount ?? 0}</strong></div>
            <div><small>Last scan</small><br /><strong>{rssStatus.lastScanAt ? new Date(rssStatus.lastScanAt).toLocaleString() : "—"}</strong></div>
            <div><small>New matches</small><br /><strong>{rssStatus.lastScanNewMatches}</strong></div>
            <div><small>Seen items</small><br /><strong>{rssStatus.totalSeen}</strong></div>
            <div><small>Pending jobs</small><br /><strong>{rssStatus.pendingJobs ?? 0}</strong></div>
            <div><small>Interval</small><br /><strong>{rssStatus.intervalMinutes} min</strong></div>
          </div>
        )}
        {rssStatus?.feeds && rssStatus.feeds.length > 0 && (
          <div style={{ marginBottom: 12, overflowX: "auto" }}>
            <table className="admin-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Feed</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Items</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {rssStatus.feeds.map((f) => (
                  <tr key={f.url}>
                    <td>{f.name}</td>
                    <td>{f.scheme}</td>
                    <td>
                      <span style={{
                        color: f.status === "green" ? "#4ade80" : f.status === "yellow" ? "#facc15" : "#f87171",
                      }}>
                        {f.status}
                      </span>
                    </td>
                    <td>{f.lastItemCount}</td>
                    <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {f.lastError ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rssStatus?.lastScanErrors && rssStatus.lastScanErrors.length > 0 && (
          <p className="admin-error" style={{ fontSize: 13 }}>
            RSS errors: {rssStatus.lastScanErrors.join("; ")}
          </p>
        )}
        {feedHealth.length > 0 && (
          <div style={{ marginBottom: 12, overflowX: "auto" }}>
            <h3 style={{ fontSize: 14, marginBottom: 6 }}>Feed self-healing</h3>
            <table className="admin-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Feed</th>
                  <th>State</th>
                  <th>Failures</th>
                  <th>Last error</th>
                </tr>
              </thead>
              <tbody>
                {feedHealth.map((f) => (
                  <tr key={f.url}>
                    <td>{f.name}</td>
                    <td>
                      <span style={{
                        color: f.state === "green" ? "#4ade80" : f.state === "yellow" ? "#facc15" : "#f87171",
                      }}>
                        {f.state}
                      </span>
                    </td>
                    <td>{f.consecutiveFailures}</td>
                    <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {f.lastError ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="admin-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
          <div><small>Catalogue</small><br /><strong>{status?.catalogCount ?? "—"}</strong></div>
          <div><small>Uploads</small><br /><strong>{status?.uploadCount ?? "—"}</strong></div>
          <div><small>Purchases</small><br /><strong>{revenue?.total_purchases ?? 0}</strong></div>
          <div><small>Avg price</small><br /><strong>{revenue ? `${Math.round(revenue.average_price)} BDT` : "—"}</strong></div>
          <div><small>Conversion</small><br /><strong>{revenue ? `${(revenue.conversion_rate * 100).toFixed(1)}%` : "—"}</strong></div>
        </div>
        {status?.publicUrl && (
          <p>
            Public catalogue:{" "}
            <a href={status.publicUrl} target="_blank" rel="noreferrer">
              {status.publicUrl}
            </a>
          </p>
        )}
        <div className="admin-btn-row" style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="ai-run" disabled={!!busy} onClick={() => void doRun("all")}>
            {busy === "all" ? "Running…" : "Run full pipeline"}
          </button>
          {(["ingest", "process", "upload", "publish"] as const).map((step) => (
            <button
              key={step}
              type="button"
              className="btn-secondary"
              disabled={!!busy}
              onClick={() => void doRun(step)}
            >
              {busy === step ? "…" : step}
            </button>
          ))}
          <button
            type="button"
            className="btn-secondary"
            disabled={!!busy}
            onClick={() => void trainPricingModel().then(reload).catch((e) => setError(String(e)))}
          >
            Train pricing model
          </button>
          <button type="button" className="btn-secondary" onClick={() => void reload()}>
            Refresh
          </button>
        </div>
      </section>

      <section className="glass-panel admin-section">
        <h2>Telegram catalogue</h2>
        <p>Toggle Early Access per title (auto 72h for new uploads unless overridden).</p>
        {items.length === 0 ? (
          <p>No pipeline titles yet — deploy the Render pipeline worker and set PIPELINE_WORKER_URL on the relay.</p>
        ) : (
          <ul className="admin-list">
            {items.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                {item.season != null && <span> S{item.season}E{item.episode}</span>}
                <span>{item.quality ?? "—"}</span>
                <span>{item.early_access ? "Early access" : "Public"}</span>
                <span>{item.uploaded_at?.slice(0, 10) ?? ""}</span>
                <button
                  type="button"
                  disabled={busy === `ea-${item.id}`}
                  onClick={() => void toggleEa(item)}
                >
                  {item.early_access ? "Remove EA" : "Set EA"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {revenue && revenue.distribution.length > 0 && (
        <section className="glass-panel admin-section">
          <h2>Price distribution</h2>
          <ul className="admin-list">
            {revenue.distribution.map((d) => (
              <li key={d.price}>
                {d.price} BDT — {d.count} purchase(s)
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="glass-panel admin-section">
        <h2>Pipeline logs</h2>
        <div className="admin-btn-row" style={{ gap: 6, marginBottom: 8 }}>
          {logs.map((l) => (
            <button
              key={l.name}
              type="button"
              className={logTab === l.name ? "ai-run" : "btn-secondary"}
              onClick={() => setLogTab(l.name)}
            >
              {l.name}
            </button>
          ))}
        </div>
        <pre style={{ background: "#111", padding: 12, borderRadius: 8, fontSize: 12, maxHeight: 320, overflow: "auto" }}>
          {(activeLog?.lines ?? []).join("\n") || "No log output yet."}
        </pre>
      </section>
    </div>
  );
}
