"""Verify request-number INSERT behavior without connecting to a database."""
import unittest

from sqlalchemy import insert, update
from sqlalchemy.dialects import postgresql

from app.models.approval import ExpenseRequest


class ExpenseRequestNumberTests(unittest.TestCase):
    def test_new_request_sends_acc_number_using_existing_sequence(self):
        statement = insert(ExpenseRequest).values(title="New draft").return_defaults()
        sql = str(statement.compile(dialect=postgresql.dialect()))

        self.assertIn("'ACC-' || to_char(CURRENT_DATE, 'YYYYMM')", sql)
        self.assertIn("lpad(nextval('acc_expense_request_no_seq')::text, 6, '0')", sql)
        self.assertNotIn("ACC-EXP-", sql)
        self.assertIn("expense_requests.request_no", sql.split("RETURNING", 1)[1])

    def test_explicit_imported_and_installment_numbers_are_preserved(self):
        for number in ("EXP-202609-000160", "ACC-EXP-202609-000160-2", "ACC-202609-000160-2"):
            with self.subTest(number=number):
                statement = insert(ExpenseRequest).values(title="Existing number", request_no=number)
                compiled = statement.compile(dialect=postgresql.dialect())
                self.assertEqual(compiled.params["request_no"], number)
                self.assertNotIn("nextval", str(compiled))

    def test_editing_existing_request_does_not_generate_another_number(self):
        statement = update(ExpenseRequest).where(ExpenseRequest.id == "request-id").values(title="Edited draft")
        sql = str(statement.compile(dialect=postgresql.dialect()))

        self.assertNotIn("request_no", sql)
        self.assertNotIn("nextval", sql)


if __name__ == "__main__":
    unittest.main()
