import tempfile
import time
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from app.parsers import (
    OcrLine,
    ParsedStatement,
    PositionedWord,
    TrustedAmount,
    _build_transaction,
    _parse_amex_ocr,
    _parse_krungsri_ocr,
    _parse_scb_pdf,
    _parse_tesseract_tsv,
    _ocr_image_variants,
    _parse_ocr_currency_values,
    parse_statement_with_metadata,
)
from app.staging import (
    PreviewNotFoundError,
    cleanup_expired_previews,
    create_preview,
    load_preview,
    read_preview_source,
)
from app.main import _submitted_preview_rows, upload_job_progress


class FakeCrop:
    def __init__(self, text):
        self.text = text

    def extract_text(self, **_):
        return self.text


class FakeScbPage:
    width = 595
    height = 842

    def extract_words(self, **_):
        return [
            {
                "text": "02/04/26",
                "x0": 29,
                "top": 230,
                "bottom": 239,
            },
            {
                "text": "08/04/26",
                "x0": 29,
                "top": 244,
                "bottom": 253,
            },
        ]

    def crop(self, bbox):
        left, top, right, _ = bbox
        second = top > 240
        if left == 62:
            return FakeCrop("22:04" if second else "21:01")
        if left == 93:
            return FakeCrop("X1" if second else "X2")
        if left == 116:
            return FakeCrop("BCMS" if second else "POS")
        if left == 160:
            return FakeCrop("" if second else "66.00")
        if left == 250:
            return FakeCrop("1,737.99" if second else "")
        if left == 394:
            return FakeCrop("รับเงินจากลูกค้า" if second else "FACEBK TEST")
        return FakeCrop("")


class FakeScbDocument:
    pages = [FakeScbPage()]


def ocr_line(text, confidence=95, page=1, left=0, top=0):
    return OcrLine(
        text=text,
        confidence=confidence,
        page=page,
        words=[
            PositionedWord(
                text=text,
                left=left,
                top=top,
                width=100,
                height=10,
                confidence=confidence,
            )
        ],
    )


