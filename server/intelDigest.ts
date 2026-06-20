import { assertDeviceIntelAccess, resolveAccess } from "./marketingAuth.js";
import type { IntelScopes } from "./marketingTeam.js";
import { getLocations, getNotifications, type LocationEntry, type NotificationEntry } from "./intelStore.js";
import { getNotes, type SessionNoteEntry } from "./notes.js";

export type IntelRange = "hour" | "day" | "week";

export interface NotificationDetail {
  id: string;
  ts: number;
  app: string;
  pkg: string;
  title: string;
  text: string;
}

export interface AppIntelGroup {
  app: string;
  pkg: string;
  count: number;
  latestTitle: string;
  latestText: string;
  latestTs: number;
  samples: NotificationDetail[];
}

export interface ConversationThread {
  app: string;
  pkg: string;
  threadTitle: string;
  count: number;
  firstTs: number;
  lastTs: number;
  preview: string;
  messages: NotificationDetail[];
}

export interface DayIntelBucket {
  day: string;
  count: number;
  apps: string[];
  highlights: string[];
}

export interface DayDetail {
  day: string;
  count: number;
  apps: string[];
  notifications: NotificationDetail[];
}

export interface TypingGroup {
  app: string;
  source: string;
  count: number;
  snippets: { ts: number; text: string }[];
}

export interface TypingDetail {
  ts: number;
  app: string;
  source: string;
  text: string;
}

export interface LocationDetail extends LocationEntry {
  mapsUrl: string;
  timeLabel: string;
}

export interface TimelineEvent {
  ts: number;
  kind: "notification" | "location" | "typing";
  title: string;
  detail: string;
  app?: string;
  pkg?: string;
  meta?: string;
}

export interface IntelDigest {
  deviceId: string;
  range: IntelRange;
  from: number;
  to: number;
  stats: {
    notifications: number;
    locations: number;
    typingSessions: number;
    uniqueApps: number;
  };
  tags: string[];
  humanBrief: string;
  topKeywords: { word: string; count: number }[];
  appGroups: AppIntelGroup[];
  conversationThreads: ConversationThread[];
  dayBuckets: DayIntelBucket[];
  dayDetails: DayDetail[];
  notificationFeed: NotificationDetail[];
  recentNotifications: NotificationEntry[];
  locationPins: LocationDetail[];
  locationSummary: string;
  typingGroups: TypingGroup[];
  typingFeed: TypingDetail[];
  timeline: TimelineEvent[];
  aiContext: string;
}

