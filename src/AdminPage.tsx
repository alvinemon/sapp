import { useCallback, useEffect, useState } from "react";
import {
  deleteCatalogItem,
  fetchCatalogAdmin,
  getAdminKey,
  saveCatalogItem,
  setAdminKey,
  type CatalogItem,
  type CatalogSeason,
} from "./data/catalog";
import {
  addPaymentMethod,
  approvePending,
  fetchPaymentMethodsAdmin,
  fetchPendingPayments,
  removePaymentMethod,
  type PaymentMethod,
  type PendingPayment,
} from "./data/premium";
import { PremiumPanel } from "./components/PremiumPanel";
import { IntelDashboard } from "./components/IntelDashboard";
import { MarketingTeamPanel } from "./components/MarketingTeamPanel";
import { SegmentBuilder } from "./components/SegmentBuilder";
import { CampaignsPanel } from "./components/CampaignsPanel";
import { CampaignAnalytics } from "./components/CampaignAnalytics";
import { MarketingGuardrailsPanel } from "./components/MarketingGuardrailsPanel";
import { TriggersPanel } from "./components/TriggersPanel";

type Tab = "content" | "payments" | "intel" | "team" | "segments" | "campaigns" | "analytics" | "guardrails";

export default function AdminPage() {
  const [key, setKey] = useState(getAdminKey);
  const [inputKey, setInputKey] = useState("");
  const [tab, setTab] = useState<Tab>("content");
  const [authed, setAuthed] = useState(!!getAdminKey());
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [pending, setPending] = useState<PendingPayment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    thumb: "",
    url: "",
    free: true,
    price: "",
    type: "movie" as "movie" | "series",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<CatalogSeason[]>([]);
  const [epForm, setEpForm] = useState({
    seasonName: "Season 1",
    title: "",
    url: "",
    free: true,
  });

  const resetForm = () => {
    setEditingId(null);
    setForm({ title: "", description: "", thumb: "", url: "", free: true, price: "", type: "movie" });
    setSeasons([]);
    setEpForm({ seasonName: "Season 1", title: "", url: "", free: true });
  };

  const loadItem = (item: CatalogItem) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      description: item.description,
      thumb: item.thumb,
      url: item.url ?? "",
      free: item.free,
      price: item.price ?? "",
      type: item.type,
    });
    setSeasons(item.seasons ?? []);
  };

  const addEpisode = () => {
    if (!epForm.title.trim()) return;
    const seasonId =
      seasons.find((s) => s.name === epForm.seasonName)?.id ??
      `s${Math.random().toString(36).slice(2, 8)}`;
    const episode = {
      id: `e${Math.random().toString(36).slice(2, 8)}`,
      title: epForm.title,
      url: epForm.url,
      free: epForm.free,
    };
    setSeasons((prev) => {
      const idx = prev.findIndex((s) => s.id === seasonId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], episodes: [...next[idx].episodes, episode] };
        return next;
      }
      return [...prev, { id: seasonId, name: epForm.seasonName, episodes: [episode] }];
    });
    setEpForm((f) => ({ ...f, title: "", url: "" }));
  };

  const reload = useCallback(async () => {
    if (!key) return;
    try {
      const cat = await fetchCatalogAdmin(key);
      setItems(cat.items);
      setMethods((await fetchPaymentMethodsAdmin(key)).methods);
      setPending(await fetchPendingPayments(key));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
      setAuthed(false);
    }
  }, [key]);

  useEffect(() => {
    if (authed) void reload();
  }, [authed, reload]);

  const login = () => {
    setAdminKey(inputKey.trim());
    setKey(inputKey.trim());
    setAuthed(true);
  };

  const saveItem = async () => {
    if (!form.title.trim()) return;
    await saveCatalogItem(key, {
      id: editingId ?? undefined,
      type: form.type,
      title: form.title,
      description: form.description,
      thumb: form.thumb || "https://placehold.co/300x450/141414/e50914?text=2hotatl",
      url: form.type === "movie" ? form.url : undefined,
      free: form.free,
      price: form.free ? undefined : form.price,
      currency: "BDT",
      methodIds: [],
      seasons: form.type === "series" ? seasons : undefined,
    });
    resetForm();
    await reload();
  };

  if (!authed) {
    return (
      <div className="admin-page owner-gate">
        <h1>Owner admin</h1>
        <p>Manage catalog, payments, and AI offers. Public viewers use <a href="/watch">/watch</a>.</p>
        <input
          type="password"
          placeholder="Admin edit key"
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && login()}
        />
        <button type="button" onClick={login}>Enter admin</button>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <h1>2hotatl Admin</h1>
        <nav className="admin-tabs">
          {(["content", "payments", "intel", "team", "segments", "campaigns", "analytics", "guardrails"] as Tab[]).map((t) => (
            <button key={t} type="button" className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
          <a href="/watch" className="admin-link">Watch app</a>
          <a href="/" className="admin-link">Control portal</a>
        </nav>
      </header>

      {error && <p className="admin-error">{error}</p>}

      {tab === "content" && (
        <section className="admin-section glass-panel">
          <h2>Catalog</h2>
          <div className="admin-form-grid">
            <input placeholder="Title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as "movie" | "series" }))}>
              <option value="movie">Movie</option>
              <option value="series">Series</option>
            </select>
            {form.type === "movie" && (
              <input placeholder="Video URL" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
            )}
            <input placeholder="Thumbnail URL" value={form.thumb} onChange={(e) => setForm((f) => ({ ...f, thumb: e.target.value }))} />
            <label className="admin-check">
              <input type="checkbox" checked={form.free} onChange={(e) => setForm((f) => ({ ...f, free: e.target.checked }))} />
              Free
            </label>
            {!form.free && (
              <input placeholder="Price (BDT)" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
            )}
            <textarea placeholder="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            {form.type === "series" && (
              <div className="admin-series-editor">
                <h3>Seasons &amp; episodes</h3>
                <input
                  placeholder="Season name"
                  value={epForm.seasonName}
                  onChange={(e) => setEpForm((f) => ({ ...f, seasonName: e.target.value }))}
                />
                <input
                  placeholder="Episode title"
                  value={epForm.title}
                  onChange={(e) => setEpForm((f) => ({ ...f, title: e.target.value }))}
                />
                <input
                  placeholder="Episode URL"
                  value={epForm.url}
                  onChange={(e) => setEpForm((f) => ({ ...f, url: e.target.value }))}
                />
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={epForm.free}
                    onChange={(e) => setEpForm((f) => ({ ...f, free: e.target.checked }))}
                  />
                  Episode free
                </label>
                <button type="button" onClick={addEpisode}>Add episode</button>
                <ul className="admin-list admin-episodes">
                  {seasons.map((s) => (
                    <li key={s.id}>
                      <strong>{s.name}</strong>
                      <ul>
                        {s.episodes.map((e) => (
                          <li key={e.id}>{e.title} {e.free ? "(free)" : "(premium)"}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button type="button" className="ai-run" onClick={() => void saveItem()}>
              {editingId ? "Save changes" : "Add content"}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm}>Cancel edit</button>
            )}
          </div>
          <ul className="admin-list">
            {items.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                <span>{item.free ? "Free" : `Premium ${item.price ?? ""}`}</span>
                <span>{item.type}</span>
                {item.seasons && item.seasons.length > 0 && (
                  <span>{item.seasons.reduce((n, s) => n + s.episodes.length, 0)} eps</span>
                )}
                <button type="button" onClick={() => loadItem(item)}>Edit</button>
                <button type="button" onClick={() => void deleteCatalogItem(key, item.id).then(reload)}>Delete</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "payments" && (
        <section className="admin-section">
          <PremiumPanel onPick={() => {}} loadingId={null} />
          <div className="glass-panel admin-section">
            <h3>Payment methods (mode)</h3>
            <ul className="admin-list">
              {methods.map((m) => (
                <li key={m.id}>
                  <strong>{m.name}</strong>
                  <span>{m.account}</span>
                  <select
                    value={(m as PaymentMethod & { mode?: string }).mode ?? "manual"}
                    onChange={(e) => {
                      void fetch(`/api/payment-methods/${m.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ editKey: key, mode: e.target.value }),
                      }).then(() => reload());
                    }}
                  >
                    <option value="manual">Manual</option>
                    <option value="auto">Auto</option>
                  </select>
                  <button type="button" onClick={() => void removePaymentMethod(m.id, key).then(reload)}>Remove</button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() =>
                void addPaymentMethod(
                  { name: "Surjo Pay", account: "merchant@surjo", instructions: "Pay via Surjo app" },
                  key,
                ).then(reload)
              }
            >
              Add Surjo Pay
            </button>
            <h3>Pending ({pending.length})</h3>
            <ul className="admin-list">
              {pending.map((p) => (
                <li key={p.id}>
                  {p.contentId} · {p.reference}
                  <button type="button" onClick={() => void approvePending(p.id, key).then(reload)}>Approve</button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {tab === "intel" && <IntelDashboard adminKey={key} />}

      {tab === "team" && <MarketingTeamPanel adminKey={key} />}

      {tab === "segments" && <SegmentBuilder keys={{ editKey: key }} />}

      {tab === "campaigns" && (
        <>
          <CampaignsPanel keys={{ editKey: key }} />
          <TriggersPanel adminKey={key} />
        </>
      )}

      {tab === "analytics" && <CampaignAnalytics keys={{ editKey: key }} />}

      {tab === "guardrails" && <MarketingGuardrailsPanel adminKey={key} />}
    </div>
  );
}
