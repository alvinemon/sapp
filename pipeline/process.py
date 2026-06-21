"""Step 2: Rename incoming videos, extract subtitles & poster, move to Ready."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

from common import (
    load_config,
    parse_language_tags,
    parse_quality,
    parse_season_episode,
    read_json,
    setup_logger,
    slugify,
    utc_now_iso,
    write_json,
)
from metadata import (
    build_description,
    extract_poster_frame,
    fetch_tmdb_poster_url,
    infer_category,
    normalize_show_title,
    parse_year,
    series_key,
)

VIDEO_EXT = {".mp4", ".mkv", ".avi", ".mov", ".m4v", ".webm"}
JOB_CONTEXT = ".pipeline_job.json"


def _run_ffmpeg(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["ffmpeg", "-y", *args],
        capture_output=True,
        text=True,
        timeout=3600,
    )


def _extract_subtitle(src: Path, dest_srt: Path) -> bool:
    if not shutil.which("ffprobe"):
        return False
    probe = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "s",
            "-show_entries", "stream=index", "-of", "csv=p=0", str(src),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if probe.returncode != 0 or not probe.stdout.strip():
        return False
    stream_idx = probe.stdout.strip().split("\n")[0]
    result = _run_ffmpeg(
        ["-i", str(src), "-map", f"0:{stream_idx}", "-c:s", "srt", str(dest_srt)],
    )
    return result.returncode == 0 and dest_srt.exists()


def _build_filename(title: str, season: int | None, episode: int | None, quality: str | None) -> str:
    base = slugify(title)
    parts = [base]
    if season is not None and episode is not None:
        parts.append(f"S{season:02d}E{episode:02d}")
    if quality:
        parts.append(quality.replace(" ", ""))
    return "_".join(parts) + ".mp4"


def _find_videos(folder: Path) -> list[Path]:
    out = []
    for p in folder.rglob("*"):
        if p.is_file() and p.suffix.lower() in VIDEO_EXT and not p.name.startswith("."):
            out.append(p)
    return out


def _load_job_context(incoming: Path) -> dict[str, Any]:
    path = incoming / JOB_CONTEXT
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _resolve_metadata(cfg: dict[str, Any], stem: str, job_ctx: dict[str, Any]) -> dict[str, Any]:
    rss_title = str(job_ctx.get("title") or "").strip()
    source_name = stem
    parse_from = rss_title or stem

    _, season, episode = parse_season_episode(parse_from)
    if season is None and rss_title:
        _, season, episode = parse_season_episode(stem)

    show_title = normalize_show_title(rss_title or stem)
    quality = parse_quality(parse_from) or parse_quality(stem)
    keywords = cfg.get("rss", {}).get("keywords", [])
    langs = parse_language_tags(parse_from, keywords) or parse_language_tags(stem, keywords)
    year = parse_year(parse_from) or parse_year(stem)
    feed_category = str(job_ctx.get("category") or "")
    category = infer_category(show_title, langs, season, feed_category)

    if season is not None and episode is not None:
        display_title = show_title
        episode_title = f"{show_title} S{season:02d}E{episode:02d}"
    else:
        display_title = show_title
        episode_title = show_title

    return {
        "title": display_title,
        "episode_title": episode_title,
        "show_title": show_title,
        "series_key": series_key(show_title),
        "season": season,
        "episode": episode,
        "quality": quality,
        "languages": langs,
        "year": year,
        "category": category,
        "description": build_description(quality, langs, year),
        "rss_title": rss_title,
        "source_name": source_name,
    }


def run_process(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or load_config()
    log = setup_logger("process", cfg)
    incoming = Path(cfg["paths"]["incoming"])
    ready = Path(cfg["paths"]["ready"])
    ready.mkdir(parents=True, exist_ok=True)
    state_path = cfg["paths"]["state"]
    state = read_json(state_path, {"processed_files": []})
    processed: set[str] = set(state.get("processed_files", []))
    job_ctx = _load_job_context(incoming)
    moved = 0

    for src in _find_videos(incoming):
        key = str(src.resolve())
        if key in processed:
            continue

        meta_fields = _resolve_metadata(cfg, src.stem, job_ctx)
        dest_name = _build_filename(
            meta_fields["show_title"],
            meta_fields["season"],
            meta_fields["episode"],
            meta_fields["quality"],
        )
        dest = ready / dest_name

        if dest.exists():
            dest = ready / f"{dest.stem}_{src.stat().st_mtime_ns}{dest.suffix}"

        try:
            if src.suffix.lower() == ".mp4":
                shutil.move(str(src), str(dest))
            else:
                result = _run_ffmpeg(
                    ["-i", str(src), "-c", "copy", "-movflags", "+faststart", str(dest)],
                )
                if result.returncode != 0:
                    log.error("Remux failed for %s: %s", src.name, result.stderr[-500:])
                    continue
                src.unlink(missing_ok=True)

            srt = dest.with_suffix(".srt")
            if _extract_subtitle(dest, srt):
                log.info("Extracted subtitle: %s", srt.name)

            poster = dest.with_suffix(".poster.jpg")
            if not extract_poster_frame(dest, poster):
                poster.unlink(missing_ok=True) if poster.exists() else None

            tmdb_poster = fetch_tmdb_poster_url(meta_fields["show_title"], cfg)

            meta = ready / f"{dest.stem}.meta.json"
            write_json(
                meta,
                {
                    **meta_fields,
                    "processed_at": utc_now_iso(),
                    "tmdb_poster_url": tmdb_poster,
                    "poster_path": str(poster) if poster.exists() else "",
                },
            )
            processed.add(key)
            moved += 1
            log.info("Ready: %s (%s)", dest.name, meta_fields["episode_title"])
        except Exception as e:
            log.error("Process failed %s: %s", src.name, e)

    ctx_path = incoming / JOB_CONTEXT
    if ctx_path.exists():
        ctx_path.unlink(missing_ok=True)

    state["processed_files"] = list(processed)[-10000:]
    state["last_process"] = utc_now_iso()
    write_json(state_path, state)
    log.info("Process complete — %d file(s) moved to Ready", moved)
    return {"ok": True, "moved": moved}


if __name__ == "__main__":
    run_process()
