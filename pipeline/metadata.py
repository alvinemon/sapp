"""Title normalization, poster frames, optional TMDB posters."""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import httpx

from common import parse_quality, parse_season_episode, slugify

# Strip release tags, codecs, groups from torrent names.
_NOISE_PATTERNS = [
    r"\b(?:WEB[- ]?DL|WEBRip|BluRay|BDRip|HDRip|HDTV|DVDRip|x264|x265|HEVC|AAC|DDP?\d?\.\d|10bit|8bit)\b",
    r"\b(?:YTS|RARBG|TGx|EZTV|SubsPlease|EMBER|FLUX|NTb|Silence|EVO|FGT|ION10|CMRG|SWAG)\b",
    r"\[.*?\]",
    r"\(.*?\)",
    r"\.{2,}",
]

_LANG_CATEGORY = [
    ("korean", "Korean"),
    ("hindi", "Hindi"),
    ("chinese", "Chinese"),
    ("mandarin", "Chinese"),
    ("bangla", "Bangla"),
    ("bengali", "Bangla"),
    ("english", "English"),
    ("anime", "Anime"),
]


def normalize_show_title(text: str) -> str:
    """Human-readable show/movie title from RSS or torrent name."""
    title = text.strip()
    title, _, _ = parse_season_episode(title)
    title = re.sub(r"\b(19|20)\d{2}\b", "", title)
    for pat in _NOISE_PATTERNS:
        title = re.sub(pat, " ", title, flags=re.IGNORECASE)
    title = re.sub(r"[_\.]+", " ", title)
    title = re.sub(r"\s+", " ", title).strip(" -_")
    return title.title() if title else text.strip()[:120]


def series_key(title: str) -> str:
    return slugify(normalize_show_title(title))[:64]


def parse_year(text: str) -> int | None:
    m = re.search(r"\b(19|20)(\d{2})\b", text)
    if not m:
        return None
    year = int(m.group(1) + m.group(2))
    return year if 1950 <= year <= 2035 else None


def infer_category(title: str, languages: list[str], season: int | None, feed_category: str = "") -> str:
    if feed_category:
        return feed_category
    lower = title.lower()
    for needle, label in _LANG_CATEGORY:
        if needle in lower:
            return label
    for lang in languages:
        if lang and len(lang) < 30:
            return lang
    if season is not None:
        return "Series"
    return "Movies"


def build_description(quality: str | None, languages: list[str], year: int | None) -> str:
    parts = [p for p in [quality, " · ".join(languages) if languages else None, str(year) if year else None] if p]
    return " · ".join(parts) if parts else "Stream on 2hotatl"


def extract_poster_frame(video: Path, out_jpg: Path, at_seconds: int = 300) -> bool:
    if not shutil.which("ffmpeg"):
        return False
    out_jpg.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [
            "ffmpeg", "-y",
            "-ss", str(at_seconds),
            "-i", str(video),
            "-frames:v", "1",
            "-q:v", "2",
            "-vf", "scale=720:-1",
            str(out_jpg),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    return result.returncode == 0 and out_jpg.exists() and out_jpg.stat().st_size > 1000


def fetch_tmdb_poster_url(title: str, cfg: dict[str, Any]) -> str | None:
    meta_cfg = cfg.get("metadata") or {}
    api_key = str(meta_cfg.get("tmdb_api_key") or "").strip()
    if not api_key or api_key.startswith("YOUR_"):
        return None
    try:
        with httpx.Client(timeout=15.0) as client:
            search = client.get(
                "https://api.themoviedb.org/3/search/multi",
                params={"api_key": api_key, "query": normalize_show_title(title), "page": 1},
            )
            search.raise_for_status()
            results = search.json().get("results") or []
            if not results:
                return None
            hit = results[0]
            path = hit.get("poster_path")
            if not path:
                return None
            base = str(meta_cfg.get("tmdb_image_base", "https://image.tmdb.org/t/p/w500"))
            return f"{base.rstrip('/')}{path}"
    except Exception:
        return None
