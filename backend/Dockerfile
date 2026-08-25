# ── Stage 1: dependency builder ───────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# WeasyPrint needs Pango/Cairo headers at build time
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq-dev gcc \
        libpango-1.0-0 libpangoft2-1.0-0 libpangocairo-1.0-0 \
        libcairo2 libgdk-pixbuf-xlib-2.0-0 libffi-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Match the production PostgreSQL 16 server for pre-sync custom-format backups.
FROM postgres:16-bookworm AS pg-client

# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# WeasyPrint runtime libs + Thai font + Poppler/Thai OCR + LibreOffice + curl
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 curl \
        libpango-1.0-0 libpangoft2-1.0-0 libpangocairo-1.0-0 \
        libcairo2 libgdk-pixbuf-xlib-2.0-0 libffi8 \
        fonts-thai-tlwg fonts-noto-core poppler-utils tesseract-ocr tesseract-ocr-tha \
        libreoffice-calc \
        fontconfig && \
    fc-cache -fv && \
    rm -rf /var/lib/apt/lists/*

# Stable non-root UID/GID: existing uploads stay readable across image rebuilds,
# and the one-time installer can grant this identity access to the mounted key.
RUN groupadd --system --gid 999 appuser && \
    useradd --system --uid 999 --gid appuser -d /app -s /sbin/nologin appuser

WORKDIR /app

COPY --from=builder /install /usr/local
COPY --from=pg-client /usr/lib/postgresql/16/bin/pg_dump /usr/local/bin/pg_dump
COPY --chown=appuser:appuser . .

RUN mkdir -p /app/uploads /tmp/.cache/fontconfig /run/secrets/hr-sync && \
    chmod +x /app/entrypoint.sh && \
    chown -R appuser:appuser /app/uploads /tmp/.cache /run/secrets/hr-sync

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["/app/entrypoint.sh"]
