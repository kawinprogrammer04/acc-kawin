import io
import unittest
import zipfile
from datetime import date
from decimal import Decimal
from xml.etree import ElementTree as ET
from unittest.mock import patch

from app.schemas.tax_invoice import (
    TaxInvoiceCustomer,
    TaxInvoiceDocument,
    TaxInvoiceLine,
)
from app.services.tax_invoice_template import build_tax_invoice_pdf, build_tax_invoice_xlsx


class TaxInvoiceTemplateTests(unittest.TestCase):
    def _document(self) -> TaxInvoiceDocument:
        return TaxInvoiceDocument(
            invoice_number="INV-TEST-001",
            invoice_date=date(2026, 7, 23),
            order_numbers=["SO-001"],
            customer=TaxInvoiceCustomer(
                name="บริษัท ทดสอบ จำกัด",
                address="1 ถนนทดสอบ\nกรุงเทพมหานคร 10160",
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
            notes="อ้างอิง SO-001",
        )

    def test_populates_cells_and_preserves_drawings(self):
        xlsx = build_tax_invoice_xlsx(self._document(), "all")
        with zipfile.ZipFile(io.BytesIO(xlsx)) as archive:
            self.assertIn("xl/drawings/drawing1.xml", archive.namelist())
            self.assertIn("xl/media/image1.png", archive.namelist())
            sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
            namespace = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

            def inline_text(reference: str) -> str:
                cell = sheet.find(f".//x:c[@r='{reference}']", namespace)
                self.assertIsNotNone(cell)
                return "".join(cell.itertext())

            self.assertEqual(inline_text("C13"), "บริษัท ทดสอบ จำกัด")
            self.assertEqual(inline_text("X13"), "บริษัท ทดสอบ จำกัด")
            self.assertEqual(inline_text("AS13"), "บริษัท ทดสอบ จำกัด")
            self.assertEqual(inline_text("C20"), "SKU-1")
            self.assertEqual(inline_text("AS20"), "SKU-1")
            self.assertIn("สองร้อยสาม", inline_text("C43"))

    def test_customer_first_description_row_matches_other_detail_rows(self):
        xlsx = build_tax_invoice_xlsx(self._document(), "all")
        with zipfile.ZipFile(io.BytesIO(xlsx)) as archive:
            sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
            namespace = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            merge_refs = {
                merge.attrib["ref"]
                for merge in sheet.findall(".//x:mergeCell", namespace)
            }
            self.assertIn("E20:J20", merge_refs)
            self.assertNotIn("E20:I20", merge_refs)

    def test_selected_copy_changes_only_print_area(self):
        xlsx = build_tax_invoice_xlsx(self._document(), "customer")
        with zipfile.ZipFile(io.BytesIO(xlsx)) as archive:
            workbook = ET.fromstring(archive.read("xl/workbook.xml"))
            namespace = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            print_area = workbook.find(
                ".//x:definedName[@name='_xlnm.Print_Area']", namespace
            )
            self.assertIsNotNone(print_area)
            self.assertEqual(print_area.text, "'1'!$B$2:$U$54")

    def test_wraps_line_item_cells_and_adds_pages_for_more_than_one_page(self):
        document = self._document()
        document.lines = document.lines * 23
        xlsx = build_tax_invoice_xlsx(document, "customer")
        with zipfile.ZipFile(io.BytesIO(xlsx)) as archive:
            sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
            workbook = ET.fromstring(archive.read("xl/workbook.xml"))
            styles = ET.fromstring(archive.read("xl/styles.xml"))
            namespace = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

            print_area = workbook.find(
                ".//x:definedName[@name='_xlnm.Print_Area']", namespace
            )
            self.assertIsNotNone(print_area)
            self.assertEqual(print_area.text, "'1'!$B$2:$U$54,'1'!$B$56:$U$108")

            sequence_cell = sheet.find(".//x:c[@r='B74']", namespace)
            description_cell = sheet.find(".//x:c[@r='E74']", namespace)
            self.assertIsNotNone(sequence_cell)
            self.assertIsNotNone(description_cell)
            self.assertEqual("".join(sequence_cell.itertext()), "23")
            self.assertEqual("".join(description_cell.itertext()), "สินค้าทดสอบ")

            cell_xfs = styles.find("x:cellXfs", namespace)
            self.assertIsNotNone(cell_xfs)
            style = cell_xfs[int(description_cell.attrib["s"])]
            alignment = style.find("x:alignment", namespace)
            self.assertIsNotNone(alignment)
            self.assertEqual(alignment.attrib.get("wrapText"), "1")

    def test_long_line_description_uses_more_rows_without_becoming_new_item(self):
        document = self._document()
        document.lines = [
            TaxInvoiceLine(
                product_code="SKU-LONG-001",
                description=(
                    "รายละเอียดสินค้าที่มีความยาวมากพอให้ต้องขึ้นบรรทัดใหม่"
                    " ภายในช่องรายละเอียดเดิม โดยไม่สร้างรายการสินค้าใหม่"
                ),
                quantity=Decimal("1"),
                unit="ชุดอุปกรณ์",
                unit_price=Decimal("100"),
            ),
            TaxInvoiceLine(
                product_code="SKU-2",
                description="สินค้าถัดไป",
                quantity=Decimal("1"),
                unit="ชิ้น",
                unit_price=Decimal("200"),
            ),
        ]
        xlsx = build_tax_invoice_xlsx(document, "customer")
        with zipfile.ZipFile(io.BytesIO(xlsx)) as archive:
            sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
            namespace = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            merge_refs = {
                merge.attrib["ref"]
                for merge in sheet.findall(".//x:mergeCell", namespace)
            }

            first_description = sheet.find(".//x:c[@r='E20']", namespace)
            self.assertIsNotNone(first_description)
            self.assertIn("\n", "".join(first_description.itertext()))
            self.assertIn("E20:J23", merge_refs)

            next_sequence = sheet.find(".//x:c[@r='B24']", namespace)
            next_description = sheet.find(".//x:c[@r='E24']", namespace)
            self.assertIsNotNone(next_sequence)
            self.assertIsNotNone(next_description)
            self.assertEqual("".join(next_sequence.itertext()), "2")
            self.assertEqual("".join(next_description.itertext()), "สินค้าถัดไป")

    def test_pdf_export_uses_excel_template_workbook(self):
        with patch(
            "app.services.tax_invoice_template.convert_xlsx_to_pdf",
            return_value=b"%PDF-1.7\n",
        ) as converter:
            pdf = build_tax_invoice_pdf(self._document(), "all")

        self.assertTrue(pdf.startswith(b"%PDF"))
        converter.assert_called_once()
        xlsx_bytes = converter.call_args.args[0]
        with zipfile.ZipFile(io.BytesIO(xlsx_bytes)) as archive:
            self.assertIn("xl/worksheets/sheet1.xml", archive.namelist())


if __name__ == "__main__":
    unittest.main()
