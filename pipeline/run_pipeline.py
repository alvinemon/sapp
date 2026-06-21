"""Step 5: Master pipeline — chain ingest → process → upload → publish every 30 minutes."""

from __future__ import annotations

import traceback
from typing import Any

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.interval import IntervalTrigger

from common import ensure_dirs, load_config, read_json, setup_logger, utc_now_iso, write_json
from process import run_process
from publish import run_publish
from telegram_upload import run_upload


def run_pipeline_cycle(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or load_config()
    ensure_dirs(cfg)
    log = setup_logger("pipeline", cfg)
    log.info("=== Pipeline cycle start ===")
    results: dict[str, Any] = {"started_at": utc_now_iso(), "steps": {}}

    # RSS discovery runs in Node (rssScanner.ts); cycle handles post-download steps only.
    steps = [
        ("process", run_process),
        ("upload", run_upload),
        ("publish", run_publish),
    ]

    for name, fn in steps:
        try:
            log.info("Running step: %s", name)
            results["steps"][name] = fn(cfg)
        except Exception as e:
            log.error("Step %s failed: %s\n%s", name, e, traceback.format_exc())
            results["steps"][name] = {"ok": False, "error": str(e)}
            break

    results["finished_at"] = utc_now_iso()
    state = read_json(cfg["paths"]["state"], {})
    state["last_pipeline_run"] = results
    write_json(cfg["paths"]["state"], state)
    log.info("=== Pipeline cycle end ===")
    return results


def main() -> None:
    cfg = load_config()
    ensure_dirs(cfg)
    log = setup_logger("scheduler", cfg)
    minutes = int(cfg.get("rss", {}).get("poll_minutes", 30))

    log.info("Running initial pipeline cycle")
    run_pipeline_cycle(cfg)

    scheduler = BlockingScheduler()
    scheduler.add_job(
        run_pipeline_cycle,
        IntervalTrigger(minutes=minutes),
        kwargs={"cfg": cfg},
        id="content_pipeline",
        max_instances=1,
        coalesce=True,
    )
    log.info("Scheduler started — every %d minutes", minutes)
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("Scheduler stopped")


if __name__ == "__main__":
    main()
