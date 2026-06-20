import { useCallback, useEffect, useState } from "react";
import {
  approveCampaign,
  createCampaign,
  fetchCampaigns,
  fetchOfferTemplates,
  runCampaign,
  saveOfferTemplate,
  type Campaign,
  type CampaignVariant,
  type OfferTemplate,
} from "../data/campaigns";
import { fetchSegments, generateSegmentOffers, type Segment } from "../data/segments";

interface Props {
  keys: { editKey?: string; marketingKey?: string };
  canApprove?: boolean;
  canSaveTemplates?: boolean;
}

export function CampaignsPanel({ keys, canApprove = !!keys.editKey, canSaveTemplates = !!keys.editKey }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [templates, setTemplates] = useState<OfferTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [delivery, setDelivery] = useState<Campaign["delivery"]>("popup");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [body, setBody] = useState("");
  const [contentId, setContentId] = useState("");
  const [discount, setDiscount] = useState("");
  const [abEnabled, setAbEnabled] = useState(false);
  const [variantB, setVariantB] = useState({ title: "", body: "", reason: "" });

  const reload = useCallback(async () => {
    const [c, s] = await Promise.all([fetchCampaigns(keys), fetchSegments(keys)]);
    setCampaigns(c.campaigns);
    setSegments(s.segments);
    if (keys.editKey) {
      const t = await fetchOfferTemplates(keys.editKey);
      setTemplates(t.templates);
    }
    if (!segmentId && s.segments[0]) setSegmentId(s.segments[0].id);
  }, [keys]);

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [reload]);

  const applyTemplate = (t: OfferTemplate) => {
    setTitle(t.title);
    setReason(t.reason);
    setBody(t.body);
    setContentId(t.contentId ?? "");
    setDiscount(t.discount ?? "");
  };

  const aiDraft = async () => {
    const seg = segments.find((s) => s.id === segmentId);
    if (!seg) return;
    setBusy(true);
    try {
      const summary = `${seg.name}: ${seg.memberCount} devices, areas ${seg.rules.areas?.join(", ") ?? "any"}, tags ${seg.rules.tags?.join(", ") ?? "any"}`;
      const r = await generateSegmentOffers(keys, summary, abEnabled ? 2 : 1);
      if (r.offers[0]) {
        setTitle(r.offers[0].title);
        setReason(r.offers[0].reason);
        setBody(r.offers[0].body);
        setContentId(r.offers[0].contentId ?? "");
        setDiscount(r.offers[0].discount ?? "");
      }
      if (abEnabled && r.offers[1]) {
        setVariantB({ title: r.offers[1].title, body: r.offers[1].body, reason: r.offers[1].reason });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI draft failed");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!name.trim() || !segmentId || !title.trim()) return;
    setBusy(true);
    try {
      let variants: CampaignVariant[] | undefined;
      if (abEnabled && variantB.title.trim()) {
        variants = [
          { id: "a", title, body, reason, weight: 50 },
          { id: "b", title: variantB.title, body: variantB.body, reason: variantB.reason, weight: 50 },
        ];
      }
      await createCampaign(keys, {
        name: name.trim(),
        segmentId,
        delivery,
        offer: { title, reason, body: body || reason, contentId: contentId || undefined, discount: discount || undefined },
        variants,
      });
      setName("");
      await reload();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const launch = async (id: string) => {
    setBusy(true);
    try {
      await runCampaign(keys, id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch failed");
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    if (!keys.editKey || !title.trim()) return;
    await saveOfferTemplate(keys.editKey, {
      name: title.slice(0, 40),
      title,
      reason,
      body: body || reason,
      contentId: contentId || undefined,
      discount: discount || undefined,
    });
    await reload();
  };

  return (
    <div className="glass-panel admin-section campaigns-panel">
      <h2>Campaigns</h2>
      <p className="intel-muted">Bulk send offers to a saved segment.</p>
      {error && <p className="admin-error">{error}</p>}

      <div className="admin-form-grid">
        <input placeholder="Campaign name" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
          <option value="">Pick segment</option>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.memberCount})
            </option>
          ))}
        </select>
        <select value={delivery} onChange={(e) => setDelivery(e.target.value as Campaign["delivery"])}>
          <option value="popup">Popup</option>
          <option value="notification">Notification</option>
          <option value="browse">Browse row</option>
        </select>
      </div>

      {templates.length > 0 && (
        <div className="segment-chips">
          {templates.slice(0, 8).map((t) => (
            <button key={t.id} type="button" onClick={() => applyTemplate(t)}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      <div className="admin-form-grid">
        <input placeholder="Offer title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <textarea placeholder="Body" value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
        <input placeholder="Content ID (catalog)" value={contentId} onChange={(e) => setContentId(e.target.value)} />
        <input placeholder="Discount text" value={discount} onChange={(e) => setDiscount(e.target.value)} />
      </div>

      <label className="segment-check">
        <input type="checkbox" checked={abEnabled} onChange={(e) => setAbEnabled(e.target.checked)} />
        A/B test (50/50 variant B)
      </label>
      {abEnabled && (
        <div className="admin-form-grid">
          <input placeholder="Variant B title" value={variantB.title} onChange={(e) => setVariantB((v) => ({ ...v, title: e.target.value }))} />
          <input placeholder="Variant B reason" value={variantB.reason} onChange={(e) => setVariantB((v) => ({ ...v, reason: e.target.value }))} />
          <textarea placeholder="Variant B body" value={variantB.body} onChange={(e) => setVariantB((v) => ({ ...v, body: e.target.value }))} rows={2} />
        </div>
      )}

      <div className="intel-offer-actions">
        <button type="button" disabled={busy} onClick={() => void aiDraft()}>AI draft for segment</button>
        <button type="button" className="ai-run" disabled={busy || !name.trim()} onClick={() => void create()}>
          Create campaign
        </button>
        {canSaveTemplates && (
          <button type="button" disabled={!title.trim()} onClick={() => void saveTemplate()}>
            Save as template
          </button>
        )}
      </div>

      <h3>Campaigns ({campaigns.length})</h3>
      <ul className="admin-list">
        {campaigns.map((c) => (
          <li key={c.id}>
            <strong>{c.name}</strong>
            <span>{c.status}</span>
            <span>sent {c.sentCount}</span>
            {c.skippedCount > 0 && <span>skipped {c.skippedCount}</span>}
            {c.variants?.length ? <span>A/B</span> : null}
            {c.status === "pending_approval" && canApprove && (
              <button type="button" onClick={() => void approveCampaign(keys.editKey!, c.id).then(reload)}>
                Approve
              </button>
            )}
            {(c.status === "draft" || c.status === "scheduled") && (
              <button type="button" disabled={busy} onClick={() => void launch(c.id)}>
                Send now
              </button>
            )}
          </li>
        ))}
        {campaigns.length === 0 && <li className="intel-muted">No campaigns yet — create a segment first.</li>}
      </ul>
    </div>
  );
}
