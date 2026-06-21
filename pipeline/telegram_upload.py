"""Step 3: Upload Ready files to private Telegram channel; log file IDs."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

from telegram import Bot
from telegram.error import RetryAfter, TelegramError

from common import load_config, read_json, setup_logger, utc_now_iso, write_json
# Telegram Bot API upload limit (~50MB); stay under for reliability.
DEFAULT_CHUNK = 49_000_000


VIDEO_EXT = {".mp4", ".mkv", ".mov", ".m4v"}
POSTER_SUFFIX = ".poster.jpg"


def _automation(cfg: dict[str, Any]) -> dict[str, Any]:
    return cfg.get("automation") or {}


def _retry_count(cfg: dict[str, Any]) -> int:
    return int(_automation(cfg).get("telegram_retry_count", 5))


async def _upload_photo(bot: Bot, channel_id: str, path: Path, cfg: dict[str, Any]) -> str:
    retries = _retry_count(cfg)
    for attempt in range(retries):
        try:
            with open(path, "rb") as f:
                msg = await bot.send_photo(chat_id=channel_id, photo=f)
            if msg.photo:
                return msg.photo[-1].file_id
            return ""
        except RetryAfter as e:
            await asyncio.sleep(float(e.retry_after) + 1)
        except TelegramError:
            if attempt + 1 >= retries:
                raise
            await asyncio.sleep(2 ** attempt)
    return ""


def _max_chunk(cfg: dict[str, Any]) -> int:
    tg = int(cfg.get("telegram", {}).get("max_chunk_bytes", DEFAULT_CHUNK))
    auto = int(_automation(cfg).get("upload_chunk_bytes", DEFAULT_CHUNK))
    return min(tg, auto, DEFAULT_CHUNK)


def _upload_delay(cfg: dict[str, Any]) -> float:
    return float(_automation(cfg).get("upload_delay_seconds", 2.0))


def _split_file(path: Path, max_bytes: int) -> list[Path]:
    size = path.stat().st_size
    if size <= max_bytes:
        return [path]
    chunks: list[Path] = []
    with open(path, "rb") as f:
        idx = 0
        while True:
            data = f.read(max_bytes)
            if not data:
                break
            chunk_path = path.parent / f"{path.stem}.part{idx:03d}{path.suffix}"
            with open(chunk_path, "wb") as out:
                out.write(data)
            chunks.append(chunk_path)
            idx += 1
    return chunks


async def _upload_file(bot: Bot, channel_id: str, path: Path, cfg: dict[str, Any]) -> str:
    retries = _retry_count(cfg)
    for attempt in range(retries):
        try:
            with open(path, "rb") as f:
                msg = await bot.send_document(chat_id=channel_id, document=f, filename=path.name)
            return msg.document.file_id if msg.document else ""
        except RetryAfter as e:
            await asyncio.sleep(float(e.retry_after) + 1)
        except TelegramError:
            if attempt + 1 >= retries:
                raise
            await asyncio.sleep(2 ** attempt)
    return ""


async def _upload_subtitle(bot: Bot, channel_id: str, path: Path, cfg: dict[str, Any]) -> str:
    return await _upload_file(bot, channel_id, path, cfg)


async def _run_upload_async(cfg: dict[str, Any]) -> dict[str, Any]:
    log = setup_logger("telegram", cfg)
    ready = Path(cfg["paths"]["ready"])
    upload_log_path = cfg["paths"]["upload_log"]
    log_data = read_json(upload_log_path, {"uploads": []})
    uploaded_paths: set[str] = {u.get("local_path", "") for u in log_data.get("uploads", [])}

    token = cfg["telegram"]["bot_token"]
    channel = cfg["telegram"]["channel_id"]
    max_chunk = _max_chunk(cfg)
    delay = _upload_delay(cfg)

    if not token or token.startswith("YOUR_"):
        log.warning("Telegram bot_token not configured — skipping upload")
        return {"ok": False, "error": "telegram not configured", "uploaded": 0}

    bot = Bot(token=token)
    count = 0

    for video in sorted(ready.iterdir()):
        if not video.is_file() or video.suffix.lower() not in VIDEO_EXT:
            continue
        if str(video.resolve()) in uploaded_paths:
            continue

        meta_path = video.with_suffix(".meta.json")
        meta = read_json(meta_path, {}) if meta_path.exists() else {}
        srt = video.with_suffix(".srt")
        poster = video.with_suffix(POSTER_SUFFIX)

        try:
            thumb_file_id = ""
            if poster.exists():
                thumb_file_id = await _upload_photo(bot, channel, poster, cfg)
                poster.unlink(missing_ok=True)
            elif meta.get("tmdb_poster_url"):
                meta["thumb_url"] = meta["tmdb_poster_url"]

            chunks = _split_file(video, max_chunk)
            file_ids: list[str] = []
            for chunk in chunks:
                fid = await _upload_file(bot, channel, chunk, cfg)
                file_ids.append(fid)
                if chunk != video:
                    chunk.unlink(missing_ok=True)
                if delay > 0:
                    await asyncio.sleep(delay)

            sub_id = ""
            if srt.exists():
                sub_id = await _upload_subtitle(bot, channel, srt, cfg)
                srt.unlink(missing_ok=True)

            entry = {
                "id": video.stem,
                "title": meta.get("title") or meta.get("show_title") or video.stem,
                "episode_title": meta.get("episode_title") or meta.get("title") or video.stem,
                "show_title": meta.get("show_title") or meta.get("title") or video.stem,
                "series_key": meta.get("series_key") or "",
                "season": meta.get("season"),
                "episode": meta.get("episode"),
                "quality": meta.get("quality"),
                "languages": meta.get("languages", []),
                "year": meta.get("year"),
                "category": meta.get("category") or "Catalog",
                "description": meta.get("description") or "",
                "telegram_file_ids": file_ids,
                "telegram_file_id": file_ids[0] if file_ids else "",
                "thumb_file_id": thumb_file_id,
                "thumb_url": meta.get("tmdb_poster_url") or meta.get("thumb_url") or "",
                "subtitle_file_id": sub_id,
                "chunks": len(file_ids),
                "uploaded_at": utc_now_iso(),
                "local_path": str(video.resolve()),
                "early_access": True,
            }
            log_data.setdefault("uploads", []).append(entry)
            write_json(upload_log_path, log_data)

            video.unlink(missing_ok=True)
            meta_path.unlink(missing_ok=True)
            uploaded_paths.add(entry["local_path"])
            count += 1
            log.info("Uploaded: %s (%d chunk(s))", entry["title"], len(file_ids))
        except TelegramError as e:
            log.error("Telegram upload failed for %s: %s", video.name, e)
        except Exception as e:
            log.error("Upload failed for %s: %s", video.name, e)

    log.info("Telegram upload complete — %d file(s)", count)
    return {"ok": True, "uploaded": count}


def run_upload(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or load_config()
    return asyncio.run(_run_upload_async(cfg))


if __name__ == "__main__":
    run_upload()
