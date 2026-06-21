"""Worker-side RSS/Telegram discovery — runs on Render even when relay sleeps."""

from __future__ import annotations

import hashlib
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import feedparser
import httpx
from bs4 import BeautifulSoup

from common import load_config, setup_logger
from job_queue import JobQueue, QUEUE


def _automation(cfg: dict[str, Any]) -> dict[str, Any]:
    return cfg.get("automation") or {}


def _dedup_db(cfg: dict[str, Any]) -> Path:
    root = Path(cfg["paths"]["data_root"])
    root.mkdir(parents=True, exist_ok=True)
    return root / "discovery_seen.db"


def _is_seen(cfg: dict[str, Any], key: str) -> bool:
    conn = sqlite3.connect(str(_dedup_db(cfg)))
    conn.execute("CREATE TABLE IF NOT EXISTS seen (dedup_key TEXT PRIMARY KEY, matched_at REAL)")
    row = conn.execute("SELECT 1 FROM seen WHERE dedup_key = ?", (key,)).fetchone()
    conn.close()
    return row is not None


def _mark_seen(cfg: dict[str, Any], key: str) -> None:
    conn = sqlite3.connect(str(_dedup_db(cfg)))
    conn.execute("CREATE TABLE IF NOT EXISTS seen (dedup_key TEXT PRIMARY KEY, matched_at REAL)")
    conn.execute("INSERT OR IGNORE INTO seen (dedup_key, matched_at) VALUES (?, ?)", (key, time.time()))
    conn.commit()
    conn.close()


def _title_ok(title: str, keywords: list[str], blacklist: list[str]) -> bool:
    lower = title.lower()
    if any(term.lower() in lower for term in blacklist):
        return False
    if not keywords:
        return True
    return any(kw.lower() in lower for kw in keywords)


def _ingestable(link: str) -> bool:
    if link.startswith("magnet:") or link.startswith("tgfile://"):
        return True
    if not link.startswith("http"):
        return False
    lower = link.lower()
    return (
        lower.endswith(".torrent")
        or "/d/" in lower
        or "download.php" in lower
        or "torrent" in lower
    )


def _extract_magnets(text: str) -> list[str]:
    return re.findall(r"magnet:\?[^\s<>\"']+", text)


def _fetch_rss(url: str) -> list[dict[str, str]]:
    with httpx.Client(timeout=45.0, follow_redirects=True) as client:
        resp = client.get(url, headers={"User-Agent": "2hotatl-pipeline/1.0"})
        resp.raise_for_status()
        parsed = feedparser.parse(resp.content)
    items: list[dict[str, str]] = []
    for entry in parsed.entries or []:
        title = str(getattr(entry, "title", "") or "").strip()
        link = str(getattr(entry, "link", "") or "").strip()
        guid = str(getattr(entry, "id", "") or getattr(entry, "guid", "") or link).strip()
        if not title:
            continue
        if not link and getattr(entry, "links", None):
            for l in entry.links:
                href = str(l.get("href", ""))
                if href.startswith("magnet:"):
                    link = href
                    break
        if link:
            items.append({"title": title, "link": link, "guid": guid})
    return items


def _fetch_html(url: str) -> str:
    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        resp = client.get(url, headers={"User-Agent": "2hotatl-pipeline/1.0"})
        resp.raise_for_status()
        return resp.text


def _scrape_dramacool(path: str) -> list[dict[str, str]]:
    base = "https://dramacool.com.sg"
    page_url = f"{base}{path if path.startswith('/') else '/' + path}"
    html = _fetch_html(page_url)
    soup = BeautifulSoup(html, "html.parser")
    items: list[dict[str, str]] = []
    seen: set[str] = set()
    for a in soup.select('a[href][title]')[:20]:
        href = str(a.get("href", "")).strip()
        title = str(a.get("title", "")).strip()
        if not href or not title or href in seen:
            continue
        seen.add(href)
        detail_url = href if href.startswith("http") else urljoin(base, href)
        try:
            detail_html = _fetch_html(detail_url)
            magnets = _extract_magnets(detail_html)
            torrents = re.findall(r"https?://[^\s\"'<>]+\.torrent", detail_html, re.I)
            link = magnets[0] if magnets else (torrents[0] if torrents else "")
            if link:
                items.append({"title": title, "link": link, "guid": detail_url})
        except Exception:
            continue
    return items


