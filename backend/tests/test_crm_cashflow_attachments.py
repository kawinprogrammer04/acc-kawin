import unittest

from app.routers.crm_cashflow import ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES


class CrmCashflowAttachmentRulesTests(unittest.TestCase):
    def test_allowed_attachment_types(self):
        self.assertIn("image/jpeg", ALLOWED_ATTACHMENT_TYPES)
        self.assertIn("image/png", ALLOWED_ATTACHMENT_TYPES)
        self.assertIn("application/pdf", ALLOWED_ATTACHMENT_TYPES)

    def test_disallowed_types_rejected(self):
        self.assertNotIn("text/plain", ALLOWED_ATTACHMENT_TYPES)
        self.assertNotIn("application/x-msdownload", ALLOWED_ATTACHMENT_TYPES)
        self.assertNotIn("text/html", ALLOWED_ATTACHMENT_TYPES)

    def test_max_attachment_byte_size_is_10mb(self):
        # 10 MB = 10 * 1024 * 1024 bytes
        self.assertEqual(MAX_ATTACHMENT_BYTES, 10 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()