import unittest

from app.parsers import parse_csv, parse_rows


class CsvParserTests(unittest.TestCase):
    def test_parses_thai_headers_and_categories(self):
        data = (
            "วันที่,รายละเอียด,จำนวนเงิน,เลขบัตร\n"
            "23/07/2026,OPENAI SUBSCRIPTION,\"1,250.00\",xxxx-1234\n"
            "24/07/2026,คืนเงินร้านค้า,(250.00),xxxx-1234\n"
        ).encode("utf-8")

        result = parse_csv(data)

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].transaction_date, "2026-07-23")
        self.assertEqual(result[0].amount, 1250.0)
        self.assertEqual(result[0].card_last4, "1234")
        self.assertEqual(result[0].category, "ซอฟต์แวร์และออนไลน์")
        self.assertEqual(result[1].amount, -250.0)

    def test_parses_separate_debit_and_credit_columns(self):
        data = (
            "Date,Description,Debit,Credit\n"
            "2026-07-20,OFFICE SUPPLY,500.00,\n"
            "2026-07-21,PAYMENT RECEIVED,,500.00\n"
        ).encode("utf-8")

        result = parse_csv(data)

        self.assertEqual([item.amount for item in result], [500.0, -500.0])

    def test_parses_bank_statement_deposit_format(self):
        rows = [
            [
                "Account Number",
                "Account Name",
                "Account Type",
                "Currency Code",
                "Branch Code",
                "Date",
                "Time",
                "Tr Code",
                "Tr Description",
                "Channel",
                "Deposit",
                "Description",
                "Note",
            ],
            [
                "4140658686",
                "บริษัท กวิน บราเธอร์ส จำกัด",
                "ออมทรัพย์",
                "THB",
                "5419",
                "25/07/2026",
                "06:06",
                "X1 ",
                "ฝากถอนเงินโอนไม่ใช้สมุด",
                "ENET",
                "2,770.00",
                "รับโอนจาก GSB x4195 นาง วิไลลักษณ์ ปัญญา",
                None,
            ],
        ]

        result = parse_rows(rows)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].transaction_date, "2026-07-25")
        self.assertEqual(result[0].transaction_time, "06:06:00")
        self.assertEqual(result[0].amount, 2770.0)
        self.assertEqual(result[0].deposit_amount, 2770.0)
        self.assertEqual(result[0].channel, "ENET")
        self.assertEqual(result[0].tr_code, "X1")
        self.assertIsNotNone(result[0].row_hash)


if __name__ == "__main__":
    unittest.main()
