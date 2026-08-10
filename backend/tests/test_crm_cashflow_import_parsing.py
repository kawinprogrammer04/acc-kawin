"""Tests for the legacy 8-column import row parser.

This format (วันที่/หัวข้อ/รายการ/จำนวนเงิน/รายละเอียด/ใบเสร็จ/เบิกคืน/แผนก) is
used to bulk-load the tax-invoice tracking worklist. The "ใบเสร็จ" column
(0=ไม่มีใบเสร็จ, 1=มีใบเสร็จ) is a plain yes/no flag, distinct from the
3-state cfstate_invoice tracking status — it maps onto that status as:
  0 (ไม่มีใบเสร็จ) -> None (ไม่มีใบกำกับ)
  1 (มีใบเสร็จ)    -> 0    (รอใบกำกับ)
"ได้รับแล้ว" (1) is never set by import; it only happens via the explicit
ตรวจสอบแล้ว step. Every imported row also starts unverified
(cfstate_verified defaults to 0) — that's what actually gates whether it
shows up on /crm-cashflow/invoices.
"""
import unittest
from datetime import date
from decimal import Decimal

from app.routers.crm_cashflow import _normalize_import_row


class LegacyEightColumnImportTests(unittest.TestCase):
    def test_receipt_present_maps_to_pending(self):
        row = ["2025-02-27", "รายจ่าย", "อุปกรณ์คอมพิวเตอร์", "-15000",
               "ซื้อเครื่องปริ้นเตอร์ใหม่", "1", "1", "ฝ่ายจัดซื้อ"]

        normalized = _normalize_import_row(row, legacy_eight_columns=True)

        self.assertEqual(normalized["invoice"], 0)

    def test_receipt_absent_maps_to_none(self):
        row = ["2025-02-27", "รายรับ", "ยอดขายออนไลน์", "15000",
               "รายได้จากการขายสินค้าออนไลน์", "0", "0", "ฝ่ายขาย"]

        normalized = _normalize_import_row(row, legacy_eight_columns=True)

        self.assertIsNone(normalized["invoice"])

    def test_malformed_receipt_column_still_raises(self):
        row = ["2025-02-27", "รายจ่าย", "ค่าเช่า", "-12000",
               "ค่าเช่าสำนักงานประจำเดือน", "ไม่ทราบ", "0", "ฝ่ายบัญชี"]

        with self.assertRaises(ValueError):
            _normalize_import_row(row, legacy_eight_columns=True)

    def test_other_fields_still_parsed_normally(self):
        row = ["2025-02-27", "รายจ่าย", "ค่าน้ำ", "-1200",
               "ค่าน้ำประจำเดือน", "1", "0", "ฝ่ายบัญชี"]

        normalized = _normalize_import_row(row, legacy_eight_columns=True)

        self.assertEqual(normalized["cfstate_date"], date(2025, 2, 27))
        self.assertEqual(normalized["category"], "รายจ่าย")
        self.assertEqual(normalized["source"], "ค่าน้ำ")
        self.assertEqual(normalized["detail"], "ค่าน้ำประจำเดือน")
        self.assertEqual(normalized["income"], Decimal("0"))
        self.assertEqual(normalized["expense"], Decimal("-1200"))
        self.assertEqual(normalized["refrain"], 0)
        self.assertEqual(normalized["department"], "ฝ่ายบัญชี")


if __name__ == "__main__":
    unittest.main()