def _scrape_bdmusic23(path: str) -> list[dict[str, str]]:
    base = "https://bdmusic23.site"
    page_url = f"{base}{path if path.startswith('/') else '/' + path}"
    html = _fetch_html(page_url)
    soup = BeautifulSoup(html, "html.parser")
    items: list[dict[str, str]] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = str(a["href"]).strip()
        title = a.get_text(strip=True)
        if len(title) < 4 or len(title) > 120 or href in seen:
            continue
        if not re.search(r"video|movie|natok|episode", href + title, re.I):
            continue
        seen.add(href)
        detail_url = href if href.startswith("http") else urljoin(base, href)
        try:
            detail_html = _fetch_html(detail_url)
            magnets = _extract_magnets(detail_html)
            if magnets:
                items.append({"title": title, "link": magnets[0], "guid": detail_url})
        except Exception:
            continue
    return items


def _fetch_scraper(url: str) -> list[dict[str, str]]:
    inner = url.replace("scraper://", "")
    host, _, rest = inner.partition("/")
    path = f"/{rest}" if rest else "/"
    host_lower = host.lower()
    if "dramacool" in host_lower:
        return _scrape_dramacool(path or "/latest")
    if "bdmusic23" in host_lower:
        return _scrape_bdmusic23(path or "/video")
    raise ValueError(f"No scraper registered for host: {host}")


def _parse_tg_chat_id(url: str) -> str:
    m = re.match(r"^tg://group/(-?\d+)", url)
    if not m:
        raise ValueError(f"Invalid tg feed URL: {url}")
    return m.group(1)


def _tg_chat_matches(message_chat_id: int, configured_id: str) -> bool:
    cfg = configured_id.strip()
    if str(message_chat_id) == cfg:
        return True
    if str(-abs(int(cfg))) == str(message_chat_id):
        return True
    return str(message_chat_id).endswith(cfg)


def _fetch_telegram(cfg: dict[str, Any], feeds: list[Any], last_update_id: int) -> tuple[list[dict[str, str]], int]:
    token = str((cfg.get("telegram") or {}).get("bot_token", "")).strip()
    if not token or token.startswith("YOUR_"):
        raise ValueError("Telegram bot_token not configured for tg:// feeds")
    tg_feeds = []
    for feed in feeds:
        url = feed if isinstance(feed, str) else str(feed.get("url", ""))
        if url.startswith("tg://"):
            tg_feeds.append(feed)
    if not tg_feeds:
        return [], last_update_id

    api = f"https://api.telegram.org/bot{token}"
    with httpx.Client(timeout=35.0) as client:
        resp = client.get(f"{api}/getUpdates", params={"offset": last_update_id + 1, "timeout": 10})
        resp.raise_for_status()
        data = resp.json()
    if not data.get("ok"):
        raise ValueError(str(data.get("description", "Telegram getUpdates failed")))

    items: list[dict[str, str]] = []
    next_id = last_update_id
    for update in data.get("result") or []:
        next_id = max(next_id, int(update.get("update_id", 0)))
        msg = update.get("message") or update.get("channel_post")
        if not msg:
            continue
        chat_id = int((msg.get("chat") or {}).get("id", 0))
        feed = None
        feed_name = "telegram"
        for f in tg_feeds:
            url = f if isinstance(f, str) else str(f.get("url", ""))
            name = url if isinstance(f, str) else str(f.get("name", url))
            if _tg_chat_matches(chat_id, _parse_tg_chat_id(url)):
                feed = f
                feed_name = name
                break
        if not feed:
            continue
        text = str(msg.get("text") or msg.get("caption") or "").strip()
        title = (text.split("\n")[0] if text else feed_name)[:200]
        if msg.get("video") or msg.get("document"):
            items.append({
                "title": title,
                "link": f"tgfile://{chat_id}/{msg.get('message_id')}",
                "guid": f"tgmedia:{update.get('update_id')}:{msg.get('message_id')}",
                "feed_name": feed_name,
            })
            continue
        for magnet in _extract_magnets(text):
            items.append({
                "title": title,
                "link": magnet,
                "guid": f"{update.get('update_id')}:{magnet[:40]}",
                "feed_name": feed_name,
            })
    return items, next_id


def _tg_state_path(cfg: dict[str, Any]) -> Path:
    root = Path(cfg["paths"]["data_root"])
    root.mkdir(parents=True, exist_ok=True)
    return root / "tg_last_update_id.txt"


def _read_tg_offset(cfg: dict[str, Any]) -> int:
    path = _tg_state_path(cfg)
    if not path.exists():
        return 0
    try:
        return int(path.read_text().strip() or "0")
    except ValueError:
        return 0


def _write_tg_offset(cfg: dict[str, Any], offset: int) -> None:
    _tg_state_path(cfg).write_text(str(offset))


