"""Remove ephemeral local files after Telegram upload; optional qBittorrent cleanup."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from common import load_config, read_json, setup_logger, write_json
from qbittorrent_client import QBittorrentClient, qbittorrent_settings


def _storage_mode(cfg: dict[str, Any]) -> str:
    return str(cfg.get("storage", {}).get("mode", "local")).lower()


def run_cleanup(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or load_config()
    log = setup_logger("cleanup", cfg)
    storage = _storage_mode(cfg)
    removed_files = 0
    removed_torrents = 0

    if storage == "telegram" or cfg.get("storage", {}).get("delete_after_upload", True):
        for key in ("incoming", "ready"):
            folder = Path(cfg["paths"][key])
            if not folder.exists():
                continue
            for path in folder.rglob("*"):
                if path.is_file() and not path.name.startswith("."):
                    try:
                        path.unlink()
                        removed_files += 1
                    except OSError as e:
                        log.warning("Could not delete %s: %s", path, e)
            for sub in sorted(folder.rglob("*"), reverse=True):
                if sub.is_dir():
                    try:
                        sub.rmdir()
                    except OSError:
                        pass

    if cfg.get("storage", {}).get("delete_torrent_after_upload", True):
        state = read_json(cfg["paths"]["state"], {})
        hashes: list[str] = state.get("pending_torrent_cleanup", [])
        if hashes:
            try:
                base, username, password, category = qbittorrent_settings(cfg)
                client = QBittorrentClient(base, username, password)
                client.login()
                for info_hash in hashes:
                    if client.delete_torrent(info_hash, delete_files=True):
                        removed_torrents += 1
                state["pending_torrent_cleanup"] = []
                write_json(cfg["paths"]["state"], state)
            except Exception as e:
                log.warning("qBittorrent cleanup skipped: %s", e)

    temp_root = cfg.get("storage", {}).get("temp_dir")
    if temp_root and storage == "telegram":
        temp_path = Path(temp_root)
        if temp_path.exists() and str(temp_path).startswith("/tmp"):
            try:
                shutil.rmtree(temp_path, ignore_errors=True)
                temp_path.mkdir(parents=True, exist_ok=True)
                (temp_path / "incoming").mkdir(exist_ok=True)
                (temp_path / "ready").mkdir(exist_ok=True)
                log.info("Reset temp storage at %s", temp_path)
            except OSError as e:
                log.warning("Temp reset failed: %s", e)

    log.info("Cleanup complete — %d file(s), %d torrent(s)", removed_files, removed_torrents)
    return {"ok": True, "removed_files": removed_files, "removed_torrents": removed_torrents}
