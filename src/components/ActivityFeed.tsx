import type { ActivityItem } from "../types/activity";

interface Props {
  items: ActivityItem[];
  phoneLive: boolean;
}

const SECTIONS: { key: ActivityItem["type"] | "all"; label: string; types: ActivityItem["type"][] }[] = [
  { key: "chat", label: "Messages", types: ["message", "chat"] },
  { key: "call", label: "Calls", types: ["call"] },
  { key: "typing", label: "Recent typing", types: ["typing"] },
];

function formatTime(at?: number) {
  if (!at) return "";
  const d = new Date(at);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function describeItem(item: ActivityItem): string {
  const who = item.who || "Someone";
  const app = item.app ? ` on ${item.app}` : "";
  const preview = item.preview ? `: ${item.preview}` : "";
  switch (item.type) {
    case "call":
      return `${who}${preview}`;
    case "typing":
      return `Typed in ${item.app || "app"}${preview}`;
    case "contact":
      return `${who}${preview}`;
    default:
      return `${who}${app}${preview}`;
  }
}

function groupItems(items: ActivityItem[]) {
  const groups: { label: string; items: ActivityItem[] }[] = [];
  for (const section of SECTIONS) {
    const filtered = items.filter((i) => section.types.includes(i.type));
    if (filtered.length > 0) groups.push({ label: section.label, items: filtered.slice(0, 20) });
  }
  return groups;
}

export function ActivityFeed({ items, phoneLive }: Props) {
  const groups = groupItems(items);

  return (
    <aside className="activity-feed glass-panel">
      <p className="panel-title">Activity</p>
      {!phoneLive && items.length === 0 && (
        <p className="feed-empty">Connect to a phone to see messages, calls, and typing here.</p>
      )}
      {phoneLive && items.length === 0 && (
        <p className="feed-empty">Waiting for activity from the phone…</p>
      )}
      {groups.map((g) => (
        <section key={g.label} className="feed-section">
          <h3 className="feed-section-title">{g.label}</h3>
          <ul className="feed-list">
            {g.items.map((item, i) => (
              <li key={item.id ?? `${item.at}-${i}`} className={`feed-card feed-${item.type}`}>
                <p className="feed-card-text">{describeItem(item)}</p>
                {item.at && <time className="feed-card-time">{formatTime(item.at)}</time>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
