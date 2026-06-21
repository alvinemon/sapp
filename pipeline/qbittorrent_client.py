"""qBittorrent Web API client using requests + session cookie auth."""

from __future__ import annotations

import json
import re
import time
from typing import Any

import requests


def log(msg: str) -> None:
    print(f"[torrent] {msg}", flush=True)


def qbittorrent_settings(cfg: dict[str, Any]) -> tuple[str, str, str, str]:
    qbt = cfg.get("qbittorrent", {})
    host = str(qbt.get("host", "127.0.0.1"))
    port = int(qbt.get("port", 8080))
    username = str(qbt.get("username", "admin"))
    password = str(qbt.get("password", ""))
    category = str(qbt.get("category", "AutoFetch"))

    if host.startswith("http://") or host.startswith("https://"):
        base = host.rstrip("/")
    else:
        base = f"http://{host}:{port}"

    return base, username, password, category


def magnet_info_hash(magnet: str) -> str:
    """Extract lowercase hex info-hash from a magnet URI."""
    hex_match = re.search(r"btih:([a-fA-F0-9]{40})", magnet, re.IGNORECASE)
    if hex_match:
        return hex_match.group(1).lower()
    b32_match = re.search(r"btih:([a-zA-Z2-7]{32})", magnet, re.IGNORECASE)
    if b32_match:
        import base64

        raw = base64.b32decode(b32_match.group(1).upper() + "=" * (-len(b32_match.group(1)) % 8))
        return raw.hex()
    raise ValueError("Could not parse info-hash from magnet link")


