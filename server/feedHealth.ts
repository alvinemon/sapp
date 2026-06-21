/** Self-healing feed health + GitHub fallback feed registry. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataPath } from "./dataPath.js";

export type FeedHealthState = "green" | "yellow" | "red";

export interface FeedHealthRecord {
  url: string;
  name: string;
  state: FeedHealthState;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  source: "config" | "fallback";
}

const FAIL_THRESHOLD_YELLOW = 2;
const FAIL_THRESHOLD_RED = 3;

const DEFAULT_FALLBACK_URL =
  "https://raw.githubusercontent.com/2hotatl/community-feeds/main/feeds.json";

function healthPath(): string {
  const dir = dataPath("pipeline");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "feed_health.json");
}

function readStore(): { feeds: FeedHealthRecord[]; fallbackFeeds: Array<{ url: string; name: string }> } {
  const path = healthPath();
  if (!existsSync(path)) return { feeds: [], fallbackFeeds: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as {
      feeds: FeedHealthRecord[];
      fallbackFeeds: Array<{ url: string; name: string }>;
    };
  } catch {
    return { feeds: [], fallbackFeeds: [] };
  }
}

function writeStore(data: ReturnType<typeof readStore>): void {
  writeFileSync(healthPath(), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function getFeedHealthRecords(): FeedHealthRecord[] {
  return readStore().feeds;
}

export function recordFeedSuccess(url: string, name: string): FeedHealthRecord {
  const store = readStore();
  let rec = store.feeds.find((f) => f.url === url);
  if (!rec) {
    rec = {
      url,
      name,
      state: "green",
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastError: null,
      lastCheckedAt: null,
      source: "config",
    };
    store.feeds.push(rec);
  }
  rec.consecutiveFailures = 0;
  rec.state = "green";
  rec.lastSuccessAt = new Date().toISOString();
  rec.lastError = null;
  rec.lastCheckedAt = rec.lastSuccessAt;
  writeStore(store);
  return rec;
}

export function recordFeedFailure(url: string, name: string, error: string): FeedHealthRecord {
  const store = readStore();
  let rec = store.feeds.find((f) => f.url === url);
  if (!rec) {
    rec = {
      url,
      name,
      state: "green",
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastError: null,
      lastCheckedAt: null,
      source: "config",
    };
    store.feeds.push(rec);
  }
  rec.consecutiveFailures += 1;
  rec.lastError = error.slice(0, 300);
  rec.lastCheckedAt = new Date().toISOString();
  if (rec.consecutiveFailures >= FAIL_THRESHOLD_RED) rec.state = "red";
  else if (rec.consecutiveFailures >= FAIL_THRESHOLD_YELLOW) rec.state = "yellow";
  writeStore(store);
  return rec;
}

export function isFeedOperational(url: string): boolean {
  const rec = readStore().feeds.find((f) => f.url === url);
  return !rec || rec.state !== "red";
}

export async function fetchFallbackFeeds(customUrl?: string): Promise<Array<{ url: string; name: string }>> {
  const url = customUrl ?? process.env.FALLBACK_FEEDS_URL ?? DEFAULT_FALLBACK_URL;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { feeds?: Array<{ url: string; name?: string }> };
    const feeds = (data.feeds ?? []).map((f) => ({
      url: String(f.url).trim(),
      name: String(f.name ?? f.url).trim(),
    })).filter((f) => f.url);
    const store = readStore();
    store.fallbackFeeds = feeds;
    writeStore(store);
    return feeds;
  } catch {
    return readStore().fallbackFeeds;
  }
}

export async function healDownFeeds(
  configuredFeeds: Array<{ url: string; name: string; status?: string }>,
): Promise<Array<{ url: string; name: string; status: string }>> {
  const store = readStore();
  const fallback = store.fallbackFeeds.length
    ? store.fallbackFeeds
    : await fetchFallbackFeeds();

  const out: Array<{ url: string; name: string; status: string }> = [];
  const seen = new Set<string>();

  for (const feed of configuredFeeds) {
    seen.add(feed.url);
    const rec = store.feeds.find((f) => f.url === feed.url);
    const state = rec?.state ?? feed.status ?? "green";
    if (state !== "red") {
      out.push({ url: feed.url, name: feed.name, status: state === "yellow" ? "yellow" : "green" });
      continue;
    }
    const replacement = fallback.find((f) => !seen.has(f.url) && isFeedOperational(f.url));
    if (replacement) {
      seen.add(replacement.url);
      out.push({ url: replacement.url, name: `${replacement.name} (fallback)`, status: "yellow" });
      recordFeedSuccess(replacement.url, replacement.name);
    }
  }

  return out.length ? out : configuredFeeds.map((f) => ({
    url: f.url,
    name: f.name,
    status: store.feeds.find((r) => r.url === f.url)?.state ?? f.status ?? "green",
  }));
}
