import { useCallback, useEffect, useState } from "react";
import {
  deleteCatalogItem,
  fetchCatalogAdmin,
  saveCatalogItem,
  type CatalogItem,
  type CatalogSeason,
} from "../data/catalog";
import {
  addPaymentMethod,
  approvePending,
  fetchPaymentMethodsAdmin,
  fetchPendingPayments,
  removePaymentMethod,
  type PaymentMethod,
  type PendingPayment,
} from "../data/premium";
import { PremiumPanel } from "./PremiumPanel";

/** Catalog + payments in one panel for the unified control portal. */
export function CatalogPanel() {
  const key = "";
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

  const reload = useCallback(async () => {
    try {
      setItems((await fetchCatalogAdmin(key)).items);
      setMethods((await fetchPaymentMethodsAdmin(key)).methods);
      setPending(await fetchPendingPayments(key));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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
    setEditingId(null);
    setForm({ title: "", description: "", thumb: "", url: "", free: true, price: "", type: "movie" });
    setSeasons([]);
    await reload();
  };

  return (
    <div className="portal-stack">
      {error && <p className="admin-error">{error}</p>}
      <section className="glass-panel admin-section">
        <h2>Add / edit catalog</h2>
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
            <input placeholder="Price BDT" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
          )}
          <textarea placeholder="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          <button type="button" className="ai-run" onClick={() => void saveItem()}>{editingId ? "Save" : "Add"}</button>
        </div>
        <ul className="admin-list">
          {items.map((item) => (
            <li key={item.id}>
              <strong>{item.title}</strong>
              <span>{item.free ? "Free" : `Premium ${item.price ?? ""}`}</span>
              <button type="button" onClick={() => {
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
              }}>Edit</button>
              <button type="button" onClick={() => void deleteCatalogItem(key, item.id).then(reload)}>Delete</button>
            </li>
          ))}
        </ul>
      </section>
      <PremiumPanel onPick={() => {}} loadingId={null} />
      <div className="glass-panel admin-section">
        <h3>Payment methods</h3>
        <ul className="admin-list">
          {methods.map((m) => (
            <li key={m.id}>
              <strong>{m.name}</strong> · {m.account}
              <button type="button" onClick={() => void removePaymentMethod(m.id, key).then(reload)}>Remove</button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => void addPaymentMethod({ name: "bKash", account: "01XXXXXXXXX", instructions: "Send payment" }, key).then(reload)}>
          Add bKash
        </button>
        <h3>Pending payments ({pending.length})</h3>
        <ul className="admin-list">
          {pending.map((p) => (
            <li key={p.id}>{p.contentId} · {p.reference}
              <button type="button" onClick={() => void approvePending(p.id, key).then(reload)}>Approve</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
