# 2hotatl Content Pipeline

Automated ingestion → processing → Telegram CDN → catalogue publication, plus an internal control panel and dynamic Early Access pricing engine.

Plugs into the existing Node app at `data/catalog.json` and `/api/catalog`.

## Prerequisites

- Python 3.11+
- **ffmpeg** / **ffprobe** on PATH (subtitle extract + remux only — no re-encoding)
- **qBittorrent** with Web UI enabled
- Telegram bot token + private channel ID

## Setup

```bash
cd pipeline
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp config.example.yaml config.yaml
# Edit config.yaml — RSS URL, qBittorrent, Telegram, panel password
```

Point qBittorrent **Incoming** category save path to `paths.incoming` in config (default: `../data/pipeline/incoming`).

## Run

### Full pipeline (30-minute loop)

```bash
python run_pipeline.py
```

Steps each cycle:

1. **ingest** — RSS → qBittorrent `Incoming`
2. **process** — rename, extract `.srt`, move to `Ready` (no transcode)
3. **telegram_upload** — split >2GB, upload chunks, log file IDs
4. **publish** — master JSON → dpaste + sync `data/catalog.json`

### Control panel + pricing API (port 5050)

**Integrated into the main Control Portal** — open `/?tab=pipeline` (same login as the rest of the portal; no separate password).

The Node server invokes Python via `pipeline/cli.py` for runs, early access, analytics, and pricing. You do **not** need to run `panel.py` unless you want a standalone debug UI.

Optional standalone panel (legacy):

```bash
python panel.py
```

### Train pricing model (nightly automatic; manual)

```bash
python pricing_engine.py
# or POST /api/pricing/train from the panel (authenticated)
```

## Integration with existing app

| Component | Integration |
|-----------|-------------|
| **Catalog** | Pipeline writes Telegram file IDs + early access flags into `data/catalog.json` |
| **Public paste** | Master catalogue URL saved to `data/pipeline/catalog_public_url.txt` |
| **Mobile stream** | App uses `telegramFileId` / `telegramFileIds` from catalog (headless Telegram client) |
| **Early Access** | `earlyAccess: true` for first 72h (configurable); dynamic price via XGBoost |
| **Payments** | Existing bKash/Nagad flow + `POST /api/premium/verify`; log attempts to pricing DB |
| **Watch parties** | Unchanged — WebRTC/WebSocket sync independent of pipeline |

### Catalog fields added (Node)

```json
{
  "telegramFileId": "BQACAg...",
  "telegramFileIds": ["..."],
  "subtitleFileId": "...",
  "earlyAccess": true,
  "earlyAccessUntil": "2026-06-24T12:00:00+00:00",
  "source": "telegram"
}
```

### Mobile Early Access flow

1. App syncs user metrics → `POST /api/users/{userId}/metrics`
2. User taps Early Access title → `GET /api/pricing/quote?userId=&contentId=`
3. Show price (BDT), process bKash/Nagad payment
4. On success → `POST /api/pricing/attempt` with `purchased: true`
5. Grant permanent unlock via existing premium verify/grant

## Directory layout

```
data/pipeline/
  incoming/          # qBittorrent downloads
  ready/             # Processed files awaiting upload
  logs/              # Per-module logs
  upload_log.json    # Telegram file ID registry
  master_catalog.json
  pricing.db         # Engagement + purchase logs
  pricing_model.json # Trained XGBoost model
  state.json         # Pipeline + early access overrides
```

## Early Access rules

- **Automatic**: titles are Early Access for `early_access.auto_hours` (default 72) after upload
- **Manual**: toggle per title in panel → `/catalog`
- Overrides stored in `state.json` → `early_access_overrides`

## Environment (Node)

```bash
PRICING_API_URL=http://127.0.0.1:5050
RENDER_DISK_PATH=/data   # align with pipeline paths on production
```

## systemd example

```ini
[Unit]
Description=2hotatl content pipeline
After=network.target

[Service]
WorkingDirectory=/opt/phone-hand/pipeline
ExecStart=/opt/phone-hand/pipeline/.venv/bin/python run_pipeline.py
Restart=always

[Install]
WantedBy=multi-user.target
```

```ini
[Unit]
Description=2hotatl pipeline panel
After=network.target

[Service]
WorkingDirectory=/opt/phone-hand/pipeline
ExecStart=/opt/phone-hand/pipeline/.venv/bin/python panel.py
Restart=always

[Install]
WantedBy=multi-user.target
```
