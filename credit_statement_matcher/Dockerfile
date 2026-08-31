FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=2 \
    OPENBLAS_NUM_THREADS=2 \
    UPLOAD_DIR=/tmp/statement_uploads \
    ROOT_PATH=/statement \
    PORT=8010

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fonts-noto-core \
        libgl1 \
        poppler-utils \
        tesseract-ocr \
        tesseract-ocr-eng \
        tesseract-ocr-tha \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 appuser \
    && useradd --uid 10001 --gid appuser --create-home appuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download the small PP-OCRv4 mobile models while building. Runtime uploads
# stay fully offline and never pause waiting for a model download.
RUN python -c "from rapidocr import RapidOCR; RapidOCR()"

COPY --chown=appuser:appuser app ./app

RUN mkdir -p /tmp/statement_uploads \
    && chown -R appuser:appuser /tmp/statement_uploads

USER appuser

EXPOSE 8010

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8010/health', timeout=3)"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
