import { useCallback, useEffect, useMemo, useState } from "react";
import { DevicePicker } from "./DevicePicker";
import { createOffer, sendOffer, type OfferDelivery } from "../data/catalog";
import {
  HTML_CAMPAIGN_TEMPLATES,
  wrapHtmlPreview,
  type HtmlTemplateKey,
} from "../data/campaignHtml";
import { fetchDeviceProfiles, type DeviceProfile } from "../data/marketing";

const OPEN_KEYS = { editKey: "" };

const STEPS = ["Pick a phone", "How to deliver", "Your message", "Review & send"] as const;

const DELIVERY_OPTIONS: { value: OfferDelivery; label: string; hint: string; icon: string }[] = [
  { value: "popup", label: "Full-screen popup", hint: "Rich HTML appears on their phone immediately", icon: "📲" },
  { value: "notification", label: "Notification", hint: "Shows in their tray — tap opens your design", icon: "🔔" },
  { value: "browse", label: "Browse row", hint: "Appears inside the watch app catalog", icon: "📺" },
];

interface Props {
  keys?: { editKey?: string; marketingKey?: string };
}

export function IndividualOfferSender({ keys = OPEN_KEYS }: Props) {
  const [step, setStep] = useState(0);
  const [deviceId, setDeviceId] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<DeviceProfile | null>(null);
  const [delivery, setDelivery] = useState<OfferDelivery>("popup");
  const [title, setTitle] = useState("Special offer");
  const [message, setMessage] = useState("");
  const [discount, setDiscount] = useState("");
  const [contentId, setContentId] = useState("");
  const [htmlMode, setHtmlMode] = useState(false);
  const [html, setHtml] = useState(HTML_CAMPAIGN_TEMPLATES.popupMinimal.html);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [previewMode, setPreviewMode] = useState<"phone" | "notif">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadProfile = useCallback(async (id: string) => {
    if (!id) {
      setSelectedProfile(null);
      return;
    }
    try {
      const data = await fetchDeviceProfiles(keys, { q: id });
      const match = data.profiles.find((p) => p.deviceId === id);
      setSelectedProfile(match ?? null);
    } catch {
      setSelectedProfile(null);
    }
  }, [keys]);

  useEffect(() => {
    void loadProfile(deviceId);
  }, [deviceId, loadProfile]);

  const previewDoc = useMemo(
    () => wrapHtmlPreview(htmlMode ? html : `<p>${message || title}</p>`, title),
    [htmlMode, html, message, title],
  );

  const plainBody = useMemo(() => {
    if (htmlMode) {
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      return tmp.textContent?.slice(0, 200) ?? title;
    }
    return message || title;
  }, [htmlMode, html, message, title]);

  const applyTemplate = (key: HtmlTemplateKey) => {
    const t = HTML_CAMPAIGN_TEMPLATES[key];
    setTitle(t.title);
    setHtml(t.html);
    if (key === "notificationRich") setDelivery("notification");
    else setDelivery("popup");
    setHtmlMode(true);
  };

  const canNext = () => {
    if (step === 0) return !!deviceId;
    if (step === 1) return !!delivery;
    if (step === 2) return title.trim().length > 0 && (htmlMode ? html.trim().length > 0 : message.trim().length > 0);
    return true;
  };

  const handleSend = async () => {
    if (!deviceId || !title.trim()) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const offer = await createOffer(deviceId, keys, {
        title: title.trim(),
        reason: message.trim() || title.trim(),
        body: plainBody,
        contentId: contentId || undefined,
        discount: discount || undefined,
        html: htmlMode ? html.trim() : undefined,
      });
      const result = await sendOffer(deviceId, offer.id, keys, delivery);
      const pushed = result.pushed ? " and pushed to their phone" : "";
      setSuccess(`Offer sent${pushed}!`);
      setStep(0);
      setDeviceId("");
      setTitle("Special offer");
      setMessage("");
      setDiscount("");
      setContentId("");
      setHtmlMode(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="portal-wizard individual-offer-sender">
      <header className="portal-wizard-head">
        <div>
          <h2>Send to one person</h2>
          <p className="intel-muted">Deliver an offer to a single phone — great for testing or VIP outreach.</p>
        </div>
      </header>

      <div className="portal-stepper" role="list" aria-label="Progress">
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
      {success && <p className="portal-success">{success}</p>}

      <div className="portal-wizard-body glass-panel">
        {step === 0 && (
          <div className="wizard-step-content">
            <h3>Step 1 — Pick a phone</h3>
            <p className="intel-muted">Choose who should receive this offer. Green dot = online now.</p>
            <DevicePicker
              editKey={keys.editKey}
              marketingKey={keys.marketingKey}
              selectedId={deviceId}
              onSelect={setDeviceId}
            />
          </div>
        )}

        {step === 1 && (
          <div className="wizard-step-content">
            <h3>Step 2 — How should it arrive?</h3>
            <p className="intel-muted">
              {selectedProfile
                ? `Sending to ${selectedProfile.label}${selectedProfile.online ? " (online)" : " (offline — will receive when connected)"}`
                : "Choose a delivery method."}
            </p>
            <div className="portal-delivery-grid">
              {DELIVERY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`portal-delivery-card ${delivery === opt.value ? "selected" : ""}`}
                  onClick={() => setDelivery(opt.value)}
                >
                  <span className="portal-delivery-icon">{opt.icon}</span>
                  <strong>{opt.label}</strong>
                  <span>{opt.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="wizard-step-content">
            <h3>Step 3 — Your message</h3>
            <div className="portal-mode-toggle">
              <button
                type="button"
                className={!htmlMode ? "active" : ""}
                onClick={() => setHtmlMode(false)}
              >
                Simple text
              </button>
              <button
                type="button"
                className={htmlMode ? "active" : ""}
                onClick={() => setHtmlMode(true)}
              >
                HTML designer
              </button>
            </div>

            {!htmlMode ? (
              <div className="portal-simple-form">
                <label>
                  Headline
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Special offer for you" />
                </label>
                <label>
                  Message
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    placeholder="Tell them why they should watch…"
                  />
                </label>
                <label>
                  Discount code (optional)
                  <input value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="e.g. HOT20" />
                </label>
              </div>
            ) : (
              <>
                <p className="intel-muted">Pick a starting design, then customize the HTML below.</p>
                <div className="portal-template-grid">
                  {(Object.keys(HTML_CAMPAIGN_TEMPLATES) as HtmlTemplateKey[]).map((k) => (
                    <button key={k} type="button" className="portal-template-card" onClick={() => applyTemplate(k)}>
                      <strong>{HTML_CAMPAIGN_TEMPLATES[k].name}</strong>
                    </button>
                  ))}
                </div>
                <label className="html-editor-label">
                  Headline
                  <input value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label className="html-editor-label">
                  HTML body
                  <textarea
                    className="html-editor"
                    spellCheck={false}
                    value={html}
                    onChange={(e) => setHtml(e.target.value)}
                    rows={12}
                  />
                </label>
              </>
            )}

            <button
              type="button"
              className="portal-advanced-toggle"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "▾ Hide advanced" : "▸ Advanced options"}
            </button>
            {showAdvanced && (
              <label className="html-editor-label">
                Catalog content ID (optional)
                <input value={contentId} onChange={(e) => setContentId(e.target.value)} placeholder="Links offer to a movie/show" />
              </label>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="wizard-step-content wizard-review">
            <h3>Step 4 — Review &amp; send</h3>
            <dl className="portal-review-list">
              <div>
                <dt>Recipient</dt>
                <dd>{selectedProfile?.label ?? deviceId}</dd>
              </div>
              <div>
                <dt>Area</dt>
                <dd>{selectedProfile?.area ?? "—"}</dd>
              </div>
              <div>
                <dt>Delivery</dt>
                <dd>{DELIVERY_OPTIONS.find((d) => d.value === delivery)?.label}</dd>
              </div>
              <div>
                <dt>Headline</dt>
                <dd>{title}</dd>
              </div>
              {discount && (
                <div>
                  <dt>Discount</dt>
                  <dd>{discount}</dd>
                </div>
              )}
            </dl>

            <div className="campaign-creator-grid review-preview">
              <div>
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
                    <iframe title="Offer preview" className="html-preview-iframe" srcDoc={previewDoc} sandbox="" />
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
                  </div>
                )}
              </div>
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
            onClick={() => void handleSend()}
          >
            {busy ? "Sending…" : "Send now"}
          </button>
        )}
      </div>
    </div>
  );
}
