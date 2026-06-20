import { useState } from "react";
import { DEFAULT_INTEL_SCOPES } from "./data/marketing";
import { IntelDashboard } from "./components/IntelDashboard";
import { SegmentBuilder } from "./components/SegmentBuilder";
import { CampaignsPanel } from "./components/CampaignsPanel";
import { CampaignAnalytics } from "./components/CampaignAnalytics";

type MktTab = "intel" | "segments" | "campaigns" | "analytics";

const OPEN_KEYS = { editKey: "" };

export default function MarketingPage() {
  const [mktTab, setMktTab] = useState<MktTab>("intel");

  return (
    <div className="admin-page marketing-page">
      <header className="admin-header">
        <h1>Marketing</h1>
        <p className="intel-muted">All devices · open access (no login)</p>
        <nav className="admin-tabs">
          {(["intel", "segments", "campaigns", "analytics"] as MktTab[]).map((t) => (
            <button key={t} type="button" className={mktTab === t ? "active" : ""} onClick={() => setMktTab(t)}>
              {t}
            </button>
          ))}
        </nav>
      </header>

      {mktTab === "intel" && (
        <IntelDashboard adminKey="" canSendOffers intelScopes={DEFAULT_INTEL_SCOPES} />
      )}
      {mktTab === "segments" && <SegmentBuilder keys={OPEN_KEYS} canDelete />}
      {mktTab === "campaigns" && <CampaignsPanel keys={OPEN_KEYS} canApprove canSaveTemplates />}
      {mktTab === "analytics" && <CampaignAnalytics keys={OPEN_KEYS} />}
    </div>
  );
}
