import { useEffect, useState } from "react";
import {
  clearMarketingKey,
  getMarketingKey,
  marketingLogin,
  setMarketingKey,
  DEFAULT_INTEL_SCOPES,
  type MarketingSession,
} from "./data/marketing";
import { IntelDashboard } from "./components/IntelDashboard";
import { SegmentBuilder } from "./components/SegmentBuilder";
import { CampaignsPanel } from "./components/CampaignsPanel";
import { CampaignAnalytics } from "./components/CampaignAnalytics";

type MktTab = "intel" | "segments" | "campaigns" | "analytics";

export default function MarketingPage() {
  const [key, setKey] = useState(getMarketingKey);
  const [inputKey, setInputKey] = useState("");
  const [session, setSession] = useState<MarketingSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mktTab, setMktTab] = useState<MktTab>("intel");

  useEffect(() => {
    if (!key) return;
    void marketingLogin(key)
      .then((r) => {
        setSession(r.member);
        setError(null);
      })
      .catch(() => {
        setSession(null);
        clearMarketingKey();
        setKey("");
      });
  }, [key]);

  const login = async () => {
    const k = inputKey.trim();
    if (!k) return;
    try {
      const r = await marketingLogin(k);
      setMarketingKey(k);
      setKey(k);
      setSession(r.member);
      setError(null);
    } catch {
      setError("Invalid marketing access key");
    }
  };

  const logout = () => {
    clearMarketingKey();
    setKey("");
    setSession(null);
  };

  if (!session) {
    return (
      <div className="admin-page owner-gate">
        <h1>Marketing portal</h1>
        <p>Enter the access key your admin gave you. You will only see phones assigned to you.</p>
        <input
          type="password"
          placeholder="Marketing access key"
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void login()}
        />
        <button type="button" onClick={() => void login()}>Sign in</button>
        {error && <p className="admin-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="admin-page marketing-page">
      <header className="admin-header">
        <h1>Marketing — {session.name}</h1>
        <p className="intel-muted">{session.email} · {session.deviceIds.length} assigned phone(s)</p>
        <nav className="admin-tabs">
          {(["intel", "segments", "campaigns", "analytics"] as MktTab[]).map((t) => (
            <button key={t} type="button" className={mktTab === t ? "active" : ""} onClick={() => setMktTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <button type="button" onClick={logout}>Sign out</button>
      </header>
      {!session.canViewIntel && (
        <p className="admin-error">Intel access is disabled for your account. Contact admin.</p>
      )}
      {session.canViewIntel && mktTab === "intel" && (
        <IntelDashboard
          marketingKey={key}
          canSendOffers={session.canSendOffers}
          intelScopes={session.intelScopes ?? DEFAULT_INTEL_SCOPES}
        />
      )}
      {mktTab === "segments" && <SegmentBuilder keys={{ marketingKey: key }} canDelete={false} />}
      {session.canSendOffers && mktTab === "campaigns" && (
        <CampaignsPanel keys={{ marketingKey: key }} canApprove={false} canSaveTemplates={false} />
      )}
      {mktTab === "analytics" && <CampaignAnalytics keys={{ marketingKey: key }} />}
    </div>
  );
}
