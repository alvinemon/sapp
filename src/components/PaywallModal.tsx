import { useEffect, useState } from "react";
import type { PaymentMethod, PremiumItem } from "../data/premium";
import {
  requestPremiumAccess,
  verifyPremiumCode,
} from "../data/premium";

interface PaywallModalProps {
  item: PremiumItem;
  methods: PaymentMethod[];
  onClose: () => void;
  onUnlocked: (item: PremiumItem) => void;
}

type Step = "method" | "pay" | "code" | "done";

export function PaywallModal({ item, methods, onClose, onUnlocked }: PaywallModalProps) {
  const [step, setStep] = useState<Step>("method");
  const [methodId, setMethodId] = useState(methods[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [unlockCode, setUnlockCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState<string | null>(null);

  const method = methods.find((m) => m.id === methodId) ?? methods[0];
  const allowed = methods.filter((m) => !item.methodIds.length || item.methodIds.includes(m.id));

  useEffect(() => {
    if (allowed.length && !allowed.find((m) => m.id === methodId)) {
      setMethodId(allowed[0].id);
    }
  }, [allowed, methodId]);

  const submitPayment = async () => {
    if (!method || !reference.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await requestPremiumAccess(item.id, method.id, reference.trim());
      setMsg(res.message);
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    if (!unlockCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await verifyPremiumCode(item.id, unlockCode.trim());
      if (res.ok && res.url) {
        onUnlocked({ ...item, locked: false, url: res.url });
        setStep("done");
        setTimeout(onClose, 800);
      } else {
        setError("Invalid code — check with admin or try again");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verify failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="paywall-backdrop" onClick={onClose} role="presentation">
      <div className="paywall-modal glass-panel" onClick={(e) => e.stopPropagation()} role="dialog">
        <button type="button" className="paywall-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="paywall-header">
          <img src={item.thumbnail} alt="" className="paywall-thumb" />
          <div>
            <h2>{item.title}</h2>
            <p className="paywall-price">
              {item.price} {item.currency}
            </p>
            {item.description && <p className="paywall-desc">{item.description}</p>}
          </div>
        </div>

        {step === "method" && (
          <div className="paywall-body">
            <p className="paywall-step-title">Choose payment method</p>
            <div className="paywall-methods">
              {allowed.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`paywall-method ${methodId === m.id ? "paywall-method-active" : ""}`}
                  onClick={() => setMethodId(m.id)}
                >
                  {m.name}
                </button>
              ))}
            </div>
            <button type="button" className="family-submit" disabled={!method} onClick={() => setStep("pay")}>
              Continue
            </button>
          </div>
        )}

        {step === "pay" && method && (
          <div className="paywall-body">
            <p className="paywall-step-title">Pay with {method.name}</p>
            {method.account && (
              <p className="paywall-account">
                Send <strong>{item.price} {item.currency}</strong> to: <code>{method.account}</code>
              </p>
            )}
            <pre className="paywall-instructions">{method.instructions}</pre>
            <label className="family-field">
              <span>Transaction ID / reference</span>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Paste trx ID after paying"
              />
            </label>
            {error && <p className="free-catalog-error">{error}</p>}
            <div className="paywall-actions">
              <button type="button" className="paywall-back" onClick={() => setStep("method")}>
                Back
              </button>
              <button
                type="button"
                className="family-submit"
                disabled={busy || !reference.trim()}
                onClick={() => void submitPayment()}
              >
                {busy ? "Sending…" : "I've paid"}
              </button>
            </div>
            <button type="button" className="paywall-link" onClick={() => setStep("code")}>
              Already have an unlock code?
            </button>
          </div>
        )}

        {step === "code" && (
          <div className="paywall-body">
            <p className="paywall-step-title">Enter unlock code</p>
            {msg && <p className="paywall-msg">{msg}</p>}
            <label className="family-field">
              <span>Unlock code from admin</span>
              <input
                value={unlockCode}
                onChange={(e) => setUnlockCode(e.target.value)}
                placeholder="e.g. A1B2C3D4"
                autoComplete="off"
              />
            </label>
            {error && <p className="free-catalog-error">{error}</p>}
            <div className="paywall-actions">
              <button type="button" className="paywall-back" onClick={() => setStep("pay")}>
                Back
              </button>
              <button
                type="button"
                className="family-submit"
                disabled={busy || !unlockCode.trim()}
                onClick={() => void submitCode()}
              >
                {busy ? "Checking…" : "Unlock & watch"}
              </button>
            </div>
          </div>
        )}

        {step === "done" && <p className="paywall-msg ok">Unlocked — starting playback…</p>}
      </div>
    </div>
  );
}
