import { useCallback, useEffect, useMemo, useState } from "react";
import {
  approveCampaign,
  createCampaign,
  fetchCampaigns,
  runCampaign,
  type Campaign,
} from "../data/campaigns";
import { fetchSegments, type Segment } from "../data/segments";
import {
  HTML_CAMPAIGN_TEMPLATES,
  wrapHtmlPreview,
  type HtmlTemplateKey,
} from "../data/campaignHtml";

const OPEN_KEYS = { editKey: "" };

interface Props {
  keys?: { editKey?: string; marketingKey?: string };
}

export function HtmlCampaignCreator({ keys = OPEN_KEYS }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [delivery, setDelivery] = useState<Campaign["delivery"]>("popup");
  const [title, setTitle] = useState("Special offer");
  const [reason, setReason] = useState("");
  const [html, setHtml] = useState(HTML_CAMPAIGN_TEMPLATES.popupHero.html);
  const [contentId, setContentId] = useState("");
  const [previewMode, setPreviewMode] = useState<"phone" | "notif">("phone");

  const reload = useCallback(async () => {
    const [c, s] = await Promise.all([fetchCampaigns(keys), fetchSegments(keys)]);
    setCampaigns(c.campaigns);
    setSegments(s.segments);
    if (!segmentId && s.segments[0]) setSegmentId(s.segments[0].id);
  }, [keys, segmentId]);

  useEffect(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [reload]);

  const previewDoc = useMemo(() => wrapHtmlPreview(html, title), [html, title]);

  const plainBody = useMemo(() => {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent?.slice(0, 200) ?? title;
  }, [html, title]);

  const applyTemplate = (key: HtmlTemplateKey) => {
    const t = HTML_CAMPAIGN_TEMPLATES[key];
    setTitle(t.title);
    setHtml(t.html);
    setReason(t.name);
    if (key === "notificationRich") setDelivery("notification");
    else setDelivery("popup");
  };

  const create = async () => {
    if (!name.trim() || !segmentId) return;
    setBusy(true);
    try {
      await createCampaign(keys, {
        name: name.trim(),
        segmentId,
        delivery,
        offer: {
          title: title.trim() || "Offer",
          reason: reason || name,
          body: plainBody,
          contentId: contentId || undefined,
          html: html.trim() || undefined,
        },
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
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="html-campaign-creator">
      <header className="panel-head">
        <div>
          <h2>Campaign creator</h2>
          <p className="intel-muted">Design popup or notification HTML — live preview on the right.</p>
        </div>
      </header>
      {error && <p className="admin-error">{error}</p>}

      <div className="campaign-creator-grid">
        <div className="campaign-editor-col glass-panel">
          <div className="admin-form-grid compact">
            <input placeholder="Campaign name" value={name} onChange={(e) => setName(e.target.value)} />
            <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
              <option value="">Audience segment</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.memberCount})</option>
              ))}
            </select>
            <select value={delivery} onChange={(e) => setDelivery(e.target.value as Campaign["delivery"])}>
              <option value="popup">Popup (full HTML)</option>
              <option value="notification">Notification (HTML on tap)</option>
              <option value="browse">Browse row (text)</option>
            </select>
            <input placeholder="Notification title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input placeholder="Catalog content ID (optional)" value={contentId} onChange={(e) => setContentId(e.target.value)} />
          </div>

          <p className="intel-muted">Templates</p>
          <div className="segment-chips">
            {(Object.keys(HTML_CAMPAIGN_TEMPLATES) as HtmlTemplateKey[]).map((k) => (
              <button key={k} type="button" onClick={() => applyTemplate(k)}>
                {HTML_CAMPAIGN_TEMPLATES[k].name}
              </button>
            ))}
          </div>

          <label className="html-editor-label">
            HTML body
            <textarea
              className="html-editor"
              spellCheck={false}
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              rows={16}
              placeholder="<div>Your design…</div>"
            />
          </label>

          <div className="intel-offer-actions">
            <button type="button" className="ai-run" disabled={busy || !name.trim()} onClick={() => void create()}>
              Save campaign
            </button>
          </div>
        </div>

        <div className="campaign-preview-col">
          <div className="preview-toggle">
            <button type="button" className={previewMode === "phone" ? "active" : ""} onClick={() => setPreviewMode("phone")}>
              Popup preview
            </button>
            <button type="button" className={previewMode === "notif" ? "active" : ""} onClick={() => setPreviewMode("notif")}>
              Notification
            </button>
          </div>
          {previewMode === "phone" ? (
            <div className="phone-preview-frame">
              <div className="phone-preview-notch" />
              <iframe title="Campaign preview" className="html-preview-iframe" srcDoc={previewDoc} sandbox="" />
              <div className="phone-preview-actions">
                <span>Dismiss</span>
                <span className="cta">Watch</span>
              </div>
            </div>
          ) : (
            <div className="notif-preview glass-panel">
              <div className="notif-preview-row">
                <span className="notif-icon">◉</span>
                <div>
                  <strong>{title}</strong>
                  <p>{plainBody.slice(0, 80)}…</p>
                </div>
              </div>
              <p className="intel-muted" style={{ marginTop: 12, fontSize: "0.75rem" }}>
                Tapping opens full HTML popup on the phone.
              </p>
            </div>
          )}
        </div>
      </div>

      <section className="glass-panel campaign-list-section">
        <h3>Campaigns ({campaigns.length})</h3>
        <ul className="admin-list">
          {campaigns.map((c) => (
            <li key={c.id}>
              <strong>{c.name}</strong>
              <span>{c.status}</span>
              <span>{c.delivery}</span>
              {c.offer.html ? <span>HTML</span> : null}
              <span>sent {c.sentCount}</span>
              {c.status === "pending_approval" && (
                <button type="button" onClick={() => void approveCampaign("", c.id).then(reload)}>Approve</button>
              )}
              {(c.status === "draft" || c.status === "scheduled") && (
                <button type="button" disabled={busy} onClick={() => void launch(c.id)}>Send to segment</button>
              )}
            </li>
          ))}
          {campaigns.length === 0 && <li className="intel-muted">Save a campaign above, then send it to your segment.</li>}
        </ul>
      </section>
    </div>
  );
}
