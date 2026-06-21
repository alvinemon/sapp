"""CLI entry points for Node server to invoke pipeline steps."""

from __future__ import annotations

import argparse
import json
import sys

from common import load_config, read_json, write_json
from cleanup import run_cleanup
from telegram_direct import cmd_telegram_ingest
from qbittorrent_client import cmd_torrent_ingest, cmd_torrent_status, setup_qbittorrent
from ingest import run_ingest
from pricing_db import connect, revenue_analytics
from pricing_engine import train_model
from process import run_process
from publish import build_master_catalog, run_publish, sync_node_catalog
from run_pipeline import run_pipeline_cycle
from telegram_upload import run_upload


def cmd_analytics() -> None:
    cfg = load_config()
    conn = connect(cfg["pricing"]["db_path"])
    print(json.dumps(revenue_analytics(conn)))
    conn.close()


def cmd_set_early_access(item_id: str, enabled: bool) -> None:
    cfg = load_config()
    state = read_json(cfg["paths"]["state"], {})
    overrides = state.setdefault("early_access_overrides", {})
    overrides[item_id] = {"early_access": enabled}
    write_json(cfg["paths"]["state"], state)
    catalog = build_master_catalog(cfg)
    import logging
    sync_node_catalog(catalog, cfg, logging.getLogger("cli"))
    print(json.dumps({"ok": True, "id": item_id, "early_access": enabled}))


def main() -> None:
    parser = argparse.ArgumentParser(description="2hotatl pipeline CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("setup", help="Create data dirs and configure qBittorrent category")
    sub.add_parser("cycle", help="Run full pipeline cycle")
    sub.add_parser("ingest")
    sub.add_parser("process")
    sub.add_parser("upload")
    sub.add_parser("publish")
    sub.add_parser("cleanup", help="Delete ephemeral local files after Telegram upload")
    sub.add_parser("analytics")
    sub.add_parser("train")

    ea = sub.add_parser("early-access")
    ea.add_argument("item_id")
    ea.add_argument("enabled", choices=("true", "false"))

    quote = sub.add_parser("quote")
    quote.add_argument("user_id")
    quote.add_argument("content_id")

    attempt = sub.add_parser("attempt")
    metrics = sub.add_parser("metrics")
    metrics.add_argument("user_id")

    ti = sub.add_parser("torrent-ingest", help="Add a magnet or torrent URL to qBittorrent")
    ti.add_argument("url", help="Magnet URI or http(s) torrent URL")

    tg = sub.add_parser("telegram-ingest", help="Copy Telegram media to library channel (no local disk)")
    tg.add_argument("url", help="tgfile://chatId/messageId")
    tg.add_argument("--title", default="", help="Catalog title")

    ts = sub.add_parser("torrent-status", help="Poll torrent until download completes")
    ts.add_argument("hash", help="Torrent info-hash (hex)")
    ts.add_argument("--poll-interval", type=float, default=5.0, help="Seconds between polls")
    ts.add_argument("--timeout", type=float, default=86400.0, help="Max wait seconds")

    args = parser.parse_args()
    cfg = load_config()

    if args.cmd == "setup":
        from common import ensure_dirs
        ensure_dirs(cfg)
        try:
            print(json.dumps(setup_qbittorrent(cfg)))
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e), "dirs": True}))
    elif args.cmd == "cycle":
        print(json.dumps(run_pipeline_cycle(cfg)))
    elif args.cmd == "ingest":
        print(json.dumps(run_ingest(cfg)))
    elif args.cmd == "process":
        print(json.dumps(run_process(cfg)))
    elif args.cmd == "upload":
        print(json.dumps(run_upload(cfg)))
    elif args.cmd == "publish":
        print(json.dumps(run_publish(cfg)))
    elif args.cmd == "cleanup":
        print(json.dumps(run_cleanup(cfg)))
    elif args.cmd == "analytics":
        cmd_analytics()
    elif args.cmd == "train":
        print(json.dumps(train_model(cfg)))
    elif args.cmd == "early-access":
        cmd_set_early_access(args.item_id, args.enabled == "true")
    elif args.cmd == "quote":
        from pricing_engine import PricingEngine
        print(json.dumps(PricingEngine(cfg).quote(args.user_id, args.content_id)))
    elif args.cmd == "attempt":
        from pricing_engine import PricingEngine
        body = json.load(sys.stdin)
        PricingEngine(cfg).record_attempt(
            body["user_id"],
            body["content_id"],
            float(body["price_shown"]),
            bool(body.get("purchased")),
            body.get("features"),
        )
        print(json.dumps({"ok": True}))
    elif args.cmd == "metrics":
        from pricing_db import connect, upsert_user
        body = json.load(sys.stdin)
        conn = connect(cfg["pricing"]["db_path"])
        upsert_user(conn, args.user_id, body)
        print(json.dumps({"ok": True}))
    elif args.cmd == "torrent-ingest":
        result = cmd_torrent_ingest(cfg, args.url)
        if result.get("hash"):
            state = read_json(cfg["paths"]["state"], {})
            pending = state.setdefault("pending_torrent_cleanup", [])
            h = str(result["hash"])
            if h not in pending:
                pending.append(h)
            state["pending_torrent_cleanup"] = pending[-500:]
            write_json(cfg["paths"]["state"], state)
        print(json.dumps(result))
    elif args.cmd == "telegram-ingest":
        print(json.dumps(cmd_telegram_ingest(cfg, args.url, args.title)))
    elif args.cmd == "torrent-status":
        print(
            json.dumps(
                cmd_torrent_status(
                    cfg,
                    args.hash,
                    poll_interval=args.poll_interval,
                    timeout=args.timeout,
                )
            )
        )


if __name__ == "__main__":
    main()
