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

# Non-root user
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

WORKDIR /app

COPY --from=builder /install /usr/local
COPY --chown=appuser:appuser . .

RUN mkdir -p /app/uploads /tmp/.cache/fontconfig && \
    chmod +x /app/entrypoint.sh && \
    chown -R appuser:appuser /app/uploads /tmp/.cache

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["/app/entrypoint.sh"]
