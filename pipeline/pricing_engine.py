"""Dynamic Early Access pricing — XGBoost purchase probability, price × P optimization."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import numpy as np

from common import load_config
from pricing_db import connect, get_user_features, log_purchase_attempt

FEATURE_ORDER = [
    "session_frequency",
    "watch_time_minutes",
    "device_type_android",
    "location_unknown",
    "preferred_hour",
    "preferred_dow",
    "price_shown",
]


class PricingEngine:
    def __init__(self, cfg: dict[str, Any] | None = None):
        self.cfg = cfg or load_config()
        self.db_path = self.cfg["pricing"]["db_path"]
        self.price_steps = [float(p) for p in self.cfg["pricing"]["price_steps"]]
        self.currency = self.cfg["pricing"].get("currency", "BDT")
        self.cache_ttl = int(self.cfg["pricing"].get("cache_ttl_seconds", 3600))
        self.model = None
        self._load_model()

    def _model_path(self) -> Path:
        return Path(self.db_path).parent / "pricing_model.json"

    def _load_model(self) -> None:
        path = self._model_path()
        if not path.exists():
            self.model = None
            return
        try:
            import xgboost as xgb
            self.model = xgb.XGBClassifier()
            self.model.load_model(str(path))
        except Exception:
            self.model = None

    def _feature_vector(self, user_id: str, price: float) -> list[float]:
        conn = connect(self.db_path)
        base = get_user_features(conn, user_id)
        conn.close()
        base["price_shown"] = price
        return [base[k] for k in FEATURE_ORDER]

    def _predict_prob(self, user_id: str, price: float) -> float:
        if self.model is None:
            # Heuristic fallback before first training
            base = 0.35 - (price / max(self.price_steps)) * 0.2
            return max(0.05, min(0.85, base))

        vec = np.array([self._feature_vector(user_id, price)])
        prob = float(self.model.predict_proba(vec)[0][1])
        return max(0.01, min(0.99, prob))

    def _cache_get(self, user_id: str, content_id: str) -> float | None:
        conn = connect(self.db_path)
        row = conn.execute(
            "SELECT price, expires_at FROM price_cache WHERE user_id=? AND content_id=?",
            (user_id, content_id),
        ).fetchone()
        conn.close()
        if row and row["expires_at"] > time.time():
            return float(row["price"])
        return None

    def _cache_set(self, user_id: str, content_id: str, price: float, prob: float) -> None:
        conn = connect(self.db_path)
        conn.execute(
            """
            INSERT INTO price_cache (user_id, content_id, price, probability, expires_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, content_id) DO UPDATE SET
                price=excluded.price, probability=excluded.probability, expires_at=excluded.expires_at
            """,
            (user_id, content_id, price, prob, time.time() + self.cache_ttl),
        )
        conn.commit()
        conn.close()

    def quote(self, user_id: str, content_id: str) -> dict[str, Any]:
        cached = self._cache_get(user_id, content_id)
        if cached is not None:
            return {
                "user_id": user_id,
                "content_id": content_id,
                "price": cached,
                "currency": self.currency,
                "cached": True,
            }

        best_price = self.price_steps[0]
        best_score = -1.0
        best_prob = 0.0

        for price in self.price_steps:
            prob = self._predict_prob(user_id, price)
            score = price * prob
            if score > best_score:
                best_score = score
                best_price = price
                best_prob = prob

        self._cache_set(user_id, content_id, best_price, best_prob)
        return {
            "user_id": user_id,
            "content_id": content_id,
            "price": best_price,
            "currency": self.currency,
            "purchase_probability": round(best_prob, 4),
            "expected_revenue": round(best_price * best_prob, 2),
            "cached": False,
        }

    def record_attempt(
        self,
        user_id: str,
        content_id: str,
        price_shown: float,
        purchased: bool,
        features: dict[str, Any] | None = None,
    ) -> None:
        conn = connect(self.db_path)
        log_purchase_attempt(conn, user_id, content_id, price_shown, purchased, self.currency, features)
        conn.close()


def train_model(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """Train XGBoost on purchase_attempts — run nightly."""
    cfg = cfg or load_config()
    db_path = cfg["pricing"]["db_path"]
    conn = connect(db_path)
    rows = conn.execute(
        "SELECT user_id, price_shown, purchased FROM purchase_attempts"
    ).fetchall()
    conn.close()

    if len(rows) < 20:
        return {"ok": False, "error": "need at least 20 purchase attempts to train", "samples": len(rows)}

    import pandas as pd
    import xgboost as xgb
    from sklearn.model_selection import train_test_split

    X, y = [], []
    for row in rows:
        feats = get_user_features(connect(db_path), row["user_id"])
        feats["price_shown"] = float(row["price_shown"])
        X.append([feats[k] for k in FEATURE_ORDER])
        y.append(int(row["purchased"]))

    df_x = pd.DataFrame(X, columns=FEATURE_ORDER)
    df_y = pd.Series(y)
    x_train, x_test, y_train, y_test = train_test_split(df_x, df_y, test_size=0.2, random_state=42)

    model = xgb.XGBClassifier(
        n_estimators=80,
        max_depth=4,
        learning_rate=0.1,
        eval_metric="logloss",
    )
    model.fit(x_train, y_train)
    acc = float(model.score(x_test, y_test))

    out = Path(db_path).parent / "pricing_model.json"
    model.save_model(str(out))

    return {"ok": True, "samples": len(rows), "test_accuracy": round(acc, 4), "model_path": str(out)}


if __name__ == "__main__":
    print(json.dumps(train_model(), indent=2))
