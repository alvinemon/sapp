import { useCallback, useEffect, useState } from "react";
import { fetchSegments, type Segment } from "../data/segments";

interface Trigger {
  id: string;
  name: string;
  enabled: boolean;
  when: {
    event: string;
    match?: { keyword?: string; area?: string };
    count?: number;
    windowHours?: number;
  };
  then: {
    title: string;
    reason: string;
    body: string;
    delivery: string;
    cooldownHours: number;
    contentId?: string;
  };
  segmentId?: string;
  fireCount: number;
}

interface Props {
  adminKey: string;
}

const EMPTY_FORM = {
  name: "",
  event: "notification",
  keyword: "",
  area: "",
  count: 2,
  windowHours: 48,
  inactiveDays: 7,
  title: "Deal for you",
  reason: "",
  body: "",
  delivery: "popup",
  cooldownHours: 24,
  contentId: "",
  segmentId: "",
};

export function TriggersPanel({ adminKey }: Props) {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const reload = useCallback(async () => {
    const [tRes, sRes] = await Promise.all([
      fetch(`/api/triggers?editKey=${encodeURIComponent(adminKey)}`),
      fetch(`/api/segments?editKey=${encodeURIComponent(adminKey)}`),
    ]);
    if (!tRes.ok) throw new Error("load failed");
    const data = (await tRes.json()) as { triggers: Trigger[] };
    setTriggers(data.triggers);
    if (sRes.ok) {
      const s = (await sRes.json()) as { segments: Segment[] };
      setSegments(s.segments);
    }
  }, [adminKey]);

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [reload]);

  const toggle = async (t: Trigger) => {
    await fetch("/api/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editKey: adminKey, ...t, enabled: !t.enabled }),
    });
    await reload();
  };

  const startEdit = (t: Trigger) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      event: t.when.event,
      keyword: t.when.match?.keyword ?? "",
      area: t.when.match?.area ?? "",
      count: t.when.count ?? 2,
      windowHours: t.when.windowHours ?? 48,
      inactiveDays: t.when.count ?? 7,
      title: t.then.title,
      reason: t.then.reason,
      body: t.then.body,
      delivery: t.then.delivery,
      cooldownHours: t.then.cooldownHours,
      contentId: t.then.contentId ?? "",
      segmentId: t.segmentId ?? "",
    });
    setShowForm(true);
  };

  const save = async () => {
    const when: Trigger["when"] = { event: form.event };
    if (form.event === "notification") {
      when.match = { keyword: form.keyword || undefined };
      when.count = form.count;
      when.windowHours = form.windowHours;
    } else if (form.event === "location_enter") {
      when.match = { area: form.area || undefined };
    } else if (form.event === "inactive_days") {
      when.count = form.inactiveDays;
    }
    const payload = {
      editKey: adminKey,
      id: editingId ?? undefined,
      name: form.name.trim(),
      enabled: true,
      when,
      then: {
        title: form.title,
        reason: form.reason || form.body,
        body: form.body || form.reason,
        delivery: form.delivery,
        cooldownHours: form.cooldownHours,
        contentId: form.contentId || undefined,
      },
      segmentId: form.segmentId || undefined,
    };
    await fetch("/api/triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    await reload();
  };

  const remove = async (id: string) => {
    await fetch(`/api/triggers/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editKey: adminKey }),
    });
    await reload();
  };

  return (
    <div className="glass-panel admin-section triggers-panel">
      <h2>Behavioral triggers</h2>
      <p className="intel-muted">Auto-fire offers when patterns match (runs every 5 min).</p>
      {error && <p className="admin-error">{error}</p>}

      <div className="intel-offer-actions">
        <button type="button" className="ai-run" onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); }}>
          Create trigger
        </button>
      </div>

      {showForm && (
        <div className="glass-panel trigger-form">
          <h3>{editingId ? "Edit trigger" : "New trigger"}</h3>
          <div className="admin-form-grid">
            <input placeholder="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <select value={form.event} onChange={(e) => setForm((f) => ({ ...f, event: e.target.value }))}>
              <option value="notification">Notification pattern</option>
              <option value="location_enter">Location enter</option>
              <option value="inactive_days">Inactive days (win-back)</option>
            </select>
            {form.event === "notification" && (
              <>
                <input placeholder="Keyword regex" value={form.keyword} onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))} />
                <input type="number" placeholder="Count" value={form.count} onChange={(e) => setForm((f) => ({ ...f, count: +e.target.value }))} />
              </>
            )}
            {form.event === "location_enter" && (
              <input placeholder="Area label" value={form.area} onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))} />
            )}
            {form.event === "inactive_days" && (
              <input type="number" placeholder="Days inactive" value={form.inactiveDays} onChange={(e) => setForm((f) => ({ ...f, inactiveDays: +e.target.value }))} />
            )}
            <select value={form.segmentId} onChange={(e) => setForm((f) => ({ ...f, segmentId: e.target.value }))}>
              <option value="">All devices</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.memberCount})</option>
              ))}
            </select>
            <input placeholder="Offer title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            <input placeholder="Reason" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
            <input placeholder="Body" value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
            <input placeholder="Content ID (optional)" value={form.contentId} onChange={(e) => setForm((f) => ({ ...f, contentId: e.target.value }))} />
            <select value={form.delivery} onChange={(e) => setForm((f) => ({ ...f, delivery: e.target.value }))}>
              <option value="popup">Popup</option>
              <option value="notification">Notification</option>
              <option value="browse">Browse row</option>
            </select>
            <button type="button" className="ai-run" onClick={() => void save()}>Save trigger</button>
            <button type="button" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <ul className="admin-list">
        {triggers.map((t) => (
          <li key={t.id}>
            <strong>{t.name}</strong>
            <span>{t.when.event}</span>
            {t.when.match?.keyword && <span>/{t.when.match.keyword}/</span>}
            {t.when.match?.area && <span>@{t.when.match.area}</span>}
            <span>→ {t.then.delivery}</span>
            <span>fired {t.fireCount}×</span>
            <button type="button" onClick={() => void toggle(t)}>
              {t.enabled ? "Disable" : "Enable"}
            </button>
            <button type="button" onClick={() => startEdit(t)}>Edit</button>
            <button type="button" onClick={() => void remove(t.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
