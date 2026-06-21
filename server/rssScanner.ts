import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { parse as parseYaml } from "yaml";
import {
  type ConfiguredFeed,
  type DiscoveryItem,
  type FeedStatus,
  feedScheme,
  fetchRssItems,
  fetchScraperItems,
  fetchTelegramItems,
  isFeedActive,
  isIngestableUrl,
} from "./feedSources.js";
import { dataPath } from "./dataPath.js";
import { recordFeedFailure, recordFeedSuccess, healDownFeeds } from "./feedHealth.js";
import { pipelineIngest, fetchWorkerJobStatus, loadAutomationConfig, workerConfigured, checkWorkerHealth } from "./pipelineClient.js";

const PIPELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline");

export interface RssFeed extends ConfiguredFeed {
  status: FeedStatus;
}

export interface RssScannerConfig {
  feeds: RssFeed[];
  keywords: string[];
  blacklist: string[];
  scanIntervalMinutes: number;
  telegramBotToken: string;
}

export interface FeedHealth {
  name: string;
  url: string;
  status: FeedStatus;
  scheme: string;
  lastError: string | null;
  lastItemCount: number;
}

export interface RssScannerStatus {
  enabled: boolean;
  feedCount: number;
  keywordCount: number;
  blacklistCount: number;
  intervalMinutes: number;
  lastScanAt: string | null;
  lastScanNewMatches: number;
  lastScanErrors: string[];
  scanning: boolean;
  totalSeen: number;
  pendingJobs: number;
  feeds: FeedHealth[];
}

let status: RssScannerStatus = {
  enabled: false,
  feedCount: 0,
  keywordCount: 0,
  blacklistCount: 0,
  intervalMinutes: 30,
  lastScanAt: null,
  lastScanNewMatches: 0,
  lastScanErrors: [],
  scanning: false,
  totalSeen: 0,
  pendingJobs: 0,
  feeds: [],
};

const feedHealth = new Map<string, FeedHealth>();

let scanTimer: ReturnType<typeof setInterval> | null = null;
let scanInFlight = false;

function pipelineConfigPath(): string {
  const configPath = join(PIPELINE_DIR, "config.yaml");
  if (existsSync(configPath)) return configPath;
  return join(PIPELINE_DIR, "config.example.yaml");
}

function parseFeedEntry(entry: unknown): RssFeed | null {
  if (typeof entry === "string") {
    const url = entry.trim();
    return url ? { url, name: url, status: "green" } : null;
  }
  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    const url = String(obj.url ?? "").trim();
    if (!url) return null;
    const name = String(obj.name ?? url).trim() || url;
    const st = String(obj.status ?? "green").toLowerCase();
    const status: FeedStatus = st === "yellow" || st === "red" ? st : "green";
    return { url, name, status };
  }
  return null;
}

