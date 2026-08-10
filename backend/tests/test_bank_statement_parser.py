import unittest
from datetime import date

from app.services.bank_statement_parser import parse_csv, parse_ocr_text, parse_rows


class BankStatementParserTests(unittest.TestCase):
    def test_parses_thai_deposit_and_withdraw_columns_with_signed_amounts(self):
        data = (
            "วันที่,รายละเอียด,เงินเข้า,เงินออก,เลขอ้างอิง\n"
            "25/07/2569,รับโอนจากลูกค้า,\"2,770.00\",,KB001\n"
            "26/07/2569,ค่าธรรมเนียมธนาคาร,,200.00,FEE01\n"
        ).encode("utf-8")

        result = parse_csv(data)

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].transaction_date, date(2026, 7, 25))
        self.assertEqual(result[0].amount, 2770.0)
        self.assertEqual(result[1].amount, -200.0)
        self.assertEqual(result[0].reference, "KB001")
        self.assertNotEqual(result[0].row_hash, result[1].row_hash)

    def test_parses_kbank_style_statement_headers(self):
        rows = [
            [
                "Account Number", "Date", "Time", "Tr Code",
                "Tr Description", "Channel", "Deposit", "Withdraw", "Description",
            ],
            [
                "4140658686", "25/07/2026", "06:06", "X1",
                "ฝากถอนเงินโอนไม่ใช้สมุด", "ENET", "2,770.00", None,
                "รับโอนจาก GSB x4195 นาง วิไลลักษณ์",
            ],
        ]

        result = parse_rows(rows)

        self.assertEqual(result[0].description, "รับโอนจาก GSB x4195 นาง วิไลลักษณ์")
        self.assertEqual(result[0].transaction_time, "06:06:00")
        self.assertEqual(result[0].channel, "ENET")
        self.assertEqual(result[0].reference, "X1")

    def test_rejects_files_without_required_headers(self):
        with self.assertRaisesRegex(ValueError, "ไม่พบหัวตาราง"):
            parse_rows([["ชื่อ", "หมายเหตุ"], ["ทดสอบ", "ไม่มีจำนวนเงิน"]])

    def test_parses_scanned_statement_text_without_using_running_balance(self):
        result = parse_ocr_text(
            "25/07/2569 รับโอนจากลูกค้า 2,770.00 12,770.00\n"
            "26/07/2569 ชำระค่าสินค้า 200.00 12,570.00"
        )

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].amount, 2770.0)
        self.assertEqual(result[1].amount, -200.0)


if __name__ == "__main__":
    unittest.main()
