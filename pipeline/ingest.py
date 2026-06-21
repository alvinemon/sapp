"""Step 1: Monitor RSS feed and enqueue matching torrents in qBittorrent."""

from __future__ import annotations

import hashlib
from typing import Any

import feedparser
import httpx
from qbittorrentapi import Client

from common import load_config, read_json, setup_logger, utc_now_iso, write_json
from qbittorrent_client import qbittorrent_settings


def _seen_key(link: str) -> str:
    return hashlib.sha256(link.encode()).hexdigest()[:16]


def run_ingest(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or load_config()
    log = setup_logger("ingest", cfg)
    state_path = cfg["paths"]["state"]
    state = read_json(state_path, {"seen_rss": [], "last_ingest": None})
    seen: set[str] = set(state.get("seen_rss", []))

    rss_cfg = cfg.get("rss", {})
    rss_url = rss_cfg.get("url")
    if not rss_url:
        feeds = rss_cfg.get("feeds") or []
        if feeds:
            first = feeds[0]
            rss_url = first.get("url") if isinstance(first, dict) else str(first)
    if not rss_url:
        return {"ok": False, "error": "rss.url or rss.feeds not configured", "added": 0}
    keywords = [k.lower() for k in rss_cfg.get("keywords", [])]
    blacklist = [b.lower() for b in rss_cfg.get("blacklist", [])]
    log.info("Fetching RSS: %s", rss_url)

    try:
        resp = httpx.get(rss_url, timeout=60, follow_redirects=True)
        resp.raise_for_status()
        feed = feedparser.parse(resp.text)
    except Exception as e:
        log.error("RSS fetch failed: %s", e)
        return {"ok": False, "error": str(e), "added": 0}

    base, username, password, category = qbittorrent_settings(cfg)
    qbt = Client(host=base, username=username, password=password)
    added = 0

    for entry in feed.entries:
        title = getattr(entry, "title", "") or ""
        lower_title = title.lower()
        if blacklist and any(term in lower_title for term in blacklist):
            continue
        if keywords and not any(kw in lower_title for kw in keywords):
            continue

        link = None
        for enc in getattr(entry, "enclosures", []) or []:
            href = enc.get("href") or enc.get("url")
            if href and (href.endswith(".torrent") or "magnet:" in href or "torrent" in enc.get("type", "")):
                link = href
                break
        if not link:
            link = getattr(entry, "link", None)

        if not link:
            continue

        key = _seen_key(link)
        if key in seen:
            continue

        try:
            qbt.torrents_add(urls=link, category=category, is_paused=False)
            seen.add(key)
            added += 1
            log.info("Queued: %s", title[:80])
        except Exception as e:
            log.warning("Failed to add torrent %s: %s", title[:40], e)

    state["seen_rss"] = list(seen)[-5000:]
    state["last_ingest"] = utc_now_iso()
    write_json(state_path, state)
    log.info("Ingest complete — %d new torrent(s)", added)
    return {"ok": True, "added": added}


if __name__ == "__main__":
    run_ingest()
