"""Remote pipeline worker — bounded queue, one torrent at a time, Telegram storage."""

from __future__ import annotations

import os
import time
from typing import Any, Optional, Union

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from common import ensure_dirs, load_config, setup_logger
from job_queue import QUEUE, disk_ok
from qbittorrent_client import setup_qbittorrent
from worker_discovery import DISCOVERY

app = FastAPI(title="2hotatl Pipeline Worker", version="1.1")


def _worker_secret() -> str:
    return os.environ.get("PIPELINE_WORKER_SECRET", "").strip()


def _auth(authorization: Optional[str]) -> None:
    secret = _worker_secret()
    if not secret:
        return
    if not authorization or authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="unauthorized")


class IngestBody(BaseModel):
    url: str
    title: str = ""


def _qbit_ok(cfg: dict[str, Any]) -> bool:
    qbt = cfg.get("qbittorrent") or {}
    host = str(qbt.get("host", "127.0.0.1"))
    port = int(qbt.get("port", 8080))
    base = host if host.startswith("http") else f"http://{host}:{port}"
    try:
        with httpx.Client(timeout=5.0) as client:
            r = client.get(f"{base.rstrip('/')}/api/v2/app/version")
            return r.status_code == 200
    except Exception:
        return False


def _telegram_ok(cfg: dict[str, Any]) -> bool:
    token = str((cfg.get("telegram") or {}).get("bot_token", ""))
    return bool(token) and not token.startswith("YOUR_")


@app.on_event("startup")
def startup() -> None:
    cfg = load_config()
    ensure_dirs(cfg)
    log = setup_logger("worker", cfg)
    try:
        setup_qbittorrent(cfg)
    except Exception as e:
        log.warning("qBittorrent setup deferred: %s", e)
    QUEUE.start(cfg)
    DISCOVERY.start(cfg)
    _start_pricing_train_scheduler(cfg, log)
    log.info("Worker ready — queue + discovery started")


def _start_pricing_train_scheduler(cfg: dict[str, Any], log: Any) -> None:
    """Nightly XGBoost retrain on purchase_attempts."""
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
        from pricing_engine import train_model

        hour = int((cfg.get("pricing") or {}).get("train_hour_utc", 3))

        def _train() -> None:
            try:
                result = train_model(load_config())
                log.info("Nightly pricing train: %s", result)
            except Exception as e:
                log.error("Nightly pricing train failed: %s", e)

        scheduler = BackgroundScheduler(daemon=True)
        scheduler.add_job(_train, CronTrigger(hour=hour, minute=0), id="pricing_train")
        scheduler.start()
        log.info("Pricing train scheduled daily at %02d:00 UTC", hour)
    except Exception as e:
        log.warning("Pricing train scheduler deferred: %s", e)


@app.get("/health")
def health() -> dict[str, Any]:
    cfg = load_config()
    ok_disk, pct = disk_ok(cfg)
    stats = QUEUE.stats(cfg)
    return {
        "ok": ok_disk and stats.get("queued", 0) < stats.get("max_queue", 50),
        "service": "pipeline-worker",
        "qbit": _qbit_ok(cfg),
        "telegram": _telegram_ok(cfg),
        "disk_ok": ok_disk,
        "disk_usage_percent": pct,
        "queue": stats,
    }


@app.get("/stats")
def stats(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    _auth(authorization)
    cfg = load_config()
    return {"ok": True, **QUEUE.stats(cfg)}


@app.get("/jobs/{job_id}")
def job_status(job_id: str, authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    _auth(authorization)
    cfg = load_config()
    job = QUEUE.get(cfg, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return {"ok": True, **job}


@app.post("/ingest")
def ingest(body: IngestBody, authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    """Queue magnet/torrent/tgfile for sequential download → Telegram → catalog."""
    _auth(authorization)
    cfg = load_config()
    ensure_dirs(cfg)
    result = QUEUE.enqueue(cfg, body.url.strip(), body.title.strip())
    if not result.get("ok"):
        err = str(result.get("error", "rejected"))
        if err in ("queue_full", "disk_full"):
            raise HTTPException(status_code=429, detail=err, headers={"Retry-After": "300"})
        if err == "duplicate":
            return {"ok": True, "duplicate": True, **result}
        raise HTTPException(status_code=400, detail=err)
    return result


@app.post("/setup")
def setup(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    _auth(authorization)
    cfg = load_config()
    ensure_dirs(cfg)
    return setup_qbittorrent(cfg)


class PricingQuoteBody(BaseModel):
    user_id: str
    content_id: str


class PricingAttemptBody(BaseModel):
    user_id: str
    content_id: str
    price_shown: float
    purchased: Union[bool, int] = False
    features: Optional[dict[str, Any]] = None


class PricingMetricsBody(BaseModel):
    user_id: str
    metrics: dict[str, Any]


@app.post("/pricing/quote")
def pricing_quote(body: PricingQuoteBody, authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    _auth(authorization)
    from pricing_engine import PricingEngine
    cfg = load_config()
    return PricingEngine(cfg).quote(body.user_id, body.content_id)


@app.post("/pricing/attempt")
def pricing_attempt(body: PricingAttemptBody, authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    _auth(authorization)
    from pricing_db import connect, log_purchase_attempt
    cfg = load_config()
    currency = str(cfg.get("pricing", {}).get("currency", "BDT"))
    conn = connect(cfg["pricing"]["db_path"])
    log_purchase_attempt(
        conn,
        body.user_id,
        body.content_id,
        float(body.price_shown),
        bool(body.purchased),
        currency,
        body.features,
    )
    conn.close()
    return {"ok": True}


@app.post("/pricing/metrics")
def pricing_metrics(body: PricingMetricsBody, authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    _auth(authorization)
    from pricing_db import connect, upsert_user
    cfg = load_config()
    conn = connect(cfg["pricing"]["db_path"])
    upsert_user(conn, body.user_id, body.metrics)
    conn.close()
    return {"ok": True}


@app.post("/pricing/train")
def pricing_train(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    _auth(authorization)
    from pricing_engine import train_model
    cfg = load_config()
    return train_model(cfg)
