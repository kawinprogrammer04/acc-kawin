from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from app.schemas.tax_invoice import TaxInvoiceDocument
from app.services.tax_invoice_template import thai_baht_text

_COPY_TYPES = {"customer", "company", "accounting", "all"}


def _money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def build_dompdf_payload(
    document: TaxInvoiceDocument,
    copy_type: str,
) -> dict[str, object]:
    if copy_type not in _COPY_TYPES:
        raise ValueError("ประเภทสำเนาไม่ถูกต้อง")

    subtotal = _money(
        sum(
            (line.quantity * line.unit_price for line in document.lines),
            Decimal("0"),
        )
    )
    discount = _money(document.discount_amount)
    after_discount = _money(max(subtotal - discount, Decimal("0")))
    vat_amount = _money(after_discount * document.vat_rate / Decimal("100"))
    grand_total = _money(after_discount + vat_amount)

    return {
        "copy_type": copy_type,
        "document": document.model_dump(mode="json"),
        "totals": {
            "subtotal": str(subtotal),
            "discount": str(discount),
            "after_discount": str(after_discount),
            "vat_amount": str(vat_amount),
            "grand_total": str(grand_total),
            "amount_text": thai_baht_text(grand_total),
        },
    }
