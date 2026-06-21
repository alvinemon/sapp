"""Copy Telegram media from source chats to the library channel — no local disk."""

from __future__ import annotations

import asyncio
import re
from typing import Any

from telegram import Bot
from telegram.error import TelegramError

from common import load_config, parse_quality, parse_season_episode, read_json, setup_logger, slugify, utc_now_iso, write_json
from metadata import infer_category, normalize_show_title, parse_year, series_key


def parse_tgfile_url(url: str) -> tuple[int, int, str]:
    """Parse tgfile://chatId/messageId or tgfile://chatId/messageId/fileId."""
    m = re.match(r"^tgfile://(-?\d+)/(\d+)(?:/(.+))?$", url)
    if not m:
        raise ValueError(f"Invalid tgfile URL: {url}")
    chat_id = int(m.group(1))
    message_id = int(m.group(2))
    file_hint = m.group(3) or ""
    return chat_id, message_id, file_hint


def _file_id_from_message(msg) -> tuple[str, str]:
    if msg.document:
        return msg.document.file_id, msg.document.file_name or "document"
    if msg.video:
        return msg.video.file_id, msg.video.file_name or f"video_{msg.message_id}.mp4"
    if msg.audio:
        return msg.audio.file_id, msg.audio.file_name or f"audio_{msg.message_id}.mp3"
    raise ValueError("Message has no copyable media")


async def _copy_async(cfg: dict[str, Any], from_chat_id: int, message_id: int, title: str) -> dict[str, Any]:
    log = setup_logger("telegram", cfg)
    token = cfg["telegram"]["bot_token"]
    channel = cfg["telegram"]["channel_id"]
    bot = Bot(token=token)

    log.info("Copying Telegram message %s:%s → channel %s", from_chat_id, message_id, channel)
    copied = await bot.copy_message(chat_id=channel, from_chat_id=from_chat_id, message_id=message_id)
    file_id, fname = _file_id_from_message(copied)

    clean_title, season, episode = parse_season_episode(title or fname)
    show_title = normalize_show_title(title or fname)
    quality = parse_quality(title or fname)
    entry_id = slugify(show_title)
    if season is not None and episode is not None:
        entry_id = f"{entry_id}_S{season:02d}E{episode:02d}"

    upload_log_path = cfg["paths"]["upload_log"]
    log_data = read_json(upload_log_path, {"uploads": []})
    entry = {
        "id": entry_id,
        "title": show_title,
        "episode_title": clean_title or show_title,
        "show_title": show_title,
        "series_key": series_key(show_title),
        "season": season,
        "episode": episode,
        "quality": quality,
        "languages": [],
        "year": parse_year(title or fname),
        "category": infer_category(show_title, [], season),
        "description": " · ".join(filter(None, [quality])),
        "telegram_file_ids": [file_id],
        "telegram_file_id": file_id,
        "thumb_file_id": "",
        "thumb_url": "",
        "subtitle_file_id": "",
        "chunks": 1,
        "uploaded_at": utc_now_iso(),
        "local_path": "",
        "early_access": True,
        "source_chat_id": from_chat_id,
        "source_message_id": message_id,
    }
    log_data.setdefault("uploads", []).append(entry)
    write_json(upload_log_path, log_data)
    log.info("Telegram direct ingest: %s → file_id %s…", entry["title"], file_id[:20])
    return {"ok": True, "hash": entry_id, "telegram_file_id": file_id, "title": entry["title"]}


def cmd_telegram_ingest(cfg: dict[str, Any], url: str, title: str = "") -> dict[str, Any]:
    from_chat_id, message_id, _ = parse_tgfile_url(url)
    return asyncio.run(_copy_async(cfg, from_chat_id, message_id, title))