class QBittorrentClient:
    def __init__(self, base_url: str, username: str, password: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.session = requests.Session()

    def login(self) -> None:
        log(f"Authenticating to {self.base_url} as {self.username}")
        resp = self.session.post(
            f"{self.base_url}/api/v2/auth/login",
            data={"username": self.username, "password": self.password},
            timeout=30,
        )
        resp.raise_for_status()
        if resp.text.strip().lower() not in ("ok.", "ok"):
            raise RuntimeError(f"qBittorrent login failed: {resp.text.strip()}")
        if not self.session.cookies.get("SID"):
            raise RuntimeError("qBittorrent login did not return SID session cookie")
        log("Authenticated — session cookie acquired")

    def ensure_category(self, category: str, save_path: str) -> None:
        log(f"Ensuring category '{category}' → save_path={save_path}")
        resp = self.session.get(f"{self.base_url}/api/v2/torrents/categories", timeout=30)
        resp.raise_for_status()
        categories = resp.json()
        if category in categories:
            current = categories[category].get("savePath", "")
            if current.rstrip("/") != save_path.rstrip("/"):
                edit = self.session.post(
                    f"{self.base_url}/api/v2/torrents/editCategory",
                    data={"category": category, "savePath": save_path},
                    timeout=30,
                )
                edit.raise_for_status()
                log(f"Updated category save path")
            else:
                log("Category already configured")
            return
        create = self.session.post(
            f"{self.base_url}/api/v2/torrents/createCategory",
            data={"category": category, "savePath": save_path},
            timeout=30,
        )
        create.raise_for_status()
        log(f"Created category '{category}'")

    def add_torrent(self, url: str, category: str) -> str:
        info_hash = ""
        if url.startswith("magnet:"):
            try:
                info_hash = magnet_info_hash(url)
            except ValueError:
                info_hash = ""

        log(f"Adding torrent to category '{category}' (hash={info_hash or 'pending'})")
        resp = self.session.post(
            f"{self.base_url}/api/v2/torrents/add",
            data={"urls": url, "category": category, "paused": "false"},
            timeout=120,
        )
        if resp.status_code == 415:
            raise RuntimeError(f"qBittorrent rejected URL: {resp.text.strip()}")
        resp.raise_for_status()
        log("Torrent queued successfully")

        if not info_hash:
            time.sleep(1.5)
            info_hash = self._newest_hash_in_category(category)
        return info_hash

    def _newest_hash_in_category(self, category: str) -> str:
        resp = self.session.get(
            f"{self.base_url}/api/v2/torrents/info",
            params={"category": category, "sort": "added_on", "reverse": "true", "limit": 1},
            timeout=30,
        )
        resp.raise_for_status()
        items = resp.json()
        if not items:
            raise RuntimeError("Torrent add succeeded but no torrent found in category")
        return str(items[0].get("hash", "")).lower()

    def torrent_properties(self, info_hash: str) -> dict[str, Any]:
        resp = self.session.get(
            f"{self.base_url}/api/v2/torrents/info",
            params={"hashes": info_hash.lower()},
            timeout=30,
        )
        resp.raise_for_status()
        items = resp.json()
        if not items:
            raise RuntimeError(f"Torrent not found: {info_hash}")
        t = items[0]
        return {
            "hash": t.get("hash", info_hash).lower(),
            "state": t.get("state", "unknown"),
            "progress": float(t.get("progress", 0)),
            "save_path": t.get("save_path", ""),
            "name": t.get("name", ""),
        }

    def wait_until_complete(
        self,
        info_hash: str,
        poll_interval: float = 5.0,
        timeout: float = 86400.0,
    ) -> dict[str, Any]:
        log(f"Polling torrent {info_hash} every {poll_interval}s (timeout {timeout}s)")
        deadline = time.time() + timeout
        last_progress = -1.0

        while time.time() < deadline:
            props = self.torrent_properties(info_hash)
            state = props["state"]
            progress = props["progress"]
            pct = round(progress * 100, 2)

            if progress != last_progress:
                log(f"Progress {pct}% — state={state} — save_path={props['save_path']}")
                last_progress = progress

            if progress >= 1.0 or state.endswith("UP") or state in ("stoppedUP", "uploading", "pausedUP"):
                log(f"Download complete — state={state} progress={pct}%")
                return {
                    "state": state,
                    "progress": progress,
                    "save_path": props["save_path"],
                    "hash": props["hash"],
                    "name": props.get("name", ""),
                }

            time.sleep(poll_interval)

        raise TimeoutError(f"Torrent {info_hash} did not complete within {timeout}s")

    def configure_limits(self, max_active_downloads: int = 1, max_active_torrents: int = 2) -> None:
        """Keep Render disk/CPU load low — one download at a time."""
        log(f"Setting qBittorrent limits: active_dl={max_active_downloads} active_torrents={max_active_torrents}")
        resp = self.session.post(
            f"{self.base_url}/api/v2/app/setPreferences",
            data={
                "json": json.dumps(
                    {
                        "max_active_downloads": max_active_downloads,
                        "max_active_torrents": max_active_torrents,
                        "max_active_uploads": 1,
                        "dont_count_slow_torrents": True,
                    }
                )
            },
            timeout=30,
        )
        resp.raise_for_status()

    def delete_torrent(self, info_hash: str, delete_files: bool = True) -> bool:
        log(f"Removing torrent {info_hash} (delete_files={delete_files})")
        resp = self.session.post(
            f"{self.base_url}/api/v2/torrents/delete",
            data={"hashes": info_hash.lower(), "deleteFiles": "true" if delete_files else "false"},
            timeout=30,
        )
        resp.raise_for_status()
        return True


def setup_qbittorrent(cfg: dict[str, Any]) -> dict[str, Any]:
    base, username, password, category = qbittorrent_settings(cfg)
    incoming = str(cfg["paths"]["incoming"])
    auto = cfg.get("automation") or {}
    max_dl = int(auto.get("qbittorrent_max_active_downloads", 1))
    max_torrents = int(auto.get("qbittorrent_max_active_torrents", 2))
    client = QBittorrentClient(base, username, password)
    client.login()
    client.ensure_category(category, incoming)
    client.configure_limits(max_dl, max_torrents)
    return {"ok": True, "category": category, "save_path": incoming, "max_active_downloads": max_dl}


def cmd_torrent_ingest(cfg: dict[str, Any], url: str) -> dict[str, Any]:
    base, username, password, category = qbittorrent_settings(cfg)
    client = QBittorrentClient(base, username, password)
    client.login()
    client.ensure_category(category, str(cfg["paths"]["incoming"]))
    info_hash = client.add_torrent(url, category)
    return {"ok": True, "hash": info_hash, "category": category, "url": url[:120]}


def cmd_torrent_status(
    cfg: dict[str, Any],
    info_hash: str,
    poll_interval: float = 5.0,
    timeout: float = 86400.0,
) -> dict[str, Any]:
    base, username, password, _ = qbittorrent_settings(cfg)
    client = QBittorrentClient(base, username, password)
    client.login()
    result = client.wait_until_complete(info_hash.lower(), poll_interval, timeout)
    return {
        "state": result["state"],
        "progress": result["progress"],
        "save_path": result["save_path"],
        "hash": result["hash"],
    }
