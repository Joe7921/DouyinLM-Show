FROM node:24-bookworm-slim AS web-builder

WORKDIR /build/apps/web

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

COPY apps/web/ ./
RUN npm run build


FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/apps/server/src \
    APP_MODE=stage \
    APP_HOST=0.0.0.0 \
    DATA_DIR=/var/data \
    WEB_DIST_DIR=/app/apps/web/dist

RUN apt-get update \
    && apt-get install --no-install-recommends -y ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY apps/server/pyproject.toml /tmp/douyinlm-server/pyproject.toml
COPY apps/server/src/ /tmp/douyinlm-server/src/
RUN pip install --no-cache-dir /tmp/douyinlm-server \
    && rm -rf /tmp/douyinlm-server

COPY apps/server/alembic.ini /app/apps/server/alembic.ini
COPY apps/server/alembic/ /app/apps/server/alembic/
COPY apps/server/src/ /app/apps/server/src/
COPY --from=web-builder /build/apps/web/dist/ /app/apps/web/dist/
COPY deploy/render/seed-data/ /app/seed-data/
COPY scripts/render-entrypoint.sh /app/scripts/render-entrypoint.sh

RUN chmod +x /app/scripts/render-entrypoint.sh

EXPOSE 10000

CMD ["/app/scripts/render-entrypoint.sh"]
