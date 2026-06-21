/** Unified discovery item from RSS, scrapers, or Telegram listeners. */

export interface DiscoveryItem {
  title: string;
  link: string;
  guid?: string;
  feedName?: string;
}

export type FeedStatus = "green" | "yellow" | "red";

export interface ConfiguredFeed {
  url: string;
  name: string;
  status?: FeedStatus;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function feedScheme(url: string): "rss" | "scraper" | "telegram" {
  if (url.startsWith("scraper://")) return "scraper";
  if (url.startsWith("tg://")) return "telegram";
  return "rss";
}

export function isFeedActive(feed: ConfiguredFeed): boolean {
  return feed.status !== "red";
}

export function isIngestableUrl(link: string): boolean {
  if (link.startsWith("magnet:")) return true;
  if (link.startsWith("tgfile://")) return true;
  if (!/^https?:\/\//i.test(link)) return false;
  const lower = link.toLowerCase();
  return (
    lower.endsWith(".torrent")
    || lower.includes("/d/")
    || lower.includes("download.php")
    || lower.includes("download.php?")
    || lower.includes("torrent")
  );
}

function extractMagnetsFromText(text: string): string[] {
  const magnets = text.match(/magnet:\?[^\s"'<>]+/gi) ?? [];
  return [...new Set(magnets)];
}

function extractTorrentUrlsFromHtml(html: string): string[] {
  const urls = new Set<string>();
  for (const m of html.match(/https?:\/\/[^\s"'<>]+\.torrent/gi) ?? []) urls.add(m);
  for (const m of html.match(/https?:\/\/[^\s"'<>]*\/d\/[^\s"'<>]+/gi) ?? []) urls.add(m);
  return [...urls];
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,*/*" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchXml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Status code ${res.status}`);
  return res.text();
}

export async function fetchRssItems(url: string): Promise<DiscoveryItem[]> {
  const Parser = (await import("rss-parser")).default;
  const parser = new Parser();
  const xml = await fetchXml(url);
  const feed = await parser.parseString(xml);
  const items: DiscoveryItem[] = [];
  for (const item of feed.items ?? []) {
    const title = item.title?.trim() ?? "";
    if (!title) continue;
    const raw = item as { enclosure?: { url?: string }; enclosures?: { url?: string }[]; guid?: string; id?: string };
    let link = "";
    if (item.enclosure?.url) link = item.enclosure.url.trim();
    else if (Array.isArray(raw.enclosures)) {
      for (const enc of raw.enclosures) {
        if (enc.url?.trim()) {
          link = enc.url.trim();
          break;
        }
      }
    }
    if (!link) link = item.link?.trim() ?? "";
    if (!link) continue;
    items.push({
      title,
      link,
      guid: item.guid ?? raw.id ?? link,
    });
  }
  return items;
}

async function scrapeGenericListPage(pageUrl: string, linkPattern: RegExp): Promise<DiscoveryItem[]> {
  const html = await fetchHtml(pageUrl);
  const items: DiscoveryItem[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(linkPattern)) {
    const href = match[1];
    const title = (match[2] ?? href).replace(/<[^>]+>/g, "").trim();
    if (!title || seen.has(href)) continue;
    seen.add(href);
    const absolute = href.startsWith("http") ? href : new URL(href, pageUrl).href;
    items.push({ title, link: absolute, guid: absolute });
  }
  return items;
}

async function scrapeDramacool(path: string): Promise<DiscoveryItem[]> {
  const base = "https://dramacool.com.sg";
  const pageUrl = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const listing = await scrapeGenericListPage(
    pageUrl,
    /<a[^>]+href="(\/[^"]+)"[^>]*title="([^"]+)"/gi,
  );
  const items: DiscoveryItem[] = [];
  for (const entry of listing.slice(0, 20)) {
    try {
      const detailUrl = entry.link.startsWith("http") ? entry.link : `${base}${entry.link}`;
      const html = await fetchHtml(detailUrl);
      const magnet = extractMagnetsFromText(html)[0];
      const torrent = extractTorrentUrlsFromHtml(html)[0];
      const link = magnet ?? torrent;
      if (link) items.push({ title: entry.title, link, guid: detailUrl });
    } catch {
      /* skip detail page failures */
    }
  }
  return items;
}

async function scrapeBdmusic23(path: string): Promise<DiscoveryItem[]> {
  const base = "https://bdmusic23.site";
  const pageUrl = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const html = await fetchHtml(pageUrl);
  const items: DiscoveryItem[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{4,120})<\/a>/gi)) {
    const href = match[1];
    const title = match[2].trim();
    if (!title || seen.has(href)) continue;
    if (!/video|movie|natok|episode/i.test(href + title)) continue;
    seen.add(href);
    const detailUrl = href.startsWith("http") ? href : new URL(href, base).href;
    try {
      const detailHtml = await fetchHtml(detailUrl);
      const magnet = extractMagnetsFromText(detailHtml)[0];
      if (magnet) items.push({ title, link: magnet, guid: detailUrl });
    } catch {
      /* skip */
    }
  }
  return items;
}

export async function fetchScraperItems(url: string): Promise<DiscoveryItem[]> {
  const inner = url.replace(/^scraper:\/\//, "");
  const [host, ...rest] = inner.split("/");
  const path = rest.length ? `/${rest.join("/")}` : "/";
  const hostLower = host.toLowerCase();
  if (hostLower.includes("dramacool")) return scrapeDramacool(path || "/latest");
  if (hostLower.includes("bdmusic23")) return scrapeBdmusic23(path || "/video");
  throw new Error(`No scraper registered for host: ${host}`);
}

export function parseTelegramChatId(url: string): string {
  const m = url.match(/^tg:\/\/group\/(-?\d+)/);
  if (!m) throw new Error(`Invalid tg feed URL: ${url}`);
  return m[1];
}

export function telegramChatMatches(messageChatId: number, configuredId: string): boolean {
  const cfg = configuredId.trim();
  if (String(messageChatId) === cfg) return true;
  if (String(-Math.abs(Number(cfg))) === String(messageChatId)) return true;
  return String(messageChatId).endsWith(cfg);
}

export async function fetchTelegramItems(
  feeds: ConfiguredFeed[],
  botToken: string,
  lastUpdateId: number,
): Promise<{ items: DiscoveryItem[]; nextUpdateId: number }> {
  if (!botToken || botToken.startsWith("YOUR_")) {
    throw new Error("Telegram bot_token not configured for tg:// feeds");
  }
  const tgFeeds = feeds.filter((f) => f.url.startsWith("tg://"));
  if (!tgFeeds.length) return { items: [], nextUpdateId: lastUpdateId };

  const api = `https://api.telegram.org/bot${botToken}`;
  const res = await fetch(`${api}/getUpdates?offset=${lastUpdateId + 1}&timeout=10`, {
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json()) as {
    ok: boolean;
    result?: Array<{
      update_id: number;
      message?: TgMessage;
      channel_post?: TgMessage;
    }>;
    description?: string;
  };
  if (!data.ok) throw new Error(data.description ?? "Telegram getUpdates failed");

  const items: DiscoveryItem[] = [];
  let nextUpdateId = lastUpdateId;
  for (const update of data.result ?? []) {
    nextUpdateId = Math.max(nextUpdateId, update.update_id);
    const msg = update.message ?? update.channel_post;
    if (!msg) continue;
    const chatId = msg.chat.id;
    const feed = tgFeeds.find((f) => telegramChatMatches(chatId, parseTelegramChatId(f.url)));
    if (!feed) continue;
    const text = (msg.text ?? msg.caption ?? "").trim();
    const title = text.split("\n")[0].slice(0, 200) || feed.name;

    if (msg.video || msg.document) {
      items.push({
        title,
        link: `tgfile://${chatId}/${msg.message_id}`,
        guid: `tgmedia:${update.update_id}:${msg.message_id}`,
        feedName: feed.name,
      });
      continue;
    }

    if (!text) continue;
    const magnets = extractMagnetsFromText(text);
    for (const magnet of magnets) {
      items.push({
        title,
        link: magnet,
        guid: `${update.update_id}:${magnet.slice(0, 40)}`,
        feedName: feed.name,
      });
    }
  }
  return { items, nextUpdateId };
}

interface TgMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  caption?: string;
  video?: { file_id: string };
  document?: { file_id: string };
}