class PdfAdapterTests(unittest.TestCase):
    def test_scb_position_parser_signs_debit_and_credit(self):
        statement = _parse_scb_pdf(
            FakeScbDocument(),
            "THE SIAM COMMERCIAL BANK PUBLIC COMPANY LIMITED\n"
            "STATEMENT OF SAVING ACCOUNT\n"
            "Account No. 123-4562988\n"
            "01/04/2026 - 30/04/2026",
        )

        self.assertEqual(statement.extraction_method, "pdf_text")
        self.assertEqual(statement.masked_reference, "•••• 2988")
        self.assertEqual([item.amount for item in statement.transactions], [-66.0, 1737.99])
        self.assertEqual(statement.transactions[1].description, "รับเงินจากลูกค้า")

    def test_amex_ocr_marks_payment_as_negative(self):
        lines = [
            ocr_line("08/04/2026"),
            ocr_line("11 มีนาคม PAYMENT AT BANK - THANK YOU 79,170.94"),
            ocr_line("(12 มีนาคม) CR"),
            ocr_line("12 มีนาคม TIKTOK ADS SINGAPORE 29,302.04", 72, page=2),
            ocr_line("Membership Rewards", page=3),
            ocr_line("รายการทั้งหมดสำหรับ บัตรหมายเลข 1002", page=3),
            ocr_line("08 กรกฎาคม เงื่อนไขโปรโมชั่น 1,000.00", page=3),
        ]

        statement = _parse_amex_ocr(
            lines,
            "Amex1002.pdf",
            "\n".join(x.text for x in lines),
            [
                TrustedAmount(page=1, top=0, amount=79170.94, is_credit=True),
                TrustedAmount(
                    page=2,
                    top=0,
                    amount=29302.04,
                    is_credit=False,
                    merchant="TIKTOK ADS",
                    reference="ABC123",
                    location="SINGAPORE",
                ),
            ],
        )

        self.assertEqual(statement.masked_reference, "•••• 1002")
        self.assertEqual(statement.transactions[0].amount, -79170.94)
        self.assertEqual(statement.transactions[1].amount, 29302.04)
        self.assertEqual(statement.transactions[1].description, "TIKTOK ADS")
        self.assertEqual(statement.transactions[1].tr_code, "ABC123")
        self.assertEqual(statement.transactions[1].channel, "SINGAPORE")
        self.assertTrue(statement.transactions[1].warnings)

    def test_amex_ocr_stops_before_membership_rewards_page(self):
        lines = [
            ocr_line("08/04/2026"),
            ocr_line("12 มีนาคม TIKTOK ADS 29,302.04"),
            ocr_line("รายการ!ฟ๑ทา๒๐๒รท[เว Rewards", page=2),
            ocr_line("คะแนน Membership Reward.", page=2),
            ocr_line("ขาวสารและสิทธิพิเศษ", page=2),
            ocr_line("13 มีนาคม โปรโมชั่น 1,500.00", page=2),
            ocr_line("14 มีนาคม เงื่อนไขโปรโมชั่น 1,000.00", page=3),
        ]

        statement = _parse_amex_ocr(
            lines,
            "Amex1002.pdf",
            "\n".join(x.text for x in lines),
        )

        self.assertEqual(
            [item.description for item in statement.transactions],
            ["TIKTOK ADS"],
        )
        self.assertEqual(
            [item.amount for item in statement.transactions],
            [29302.04],
        )

    def test_krungsri_statement_without_transactions_is_valid(self):
        lines = [
            ocr_line("Krungsriayudhya Card Company Limited"),
            ocr_line("Card Number 4943 51XX XXXX 3476"),
            ocr_line("Statement Closing Date 25/06/26"),
            ocr_line("Total Payment Due -100.00"),
            ocr_line("Minimum Payment Due 0.00"),
            ocr_line("Shared Credit Line 110,000.00"),
            ocr_line("Shared Credit Line Used -89,102.90"),
            ocr_line("Shared Available Credit Limit 110,000.00"),
            ocr_line("Previous Statement Balance -100.00"),
            ocr_line("Transaction Date Posting Date Description Amount (Baht)"),
            ocr_line("Total Payments 0.00"),
        ]

        statement = _parse_krungsri_ocr(
            lines, "494351xxxxxx3476.pdf", "\n".join(x.text for x in lines)
        )

        self.assertEqual(statement.transactions, [])
        self.assertEqual(statement.masked_reference, "•••• 3476")
        self.assertEqual(statement.summary_totals["total_payment_due"], -100.0)
        self.assertEqual(statement.summary_totals["shared_credit_line"], 110000.0)
        self.assertEqual(
            statement.summary_totals["shared_credit_line_used"], -89102.9
        )
        self.assertEqual(
            statement.summary_totals["shared_available_credit_limit"], 110000.0
        )
        self.assertEqual(
            statement.summary_totals["previous_statement_balance"], -100.0
        )
        self.assertEqual(statement.summary_totals["total_payments"], 0.0)
        self.assertTrue(statement.warnings)

    def test_krungsri_pairs_summary_label_with_adjacent_amount_column(self):
        lines = [
            ocr_line("Krungsriayudhya Card Company Limited"),
            ocr_line(
                "Total Payment Due For Credit Card",
                left=600,
                top=100,
            ),
            ocr_line("100.00", left=1400, top=112),
            ocr_line("Minimum Payment Due", left=1100, top=200),
            ocr_line("0.00", left=1450, top=212),
        ]

        statement = _parse_krungsri_ocr(
            lines,
            "494351xxxxxx3476.pdf",
            "Krungsriayudhya Card Company Limited ไม่มียอดต้องชำระ",
        )

        self.assertEqual(statement.summary_totals["total_payment_due"], -100.0)
        self.assertEqual(statement.summary_totals["minimum_payment_due"], 0.0)

    def test_krungsri_repairs_damaged_currency_and_uses_nearest_column(self):
        lines = [
            ocr_line("Krungsriayudhya Card Company Limited"),
            ocr_line("Shared Credit Line", left=800, top=360),
            ocr_line("110.000 oo", left=1075, top=325),
            ocr_line("10000", left=1495, top=341),
            ocr_line("Shared Credit Line Used", left=800, top=442),
            ocr_line("-8910290", left=1080, top=395),
            ocr_line("Total Payments 0.00", left=990, top=1287),
            ocr_line("-100.00", left=1455, top=1262),
            ocr_line(
                "Total Payment Due For Credit Card 100.00",
                left=660,
                top=1327,
            ),
        ]

        statement = _parse_krungsri_ocr(
            lines,
            "494351xxxxxx3476.pdf",
            "Krungsriayudhya Card Company Limited",
        )

        self.assertEqual(statement.summary_totals["shared_credit_line"], 110000.0)
        self.assertEqual(
            statement.summary_totals["shared_credit_line_used"], -89102.9
        )
        self.assertEqual(statement.summary_totals["total_payments"], 0.0)
        self.assertEqual(statement.summary_totals["total_payment_due"], -100.0)
        self.assertEqual(
            _parse_ocr_currency_values("110.000 oo"), [110000.0]
        )

    def test_tesseract_literal_quote_does_not_swallow_following_rows(self):
        tsv = (
            "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
            '5\t1\t1\t1\t1\t1\t10\t10\t50\t10\t90\t"FACEBK\n'
            "5\t1\t1\t1\t2\t1\t100\t20\t50\t10\t90\tDUBLIN\n"
        )

        lines = _parse_tesseract_tsv(tsv, 1)

        self.assertEqual([line.text for line in lines], ['"FACEBK', "DUBLIN"])

    def test_ocr_preprocessing_builds_adaptive_black_and_white_variant(self):
        source = Image.new("RGB", (160, 80), "#d0d0d0")
        draw = ImageDraw.Draw(source)
        draw.rectangle((20, 25, 140, 50), fill="#454545")

        variants = _ocr_image_variants(source)

        self.assertEqual(
            set(variants), {"binary", "adaptive", "grayscale"}
        )
        self.assertTrue(set(variants["adaptive"].getdata()).issubset({0, 255}))
        self.assertEqual(variants["adaptive"].getpixel((80, 35)), 0)
        self.assertEqual(variants["adaptive"].getpixel((5, 5)), 255)

    def test_csv_metadata_remains_backward_compatible(self):
        statement = parse_statement_with_metadata(
            "statement.csv",
            "Date,Description,Amount\n2026-07-20,OFFICE SUPPLY,500.00\n".encode(),
        )

        self.assertEqual(statement.extraction_method, "csv")
        self.assertEqual(statement.transactions[0].amount, 500.0)

    def test_low_confidence_transaction_requires_review_warning(self):
        item = _build_transaction(
            transaction_date="2026-07-20",
            description="TEST",
            amount=100,
            confidence=55,
        )

        self.assertIn("OCR confidence ต่ำ ต้องตรวจทานก่อนนำเข้า", item.warnings)


