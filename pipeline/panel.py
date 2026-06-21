"""Password-protected FastAPI control panel + pricing API for the content pipeline."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import uvicorn
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.templating import Jinja2Templates

from common import load_config, read_json, write_json
from pricing_db import connect, revenue_analytics, upsert_user
from pricing_engine import PricingEngine, train_model
from run_pipeline import run_pipeline_cycle

ROOT = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(ROOT / "templates"))
security = HTTPBasic()
app = FastAPI(title="2hotatl Content Pipeline", docs_url="/api/docs")
cfg = load_config()
engine = PricingEngine(cfg)
sessions: set[str] = set()


def verify_password(credentials: HTTPBasicCredentials = Depends(security)) -> str:
    expected = cfg["panel"]["password"]
    ok_user = secrets.compare_digest(credentials.username.encode(), b"admin")
    ok_pass = secrets.compare_digest(credentials.password.encode(), expected.encode())
    if not (ok_user and ok_pass):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


def _pipeline_status() -> dict[str, Any]:
    state = read_json(cfg["paths"]["state"], {})
    upload_log = read_json(cfg["paths"]["upload_log"], {"uploads": []})
    master = read_json(cfg["paths"]["master_catalog"], {"items": []})
    url_file = Path(cfg["paths"]["catalog_public_url"])
    public_url = url_file.read_text(encoding="utf-8").strip() if url_file.exists() else state.get("catalog_public_url")
    return {
        "last_pipeline": state.get("last_pipeline_run"),
        "last_ingest": state.get("last_ingest"),
        "last_process": state.get("last_process"),
        "last_publish": state.get("last_publish"),
        "upload_count": len(upload_log.get("uploads", [])),
        "catalog_count": len(master.get("items", [])),
        "public_url": public_url,
    }


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request, _: str = Depends(verify_password)):
    status_data = _pipeline_status()
    master = read_json(cfg["paths"]["master_catalog"], {"items": []})
    conn = connect(cfg["pricing"]["db_path"])
    analytics = revenue_analytics(conn)
    conn.close()
    return templates.TemplateResponse(
        "dashboard.html",
        {
            "request": request,
            "status": status_data,
            "items": master.get("items", [])[:100],
            "analytics": analytics,
        },
    )


@app.get("/logs", response_class=HTMLResponse)
async def logs_page(request: Request, _: str = Depends(verify_password)):
    log_dir = Path(cfg["paths"]["logs"])
    lines = []
    for name in ("pipeline", "ingest", "process", "telegram", "publish"):
        p = log_dir / f"{name}.log"
        if p.exists():
            text = p.read_text(encoding="utf-8", errors="replace").splitlines()[-80:]
            lines.append({"name": name, "lines": text})
    return templates.TemplateResponse("logs.html", {"request": request, "logs": lines})


@app.get("/catalog", response_class=HTMLResponse)
async def catalog_page(request: Request, _: str = Depends(verify_password)):
    master = read_json(cfg["paths"]["master_catalog"], {"items": []})
    overrides = read_json(cfg["paths"]["state"], {}).get("early_access_overrides", {})
    items = []
    for item in master.get("items", []):
        ov = overrides.get(item["id"], {})
        items.append({**item, "override": ov})
    return templates.TemplateResponse("catalog.html", {"request": request, "items": items})


@app.post("/catalog/{item_id}/early-access")
async def set_early_access(
    item_id: str,
    early_access: bool = Form(...),
    _: str = Depends(verify_password),
):
    state = read_json(cfg["paths"]["state"], {})
    overrides = state.setdefault("early_access_overrides", {})
    overrides[item_id] = {"early_access": early_access, "updated_at": datetime.now(timezone.utc).isoformat()}
    write_json(cfg["paths"]["state"], state)
    from publish import build_master_catalog, sync_node_catalog
    catalog = build_master_catalog(cfg)
    sync_node_catalog(catalog, cfg, __import__("logging").getLogger("panel"))
    return RedirectResponse("/catalog", status_code=303)


@app.post("/pipeline/run")
async def trigger_pipeline(_: str = Depends(verify_password)):
    result = run_pipeline_cycle(cfg)
    return JSONResponse(result)


@app.get("/api/status")
async def api_status(_: str = Depends(verify_password)):
    return _pipeline_status()


@app.get("/api/catalog")
async def api_catalog(_: str = Depends(verify_password)):
    return read_json(cfg["paths"]["master_catalog"], {"items": []})


@app.get("/api/analytics/revenue")
async def api_revenue(_: str = Depends(verify_password)):
    conn = connect(cfg["pricing"]["db_path"])
    data = revenue_analytics(conn)
    conn.close()
    return data


# --- Pricing API (called by mobile app) ---

@app.post("/api/users/{user_id}/metrics")
async def update_user_metrics(user_id: str, body: dict[str, Any]):
    conn = connect(cfg["pricing"]["db_path"])
    upsert_user(conn, user_id, body)
    conn.close()
    return {"ok": True}


@app.get("/api/pricing/quote")
async def pricing_quote(user_id: str, content_id: str):
    return engine.quote(user_id, content_id)


@app.post("/api/pricing/attempt")
async def pricing_attempt(body: dict[str, Any]):
    engine.record_attempt(
        body["user_id"],
        body["content_id"],
        float(body["price_shown"]),
        bool(body.get("purchased", False)),
        body.get("features"),
    )
    return {"ok": True}


@app.post("/api/pricing/train")
async def pricing_train(_: str = Depends(verify_password)):
    return train_model(cfg)


def _nightly_train() -> None:
    train_model(cfg)


def main() -> None:
    scheduler = BackgroundScheduler()
    hour = int(cfg.get("pricing", {}).get("train_hour_utc", 3))
    scheduler.add_job(_nightly_train, "cron", hour=hour, minute=0)
    scheduler.start()
    uvicorn.run(
        app,
        host=cfg["panel"]["host"],
        port=int(cfg["panel"]["port"]),
        log_level="info",
    )


if __name__ == "__main__":
    main()
