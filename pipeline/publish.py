"""Build master catalogue and sync organized items (series grouped) to Node relay."""

from __future__ import annotations

import hashlib
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from common import load_config, read_json, setup_logger, slugify, utc_now_iso, write_json
from metadata import normalize_show_title, series_key


def _apply_early_access_rules(entry: dict[str, Any], cfg: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    auto_hours = int(cfg.get("early_access", {}).get("auto_hours", 72))
    uploaded_at = entry.get("uploaded_at", "")
    override = overrides.get(entry["id"], {})

    if "early_access" in override:
        entry["early_access"] = bool(override["early_access"])
    elif uploaded_at:
        try:
            dt = datetime.fromisoformat(uploaded_at.replace("Z", "+00:00"))
            age_h = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
            entry["early_access"] = age_h < auto_hours
        except ValueError:
            entry["early_access"] = True
    else:
        entry["early_access"] = True

    if override.get("early_access_until"):
        entry["early_access_until"] = override["early_access_until"]
    elif entry.get("early_access") and uploaded_at:
        try:
            dt = datetime.fromisoformat(uploaded_at.replace("Z", "+00:00"))
            from datetime import timedelta
            until = dt + timedelta(hours=auto_hours)
            entry["early_access_until"] = until.isoformat()
        except ValueError:
            pass

    return entry


def build_master_catalog(cfg: dict[str, Any]) -> dict[str, Any]:
    upload_log = read_json(cfg["paths"]["upload_log"], {"uploads": []})
    overrides = read_json(cfg["paths"]["state"], {}).get("early_access_overrides", {})
    items = []
    for u in upload_log.get("uploads", []):
        entry = _apply_early_access_rules(dict(u), cfg, overrides)
        items.append(
            {
                "id": entry["id"],
                "title": entry.get("title") or entry.get("show_title") or entry["id"],
                "show_title": entry.get("show_title") or entry.get("title"),
                "episode_title": entry.get("episode_title") or entry.get("title"),
                "series_key": entry.get("series_key") or series_key(entry.get("show_title") or entry.get("title", "")),
                "season": entry.get("season"),
                "episode": entry.get("episode"),
                "quality": entry.get("quality"),
                "languages": entry.get("languages", []),
                "year": entry.get("year"),
                "category": entry.get("category"),
                "description": entry.get("description"),
                "telegram_file_id": entry.get("telegram_file_id"),
                "telegram_file_ids": entry.get("telegram_file_ids", []),
                "thumb_file_id": entry.get("thumb_file_id"),
                "thumb_url": entry.get("thumb_url"),
                "subtitle_file_id": entry.get("subtitle_file_id"),
                "chunks": entry.get("chunks", 1),
                "uploaded_at": entry.get("uploaded_at"),
                "early_access": entry.get("early_access", False),
                "early_access_until": entry.get("early_access_until"),
                "source": "telegram",
            }
        )
    catalog = {
        "title": "2hotatl Telegram Library",
        "generated_at": utc_now_iso(),
        "items": items,
    }
    write_json(cfg["paths"]["master_catalog"], catalog)
    return catalog


def publish_to_dpaste(catalog: dict[str, Any], cfg: dict[str, Any], log) -> str | None:
    api = cfg["publication"]["dpaste_api"].rstrip("/") + "/"
    expiry = str(cfg["publication"].get("dpaste_expiry_days", 365))
    content = __import__("json").dumps(catalog, indent=2, ensure_ascii=False)
    try:
        resp = httpx.post(
            api,
            data={
                "content": content,
                "lexer": "json",
                "expires": expiry,
                "title": f"2hotatl-catalog-{utc_now_iso()[:10]}",
            },
            timeout=60,
        )
        resp.raise_for_status()
        url = resp.text.strip()
        if url.startswith("http"):
            Path = __import__("pathlib").Path
            Path(cfg["paths"]["catalog_public_url"]).write_text(url + ".json", encoding="utf-8")
            log.info("Published catalogue: %s", url)
            return url
    except Exception as e:
        log.error("dpaste publish failed: %s", e)
    return None


def _node_api_base(cfg: dict[str, Any]) -> str:
    return (
        os.environ.get("NODE_API_BASE", "").strip()
        or str(cfg.get("node", {}).get("api_base", "")).strip()
    ).rstrip("/")


def _default_price(cfg: dict[str, Any]) -> str:
    purchase = cfg.get("purchase") or {}
    if purchase.get("default_price") is not None:
        return str(purchase["default_price"])
    steps = (cfg.get("pricing") or {}).get("price_steps") or []
    if steps:
        return str(steps[len(steps) // 2])
    return "99"


def _catalog_urls(api_base: str, cid: str) -> tuple[str, str]:
    if not api_base.startswith("http"):
        return "", ""
    return f"{api_base}/api/catalog/thumb/{cid}", f"{api_base}/api/catalog/stream/{cid}"


def _added_at_ms(item: dict[str, Any]) -> int:
    uploaded = item.get("uploaded_at")
    if uploaded:
        try:
            return int(datetime.fromisoformat(str(uploaded).replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            pass
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _pick_thumb(group_items: list[dict[str, Any]]) -> tuple[str, str]:
    for it in sorted(group_items, key=lambda x: _added_at_ms(x), reverse=True):
        if it.get("thumb_url"):
            return "", str(it["thumb_url"])
        if it.get("thumb_file_id"):
            return str(it["thumb_file_id"]), ""
    return "", ""


def _episode_node(
    item: dict[str, Any],
    api_base: str,
    cid: str,
    is_early: bool,
    cfg: dict[str, Any],
) -> dict[str, Any]:
    _, stream_url = _catalog_urls(api_base, cid)
    ep_num = int(item.get("episode") or 0)
    ep_id = f"e{ep_num}" if ep_num else slugify(str(item.get("id", "ep")))[:16]
    ep_cid = f"{cid}/{ep_id}"
    _, ep_stream = _catalog_urls(api_base, ep_cid)
    return {
        "id": ep_id,
        "title": item.get("episode_title") or f"Episode {ep_num or ''}".strip(),
        "free": not is_early,
        "price": _default_price(cfg) if is_early else None,
        "currency": cfg.get("pricing", {}).get("currency", "BDT"),
        "methodIds": ["bkash", "nagad"],
        "url": ep_stream or stream_url,
        "telegramFileId": item.get("telegram_file_id"),
        "telegramFileIds": item.get("telegram_file_ids", []),
        "subtitleFileId": item.get("subtitle_file_id"),
    }


def _movie_item(
    item: dict[str, Any],
    cfg: dict[str, Any],
    api_base: str,
) -> dict[str, Any]:
    cid = f"tg_{hashlib.sha256(str(item['id']).encode()).hexdigest()[:12]}"
    is_early = bool(item.get("early_access"))
    thumb_url_path, stream_url = _catalog_urls(api_base, cid)
    thumb_file_id, external_thumb = _pick_thumb([item])
    thumb = external_thumb or thumb_url_path
    desc = item.get("description") or " ".join(
        filter(None, [item.get("quality"), " ".join(item.get("languages") or [])]),
    )
    return {
        "id": cid,
        "type": "movie",
        "title": item.get("show_title") or item.get("title") or cid,
        "description": desc.strip() or item.get("title", ""),
        "thumb": thumb,
        "thumbTelegramFileId": thumb_file_id or None,
        "free": not is_early,
        "price": _default_price(cfg) if is_early else None,
        "currency": cfg.get("pricing", {}).get("currency", "BDT"),
        "methodIds": ["bkash", "nagad"],
        "category": item.get("category") or "Movies",
        "year": item.get("year"),
        "url": stream_url,
        "addedAt": _added_at_ms(item),
        "telegramFileId": item.get("telegram_file_id"),
        "telegramFileIds": item.get("telegram_file_ids", []),
        "subtitleFileId": item.get("subtitle_file_id"),
        "earlyAccess": is_early,
        "earlyAccessUntil": item.get("early_access_until"),
        "source": "telegram",
    }


def _series_item(
    show_title: str,
    episodes: list[dict[str, Any]],
    cfg: dict[str, Any],
    api_base: str,
) -> dict[str, Any]:
    sk = series_key(show_title)
    cid = f"tg_{hashlib.sha256(sk.encode()).hexdigest()[:12]}"
    is_early = any(bool(e.get("early_access")) for e in episodes)
    thumb_url_path, stream_url = _catalog_urls(api_base, cid)
    thumb_file_id, external_thumb = _pick_thumb(episodes)
    thumb = external_thumb or thumb_url_path
    latest = max(episodes, key=_added_at_ms)
    desc = latest.get("description") or show_title
    category = latest.get("category") or "Series"

    seasons_map: dict[int, list[dict[str, Any]]] = {}
    for ep in episodes:
        sn = int(ep.get("season") or 1)
        seasons_map.setdefault(sn, []).append(ep)

    seasons = []
    for sn in sorted(seasons_map.keys()):
        eps = sorted(seasons_map[sn], key=lambda e: int(e.get("episode") or 0))
        season_eps = []
        for ep in eps:
            ep_early = bool(ep.get("early_access"))
            ep_cid = f"{cid}/s{sn}/e{int(ep.get('episode') or 0)}"
            _, ep_stream = _catalog_urls(api_base, ep_cid)
            season_eps.append(
                {
                    "id": f"e{int(ep.get('episode') or 0)}",
                    "title": ep.get("episode_title") or f"Episode {ep.get('episode')}",
                    "free": not ep_early,
                    "price": _default_price(cfg) if ep_early else None,
                    "currency": cfg.get("pricing", {}).get("currency", "BDT"),
                    "methodIds": ["bkash", "nagad"],
                    "url": ep_stream,
                    "telegramFileId": ep.get("telegram_file_id"),
                    "telegramFileIds": ep.get("telegram_file_ids", []),
                    "subtitleFileId": ep.get("subtitle_file_id"),
                }
            )
        seasons.append({"id": f"s{sn}", "name": f"Season {sn}", "episodes": season_eps})

    return {
        "id": cid,
        "type": "series",
        "title": show_title,
        "description": desc,
        "thumb": thumb,
        "thumbTelegramFileId": thumb_file_id or None,
        "free": not is_early,
        "price": _default_price(cfg) if is_early else None,
        "currency": cfg.get("pricing", {}).get("currency", "BDT"),
        "methodIds": ["bkash", "nagad"],
        "category": category,
        "year": latest.get("year"),
        "url": stream_url if len(seasons_map) == 1 and len(list(seasons_map.values())[0]) == 1 else "",
        "addedAt": max(_added_at_ms(e) for e in episodes),
        "telegramFileId": latest.get("telegram_file_id"),
        "telegramFileIds": latest.get("telegram_file_ids", []),
        "subtitleFileId": latest.get("subtitle_file_id"),
        "earlyAccess": is_early,
        "earlyAccessUntil": latest.get("early_access_until"),
        "source": "telegram",
        "seasons": seasons,
    }


def _build_node_catalog(catalog: dict[str, Any], cfg: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Merge episodes under series titles; attach thumb/stream URLs for the app."""
    node = read_json(cfg["paths"]["node_catalog"], {"title": "2hotatl", "items": []})
    existing = {i["id"]: i for i in node.get("items", []) if not str(i.get("source", "")).startswith("telegram")}
    api_base = _node_api_base(cfg)

    movies: list[dict[str, Any]] = []
    series_groups: dict[str, list[dict[str, Any]]] = {}

    for item in catalog.get("items", []):
        if item.get("season") is not None and item.get("episode") is not None:
            show = item.get("show_title") or normalize_show_title(item.get("title", ""))
            sk = item.get("series_key") or series_key(show)
            series_groups.setdefault(sk, [])
            series_groups[sk].append({**item, "show_title": show})
        else:
            movies.append(item)

    synced = 0
    for item in movies:
        built = _movie_item(item, cfg, api_base)
        existing[built["id"]] = built
        synced += 1

    for sk, eps in series_groups.items():
        show_title = eps[0].get("show_title") or normalize_show_title(eps[0].get("title", ""))
        built = _series_item(show_title, eps, cfg, api_base)
        existing[built["id"]] = built
        synced += 1

    node["title"] = "2hotatl"
    node["items"] = list(existing.values())
    node["updated_at"] = utc_now_iso()
    return node, synced


def sync_node_catalog(catalog: dict[str, Any], cfg: dict[str, Any], log) -> int:
    node, synced = _build_node_catalog(catalog, cfg)
    write_json(cfg["paths"]["node_catalog"], node)
    log.info("Synced %d organized item(s) to local Node catalog file", synced)

    api_base = _node_api_base(cfg)
    if not api_base.startswith("http"):
        return synced

    edit_key = os.environ.get("NODE_EDIT_KEY", "").strip() or str(cfg.get("node", {}).get("edit_key", "")).strip()
    headers = {"Content-Type": "application/json"}
    if edit_key:
        headers["X-Edit-Key"] = edit_key
    retries = int((cfg.get("automation") or {}).get("catalog_sync_retries", 5))
    delay = float((cfg.get("automation") or {}).get("catalog_sync_delay_seconds", 10))
    for attempt in range(retries):
        try:
            with httpx.Client(timeout=60.0) as client:
                resp = client.post(f"{api_base}/api/pipeline/catalog-sync", json=node, headers=headers)
                resp.raise_for_status()
            log.info("Pushed organized catalog to Node relay at %s", api_base)
            break
        except Exception as e:
            if attempt + 1 >= retries:
                log.error("Remote catalog sync failed after %d attempts: %s", retries, e)
            else:
                log.warning("Catalog sync retry %d/%d: %s", attempt + 1, retries, e)
                time.sleep(delay)
    return synced


def run_publish(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or load_config()
    log = setup_logger("publish", cfg)
    catalog = build_master_catalog(cfg)
    url = publish_to_dpaste(catalog, cfg, log)
    synced = sync_node_catalog(catalog, cfg, log)
    state = read_json(cfg["paths"]["state"], {})
    state["last_publish"] = utc_now_iso()
    state["catalog_public_url"] = url
    write_json(cfg["paths"]["state"], state)
    return {"ok": True, "items": len(catalog["items"]), "url": url, "synced": synced}


if __name__ == "__main__":
    run_publish()