class PreviewStagingTests(unittest.TestCase):
    def sample_statement(self):
        return ParsedStatement(
            issuer="Test",
            statement_type="credit_card",
            extraction_method="ocr",
            masked_reference="•••• 1234",
            statement_date_from="2026-07-01",
            statement_date_to="2026-07-31",
            summary_totals={},
            transactions=[
                _build_transaction(
                    transaction_date="2026-07-20",
                    description="TEST",
                    amount=100,
                )
            ],
        )

    def test_preview_round_trip_and_source_integrity(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            upload_dir = Path(temp_dir)
            token = create_preview(
                upload_dir, "statement.pdf", b"%PDF-test", self.sample_statement()
            )

            payload = load_preview(upload_dir, token)

            self.assertEqual(payload["statement"]["issuer"], "Test")
            self.assertEqual(read_preview_source(upload_dir, payload), b"%PDF-test")

    def test_expired_preview_is_removed(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            upload_dir = Path(temp_dir)
            token = create_preview(
                upload_dir, "statement.pdf", b"%PDF-test", self.sample_statement()
            )
            payload = load_preview(upload_dir, token)
            cleanup_expired_previews(
                upload_dir, now=float(payload["created_at"]) + 3601
            )

            with self.assertRaises(PreviewNotFoundError):
                load_preview(upload_dir, token)


class UploadJobTests(unittest.TestCase):
    def test_long_running_upload_reports_ocr_without_blocking_request(self):
        started_at = time.time() - 90
        result = upload_job_progress(
            {
                "status": "processing",
                "created_at": started_at,
                "processing_started_at": started_at,
            },
            now=time.time(),
        )

        self.assertEqual(result["status"], "processing")
        self.assertEqual(result["step"], 2)
        self.assertIn("OCR", result["message"])

    def test_completed_upload_returns_short_preview_redirect(self):
        result = upload_job_progress(
            {
                "status": "complete",
                "created_at": time.time(),
                "preview_token": "a" * 32,
            }
        )

        self.assertEqual(
            result["redirect_url"], "/statement/preview/" + "a" * 32
        )


class PreviewValidationTests(unittest.TestCase):
    def test_low_confidence_selected_row_explains_review_requirement(self):
        statement = {
            "transactions": [
                {
                    "transaction_date": "2026-07-20",
                    "description": "AMEX TEST",
                    "amount": 123.45,
                    "confidence": 55,
                }
            ]
        }
        form = {
            "include_0": "1",
            "transaction_date_0": "2026-07-20",
            "description_0": "AMEX TEST",
            "amount_0": "123.45",
        }

        parsed, rows, errors = _submitted_preview_rows(statement, form)

        self.assertEqual(parsed, [])
        self.assertIn(
            "แถว 1: กรุณายืนยันว่าได้ตรวจทานแถวนี้แล้ว",
            errors,
        )
        self.assertTrue(rows[0]["requires_review"])


if __name__ == "__main__":
    unittest.main()
