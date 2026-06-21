import { useEffect, useState } from "react";
import type { PortalTab } from "./ControlPortal";

interface Props {
  onNavigate: (tab: PortalTab) => void;
}

interface GrowthPulse {
  sent: number;
  clicks: number;
  unlocks: number;
  automationRate: number;
  coveragePercent: number;
}

const ACTIONS: {
  id: PortalTab | "send-one";
  icon: string;
  title: string;
  description: string;
  accent: string;
}[] = [
  {
    id: "send-one",
    icon: "📱",
    title: "Send offer to one person",
    description: "Pick a phone and deliver a popup, notification, or browse offer right now.",
    accent: "portal-card-accent-purple",
  },
  {
    id: "campaigns",
    icon: "📣",
    title: "Run a campaign",
    description: "Send a designed offer to a whole group — hundreds of people at once.",
    accent: "portal-card-accent-red",
  },
  {
    id: "devices",
    icon: "🖥️",
    title: "Review phones",
    description: "See connected devices, remote control screens, and check who's online.",
    accent: "portal-card-accent-cyan",
  },
  {
    id: "intel",
    icon: "🔍",
    title: "Phone activity",
    description: "See what someone has been doing and send personalized offers from their profile.",
    accent: "portal-card-accent-pink",
  },
  {
    id: "analytics",
    icon: "📊",
    title: "See results",
    description: "Track how many people opened, clicked, and converted on your offers.",
    accent: "portal-card-accent-green",
  },
  {
    id: "audiences",
    icon: "👥",
    title: "Build a target list",
    description: "Create groups like \"active this week\" or \"in Dhaka\" for future campaigns.",
    accent: "portal-card-accent-amber",
  },
];

export function PortalDashboard({ onNavigate }: Props) {
  const [pulse, setPulse] = useState<GrowthPulse | null>(null);
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  useEffect(() => {
    void fetch("/api/growth-pulse")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPulse(d as GrowthPulse | null))
      .catch(() => setPulse(null));
  }, []);

  return (
    <div className="portal-dashboard">
      <header className="portal-welcome">
        <div>
          <p className="portal-welcome-greeting">{greeting}</p>
          <h1 className="portal-welcome-title">What do you want to do?</h1>
          <p className="portal-welcome-sub">
            Pick a task below — no technical knowledge needed. Each flow walks you through step by step.
          </p>
        </div>
      </header>

      {pulse && (
        <section className="portal-growth-pulse glass-panel">
          <h3>Growth pulse · last 24 hours</h3>
          <p className="portal-pulse-line">
            <strong>{pulse.sent}</strong> sent → <strong>{pulse.clicks}</strong> clicks →{" "}
            <strong>{pulse.unlocks}</strong> unlocks
          </p>
          <div className="portal-pulse-kpis">
            <span>Automation {pulse.automationRate}%</span>
            <span>Coverage {pulse.coveragePercent}%</span>
          </div>
        </section>
      )}

      <div className="portal-action-grid">
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            className={`portal-action-card ${action.accent}`}
            onClick={() => onNavigate(action.id as PortalTab)}
          >
            <span className="portal-action-icon" aria-hidden>
              {action.icon}
            </span>
            <span className="portal-action-body">
              <strong>{action.title}</strong>
              <span>{action.description}</span>
            </span>
            <span className="portal-action-arrow" aria-hidden>
              →
            </span>
          </button>
        ))}
      </div>

      <section className="portal-quick-tips glass-panel">
        <h3>Quick tips</h3>
        <ul>
          <li>
            <strong>One person?</strong> Use &ldquo;Send offer to one person&rdquo; — fastest way to test a design.
          </li>
          <li>
            <strong>Many people?</strong> Build a target list first, then run a campaign.
          </li>
          <li>
            <strong>Popup vs notification?</strong> Popups appear full-screen; notifications show in the tray and open the design when tapped.
          </li>
        </ul>
      </section>
    </div>
  );
}
