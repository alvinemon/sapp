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
import { PortalDashboard } from "./PortalDashboard";
import { IndividualOfferSender } from "./IndividualOfferSender";
import { DEFAULT_INTEL_SCOPES } from "../data/marketing";

export type PortalTab =
  | "home"
  | "send-one"
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

type NavItem = { id: PortalTab; label: string; hint: string; icon: string };

type NavGroup = { title: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Get started",
    items: [
      { id: "home", label: "Home", hint: "Quick actions", icon: "⌂" },
      { id: "send-one", label: "Send to one person", hint: "Single phone", icon: "📱" },
      { id: "campaigns", label: "Send offers", hint: "Bulk campaigns", icon: "📣" },
    ],
  },
  {
    title: "People & phones",
    items: [
      { id: "devices", label: "Phones", hint: "Remote control", icon: "🖥️" },
      { id: "intel", label: "Phone activity", hint: "Review & send", icon: "🔍" },
      { id: "audiences", label: "Who to target", hint: "Audience lists", icon: "👥" },
    ],
  },
  {
    title: "Results & setup",
    items: [
      { id: "analytics", label: "See results", hint: "Opens & clicks", icon: "📊" },
      { id: "automation", label: "Automation", hint: "Auto triggers", icon: "⚡" },
      { id: "catalog", label: "Catalog", hint: "Movies & pay", icon: "🎬" },
      { id: "team", label: "Team", hint: "Marketers", icon: "👤" },
      { id: "settings", label: "Settings", hint: "Guardrails", icon: "⚙️" },
    ],
  },
];

const ALL_TABS = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));

const TAB_META: Record<PortalTab, { title: string; subtitle: string }> = {
  home: { title: "Home", subtitle: "What do you want to do today?" },
  "send-one": { title: "Send to one person", subtitle: "Deliver an offer to a single phone" },
  devices: { title: "Phones", subtitle: "Remote control connected devices" },
  intel: { title: "Phone activity", subtitle: "See activity and send personalized offers" },
  audiences: { title: "Who to target", subtitle: "Build audience lists for campaigns" },
  campaigns: { title: "Send offers", subtitle: "Design and send offers to a group" },
  analytics: { title: "See results", subtitle: "Track opens, clicks, and conversions" },
  automation: { title: "Automation", subtitle: "Set up automatic offer triggers" },
  catalog: { title: "Catalog", subtitle: "Manage movies, shows, and pricing" },
  team: { title: "Team", subtitle: "Manage marketer access" },
  settings: { title: "Settings", subtitle: "Sending limits and quiet hours" },
};

function tabFromUrl(): PortalTab {
  const p = new URLSearchParams(window.location.search);
  const t = p.get("tab") as PortalTab | null;
  if (t && ALL_TABS.includes(t)) return t;
  const hash = window.location.hash.replace("#", "") as PortalTab;
  if (hash && ALL_TABS.includes(hash)) return hash;
  return "home";
}

function findNavItem(id: PortalTab): NavItem | undefined {
  for (const g of NAV_GROUPS) {
    const item = g.items.find((i) => i.id === id);
    if (item) return item;
  }
  return undefined;
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

  const meta = TAB_META[tab];
  const navItem = findNavItem(tab);

  return (
    <div className={`control-portal ${tab === "devices" ? "control-portal-devices" : ""}`}>
      <aside className={`portal-sidebar ${navOpen ? "open" : "collapsed"}`}>
        <div className="portal-brand">
          <span className="logo-icon">◉</span>
          {navOpen && (
            <div>
              <strong>2hotatl</strong>
              <span>Marketing</span>
            </div>
          )}
        </div>

        <nav className="portal-nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="portal-nav-group">
              {navOpen && <span className="portal-nav-group-title">{group.title}</span>}
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={tab === item.id ? "active" : ""}
                  onClick={() => go(item.id)}
                  title={navOpen ? undefined : item.label}
                >
                  <span className="portal-nav-icon" aria-hidden>
                    {item.icon}
                  </span>
                  {navOpen && (
                    <>
                      <span className="portal-nav-label">{item.label}</span>
                      <span className="portal-nav-hint">{item.hint}</span>
                    </>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="portal-sidebar-foot">
          {navOpen && <a href="/watch">Public watch app →</a>}
          <button type="button" className="portal-collapse" onClick={() => setNavOpen((v) => !v)}>
            {navOpen ? "◂" : "▸"}
          </button>
        </div>
      </aside>

      <div className="portal-content">
        {tab !== "devices" && tab !== "home" && (
          <header className="portal-topbar">
            <div className="portal-topbar-icon" aria-hidden>
              {navItem?.icon}
            </div>
            <div>
              <h1>{meta.title}</h1>
              <p>{meta.subtitle}</p>
            </div>
          </header>
        )}

        {tab === "home" && <PortalDashboard onNavigate={go} />}
        {tab === "send-one" && <IndividualOfferSender keys={OPEN_KEYS} />}
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
