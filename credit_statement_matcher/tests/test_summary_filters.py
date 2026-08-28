from __future__ import annotations

import unittest

from fastapi import HTTPException

from app.main import summary_platform_sql, summary_transaction_filter_parts


class SummaryFilterTests(unittest.TestCase):
    def test_empty_filter_keeps_all_transactions(self) -> None:
        clauses, values = summary_transaction_filter_parts()
        self.assertEqual(clauses, [])
        self.assertEqual(values, [])

    def test_combined_filters_are_parameterized_and_dates_are_inclusive(self) -> None:
        clauses, values = summary_transaction_filter_parts(
            date_from="2026-07-01",
            date_to="2026-07-31",
            card_last4="••••1002",
            platform="tiktok",
            status="unmatched",
            statement_id=19,
        )
        sql = " AND ".join(clauses)
        self.assertIn("t.transaction_date >= ?", sql)
        self.assertIn("t.transaction_date <= ?", sql)
        self.assertIn("t.card_last4 = ?", sql)
        self.assertIn("t.match_status = ?", sql)
        self.assertIn("t.statement_id = ?", sql)
        self.assertIn("CASE", sql)
        self.assertEqual(
            values,
            ["2026-07-01", "2026-07-31", "1002", "tiktok", "unmatched", 19],
        )

    def test_issue_statuses_use_the_expected_columns(self) -> None:
        duplicate_clauses, _ = summary_transaction_filter_parts(status="duplicates")
        missing_clauses, _ = summary_transaction_filter_parts(status="missing-attachments")
        self.assertEqual(duplicate_clauses, ["t.is_duplicate = 1"])
        self.assertEqual(
            missing_clauses,
            ["t.match_status = 'matched' AND t.has_attachment = 0"],
        )

    def test_rejects_invalid_or_reversed_dates(self) -> None:
        with self.assertRaises(HTTPException):
            summary_transaction_filter_parts(date_from="not-a-date")
        with self.assertRaises(HTTPException):
            summary_transaction_filter_parts(date_from="2026-08-01", date_to="2026-07-31")

    def test_platform_grouping_uses_friendly_sources(self) -> None:
        sql = summary_platform_sql("tx")
        self.assertIn("tx.channel", sql)
        self.assertIn("tx.description", sql)
        self.assertIn("tx.category", sql)
        self.assertIn("'facebook'", sql)
        self.assertIn("'payment'", sql)


if __name__ == "__main__":
    unittest.main()

