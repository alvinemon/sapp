# Pipeline worker: qBittorrent-nox + Python on Render/VPS — torrent → Telegram, no Mac storage.
FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    qbittorrent-nox ffmpeg supervisor curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/pipeline

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./
COPY config.render.yaml ./config.yaml
COPY docker/supervisord.conf /etc/supervisor/conf.d/pipeline.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV PYTHONPATH=/app/pipeline
ENV PIPELINE_CONFIG=/app/pipeline/config.yaml
ENV QBT_WEBUI_PORT=8080
ENV STORAGE_MODE=telegram
ENV PIPELINE_DATA_ROOT=/data/pipeline

RUN mkdir -p /data/pipeline/incoming /data/pipeline/ready /data/pipeline/logs /tmp/phone-hand-pipeline

EXPOSE 8090

CMD ["/entrypoint.sh"]