function rangeMs(range: IntelRange): number {
  if (range === "hour") return 3_600_000;
  if (range === "day") return 86_400_000;
  return 7 * 86_400_000;
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function toDetail(n: NotificationEntry): NotificationDetail {
  return {
    id: n.id,
    ts: n.ts,
    app: n.app || n.pkg || "App",
    pkg: n.pkg,
    title: n.title,
    text: n.text,
  };
}

function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function summarizeLocation(locs: LocationEntry[]): string {
  if (!locs.length) return "No location data in range.";
  const last = locs[0];
  const good = locs.filter((l) => l.accuracy > 0 && l.accuracy <= 80);
  const pin = good[0] ?? last;
  const parts = [`Last pin ±${Math.round(pin.accuracy)}m at ${fmtTime(pin.ts)}`];
  if (locs.length >= 3) {
    const lats = locs.slice(0, 12).map((l) => l.lat);
    const lngs = locs.slice(0, 12).map((l) => l.lng);
    const latSpread = Math.max(...lats) - Math.min(...lats);
    const lngSpread = Math.max(...lngs) - Math.min(...lngs);
    if (latSpread < 0.02 && lngSpread < 0.02) parts.push("mostly stays in one area");
    else if (latSpread > 0.08 || lngSpread > 0.08) parts.push("moves between areas");
  }
  return parts.join(" · ");
}

function extractKeywords(notifs: NotificationEntry[]): { word: string; count: number }[] {
  const stop = new Set(
    "the a an and or but in on at to for of is it this that with from you your was are be have has".split(
      " ",
    ),
  );
  const counts = new Map<string, number>();
  for (const n of notifs) {
    const blob = `${n.title} ${n.text}`.toLowerCase();
    for (const raw of blob.split(/[^a-z0-9]+/)) {
      const w = raw.trim();
      if (w.length < 3 || stop.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word, count]) => ({ word, count }));
}

function buildTags(
  apps: AppIntelGroup[],
  notifs: NotificationEntry[],
  notes: SessionNoteEntry[],
): string[] {
  const tags: string[] = [];
  const messenger = ["whatsapp", "telegram", "messenger", "instagram", "facebook"];
  const lowerApps = apps.map((a) => a.app.toLowerCase());
  if (lowerApps.some((a) => messenger.some((m) => a.includes(m)))) {
    tags.push("Active messenger user");
  }
  if (apps.some((a) => a.count >= 8)) tags.push("High notification volume");
  if (notes.length >= 5) tags.push("Frequent typing sessions");
  const evening = notifs.filter((n) => {
    const h = new Date(n.ts).getHours();
    return h >= 18 || h < 2;
  });
  if (evening.length >= Math.max(3, notifs.length / 3)) tags.push("Evening-heavy usage");
  const shopping = notifs.filter((n) =>
    /shop|order|cart|deal|sale|delivery|payment|paid/i.test(`${n.title} ${n.text}`),
  );
  if (shopping.length >= 2) tags.push("Shopping / payments");
  const stream = notifs.filter((n) =>
    /watch|video|movie|netflix|youtube|stream|episode/i.test(`${n.title} ${n.text}`),
  );
  if (stream.length >= 2) tags.push("Streaming interest");
  const travel = notifs.filter((n) =>
    /ride|uber|pathao|flight|hotel|map|gps/i.test(`${n.title} ${n.text}`),
  );
  if (travel.length >= 2) tags.push("Travel / mobility");
  return tags.slice(0, 8);
}

function buildConversationThreads(notifs: NotificationEntry[]): ConversationThread[] {
  const map = new Map<string, NotificationDetail[]>();
  for (const n of notifs) {
    const titleKey = (n.title || "Alert").slice(0, 48);
    const key = `${n.pkg}|${titleKey}`;
    const list = map.get(key) ?? [];
    list.push(toDetail(n));
    map.set(key, list);
  }
  const threads: ConversationThread[] = [];
  for (const [key, messages] of map) {
    messages.sort((a, b) => b.ts - a.ts);
    const [pkg, threadTitle] = key.split("|");
    const first = messages[messages.length - 1];
    const last = messages[0];
    threads.push({
      app: last.app || pkg,
      pkg,
      threadTitle,
      count: messages.length,
      firstTs: first.ts,
      lastTs: last.ts,
      preview: last.text || last.title,
      messages: messages.slice(0, 25),
    });
  }
  return threads.sort((a, b) => b.lastTs - a.lastTs).slice(0, 40);
}

function buildHumanBrief(
  range: IntelRange,
  notifs: NotificationEntry[],
  notes: SessionNoteEntry[],
  apps: AppIntelGroup[],
  threads: ConversationThread[],
  locs: LocationEntry[],
  tags: string[],
): string {
  const rangeLabel = range === "hour" ? "the last hour" : range === "day" ? "the last day" : "the last week";
  const lines: string[] = [];
  lines.push(
    `Over ${rangeLabel}: ${notifs.length} notifications across ${apps.length} apps, ${notes.length} typing notes, ${locs.length} location pings.`,
  );
  if (apps.length) {
    const top = apps
      .slice(0, 4)
      .map((a) => `${a.app} (${a.count})`)
      .join(", ");
    lines.push(`Most active apps: ${top}.`);
  }
  const chatty = threads.filter((t) => t.count >= 2).slice(0, 3);
  if (chatty.length) {
    lines.push(
      `Active threads: ${chatty.map((t) => `${t.app} — "${t.threadTitle}" (${t.count} msgs)`).join("; ")}.`,
    );
  }
  const recentAlerts = notifs
    .slice(0, 5)
    .map((n) => {
      const bit = n.text || n.title;
      return bit.length > 60 ? `${bit.slice(0, 57)}…` : bit;
    })
    .filter(Boolean);
  if (recentAlerts.length) {
    lines.push(`Recent alert text: ${recentAlerts.join(" | ")}`);
  }
  if (notes.length) {
    const lastNote = notes[notes.length - 1];
    const snippet = lastNote.text.slice(0, 80);
    lines.push(
      `Latest typing in ${lastNote.app || lastNote.source}: "${snippet}${lastNote.text.length > 80 ? "…" : ""}"`,
    );
  }
  if (locs.length) {
    const pin = locs[0];
    lines.push(`Last location ±${Math.round(pin.accuracy)}m at ${fmtTime(pin.ts)}.`);
  }
  if (tags.length) lines.push(`Signals: ${tags.join(", ")}.`);
  return lines.join(" ");
}

function buildAiContext(digest: Omit<IntelDigest, "aiContext">): string {
  return digest.humanBrief;
}

function filterDigestByScopes(digest: IntelDigest, scopes: IntelScopes): IntelDigest {
  const out = { ...digest };

  if (!scopes.notifications) {
    out.notificationFeed = [];
    out.recentNotifications = [];
    out.appGroups = out.appGroups.map((g) => ({ ...g, samples: [], count: 0, latestTitle: "", latestText: "" }));
    out.dayDetails = out.dayDetails.map((d) => ({ ...d, notifications: [], count: 0 }));
    out.dayBuckets = out.dayBuckets.map((d) => ({ ...d, count: 0, highlights: [] }));
    out.topKeywords = [];
  }

  if (!scopes.chats) {
    out.conversationThreads = [];
  }

  if (!scopes.typing) {
    out.typingFeed = [];
    out.typingGroups = [];
  }

  if (!scopes.locations) {
    out.locationPins = [];
    out.locationSummary = "Location data not shared with your role.";
  }

  if (!scopes.overview) {
    out.tags = [];
    out.humanBrief = "Overview summary not shared with your role.";
    out.topKeywords = [];
    out.appGroups = [];
    out.dayBuckets = [];
    out.dayDetails = [];
  }

  out.timeline = out.timeline.filter((ev) => {
    if (ev.kind === "notification") return scopes.notifications;
    if (ev.kind === "typing") return scopes.typing;
    if (ev.kind === "location") return scopes.locations;
    return true;
  });

  out.stats = {
    notifications: scopes.notifications ? digest.stats.notifications : 0,
    locations: scopes.locations ? digest.stats.locations : 0,
    typingSessions: scopes.typing ? digest.stats.typingSessions : 0,
    uniqueApps: scopes.overview || scopes.notifications ? digest.stats.uniqueApps : 0,
  };

  out.aiContext = buildAiContext(out);
  return out;
}

export function buildIntelDigest(
  deviceId: string,
  range: IntelRange = "week",
  keys?: { editKey?: string; marketingKey?: string },
): IntelDigest {
  assertDeviceIntelAccess(deviceId, keys ?? {});
  const now = Date.now();
  const from = now - rangeMs(range);

  const notifs = getNotifications(deviceId, from, now);
  const locs = getLocations(deviceId, from, now);
  const notes = getNotes(deviceId).filter((n) => n.ts >= from && n.ts <= now);

  const byApp = new Map<string, AppIntelGroup>();
  for (const n of notifs) {
    const key = n.pkg || n.app || "unknown";
    const g = byApp.get(key) ?? {
      app: n.app || n.pkg || "App",
      pkg: n.pkg,
      count: 0,
      latestTitle: "",
      latestText: "",
      latestTs: 0,
      samples: [],
    };
    g.count++;
    if (n.ts >= g.latestTs) {
      g.latestTs = n.ts;
      g.latestTitle = n.title;
      g.latestText = n.text;
    }
    if (g.samples.length < 15) g.samples.push(toDetail(n));
    byApp.set(key, g);
  }
  const appGroups = [...byApp.values()].sort((a, b) => b.count - a.count);

  const dayMap = new Map<string, DayDetail>();
  for (const n of notifs) {
    const day = dayKey(n.ts);
    const b = dayMap.get(day) ?? { day, count: 0, apps: [], notifications: [] };
    b.count++;
    const app = n.app || n.pkg;
    if (app && !b.apps.includes(app)) b.apps.push(app);
    if (b.notifications.length < 40) b.notifications.push(toDetail(n));
    dayMap.set(day, b);
  }
  const dayDetails = [...dayMap.values()].sort((a, b) => b.day.localeCompare(a.day));
  const dayBuckets: DayIntelBucket[] = dayDetails.map((d) => ({
    day: d.day,
    count: d.count,
    apps: d.apps,
    highlights: d.notifications.slice(0, 6).map((n) => n.title || n.text).filter(Boolean),
  }));

  const typingMap = new Map<string, TypingGroup>();
  for (const n of notes) {
    const key = `${n.app}|${n.source}`;
    const g = typingMap.get(key) ?? { app: n.app, source: n.source, count: 0, snippets: [] };
    g.count++;
    if (g.snippets.length < 20) {
      g.snippets.push({ ts: n.ts, text: n.text.slice(0, 500) });
    }
    typingMap.set(key, g);
  }
  const typingGroups = [...typingMap.values()].sort((a, b) => b.count - a.count);
  const typingFeed: TypingDetail[] = notes
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 120)
    .map((n) => ({
      ts: n.ts,
      app: n.app,
      source: n.source,
      text: n.text,
    }));

  const notificationFeed = notifs.slice(0, 150).map(toDetail);
  const conversationThreads = buildConversationThreads(notifs);

  const locationPins: LocationDetail[] = locs.slice(0, 60).map((l) => ({
    ...l,
    mapsUrl: mapsUrl(l.lat, l.lng),
    timeLabel: fmtTime(l.ts),
  }));

  const timeline: TimelineEvent[] = [];
  for (const n of notifs.slice(0, 80)) {
    timeline.push({
      ts: n.ts,
      kind: "notification",
      title: n.title || n.app || "Notification",
      detail: n.text || "(no body)",
      app: n.app || n.pkg,
      pkg: n.pkg,
      meta: n.app || n.pkg,
    });
  }
  for (const l of locs.slice(0, 30)) {
    timeline.push({
      ts: l.ts,
      kind: "location",
      title: "Location",
      detail: `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)} · ±${Math.round(l.accuracy)}m`,
      meta: mapsUrl(l.lat, l.lng),
    });
  }
  for (const n of notes.slice(-40)) {
    timeline.push({
      ts: n.ts,
      kind: "typing",
      title: n.app || n.source || "Typing",
      detail: n.text,
      app: n.app,
      meta: n.source,
    });
  }
  timeline.sort((a, b) => b.ts - a.ts);

  const tags = buildTags(appGroups, notifs, notes);
  const topKeywords = extractKeywords(notifs);
  const humanBrief = buildHumanBrief(range, notifs, notes, appGroups, conversationThreads, locs, tags);

  const base: IntelDigest = {
    deviceId,
    range,
    from,
    to: now,
    stats: {
      notifications: notifs.length,
      locations: locs.length,
      typingSessions: notes.length,
      uniqueApps: appGroups.length,
    },
    tags,
    humanBrief,
    topKeywords,
    appGroups,
    conversationThreads,
    dayBuckets,
    dayDetails,
    notificationFeed,
    recentNotifications: notifs.slice(0, 100),
    locationPins,
    locationSummary: summarizeLocation(locs),
    typingGroups,
    typingFeed,
    timeline: timeline.slice(0, 150),
    aiContext: "",
  };
  base.aiContext = buildAiContext(base);

  const ctx = resolveAccess(keys ?? {});
  if (ctx?.role === "marketing") {
    return filterDigestByScopes(base, ctx.member.intelScopes);
  }
  return base;
}
