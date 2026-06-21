"""Persistent job queue — one torrent at a time, disk guard, auto-retry."""

from __future__ import annotations

import json
import shutil
import sqlite3
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Any, Callable

from cleanup import run_cleanup
from common import ensure_dirs, load_config, read_json, setup_logger, write_json
from publish import run_publish
from process import run_process
from qbittorrent_client import cmd_torrent_ingest, cmd_torrent_status, setup_qbittorrent
from telegram_direct import cmd_telegram_ingest
from telegram_upload import run_upload


def _automation(cfg: dict[str, Any]) -> dict[str, Any]:
    return cfg.get("automation") or {}


def _queue_db(cfg: dict[str, Any]) -> Path:
    root = Path(cfg["paths"]["data_root"])
    root.mkdir(parents=True, exist_ok=True)
    return root / "job_queue.db"


def disk_usage_percent(path: str | Path) -> float:
    usage = shutil.disk_usage(str(path))
    if usage.total == 0:
        return 100.0
    return (usage.used / usage.total) * 100.0


def disk_ok(cfg: dict[str, Any]) -> tuple[bool, float]:
    auto = _automation(cfg)
    max_pct = float(auto.get("disk_usage_max_percent", 85))
    check_path = cfg.get("storage", {}).get("temp_dir") or cfg["paths"]["data_root"]
    pct = disk_usage_percent(check_path)
    return pct < max_pct, pct


