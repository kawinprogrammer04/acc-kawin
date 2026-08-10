import unittest
from datetime import date
from decimal import Decimal

from app.schemas.tax_invoice import (
    TaxInvoiceCustomer,
    TaxInvoiceDocument,
    TaxInvoiceLine,
)
from app.services.tax_invoice_payload import build_dompdf_payload


class DompdfRendererPayloadTests(unittest.TestCase):
    def _document(self) -> TaxInvoiceDocument:
        return TaxInvoiceDocument(
            invoice_number="INV-DOMPDF-001",
            invoice_date=date(2026, 7, 23),
            order_numbers=["SO-001"],
            customer=TaxInvoiceCustomer(
                name="บริษัท ทดสอบ จำกัด",
                address="1 ถนนทดสอบ กรุงเทพมหานคร",
                tax_id="0100000000001",
                branch="สำนักงานใหญ่",
            ),
            lines=[
                TaxInvoiceLine(
                    product_code="SKU-1",
                    description="สินค้าทดสอบ",
                    quantity=Decimal("2"),
                    unit="ชิ้น",
                    unit_price=Decimal("100"),
                )
            ],
            discount_amount=Decimal("10"),
            vat_rate=Decimal("7"),
        )

    def test_payload_contains_reconciled_totals_and_thai_text(self):
        payload = build_dompdf_payload(self._document(), "all")
        self.assertEqual(payload["totals"]["subtotal"], "200.00")
        self.assertEqual(payload["totals"]["discount"], "10.00")
        self.assertEqual(payload["totals"]["after_discount"], "190.00")
        self.assertEqual(payload["totals"]["vat_amount"], "13.30")
        self.assertEqual(payload["totals"]["grand_total"], "203.30")
        self.assertIn("สองร้อยสามบาท", payload["totals"]["amount_text"])

    def test_accepts_more_than_twenty_two_lines_for_pdf_pagination(self):
        document = self._document()
        document.lines = document.lines * 23
        payload = build_dompdf_payload(document, "all")
        self.assertEqual(len(payload["document"]["lines"]), 23)


if __name__ == "__main__":
    unittest.main()
