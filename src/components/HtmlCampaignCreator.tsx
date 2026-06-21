import { useCallback, useEffect, useMemo, useState } from "react";
import {
  approveCampaign,
  createCampaign,
  fetchCampaigns,
  runCampaign,
  type Campaign,
} from "../data/campaigns";
import { fetchSegments, type Segment } from "../data/segments";
import { HTML_CAMPAIGN_TEMPLATES,
  wrapHtmlPreview,
  type HtmlTemplateKey,
} from "../data/campaignHtml";
import { OfferTemplatesPanel } from "./OfferTemplatesPanel";
import type { OfferTemplate } from "../data/campaigns";

const OPEN_KEYS = { editKey: "" };

const STEPS = ["Who", "What", "Design", "Review & send"] as const;

interface Props {
  keys?: { editKey?: string; marketingKey?: string };
}

export function HtmlCampaignCreator({ keys = OPEN_KEYS }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPastCampaigns, setShowPastCampaigns] = useState(false);

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

  const selectedSegment = segments.find((s) => s.id === segmentId);
  const audienceCount = selectedSegment?.memberCount ?? 0;

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
    setStep(2);
  };

  const canNext = () => {
    if (step === 0) return !!segmentId;
    if (step === 1) return !!title.trim();
    if (step === 2) return html.trim().length > 0;
    if (step === 3) return name.trim().length > 0;
    return true;
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
      setStep(0);
      await reload();
      setError(null);
      setShowPastCampaigns(true);
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

  const deliveryLabel =
    delivery === "popup"
      ? "Full-screen popup"
      : delivery === "notification"
        ? "Notification"
        : "Browse row";

  const applyOfferTemplate = (t: OfferTemplate) => {
    setTitle(t.title);
    setReason(t.reason);
    setContentId(t.contentId ?? "");
    if (t.body) {
      setHtml(`<p>${t.body.replace(/</g, "&lt;")}</p>${t.discount ? `<p><strong>${t.discount}</strong></p>` : ""}`);
    }
    setStep(2);
  };

  return (
    <div className="portal-wizard html-campaign-creator">
      <OfferTemplatesPanel adminKey={keys.editKey ?? ""} onApply={applyOfferTemplate} />
      <div className="portal-stepper" role="list" aria-label="Campaign progress">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            role="listitem"
            className={`portal-step ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}
            onClick={() => i < step && setStep(i)}
            disabled={i > step}
          >
            <span className="portal-step-num">{i < step ? "✓" : i + 1}</span>
            <span className="portal-step-label">{label}</span>
          </button>
        ))}
      </div>

      {error && <p className="admin-error">{error}</p>}

      <div className="portal-wizard-body glass-panel">
        {step === 0 && (
          <div className="wizard-step-content">
            <h3>Step 1 — Who should get this?</h3>
            <p className="intel-muted">Pick an audience list. We&apos;ll show you how many people are in it.</p>

            {segments.length === 0 ? (
              <div className="portal-empty-state">
                <p>No audience lists yet.</p>
                <p className="intel-muted">Go to &ldquo;Who to target&rdquo; in the sidebar to create one first.</p>
              </div>
            ) : (
              <div className="portal-segment-grid">
                {segments.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`portal-segment-card ${segmentId === s.id ? "selected" : ""}`}
                    onClick={() => setSegmentId(s.id)}
                  >
                    <strong>{s.name}</strong>
                    <span className="portal-segment-count">
                      {s.memberCount.toLocaleString()} {s.memberCount === 1 ? "person" : "people"}
                    </span>
                    {s.description && <span className="portal-segment-desc">{s.description}</span>}
                  </button>
                ))}
              </div>
            )}

            {selectedSegment && (
              <p className="portal-audience-summary">
                You&apos;re about to reach <strong>{audienceCount.toLocaleString()}</strong>{" "}
                {audienceCount === 1 ? "person" : "people"}.
              </p>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="wizard-step-content">
            <h3>Step 2 — What should it look like?</h3>
            <p className="intel-muted">Choose a starting template. You can customize everything in the next step.</p>

            <div className="portal-template-grid">
              {(Object.keys(HTML_CAMPAIGN_TEMPLATES) as HtmlTemplateKey[]).map((k) => (
                <button key={k} type="button" className="portal-template-card" onClick={() => applyTemplate(k)}>
                  <strong>{HTML_CAMPAIGN_TEMPLATES[k].name}</strong>
                  <span>{HTML_CAMPAIGN_TEMPLATES[k].title}</span>
                </button>
              ))}
            </div>

            <div className="portal-delivery-grid compact">
              <p className="intel-muted" style={{ gridColumn: "1 / -1" }}>How should it arrive?</p>
              {(
                [
                  { value: "popup" as const, label: "Full-screen popup", icon: "📲" },
                  { value: "notification" as const, label: "Notification", icon: "🔔" },
                  { value: "browse" as const, label: "Browse row", icon: "📺" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`portal-delivery-card ${delivery === opt.value ? "selected" : ""}`}
                  onClick={() => setDelivery(opt.value)}
                >
                  <span className="portal-delivery-icon">{opt.icon}</span>
                  <strong>{opt.label}</strong>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="wizard-step-content">
            <h3>Step 3 — Design your offer</h3>
            <div className="campaign-creator-grid">
              <div className="campaign-editor-col">
                <label>
                  Notification headline
                  <input value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>

                <label className="html-editor-label">
                  HTML body
                  <textarea
                    className="html-editor"
                    spellCheck={false}
                    value={html}
                    onChange={(e) => setHtml(e.target.value)}
                    rows={14}
                    placeholder="<div>Your design…</div>"
                  />
                </label>

                <button
                  type="button"
                  className="portal-advanced-toggle"
                  onClick={() => setShowAdvanced((v) => !v)}
                >
                  {showAdvanced ? "▾ Hide advanced" : "▸ Advanced options"}
                </button>
                {showAdvanced && (
                  <div className="portal-simple-form">
                    <label>
                      Internal reason (optional)
                      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For your records" />
                    </label>
                    <label>
                      Catalog content ID (optional)
                      <input value={contentId} onChange={(e) => setContentId(e.target.value)} />
                    </label>
                  </div>
                )}
              </div>

              <div className="campaign-preview-col">
                <div className="preview-toggle">
                  <button
                    type="button"
                    className={previewMode === "phone" ? "active" : ""}
                    onClick={() => setPreviewMode("phone")}
                  >
                    Popup preview
                  </button>
                  <button
                    type="button"
                    className={previewMode === "notif" ? "active" : ""}
                    onClick={() => setPreviewMode("notif")}
                  >
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
          </div>
        )}

        {step === 3 && (
          <div className="wizard-step-content wizard-review">
            <h3>Step 4 — Review &amp; send</h3>
            <dl className="portal-review-list">
              <div>
                <dt>Audience</dt>
                <dd>
                  {selectedSegment?.name} ({audienceCount.toLocaleString()}{" "}
                  {audienceCount === 1 ? "person" : "people"})
                </dd>
              </div>
              <div>
                <dt>Delivery</dt>
                <dd>{deliveryLabel}</dd>
              </div>
              <div>
                <dt>Headline</dt>
                <dd>{title}</dd>
              </div>
            </dl>

            <label>
              Campaign name (for your records)
              <input
                placeholder="e.g. Weekend flash sale"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <div className="phone-preview-frame review-mini">
              <div className="phone-preview-notch" />
              <iframe title="Final preview" className="html-preview-iframe" srcDoc={previewDoc} sandbox="" />
            </div>
          </div>
        )}
      </div>

      <div className="portal-wizard-nav">
        {step > 0 && (
          <button type="button" className="portal-btn-secondary" onClick={() => setStep((s) => s - 1)}>
            ← Back
          </button>
        )}
        <div className="portal-wizard-nav-spacer" />
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            className="portal-btn-primary"
            disabled={!canNext()}
            onClick={() => setStep((s) => s + 1)}
          >
            Continue →
          </button>
        ) : (
          <button
            type="button"
            className="portal-btn-primary portal-btn-send"
            disabled={busy || !canNext()}
            onClick={() => void create()}
          >
            {busy ? "Saving…" : "Save campaign"}
          </button>
        )}
      </div>

      <section className="glass-panel campaign-list-section">
        <button
          type="button"
          className="portal-advanced-toggle campaign-list-toggle"
          onClick={() => setShowPastCampaigns((v) => !v)}
        >
          {showPastCampaigns ? "▾" : "▸"} Past campaigns ({campaigns.length})
        </button>
        {showPastCampaigns && (
          <ul className="admin-list portal-campaign-list">
            {campaigns.map((c) => (
              <li key={c.id}>
                <div className="portal-campaign-row-main">
                  <strong>{c.name}</strong>
                  <span className={`portal-status-badge status-${c.status}`}>{c.status.replace("_", " ")}</span>
                </div>
                <div className="portal-campaign-row-meta">
                  <span>{c.delivery}</span>
                  {c.offer.html ? <span>HTML</span> : null}
                  <span>sent to {c.sentCount}</span>
                  {c.failedCount > 0 && (
                    <span className="portal-status-badge status-cancelled">
                      {c.failedCount} phone offline, queued
                    </span>
                  )}
                  {c.skippedCount > 0 && (
                    <span className="intel-muted">{c.skippedCount} blocked by guardrail</span>
                  )}
                </div>
                <div className="portal-campaign-row-actions">
                  {c.status === "pending_approval" && (
                    <button type="button" onClick={() => void approveCampaign("", c.id).then(reload)}>
                      Approve
                    </button>
                  )}
                  {(c.status === "draft" || c.status === "scheduled") && (
                    <button type="button" className="portal-btn-primary small" disabled={busy} onClick={() => void launch(c.id)}>
                      Send now
                    </button>
                  )}
                </div>
              </li>
            ))}
            {campaigns.length === 0 && (
              <li className="intel-muted">No campaigns yet — complete the wizard above to create one.</li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