class JobQueue:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._running = False
        self._worker_thread: threading.Thread | None = None
        self._cfg: dict[str, Any] | None = None

    def _conn(self, cfg: dict[str, Any]) -> sqlite3.Connection:
        conn = sqlite3.connect(str(_queue_db(cfg)), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                title TEXT,
                mode TEXT NOT NULL,
                status TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                max_retries INTEGER NOT NULL DEFAULT 3,
                error TEXT,
                result_json TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS url_dedup (
                url_hash TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at REAL NOT NULL
            )
            """
        )
        conn.commit()
        return conn

    def start(self, cfg: dict[str, Any]) -> None:
        with self._lock:
            self._cfg = cfg
            if self._running:
                return
            self._running = True
            self._worker_thread = threading.Thread(target=self._loop, daemon=True, name="job-queue")
            self._worker_thread.start()

    def stats(self, cfg: dict[str, Any]) -> dict[str, Any]:
        conn = self._conn(cfg)
        rows = conn.execute(
            "SELECT status, COUNT(*) AS n FROM jobs GROUP BY status"
        ).fetchall()
        by_status = {str(r["status"]): int(r["n"]) for r in rows}
        queued = int(by_status.get("queued", 0))
        active = int(by_status.get("downloading", 0)) + int(by_status.get("waiting", 0)) + int(
            by_status.get("processing", 0)
        ) + int(by_status.get("copying", 0))
        auto = _automation(cfg)
        ok, pct = disk_ok(cfg)
        return {
            "queued": queued,
            "active": active,
            "by_status": by_status,
            "max_concurrent": int(auto.get("max_concurrent_jobs", 1)),
            "max_queue": int(auto.get("max_queue_size", 50)),
            "disk_ok": ok,
            "disk_usage_percent": round(pct, 1),
        }

    def get(self, cfg: dict[str, Any], job_id: str) -> dict[str, Any] | None:
        conn = self._conn(cfg)
        row = conn.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
        if not row:
            return None
        out = dict(row)
        if out.get("result_json"):
            try:
                out["result"] = json.loads(str(out["result_json"]))
            except json.JSONDecodeError:
                pass
        return out

    def enqueue(self, cfg: dict[str, Any], url: str, title: str = "") -> dict[str, Any]:
        import hashlib

        auto = _automation(cfg)
        max_queue = int(auto.get("max_queue_size", 50))
        max_retries = int(auto.get("max_job_retries", 3))
        stats = self.stats(cfg)
        if stats["queued"] + stats["active"] >= max_queue:
            return {"ok": False, "error": "queue_full", "stats": stats}

        ok, pct = disk_ok(cfg)
        if not ok:
            return {"ok": False, "error": "disk_full", "disk_usage_percent": pct}

        url_hash = hashlib.sha256(url.encode()).hexdigest()[:32]
        conn = self._conn(cfg)
        existing = conn.execute(
            "SELECT status FROM url_dedup WHERE url_hash = ?", (url_hash,)
        ).fetchone()
        if existing and str(existing["status"]) in ("queued", "downloading", "waiting", "processing", "copying", "complete"):
            return {"ok": False, "error": "duplicate", "status": str(existing["status"])}

        mode = "telegram-direct" if url.startswith("tgfile://") else "torrent-remote"
        job_id = uuid.uuid4().hex[:12]
        now = time.time()
        conn.execute(
            """
            INSERT INTO jobs (job_id, url, title, mode, status, attempts, max_retries, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?)
            """,
            (job_id, url[:2000], title[:500], mode, max_retries, now, now),
        )
        conn.execute(
            "INSERT OR REPLACE INTO url_dedup (url_hash, job_id, status, created_at) VALUES (?, ?, 'queued', ?)",
            (url_hash, job_id, now),
        )
        conn.commit()
        return {"ok": True, "job_id": job_id, "mode": mode, "stats": self.stats(cfg)}

    def _update(self, cfg: dict[str, Any], job_id: str, status: str, **fields: Any) -> None:
        import hashlib

        conn = self._conn(cfg)
        now = time.time()
        sets = ["status = ?", "updated_at = ?"]
        vals: list[Any] = [status, now]
        for key, val in fields.items():
            if key == "result":
                sets.append("result_json = ?")
                vals.append(json.dumps(val))
            elif key in ("error", "attempts"):
                sets.append(f"{key} = ?")
                vals.append(val)
        vals.append(job_id)
        conn.execute(f"UPDATE jobs SET {', '.join(sets)} WHERE job_id = ?", vals)
        row = conn.execute("SELECT url FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
        if row:
            url_hash = hashlib.sha256(str(row["url"]).encode()).hexdigest()[:32]
            conn.execute(
                "UPDATE url_dedup SET status = ? WHERE url_hash = ?",
                (status, url_hash),
            )
        conn.commit()

    def _run_torrent(self, cfg: dict[str, Any], url: str, title: str, job_id: str, log) -> dict[str, Any]:
        result = cmd_torrent_ingest(cfg, url)
        info_hash = str(result.get("hash", ""))
        if not info_hash:
            raise RuntimeError("No torrent hash returned")

        state = read_json(cfg["paths"]["state"], {})
        pending = state.setdefault("pending_torrent_cleanup", [])
        if info_hash not in pending:
            pending.append(info_hash)
        state["pending_torrent_cleanup"] = pending[-500:]
        write_json(cfg["paths"]["state"], state)

        self._update(cfg, job_id, "waiting", result={"ingest": result})
        status_result = cmd_torrent_status(
            cfg,
            info_hash,
            poll_interval=float(_automation(cfg).get("torrent_poll_seconds", 15)),
            timeout=float(_automation(cfg).get("torrent_timeout_seconds", 86400)),
        )
        self._update(cfg, job_id, "processing")

        incoming = Path(cfg["paths"]["incoming"])
        incoming.mkdir(parents=True, exist_ok=True)
        ctx_path = incoming / ".pipeline_job.json"
        ctx_path.write_text(
            json.dumps({"job_id": job_id, "title": title, "url": url[:500]}),
            encoding="utf-8",
        )

        run_process(cfg)
        upload = run_upload(cfg)
        publish = run_publish(cfg)
        cleanup = run_cleanup(cfg)

        state = read_json(cfg["paths"]["state"], {})
        pending = [h for h in state.get("pending_torrent_cleanup", []) if h != info_hash]
        state["pending_torrent_cleanup"] = pending
        write_json(cfg["paths"]["state"], state)

        return {"hash": info_hash, "download": status_result, "upload": upload, "publish": publish, "cleanup": cleanup}

    def _run_telegram(self, cfg: dict[str, Any], url: str, title: str, job_id: str) -> dict[str, Any]:
        result = cmd_telegram_ingest(cfg, url, title)
        publish = run_publish(cfg)
        return {"result": result, "publish": publish}

    def _process_one(self, cfg: dict[str, Any], row: sqlite3.Row) -> None:
        job_id = str(row["job_id"])
        url = str(row["url"])
        title = str(row["title"] or "")
        mode = str(row["mode"])
        attempts = int(row["attempts"]) + 1
        max_retries = int(row["max_retries"])
        log = setup_logger("worker", cfg)

        status = "copying" if mode == "telegram-direct" else "downloading"
        self._update(cfg, job_id, status, attempts=attempts)

        try:
            if mode == "telegram-direct":
                result = self._run_telegram(cfg, url, title, job_id)
            else:
                result = self._run_torrent(cfg, url, title, job_id, log)
            self._update(cfg, job_id, "complete", result=result)
            log.info("Job %s complete", job_id)
        except Exception as e:
            err = str(e)
            log.error("Job %s failed (attempt %d/%d): %s\n%s", job_id, attempts, max_retries, err, traceback.format_exc())
            if attempts < max_retries:
                self._update(cfg, job_id, "queued", error=err, attempts=attempts)
                delay = float(_automation(cfg).get("retry_delay_seconds", 300))
                time.sleep(min(delay, 60))
            else:
                self._update(cfg, job_id, "failed", error=err, attempts=attempts)

    def _loop(self) -> None:
        while self._running:
            cfg = self._cfg or load_config()
            auto = _automation(cfg)
            max_concurrent = int(auto.get("max_concurrent_jobs", 1))
            conn = self._conn(cfg)
            active = conn.execute(
                """
                SELECT COUNT(*) AS n FROM jobs
                WHERE status IN ('downloading', 'waiting', 'processing', 'copying')
                """
            ).fetchone()
            if active and int(active["n"]) >= max_concurrent:
                time.sleep(5)
                continue

            ok, _ = disk_ok(cfg)
            if not ok:
                time.sleep(30)
                continue

            row = conn.execute(
                """
                SELECT * FROM jobs WHERE status = 'queued'
                ORDER BY created_at ASC LIMIT 1
                """
            ).fetchone()
            if not row:
                time.sleep(3)
                continue

            self._process_one(cfg, row)


QUEUE = JobQueue()
