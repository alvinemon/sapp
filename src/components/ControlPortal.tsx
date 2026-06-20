import { useEffect, useState } from "react";
import App from "../App";
import { IntelDashboard } from "./IntelDashboard";
import { SegmentBuilder } from "./SegmentBuilder";
import { HtmlCampaignCreator } from "./HtmlCampaignCreator";
import { CampaignAnalytics } from "./CampaignAnalytics";
import { TriggersPanel } from "./TriggersPanel";
import { MarketingTeamPanel } from "./MarketingTeamPanel";
import { MarketingGuardrailsPanel } from "./MarketingGuardrailsPanel";
import { CatalogPanel } from "./CatalogPanel";
import { DEFAULT_INTEL_SCOPES } from "../data/marketing";

export type PortalTab =
  | "devices"
  | "intel"
  | "audiences"
  | "campaigns"
  | "analytics"
  | "automation"
  | "catalog"
  | "team"
  | "settings";

const OPEN_KEYS = { editKey: "" };

const NAV: { id: PortalTab; label: string; hint: string }[] = [
  { id: "devices", label: "Phones", hint: "Remote control" },
  { id: "intel", label: "Intel", hint: "Review & send offers" },
  { id: "audiences", label: "Audiences", hint: "Segments" },
  { id: "campaigns", label: "Campaigns", hint: "HTML popups" },
  { id: "analytics", label: "Analytics", hint: "Funnel & CSV" },
  { id: "automation", label: "Automation", hint: "Triggers" },
  { id: "catalog", label: "Catalog", hint: "Movies & pay" },
  { id: "team", label: "Team", hint: "Marketers" },
  { id: "settings", label: "Settings", hint: "Guardrails" },
];

function tabFromUrl(): PortalTab {
  const p = new URLSearchParams(window.location.search);
  const t = p.get("tab") as PortalTab | null;
  if (t && NAV.some((n) => n.id === t)) return t;
  const hash = window.location.hash.replace("#", "") as PortalTab;
  if (hash && NAV.some((n) => n.id === hash)) return hash;
  return "devices";
}

export function ControlPortal() {
  const [tab, setTab] = useState<PortalTab>(tabFromUrl);
  const [navOpen, setNavOpen] = useState(true);

  const go = (next: PortalTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState({}, "", url.pathname + url.search);
  };

  useEffect(() => {
    const onPop = () => setTab(tabFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className={`control-portal ${tab === "devices" ? "control-portal-devices" : ""}`}>
      <aside className={`portal-sidebar ${navOpen ? "open" : "collapsed"}`}>
        <div className="portal-brand">
          <span className="logo-icon">◉</span>
          <div>
            <strong>2hotatl</strong>
            <span>Control</span>
          </div>
        </div>
        <nav className="portal-nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? "active" : ""}
              onClick={() => go(item.id)}
            >
              <span className="portal-nav-label">{item.label}</span>
              <span className="portal-nav-hint">{item.hint}</span>
            </button>
          ))}
        </nav>
        <div className="portal-sidebar-foot">
          <a href="/watch">Public watch app →</a>
          <button type="button" className="portal-collapse" onClick={() => setNavOpen((v) => !v)}>
            {navOpen ? "◂" : "▸"}
          </button>
        </div>
      </aside>

      <div className="portal-content">
        {tab !== "devices" && (
          <header className="portal-topbar">
            <h1>{NAV.find((n) => n.id === tab)?.label}</h1>
            <p>{NAV.find((n) => n.id === tab)?.hint}</p>
          </header>
        )}

        {tab === "devices" && <App />}
        {tab === "intel" && (
          <IntelDashboard adminKey="" canSendOffers intelScopes={DEFAULT_INTEL_SCOPES} />
        )}
        {tab === "audiences" && <SegmentBuilder keys={OPEN_KEYS} canDelete />}
        {tab === "campaigns" && <HtmlCampaignCreator keys={OPEN_KEYS} />}
        {tab === "analytics" && <CampaignAnalytics keys={OPEN_KEYS} />}
        {tab === "automation" && (
          <div className="portal-stack">
            <TriggersPanel adminKey="" />
          </div>
        )}
        {tab === "catalog" && <CatalogPanel />}
        {tab === "team" && <MarketingTeamPanel adminKey="" />}
        {tab === "settings" && <MarketingGuardrailsPanel adminKey="" />}
      </div>
    </div>
  );
}
