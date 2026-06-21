"""SQLite schema for user engagement and purchase logs."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    session_frequency REAL DEFAULT 0,
    watch_time_minutes REAL DEFAULT 0,
    device_type TEXT DEFAULT 'unknown',
    location_region TEXT DEFAULT 'unknown',
    preferred_hour INTEGER DEFAULT 12,
    preferred_dow INTEGER DEFAULT 0,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS purchase_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    content_id TEXT NOT NULL,
    price_shown REAL NOT NULL,
    currency TEXT DEFAULT 'BDT',
    purchased INTEGER NOT NULL DEFAULT 0,
    features_json TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_cache (
    user_id TEXT NOT NULL,
    content_id TEXT NOT NULL,
    price REAL NOT NULL,
    probability REAL,
    expires_at REAL NOT NULL,
    PRIMARY KEY (user_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_attempts_user ON purchase_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_content ON purchase_attempts(content_id);
"""


def connect(db_path: str) -> sqlite3.Connection:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def upsert_user(conn: sqlite3.Connection, user_id: str, metrics: dict[str, Any]) -> None:
    conn.execute(
        """
        INSERT INTO users (user_id, session_frequency, watch_time_minutes, device_type,
                           location_region, preferred_hour, preferred_dow, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET
            session_frequency=excluded.session_frequency,
            watch_time_minutes=excluded.watch_time_minutes,
            device_type=excluded.device_type,
            location_region=excluded.location_region,
            preferred_hour=excluded.preferred_hour,
            preferred_dow=excluded.preferred_dow,
            updated_at=datetime('now')
        """,
        (
            user_id,
            metrics.get("session_frequency", 0),
            metrics.get("watch_time_minutes", 0),
            metrics.get("device_type", "unknown"),
            metrics.get("location_region", "unknown"),
            metrics.get("preferred_hour", 12),
            metrics.get("preferred_dow", 0),
        ),
    )
    conn.commit()


def log_purchase_attempt(
    conn: sqlite3.Connection,
    user_id: str,
    content_id: str,
    price_shown: float,
    purchased: bool,
    currency: str = "BDT",
    features: dict[str, Any] | None = None,
) -> None:
    import json
    conn.execute(
        """
        INSERT INTO purchase_attempts (user_id, content_id, price_shown, currency, purchased, features_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        """,
        (user_id, content_id, price_shown, currency, 1 if purchased else 0, json.dumps(features or {})),
    )
    conn.commit()


def get_user_features(conn: sqlite3.Connection, user_id: str) -> dict[str, float]:
    row = conn.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        return {
            "session_frequency": 1.0,
            "watch_time_minutes": 30.0,
            "device_type_android": 1.0,
            "location_unknown": 1.0,
            "preferred_hour": 20.0,
            "preferred_dow": 5.0,
        }
    device_android = 1.0 if (row["device_type"] or "").lower() == "android" else 0.0
    return {
        "session_frequency": float(row["session_frequency"] or 0),
        "watch_time_minutes": float(row["watch_time_minutes"] or 0),
        "device_type_android": device_android,
        "location_unknown": 1.0 if (row["location_region"] or "unknown") == "unknown" else 0.0,
        "preferred_hour": float(row["preferred_hour"] or 12),
        "preferred_dow": float(row["preferred_dow"] or 0),
    }


def revenue_analytics(conn: sqlite3.Connection) -> dict[str, Any]:
    rows = conn.execute(
        """
        SELECT price_shown, purchased, currency FROM purchase_attempts
        """
    ).fetchall()
    if not rows:
        return {"total_purchases": 0, "total_attempts": 0, "average_price": 0, "distribution": []}

    purchases = [r for r in rows if r["purchased"]]
    prices = [float(r["price_shown"]) for r in purchases]
    dist: dict[float, int] = {}
    for p in prices:
        dist[p] = dist.get(p, 0) + 1

    return {
        "total_purchases": len(purchases),
        "total_attempts": len(rows),
        "average_price": sum(prices) / len(prices) if prices else 0,
        "conversion_rate": len(purchases) / len(rows) if rows else 0,
        "distribution": [{"price": k, "count": v} for k, v in sorted(dist.items())],
    }
