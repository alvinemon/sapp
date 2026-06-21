#!/usr/bin/env python3
"""Push pipeline secrets from local config.yaml to Render services via API."""
from __future__ import annotations

import json
import os
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
CFG = ROOT / "pipeline" / "config.yaml"
EXAMPLE = ROOT / "pipeline" / "config.example.yaml"
API = "https://api.render.com/v1"

RELAY_NAMES = {"2hotatl-relay", "sapp-xoyi", "sapp", "2hotatl"}
PIPELINE_NAMES = {"2hotatl-pipeline", "2hotatl-pipeline-worker", "phone-hand-pipeline"}


def load_local_config() -> dict:
    path = CFG if CFG.exists() else EXAMPLE
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def api_key() -> str:
    for name in (".render-api-key", ".env"):
        p = ROOT / name
        if not p.exists():
            continue
        text = p.read_text(encoding="utf-8")
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("RENDER_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    key = os.environ.get("RENDER_API_KEY", "").strip()
    if key:
        return key
    raise SystemExit(
        "Missing RENDER_API_KEY. Add RENDER_API_KEY=rnd_... to phone-hand/.render-api-key"
    )


def service_ids() -> tuple[str | None, str | None]:
    relay = os.environ.get("RELAY_SERVICE_ID", "").strip() or None
    pipeline = os.environ.get("PIPELINE_SERVICE_ID", "").strip() or None
    path = ROOT / ".render-api-key"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("RELAY_SERVICE_ID="):
                relay = relay or line.split("=", 1)[1].strip()
            if line.startswith("PIPELINE_SERVICE_ID="):
                pipeline = pipeline or line.split("=", 1)[1].strip()
    return relay, pipeline


def request(method: str, path: str, body: dict | None = None) -> dict | list:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{API}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key()}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        raise SystemExit(f"Render API {method} {path} failed ({e.code}): {err}") from e


def list_services() -> list[dict]:
    out: list[dict] = []
    cursor = ""
    while True:
        q = f"/services?limit=100" + (f"&cursor={cursor}" if cursor else "")
        page = request("GET", q)
        if not isinstance(page, list):
            break
        out.extend(item.get("service", item) for item in page if isinstance(item, dict))
        if len(page) < 100:
            break
        cursor = page[-1].get("cursor", "") if page else ""
        if not cursor:
            break
    return out


def find_service(services: list[dict], names: set[str], *, url_hint: str | None = None) -> dict | None:
    for svc in services:
        n = str(svc.get("name", "")).lower()
        slug = str(svc.get("slug", "")).lower()
        if n in names or slug in names:
            return svc
    if url_hint:
        for svc in services:
            url = str(svc.get("serviceDetails", {}).get("url", "") or svc.get("url", ""))
            if url_hint in url:
                return svc
    return None


def put_env(service_id: str, key: str, value: str) -> None:
    request(
        "PUT",
        f"/services/{service_id}/env-vars/{key}",
        {"value": value},
    )


def trigger_deploy(service_id: str) -> None:
    request("POST", f"/services/{service_id}/deploys", {"clearCache": "clear"})


def main() -> None:
    cfg = load_local_config()
    tg = cfg.get("telegram") or {}
    bot = str(tg.get("bot_token", "")).strip()
    channel = str(tg.get("channel_id", "")).strip()
    if not bot or bot.startswith("YOUR_"):
        raise SystemExit("Telegram bot_token missing in pipeline/config.yaml")

    admin_key = os.environ.get("ADMIN_EDIT_KEY", "").strip() or secrets.token_urlsafe(24)
    worker_secret = os.environ.get("PIPELINE_WORKER_SECRET", "").strip() or secrets.token_urlsafe(32)

    services = list_services()
    if not services:
        raise SystemExit("No Render services found on this account")

    relay = find_service(services, RELAY_NAMES, url_hint="sapp-xoyi")
    pipeline = find_service(services, PIPELINE_NAMES, url_hint="2hotatl-pipeline")
    relay_id_override, pipeline_id_override = service_ids()
    if relay_id_override:
        relay = next((s for s in services if s.get("id") == relay_id_override), relay) or {"id": relay_id_override, "name": "relay (override)"}
    if pipeline_id_override:
        pipeline = next((s for s in services if s.get("id") == pipeline_id_override), None)
        if not pipeline:
            pipeline = {"id": pipeline_id_override, "name": "pipeline (override)"}

    # Never treat relay as pipeline when ids match
    if relay and pipeline and relay.get("id") == pipeline.get("id"):
        pipeline = None

    print(f"Found {len(services)} service(s)")
    if relay:
        rid = relay["id"]
        print(f"Relay: {relay.get('name')} ({rid})")
        relay_host = str(relay.get("serviceDetails", {}).get("url", "") or relay.get("url", "")).replace("https://", "")
        for k, v in {
            "TELEGRAM_BOT_TOKEN": bot,
            "PIPELINE_MODE": "remote",
            "PIPELINE_LOCAL_DOWNLOADS": "false",
            "PIPELINE_WORKER_SECRET": worker_secret,
            "ADMIN_EDIT_KEY": admin_key,
            "OPEN_ACCESS": "false",
            "RENDER_DISK_PATH": "/data",
        }.items():
            put_env(rid, k, v)
            print(f"  set {k}")
        if pipeline and pipeline.get("id") != rid:
            put_env(rid, "PIPELINE_RELAY_RSS", "false")
            print("  set PIPELINE_RELAY_RSS=false")
            ph = str(pipeline.get("serviceDetails", {}).get("url", "") or pipeline.get("url", "")).replace("https://", "")
            if ph:
                put_env(rid, "PIPELINE_WORKER_URL", f"https://{ph}")
                print("  set PIPELINE_WORKER_URL")
        else:
            put_env(rid, "PIPELINE_RELAY_RSS", "true")
            print("  set PIPELINE_RELAY_RSS=true (no worker yet — discovery on relay)")
        trigger_deploy(rid)
        print("  triggered relay deploy")
    else:
        print("WARN: relay service not found — apply render.yaml blueprint first")

    if pipeline:
        pid = pipeline["id"]
        print(f"Pipeline: {pipeline.get('name')} ({pid})")
        relay_host = ""
        if relay:
            relay_host = str(relay.get("serviceDetails", {}).get("url", "") or relay.get("url", "")).replace("https://", "")
        for k, v in {
            "TELEGRAM_BOT_TOKEN": bot,
            "TELEGRAM_CHANNEL_ID": channel,
            "PIPELINE_WORKER_SECRET": worker_secret,
            "NODE_EDIT_KEY": admin_key,
            "ADMIN_EDIT_KEY": admin_key,
            "STORAGE_MODE": "telegram",
            "PIPELINE_DATA_ROOT": "/data/pipeline",
            "WORKER_RUN_DISCOVERY": "true",
        }.items():
            if v:
                put_env(pid, k, v)
                print(f"  set {k}")
        if relay_host:
            put_env(pid, "NODE_API_BASE", f"https://{relay_host}")
            print("  set NODE_API_BASE")
        trigger_deploy(pid)
        print("  triggered pipeline deploy")
    else:
        print("WARN: pipeline worker not found — create via Blueprint (2hotatl-pipeline)")

    print("\nDone. Save these locally if needed:")
    print(f"  ADMIN_EDIT_KEY={admin_key}")
    print(f"  PIPELINE_WORKER_SECRET={worker_secret}")


if __name__ == "__main__":
    main()
