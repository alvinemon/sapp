import { useCallback, useEffect, useState } from "react";
import type { PaymentMethod, PendingPayment, PremiumItem } from "../data/premium";
import {
  addPaymentMethod,
  addPremiumItem,
  approvePending,
  fetchPaymentMethods,
  fetchPaymentMethodsAdmin,
  fetchPendingPayments,
  fetchPremium,
  grantPremium,
  removePaymentMethod,
  removePremiumItem,
} from "../data/premium";
import { PaywallModal } from "./PaywallModal";

interface PremiumPanelProps {
  onPick: (item: PremiumItem) => void;
  loadingId: string | null;
}

const EDIT_KEY_STORAGE = "premium_admin_key";

export function PremiumPanel({ onPick, loadingId }: PremiumPanelProps) {
  const [items, setItems] = useState<PremiumItem[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [pending, setPending] = useState<PendingPayment[]>([]);
  const [heading, setHeading] = useState("Special content");
  const [requiresKey, setRequiresKey] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminTab, setAdminTab] = useState<"content" | "methods" | "pending">("content");
  const [paywallItem, setPaywallItem] = useState<PremiumItem | null>(null);
  const [editKey, setEditKey] = useState(() => sessionStorage.getItem(EDIT_KEY_STORAGE) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grantCode, setGrantCode] = useState<string | null>(null);

  const [contentForm, setContentForm] = useState({
    title: "",
    description: "",
    thumbnail: "",
    url: "",
    price: "",
    currency: "BDT",
    methodIds: [] as string[],
  });

  const [methodForm, setMethodForm] = useState({
    name: "",
    account: "",
    instructions: "",
  });

  const reload = useCallback(() => {
    void fetchPremium()
      .then((data) => {
        setItems(data.items);
        setHeading(data.title);
        setRequiresKey(data.requiresKey);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed"));

    void fetchPaymentMethods()
      .then(setMethods)
      .catch(() => setMethods([]));
  }, []);

  const reloadAdmin = useCallback(() => {
    void fetchPaymentMethodsAdmin(editKey).then(setMethods).catch(() => {});
    void fetchPendingPayments(editKey).then(setPending).catch(() => setPending([]));
  }, [editKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (showAdmin) reloadAdmin();
  }, [showAdmin, reloadAdmin]);

  const pick = (item: PremiumItem) => {
    if (item.locked || !item.url) {
      setPaywallItem(item);
      return;
    }
    onPick(item);
  };

  const saveContent = async () => {
    if (!contentForm.title.trim() || !contentForm.url.trim() || !contentForm.price.trim()) return;
    setBusy(true);
    try {
      await addPremiumItem(
        {
          title: contentForm.title,
          description: contentForm.description,
          thumbnail: contentForm.thumbnail || "https://placehold.co/300x450/2a1a3e/aa88cc?text=Premium",
          url: contentForm.url,
          price: contentForm.price,
          currency: contentForm.currency,
          methodIds: contentForm.methodIds,
        },
        editKey || undefined,
      );
      setContentForm({
        title: "",
        description: "",
        thumbnail: "",
        url: "",
        price: "",
        currency: "BDT",
        methodIds: [],
      });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const saveMethod = async () => {
    if (!methodForm.name.trim() || !methodForm.instructions.trim()) return;
    setBusy(true);
    try {
      await addPaymentMethod(methodForm, editKey || undefined);
      setMethodForm({ name: "", account: "", instructions: "" });
      reload();
      reloadAdmin();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleMethodForContent = (id: string) => {
    setContentForm((f) => ({
      ...f,
      methodIds: f.methodIds.includes(id) ? f.methodIds.filter((x) => x !== id) : [...f.methodIds, id],
    }));
  };

  const methodsForPaywall = (item: PremiumItem) => {
    if (!item.methodIds.length) return methods;
    return methods.filter((m) => item.methodIds.includes(m.id));
  };

  return (
    <>
      <section className="premium-panel glass-panel">
        <div className="family-library-head">
          <div>
            <p className="panel-title">{heading}</p>
            <p className="family-library-sub">Paid titles — pick a payment method, then unlock with code</p>
          </div>
          <button type="button" className="family-add-toggle" onClick={() => setShowAdmin((v) => !v)}>
            {showAdmin ? "Close admin" : "Manage"}
          </button>
        </div>

        {showAdmin && (
          <div className="premium-admin">
            {requiresKey && (
              <label className="family-field">
                <span>Admin key</span>
                <input
                  type="password"
                  value={editKey}
                  onChange={(e) => setEditKey(e.target.value)}
                  placeholder="LIBRARY_EDIT_KEY from server"
                />
              </label>
            )}
            <div className="free-catalog-filters">
              {(["content", "methods", "pending"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`free-filter ${adminTab === t ? "free-filter-active" : ""}`}
                  onClick={() => setAdminTab(t)}
                >
                  {t === "content" ? "Add content" : t === "methods" ? "Payment methods" : `Pending (${pending.length})`}
                </button>
              ))}
            </div>

            {adminTab === "content" && (
              <div className="family-form">
                <label className="family-field">
                  <span>Title</span>
                  <input value={contentForm.title} onChange={(e) => setContentForm((f) => ({ ...f, title: e.target.value }))} />
                </label>
                <label className="family-field">
                  <span>Description</span>
                  <textarea value={contentForm.description} onChange={(e) => setContentForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
                </label>
                <label className="family-field">
                  <span>Thumbnail URL</span>
                  <input value={contentForm.thumbnail} onChange={(e) => setContentForm((f) => ({ ...f, thumbnail: e.target.value }))} />
                </label>
                <label className="family-field">
                  <span>Video link (hidden until unlock)</span>
                  <input value={contentForm.url} onChange={(e) => setContentForm((f) => ({ ...f, url: e.target.value }))} />
                </label>
                <div className="paywall-row">
                  <label className="family-field">
                    <span>Price</span>
                    <input value={contentForm.price} onChange={(e) => setContentForm((f) => ({ ...f, price: e.target.value }))} placeholder="200" />
                  </label>
                  <label className="family-field">
                    <span>Currency</span>
                    <input value={contentForm.currency} onChange={(e) => setContentForm((f) => ({ ...f, currency: e.target.value }))} placeholder="BDT" />
                  </label>
                </div>
                {methods.length > 0 && (
                  <div className="paywall-method-picks">
                    <span>Accepted methods (empty = all)</span>
                    <div className="paywall-methods">
                      {methods.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className={`paywall-method ${contentForm.methodIds.includes(m.id) ? "paywall-method-active" : ""}`}
                          onClick={() => toggleMethodForContent(m.id)}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button type="button" className="family-submit" disabled={busy} onClick={() => void saveContent()}>
                  Add premium title
                </button>
              </div>
            )}

            {adminTab === "methods" && (
              <div className="family-form">
                <label className="family-field">
                  <span>Method name</span>
                  <input value={methodForm.name} onChange={(e) => setMethodForm((f) => ({ ...f, name: e.target.value }))} placeholder="bKash, Nagad, Bank, PayPal…" />
                </label>
                <label className="family-field">
                  <span>Account / number / wallet</span>
                  <input value={methodForm.account} onChange={(e) => setMethodForm((f) => ({ ...f, account: e.target.value }))} placeholder="01XXXXXXXXX" />
                </label>
                <label className="family-field">
                  <span>Payment instructions</span>
                  <textarea
                    value={methodForm.instructions}
                    onChange={(e) => setMethodForm((f) => ({ ...f, instructions: e.target.value }))}
                    rows={5}
                    placeholder="Step-by-step how to pay…"
                  />
                </label>
                <button type="button" className="family-submit" disabled={busy} onClick={() => void saveMethod()}>
                  Add payment method
                </button>
                <ul className="premium-method-list">
                  {methods.map((m) => (
                    <li key={m.id}>
                      <strong>{m.name}</strong> — {m.account || "no account"}
                      <button type="button" className="family-remove" disabled={busy} onClick={() => void removePaymentMethod(m.id, editKey).then(reloadAdmin)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {adminTab === "pending" && (
              <div className="premium-pending">
                {pending.length === 0 ? (
                  <p className="family-empty">No pending payments.</p>
                ) : (
                  pending.map((p) => {
                    const title = items.find((i) => i.id === p.contentId)?.title ?? p.contentId;
                    const mname = methods.find((m) => m.id === p.methodId)?.name ?? p.methodId;
                    return (
                      <div key={p.id} className="premium-pending-row">
                        <div>
                          <strong>{title}</strong>
                          <span>
                            {mname} · ref {p.reference}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="family-submit"
                          disabled={busy}
                          onClick={() => {
                            setBusy(true);
                            void approvePending(p.id, editKey)
                              .then((r) => {
                                setGrantCode(r.code);
                                reload();
                                reloadAdmin();
                              })
                              .finally(() => setBusy(false));
                          }}
                        >
                          Approve & get code
                        </button>
                      </div>
                    );
                  })
                )}
                {grantCode && (
                  <p className="paywall-msg ok">
                    Send this unlock code to the payer: <code>{grantCode}</code>
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {error && <p className="free-catalog-error">{error}</p>}

        {items.length === 0 ? (
          <p className="family-empty">No special content yet — tap <strong>Manage</strong> to add payment methods and titles.</p>
        ) : (
          <div className="family-grid">
            {items.map((item) => (
              <article key={item.id} className="family-card-wrap">
                <button
                  type="button"
                  className={`free-card family-card ${item.locked ? "premium-locked" : ""}`}
                  disabled={loadingId === item.id}
                  onClick={() => pick(item)}
                >
                  <img src={item.thumbnail} alt="" className="free-thumb" loading="lazy" />
                  {item.locked && <span className="premium-lock-badge">🔒 {item.price} {item.currency}</span>}
                  <div className="free-card-body">
                    <strong>{item.title}</strong>
                    {item.description && <p className="family-desc">{item.description}</p>}
                    {!item.locked && <span className="premium-unlocked-tag">Unlocked</span>}
                  </div>
                </button>
                {showAdmin && (
                  <div className="premium-admin-row">
                    <button
                      type="button"
                      className="family-remove"
                      onClick={() => void removePremiumItem(item.id, editKey).then(reload)}
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      className="paywall-link"
                      onClick={() => {
                        void grantPremium(item.id, editKey).then((r) => setGrantCode(r.code));
                      }}
                    >
                      Grant code
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {paywallItem && (
        <PaywallModal
          item={paywallItem}
          methods={methodsForPaywall(paywallItem)}
          onClose={() => setPaywallItem(null)}
          onUnlocked={(unlocked) => {
            setPaywallItem(null);
            reload();
            onPick(unlocked);
          }}
        />
      )}
    </>
  );
}
