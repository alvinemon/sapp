"""Shared configuration and utilities for the content pipeline."""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent
CONFIG_PATH = PIPELINE_DIR / "config.yaml"
CONFIG_FALLBACK = PIPELINE_DIR / "config.example.yaml"
DEFAULT_TEMP_ROOT = Path("/tmp/phone-hand-pipeline")


def _apply_storage_paths(cfg: dict[str, Any]) -> None:
    storage = cfg.get("storage") or {}
    mode = str(storage.get("mode", "local")).lower()
    if mode != "telegram":
        return
    temp_raw = storage.get("temp_dir") or str(DEFAULT_TEMP_ROOT)
    temp_root = Path(temp_raw) if Path(temp_raw).is_absolute() else (ROOT / temp_raw).resolve()
    cfg["paths"]["incoming"] = str(temp_root / "incoming")
    cfg["paths"]["ready"] = str(temp_root / "ready")
    cfg.setdefault("storage", {})["temp_dir"] = str(temp_root)
    cfg["storage"]["mode"] = "telegram"


def _resolve_path(raw: str) -> str:
    p = Path(raw)
    if p.is_absolute():
        return str(p)
    base = PIPELINE_DIR if raw.startswith("..") else ROOT
    return str((base / p).resolve())


def _apply_env_overrides(cfg: dict[str, Any]) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if token:
        cfg.setdefault("telegram", {})["bot_token"] = token
    channel = os.environ.get("TELEGRAM_CHANNEL_ID", "").strip()
    if channel:
        cfg.setdefault("telegram", {})["channel_id"] = channel
    api_base = os.environ.get("NODE_API_BASE", "").strip()
    if not api_base:
        host = os.environ.get("NODE_API_HOST", "").strip()
        if host:
            api_base = f"https://{host.lstrip('https://').lstrip('http://')}"
    if api_base:
        cfg.setdefault("node", {})["api_base"] = api_base
    edit_key = os.environ.get("NODE_EDIT_KEY", "").strip()
    if edit_key:
        cfg.setdefault("node", {})["edit_key"] = edit_key
    storage_mode = os.environ.get("STORAGE_MODE", "").strip().lower()
    if storage_mode:
        cfg.setdefault("storage", {})["mode"] = storage_mode
    if os.environ.get("WORKER_RUN_DISCOVERY", "").strip().lower() == "false":
        cfg.setdefault("automation", {})["discovery_on_worker"] = False
    elif os.environ.get("WORKER_RUN_DISCOVERY", "").strip().lower() == "true":
        cfg.setdefault("automation", {})["discovery_on_worker"] = True
    data_root = os.environ.get("PIPELINE_DATA_ROOT", "").strip()
    if data_root:
        root = Path(data_root)
        cfg.setdefault("paths", {})
        cfg["paths"]["data_root"] = str(root)
        cfg["paths"]["incoming"] = str(root / "incoming")
        cfg["paths"]["ready"] = str(root / "ready")
        cfg["paths"]["logs"] = str(root / "logs")
        cfg["paths"]["upload_log"] = str(root / "upload_log.json")
        cfg["paths"]["master_catalog"] = str(root / "master_catalog.json")
        cfg["paths"]["catalog_public_url"] = str(root / "catalog_public_url.txt")
        cfg["paths"]["state"] = str(root / "state.json")
        cfg.setdefault("pricing", {})["db_path"] = str(root / "pricing.db")
    pricing_db = os.environ.get("PRICING_DB_PATH", "").strip()
    if pricing_db:
        cfg.setdefault("pricing", {})["db_path"] = pricing_db


def load_config() -> dict[str, Any]:
    path = CONFIG_PATH if CONFIG_PATH.exists() else CONFIG_FALLBACK
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    for key in ("incoming", "ready", "logs", "upload_log", "master_catalog", "catalog_public_url", "node_catalog", "state", "data_root"):
        if "paths" in cfg and key in cfg["paths"]:
            cfg["paths"][key] = _resolve_path(str(cfg["paths"][key]))
    if "pricing" in cfg and "db_path" in cfg["pricing"]:
        cfg["pricing"]["db_path"] = _resolve_path(str(cfg["pricing"]["db_path"]))
    _apply_env_overrides(cfg)
    _apply_storage_paths(cfg)
    return cfg


def ensure_dirs(cfg: dict[str, Any]) -> None:
    for key in ("incoming", "ready", "logs", "data_root"):
        Path(cfg["paths"][key]).mkdir(parents=True, exist_ok=True)


def setup_logger(name: str, cfg: dict[str, Any]) -> logging.Logger:
    log_dir = Path(cfg["paths"]["logs"])
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
    fh = logging.FileHandler(log_dir / f"{name}.log", encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    logger.addHandler(fh)
    logger.addHandler(sh)
    return logger


def read_json(path: str | Path, default: Any = None) -> Any:
    p = Path(path)
    if not p.exists():
        return default if default is not None else {}
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def write_json(path: str | Path, data: Any) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def slugify(text: str) -> str:
    s = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE)
    s = re.sub(r"[\s_-]+", "_", s.strip())
    return s[:80] or "untitled"


def parse_season_episode(title: str) -> tuple[str, int | None, int | None]:
    """Extract SxxExx or 1x02 from title; return cleaned title, season, episode."""
    m = re.search(r"[Ss](\d{1,2})[Ee](\d{1,3})", title)
    if m:
        season, ep = int(m.group(1)), int(m.group(2))
        clean = re.sub(r"[Ss]\d+[Ee]\d+", "", title).strip(" -_")
        return clean or title, season, ep
    m2 = re.search(r"\b(\d{1,2})[xX](\d{1,3})\b", title)
    if m2:
        season, ep = int(m2.group(1)), int(m2.group(2))
        clean = re.sub(r"\b\d{1,2}[xX]\d{1,3}\b", "", title).strip(" -_")
        return clean or title, season, ep
    return title, None, None


def parse_quality(title: str) -> str | None:
    for q in ("2160p", "1080p", "720p", "480p", "4K"):
        if q.lower() in title.lower():
            return q
    return None


def parse_language_tags(title: str, keywords: list[str]) -> list[str]:
    langs = []
    lower = title.lower()
    for kw in keywords:
        if kw.lower() in lower and any(x in kw.lower() for x in ("sub", "audio", "dual", "dub")):
            langs.append(kw)
    return langs
