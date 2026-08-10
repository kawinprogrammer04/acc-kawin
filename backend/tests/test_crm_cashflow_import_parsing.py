"""Tests for the legacy 8-column import row parser.

Every imported row starts with an unassigned invoice/document status. Values
in the legacy "ใบเสร็จ" column and the current "ใบกำกับภาษี" column are
intentionally ignored; accounting staff classify the document during review.
"""
import unittest
from io import BytesIO
from datetime import date
from decimal import Decimal

from openpyxl import load_workbook

from app.routers.crm_cashflow import (
    DEFAULT_IMPORT_SOURCE_NAME,
    IMPORT_HEADERS_10,
    _normalize_import_row,
    _prepare_import_rows,
    download_import_template,
)


class LegacyEightColumnImportTests(unittest.TestCase):
    def test_receipt_present_starts_unassigned(self):
        row = ["2025-02-27", "รายจ่าย", "อุปกรณ์คอมพิวเตอร์", "-15000",
               "ซื้อเครื่องปริ้นเตอร์ใหม่", "1", "1", "ฝ่ายจัดซื้อ"]

        normalized = _normalize_import_row(row, legacy_eight_columns=True)

        self.assertIsNone(normalized["invoice"])

    def test_receipt_absent_maps_to_none(self):
        row = ["2025-02-27", "รายรับ", "ยอดขายออนไลน์", "15000",
               "รายได้จากการขายสินค้าออนไลน์", "0", "0", "ฝ่ายขาย"]

        normalized = _normalize_import_row(row, legacy_eight_columns=True)

        self.assertIsNone(normalized["invoice"])

    def test_receipt_column_is_ignored_even_when_malformed(self):
        row = ["2025-02-27", "รายจ่าย", "ค่าเช่า", "-12000",
               "ค่าเช่าสำนักงานประจำเดือน", "ไม่ทราบ", "0", "ฝ่ายบัญชี"]

        normalized = _normalize_import_row(row, legacy_eight_columns=True)

        self.assertIsNone(normalized["invoice"])

    def test_current_ten_column_invoice_value_is_ignored(self):
        row = ["2025-02-27", "รายจ่าย", "ค่าเช่า", "สำนักงาน", "ได้รับแล้ว",
               "0", "0", "-12000", "REF-1", "ฝ่ายบัญชี"]

        normalized = _normalize_import_row(row, legacy_eight_columns=False)

        self.assertIsNone(normalized["invoice"])

    def test_report_export_invoice_value_is_ignored(self):
        row = ["1", "ฝ่ายบัญชี", "2025-02-27", "รายจ่าย", "ค่าเช่า",
               "สำนักงาน", "ได้รับแล้ว", "OFF", "0", "-12000"]

        normalized = _normalize_import_row(
            row, legacy_eight_columns=False, report_export_columns=True,
        )

        self.assertIsNone(normalized["invoice"])

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


class CurrentImportFormatTests(unittest.TestCase):
    def test_positive_expense_is_saved_as_negative_amount(self):
        row = ["2025-02-27", "รายจ่าย", "ค่าเช่า", "สำนักงาน", "", "0",
               "0", "12000", "", "ฝ่ายบัญชี"]

        normalized = _normalize_import_row(row, legacy_eight_columns=False)

        self.assertEqual(normalized["income"], Decimal("0"))
        self.assertEqual(normalized["expense"], Decimal("-12000"))

    def test_blank_source_is_valid(self):
        rows = [
            IMPORT_HEADERS_10,
            ["2025-02-27", "รายจ่าย", "", "สำนักงาน", "", "0",
             "0", "12000", "", "ฝ่ายบัญชี"],
        ]

        prepared = _prepare_import_rows(rows, has_header=True)

        self.assertEqual(prepared[0]["errors"], [])
        self.assertEqual(prepared[0]["data"]["source"], "")
        self.assertEqual(DEFAULT_IMPORT_SOURCE_NAME, "ไม่ระบุ")


class ImportTemplateTests(unittest.IsolatedAsyncioTestCase):
    async def test_xlsx_template_has_separate_positive_income_and_expense_columns(self):
        response = await download_import_template("xlsx")
        content = b"".join([chunk async for chunk in response.body_iterator])
        workbook = load_workbook(BytesIO(content), data_only=True)
        sheet = workbook.active

        headers = [cell.value for cell in sheet[1]]
        self.assertEqual(headers, IMPORT_HEADERS_10)
        self.assertTrue(any(
            row[6] == 0 and row[7] > 0
            for row in sheet.iter_rows(min_row=2, values_only=True)
        ))
        self.assertTrue(any(
            row[2] is None
            for row in sheet.iter_rows(min_row=2, values_only=True)
        ))


if __name__ == "__main__":
    unittest.main()