export function loadRssConfig(): RssScannerConfig | null {
  const path = pipelineConfigPath();
  if (!existsSync(path)) return null;
  try {
    const raw = parseYaml(readFileSync(path, "utf8")) as Record<string, unknown>;
    const rss = (raw.rss ?? {}) as Record<string, unknown>;
    const telegram = (raw.telegram ?? {}) as Record<string, unknown>;
    const feedsRaw = rss.feeds ?? (rss.url ? [{ url: rss.url, name: "default" }] : []);
    const feeds = (Array.isArray(feedsRaw) ? feedsRaw : [])
      .map(parseFeedEntry)
      .filter((f): f is RssFeed => f !== null);
    const keywords = stringList(rss.keywords);
    const blacklist = stringList(rss.blacklist);
    const intervalMinutes = Number(
      rss.scan_interval_minutes ?? rss.poll_minutes ?? 30,
    );
    if (!feeds.length) return null;
    return {
      feeds,
      keywords,
      blacklist,
      scanIntervalMinutes: Number.isFinite(intervalMinutes) && intervalMinutes > 0
        ? intervalMinutes
        : 30,
      telegramBotToken: String(telegram.bot_token ?? ""),
    };
  } catch (e) {
    console.error("[rss] config load failed:", e);
    return null;
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function rssLogDir(): string {
  const dir = dataPath("pipeline", "logs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function logRss(line: string): void {
  const ts = new Date().toISOString();
  const msg = `${ts} ${line}`;
  console.error(`[rss] ${line}`);
  try {
    appendFileSync(join(rssLogDir(), "rss.log"), msg + "\n", "utf8");
  } catch {
    /* ignore */
  }
}

function dbPath(): string {
  const dir = dataPath("pipeline");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "rss_seen.db");
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(dbPath());
    db.exec(`
      CREATE TABLE IF NOT EXISTS seen_items (
        dedup_key TEXT PRIMARY KEY,
        title TEXT,
        link TEXT,
        feed_url TEXT,
        feed_name TEXT,
        matched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scanner_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    try {
      db.exec("ALTER TABLE seen_items ADD COLUMN feed_name TEXT");
    } catch { /* exists */ }
  }
  return db;
}

function getScannerState(key: string, fallback: string): string {
  const row = getDb().prepare("SELECT value FROM scanner_state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

function setScannerState(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO scanner_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

function countSeen(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM seen_items").get() as { n: number };
  return row.n;
}

function isSeen(dedupKey: string): boolean {
  initDb();
  if (getDb().prepare("SELECT 1 FROM seen_items WHERE dedup_key = ?").get(dedupKey)) return true;
  return !!getDb().prepare("SELECT 1 FROM pending_jobs WHERE dedup_key = ?").get(dedupKey);
}

let jobTrackerTimer: ReturnType<typeof setInterval> | null = null;

function initDb(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS pending_jobs (
      dedup_key TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      title TEXT,
      link TEXT,
      feed_url TEXT,
      feed_name TEXT,
      queued_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function countPendingJobs(): number {
  initDb();
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM pending_jobs").get() as { n: number };
  return row.n;
}

function markPending(
  dedupKey: string,
  jobId: string,
  title: string,
  link: string,
  feed: RssFeed,
): void {
  initDb();
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO pending_jobs
       (dedup_key, job_id, title, link, feed_url, feed_name, queued_at, attempts)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(dedupKey, jobId, title, link, feed.url, feed.name, new Date().toISOString());
  status.pendingJobs = countPendingJobs();
}

function markSeen(dedupKey: string, title: string, link: string, feed: RssFeed): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO seen_items (dedup_key, title, link, feed_url, feed_name, matched_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(dedupKey, title, link, feed.url, feed.name, new Date().toISOString());
}

function markSeenFromPending(dedupKey: string, title: string, link: string, feedUrl: string, feedName: string): void {
  markSeen(dedupKey, title, link, { url: feedUrl, name: feedName, status: "green" });
  getDb().prepare("DELETE FROM pending_jobs WHERE dedup_key = ?").run(dedupKey);
  status.pendingJobs = countPendingJobs();
}

async function pollPendingJobs(): Promise<void> {
  initDb();
  const auto = loadAutomationConfig();
  const rows = getDb()
    .prepare("SELECT dedup_key, job_id, title, link, feed_url, feed_name, attempts FROM pending_jobs")
    .all() as Array<{
      dedup_key: string;
      job_id: string;
      title: string;
      link: string;
      feed_url: string;
      feed_name: string;
      attempts: number;
    }>;

  for (const row of rows) {
    try {
      const job = await fetchWorkerJobStatus(row.job_id);
      const st = String(job.status ?? "");
      if (st === "complete" || job.duplicate) {
        markSeenFromPending(row.dedup_key, row.title, row.link, row.feed_url, row.feed_name);
        logRss(`Job complete: ${row.title.slice(0, 80)}`);
      } else if (st === "failed") {
        const nextAttempts = row.attempts + 1;
        if (nextAttempts >= auto.maxJobRetries) {
          markSeenFromPending(row.dedup_key, row.title, row.link, row.feed_url, row.feed_name);
          logRss(`Job failed permanently: ${row.title.slice(0, 60)} — ${String(job.error ?? "")}`);
        } else {
          getDb()
            .prepare("UPDATE pending_jobs SET attempts = ? WHERE dedup_key = ?")
            .run(nextAttempts, row.dedup_key);
          try {
            const re = await pipelineIngest(row.link, row.title);
            const newId = String(re.job_id ?? "");
            if (newId) {
              markPending(row.dedup_key, newId, row.title, row.link, {
                url: row.feed_url,
                name: row.feed_name,
                status: "green",
              });
            }
          } catch (e) {
            logRss(`Retry queue failed: ${e instanceof Error ? e.message : e}`);
          }
        }
      }
    } catch (e) {
      logRss(`Job poll error ${row.job_id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  status.pendingJobs = countPendingJobs();
}

export function startJobTracker(): void {
  if (jobTrackerTimer) return;
  const auto = loadAutomationConfig();
  const ms = auto.jobPollIntervalSeconds * 1000;
  logRss(`Job tracker starting — poll every ${auto.jobPollIntervalSeconds}s`);
  void pollPendingJobs();
  jobTrackerTimer = setInterval(() => { void pollPendingJobs(); }, ms);
}

function dedupKey(guid: string | undefined, link: string): string {
  if (guid?.trim()) return guid.trim();
  return createHash("sha256").update(link).digest("hex").slice(0, 32);
}

function titleMatchesFilters(title: string, keywords: string[], blacklist: string[]): boolean {
  const lower = title.toLowerCase();
  if (blacklist.some((term) => lower.includes(term.toLowerCase()))) return false;
  if (!keywords.length) return true;
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function initFeedHealth(feed: RssFeed): FeedHealth {
  const h: FeedHealth = {
    name: feed.name,
    url: feed.url,
    status: feed.status,
    scheme: feedScheme(feed.url),
    lastError: null,
    lastItemCount: 0,
  };
  feedHealth.set(feed.url, h);
  return h;
}

async function processItems(
  feed: RssFeed,
  items: DiscoveryItem[],
  cfg: RssScannerConfig,
  ingestBudget: { remaining: number },
): Promise<number> {
  let newMatches = 0;
  const health = feedHealth.get(feed.url) ?? initFeedHealth(feed);
  health.lastItemCount = items.length;

  for (const item of items) {
    if (ingestBudget.remaining <= 0) break;
    const title = item.title.trim();
    if (!title) continue;
    if (!titleMatchesFilters(title, cfg.keywords, cfg.blacklist)) continue;

    const link = item.link.trim();
    if (!link) continue;
    if (!isIngestableUrl(link)) {
      logRss(`Match skipped (not torrent URL): [${feed.name}] ${title.slice(0, 80)}`);
      continue;
    }

    const key = dedupKey(item.guid, link);
    if (isSeen(key)) continue;

    logRss(`Match: [${feed.name}] ${title.slice(0, 120)} → ${link.slice(0, 80)}…`);
    try {
      const result = await pipelineIngest(link, title);
      if (result.duplicate) {
        markSeen(key, title, link, feed);
        continue;
      }
      const jobId = String(result.job_id ?? "");
      if (!jobId) throw new Error("No job_id from worker");
      markPending(key, jobId, title, link, feed);
      ingestBudget.remaining -= 1;
      newMatches += 1;
      recordFeedSuccess(feed.url, feed.name);
      logRss(`Queued job ${jobId}: ${JSON.stringify(result)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      recordFeedFailure(feed.url, feed.name, msg);
      status.lastScanErrors.push(`[${feed.name}] ${title.slice(0, 60)}: ${msg}`);
      logRss(`Ingest failed: [${feed.name}] ${title.slice(0, 80)} — ${msg}`);
    }
  }
  return newMatches;
}

async function scanOnce(): Promise<void> {
  if (scanInFlight) return;
  scanInFlight = true;
  status.scanning = true;
  status.lastScanNewMatches = 0;
  status.lastScanErrors = [];

  const cfg = loadRssConfig();
  if (!cfg) {
    status.enabled = false;
    status.scanning = false;
    scanInFlight = false;
    status.lastScanErrors = ["RSS not configured (rss.feeds empty or config missing)"];
    return;
  }

  status.enabled = true;
  status.keywordCount = cfg.keywords.length;
  status.blacklistCount = cfg.blacklist.length;
  status.intervalMinutes = cfg.scanIntervalMinutes;

  const healed = await healDownFeeds(cfg.feeds);
  const feedByUrl = new Map(cfg.feeds.map((f) => [f.url, f]));
  const activeFeeds: RssFeed[] = healed.map((h) => {
    const base = feedByUrl.get(h.url);
    const st = h.status === "yellow" || h.status === "red" ? h.status : "green";
    return {
      url: h.url,
      name: h.name,
      status: st as FeedStatus,
    };
  }).filter(isFeedActive);
  status.feedCount = activeFeeds.length;

  for (const feed of activeFeeds) initFeedHealth(feed);

  logRss(
    `Scan start — ${activeFeeds.length} feed(s) (${healed.length} configured), ${cfg.keywords.length} keyword(s), ${cfg.blacklist.length} blacklist term(s)`,
  );
  let newMatches = 0;
  const auto = loadAutomationConfig();
  const ingestBudget = { remaining: auto.maxIngestsPerScan };

  const tgFeeds = activeFeeds.filter((f) => feedScheme(f.url) === "telegram");

  if (tgFeeds.length) {
    try {
      const lastId = Number(getScannerState("tg_last_update_id", "0"));
      const { items, nextUpdateId } = await fetchTelegramItems(
        tgFeeds,
        cfg.telegramBotToken,
        lastId,
      );
      setScannerState("tg_last_update_id", String(nextUpdateId));
      for (const feed of tgFeeds) {
        const feedItems = items.filter((i) => i.feedName === feed.name);
        const health = feedHealth.get(feed.url)!;
        try {
          if (feedItems.length) recordFeedSuccess(feed.url, feed.name);
          newMatches += await processItems(feed, feedItems, cfg, ingestBudget);
          health.lastError = null;
          health.status = "green";
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          recordFeedFailure(feed.url, feed.name, msg);
          health.lastError = msg;
          health.status = "red";
          status.lastScanErrors.push(`[${feed.name}] ${msg}`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      for (const feed of tgFeeds) {
        const health = feedHealth.get(feed.url)!;
        recordFeedFailure(feed.url, feed.name, msg);
        health.lastError = msg;
        health.status = "red";
      }
      status.lastScanErrors.push(`[telegram] ${msg}`);
      logRss(`Telegram listener error: ${msg}`);
    }
  }

  for (const feed of activeFeeds) {
    const scheme = feedScheme(feed.url);
    if (scheme === "telegram") continue;

    const health = feedHealth.get(feed.url)!;
    try {
      logRss(`Fetching feed: ${feed.name} (${feed.url}) [${feed.status}/${scheme}]`);
      let items: DiscoveryItem[] = [];
      if (scheme === "rss") items = await fetchRssItems(feed.url);
      else if (scheme === "scraper") items = await fetchScraperItems(feed.url);
      recordFeedSuccess(feed.url, feed.name);
      health.status = "green";
      newMatches += await processItems(feed, items, cfg, ingestBudget);
      health.lastError = null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const rec = recordFeedFailure(feed.url, feed.name, msg);
      health.lastError = msg;
      health.status = rec.state;
      status.lastScanErrors.push(`[${feed.name}] ${feed.url}: ${msg}`);
      logRss(`Feed error [${feed.name}] ${feed.url}: ${msg}`);
    }
  }

  status.lastScanAt = new Date().toISOString();
  status.lastScanNewMatches = newMatches;
  status.totalSeen = countSeen();
  status.feeds = activeFeeds.map((f) => feedHealth.get(f.url) ?? initFeedHealth(f));
  status.scanning = false;
  scanInFlight = false;
  logRss(`Scan complete — ${newMatches} new match(es), ${status.totalSeen} total seen`);
}

export function getRssScannerStatus(): RssScannerStatus {
  const cfg = loadRssConfig();
  if (cfg) {
    status.enabled = true;
    status.feedCount = cfg.feeds.length;
    status.keywordCount = cfg.keywords.length;
    status.blacklistCount = cfg.blacklist.length;
    status.intervalMinutes = cfg.scanIntervalMinutes;
    status.feeds = cfg.feeds.map((f) => feedHealth.get(f.url) ?? initFeedHealth(f));
  }
  status.totalSeen = countSeen();
  status.pendingJobs = countPendingJobs();
  return { ...status };
}

export function relayRssEnabled(): boolean {
  if (process.env.PIPELINE_RELAY_RSS === "true") return true;
  if (process.env.PIPELINE_RELAY_RSS === "false") return false;
  const auto = loadAutomationConfig();
  // Discovery on relay when worker is not configured (local dev fallback)
  if (!workerConfigured()) return true;
  return auto.relayRssEnabled;
}

export function startRssScanner(): void {
  if (scanTimer) return;
  if (!relayRssEnabled()) {
    console.error("[rss] Relay RSS disabled — worker runs discovery (automation.discovery_on_worker)");
    status.enabled = false;
    return;
  }
  const cfg = loadRssConfig();
  if (!cfg) {
    console.error("[rss] Scanner disabled — no rss.feeds in pipeline config");
    status.enabled = false;
    return;
  }
  const ms = cfg.scanIntervalMinutes * 60_000;
  console.error(
    `[rss] Scanner starting — every ${cfg.scanIntervalMinutes} min, ${cfg.feeds.length} feed(s)`,
  );
  void scanOnce();
  scanTimer = setInterval(() => { void scanOnce(); }, ms);
}

export function stopRssScanner(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}

/** Trigger one RSS/discovery scan (used by master pipeline). */
export async function runRssScanOnce(): Promise<void> {
  await scanOnce();
}