def _scan_once(cfg: dict[str, Any], queue: JobQueue) -> int:
    log = setup_logger("discovery", cfg)
    rss = cfg.get("rss") or {}
    feeds = rss.get("feeds") or []
    keywords = [str(k) for k in (rss.get("keywords") or [])]
    blacklist = [str(k) for k in (rss.get("blacklist") or [])]
    max_per_scan = int(_automation(cfg).get("max_ingests_per_scan", 5))
    queued = 0

    for feed in feeds:
        if queued >= max_per_scan:
            break
        if isinstance(feed, str):
            url, name, status = feed, feed, "green"
        else:
            url = str(feed.get("url", "")).strip()
            name = str(feed.get("name", url))
            status = str(feed.get("status", "green")).lower()
        if not url or status == "red":
            continue
        if url.startswith("scraper://") or url.startswith("tg://"):
            continue

        try:
            items = _fetch_rss(url)
        except Exception as e:
            log.warning("Feed %s failed: %s", name, e)
            continue

        queued += _queue_items(items, name, cfg, queue, keywords, blacklist, max_per_scan - queued, log)

    scraper_feeds = [
        f for f in feeds
        if (f if isinstance(f, str) else str(f.get("url", ""))).startswith("scraper://")
        and (f if isinstance(f, str) else str(f.get("status", "green")).lower()) != "red"
    ]
    for feed in scraper_feeds:
        if queued >= max_per_scan:
            break
        if isinstance(feed, str):
            url, name = feed, feed
        else:
            url = str(feed.get("url", "")).strip()
            name = str(feed.get("name", url))
        try:
            items = _fetch_scraper(url)
            queued += _queue_items(items, name, cfg, queue, keywords, blacklist, max_per_scan - queued, log)
        except Exception as e:
            log.warning("Scraper %s failed: %s", name, e)

    tg_feeds = [
        f for f in feeds
        if (f if isinstance(f, str) else str(f.get("url", ""))).startswith("tg://")
        and (f if isinstance(f, str) else str(f.get("status", "green")).lower()) != "red"
    ]
    if tg_feeds and queued < max_per_scan:
        try:
            last_id = _read_tg_offset(cfg)
            items, next_id = _fetch_telegram(cfg, tg_feeds, last_id)
            if next_id > last_id:
                _write_tg_offset(cfg, next_id)
            for item in items:
                feed_name = item.pop("feed_name", "telegram")
                queued += _queue_items([item], feed_name, cfg, queue, keywords, blacklist, max_per_scan - queued, log)
                if queued >= max_per_scan:
                    break
        except Exception as e:
            log.warning("Telegram listener failed: %s", e)

    return queued


def _queue_items(
    items: list[dict[str, str]],
    name: str,
    cfg: dict[str, Any],
    queue: JobQueue,
    keywords: list[str],
    blacklist: list[str],
    budget: int,
    log: Any,
) -> int:
    queued = 0
    for item in items:
        if queued >= budget:
            break
        title = item["title"]
        link = item["link"]
        if not _title_ok(title, keywords, blacklist):
            continue
        if not _ingestable(link):
            continue
        key = item.get("guid") or hashlib.sha256(link.encode()).hexdigest()[:32]
        if _is_seen(cfg, key):
            continue

        result = queue.enqueue(cfg, link, title)
        if not result.get("ok"):
            if result.get("error") == "queue_full":
                log.warning("Queue full — pausing discovery")
                return queued
            if result.get("error") == "duplicate":
                _mark_seen(cfg, key)
            continue

        _mark_seen(cfg, key)
        queued += 1
        log.info("Queued [%s] %s", name, title[:80])
    return queued


class DiscoveryLoop:
    def __init__(self, queue: JobQueue) -> None:
        self._queue = queue
        self._running = False
        self._thread: threading.Thread | None = None

    def start(self, cfg: dict[str, Any]) -> None:
        auto = _automation(cfg)
        if not auto.get("discovery_on_worker", True):
            return
        if self._running:
            return
        self._running = True
        interval = float((cfg.get("rss") or {}).get("scan_interval_minutes", 30)) * 60
        log = setup_logger("discovery", cfg)

        def loop() -> None:
            log.info("Worker discovery loop started (interval %.0fs)", interval)
            while self._running:
                try:
                    c = load_config()
                    n = _scan_once(c, self._queue)
                    if n:
                        log.info("Discovery queued %d item(s)", n)
                except Exception as e:
                    log.error("Discovery scan error: %s", e)
                time.sleep(interval)

        self._thread = threading.Thread(target=loop, daemon=True, name="worker-discovery")
        self._thread.start()


DISCOVERY = DiscoveryLoop(QUEUE)
