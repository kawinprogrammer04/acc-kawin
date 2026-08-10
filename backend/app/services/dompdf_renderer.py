from __future__ import annotations

import httpx

from app.core.config import settings
from app.schemas.tax_invoice import TaxInvoiceDocument
from app.services.tax_invoice_payload import build_dompdf_payload


async def render_tax_invoice_pdf(
    document: TaxInvoiceDocument,
    copy_type: str,
) -> bytes:
    payload = build_dompdf_payload(document, copy_type)
    url = settings.DOMPDF_RENDERER_URL.rstrip("/") + "/render"

    async with httpx.AsyncClient(timeout=settings.DOMPDF_TIMEOUT_SECONDS) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()

    if not response.content.startswith(b"%PDF"):
        raise RuntimeError("Dompdf ตอบกลับข้อมูลที่ไม่ใช่ PDF")
    return response.content
