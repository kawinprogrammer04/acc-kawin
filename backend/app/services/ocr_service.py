"""Extract structured data from receipt / tax-invoice images via a local
Ollama vision model — self-hosted, no per-request API cost.

Ollama must run natively on the host machine (not inside a Docker container):
Docker Desktop on macOS cannot pass the GPU (Metal) into a Linux container, so
an in-container Ollama would fall back to CPU-only inference and be very slow.
The backend container reaches the host's Ollama via `host.docker.internal`
(see OLLAMA_URL in app/core/config.py and the `extra_hosts` entry in
docker-compose.yml).

Setup on the host:
    brew install ollama
    ollama pull qwen2.5vl:7b   # or a lighter model — see CLAUDE.md
    ollama serve               # or let the Ollama menu-bar app run it
"""
from __future__ import annotations

import base64
import json

import httpx

from app.core.config import settings


class OcrServiceError(Exception):
    """Ollama is unreachable, the model isn't pulled, or the reply wasn't valid JSON.

    Callers should treat this as a soft failure — let the user fill the form
    manually — rather than blocking the document upload/workflow on it.
    """


# Structured-output schema passed to Ollama's `format` parameter — the model
# is constrained to return exactly this shape, no prompt-side JSON coaxing needed.
RECEIPT_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "vendor_name": {"type": "string", "description": "ชื่อร้าน/ผู้ขายบนใบเสร็จ"},
        "document_date": {"type": "string", "description": "วันที่บนเอกสาร รูปแบบ YYYY-MM-DD ถ้าอ่านได้"},
        "total_amount": {"type": "number", "description": "ยอดรวมสุดท้ายที่ต้องจ่าย"},
        "vat_amount": {"type": "number", "description": "ภาษีมูลค่าเพิ่ม ถ้าแยกแสดงไว้"},
        "tax_id": {"type": "string", "description": "เลขประจำตัวผู้เสียภาษี 13 หลัก ถ้ามี"},
        "reference_number": {"type": "string", "description": "เลขที่ใบเสร็จ/ใบกำกับภาษี"},
    },
    "required": ["total_amount"],
}

EXTRACT_PROMPT = (
    "อ่านใบเสร็จหรือใบกำกับภาษีในภาพนี้ แล้วดึงข้อมูลออกมาให้ครบตาม schema ที่กำหนด "
    "ถ้าฟิลด์ไหนอ่านไม่ได้หรือไม่มีในภาพ ให้เว้นว่างไว้ อย่าเดาตัวเลข"
)


async def extract_receipt_data(file_path: str) -> dict:
    """Read an image file and return structured receipt fields via Ollama.

    Raises OcrServiceError on any failure (connection refused, model not
    pulled, timeout, or a non-JSON reply) so the router can turn it into a
    502 with a clear message instead of a raw stack trace.
    """
    with open(file_path, "rb") as f:
        image_b64 = base64.b64encode(f.read()).decode("utf-8")

    payload = {
        "model": settings.OLLAMA_VISION_MODEL,
        "messages": [
            {"role": "user", "content": EXTRACT_PROMPT, "images": [image_b64]},
        ],
        "format": RECEIPT_SCHEMA,
        "stream": False,
    }

    try:
        async with httpx.AsyncClient(timeout=settings.OLLAMA_TIMEOUT_SECONDS) as client:
            response = await client.post(f"{settings.OLLAMA_URL}/api/chat", json=payload)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise OcrServiceError(
            f"เชื่อมต่อ Ollama ไม่ได้ที่ {settings.OLLAMA_URL} — ตรวจสอบว่า `ollama serve` "
            f"รันอยู่บนเครื่อง host และ pull โมเดล {settings.OLLAMA_VISION_MODEL} แล้ว ({exc})"
        ) from exc

    body = response.json()
    content = body.get("message", {}).get("content", "")
    try:
        return json.loads(content)
    except (json.JSONDecodeError, TypeError) as exc:
        raise OcrServiceError(f"Ollama ตอบกลับไม่เป็น JSON ที่อ่านได้: {content[:200]!r}") from exc
