"""Tests for CRM cashflow duplicate detection and statement lifecycle.

Follows the mocked-``AsyncSession`` pattern used in ``test_tenant_dependencies.py``
since this suite has no real-database test fixtures for the crm_cashflow router.
"""
import tempfile
import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from fastapi import HTTPException

from app.models.crm_cashflow import (
    CrmCashflowCategory,
    CrmCashflowDepartment,
    CrmCashflowList,
    CrmCashflowStatement,
    CrmCashflowStatementAttachment,
)
from app.routers.crm_cashflow import (
    StatementBatchCreate,
    StatementCreate,
    _ensure_statement_references,
    _find_duplicate_statement,
    _parse_row_numbers,
    check_statement_duplicates,
    create_statements,
    delete_statement,
)


class _Result:
    """Minimal stand-in for a SQLAlchemy ``Result``."""

    def __init__(self, *, scalar=None, scalars_list=None):
        self._scalar = scalar
        self._scalars_list = scalars_list or []

    def scalar_one_or_none(self):
        return self._scalar

    def scalars(self):
        return self

    def all(self):
        return self._scalars_list


class _Company:
    def __init__(self, id=5):
        self.id = id


class _User:
    def __init__(self, id=1):
        self.id = id


def _make_db() -> AsyncMock:
    """AsyncMock session with a sync ``add`` — matching real ``AsyncSession``."""
    db = AsyncMock()
    db.add = MagicMock()
    return db


def _statement_item(**overrides) -> StatementCreate:
    defaults = dict(
        cfstate_date=date(2026, 8, 1),
        cfcat_id=1,
        cflist_id=2,
        cfstate_dep_id=None,
        cfstate_invoice=None,
        cfstate_refrain=1,
        cfstate_detail="ค่าเช่า",
        cfstate_amount=Decimal("1000.00"),
        cfstate_ref=None,
    )
    defaults.update(overrides)
    return StatementCreate(**defaults)


class ParseRowNumbersTests(unittest.TestCase):
    def test_none_and_blank_return_empty_set(self):
        self.assertEqual(_parse_row_numbers(None), set())
        self.assertEqual(_parse_row_numbers("   "), set())

    def test_comma_separated_string(self):
        self.assertEqual(_parse_row_numbers("2,5, 9"), {2, 5, 9})

    def test_json_array_string(self):
        self.assertEqual(_parse_row_numbers("[2, 5, 9]"), {2, 5, 9})


class EnsureStatementReferencesTests(unittest.IsolatedAsyncioTestCase):
    async def test_no_department_does_not_crash(self):
        """Regression test: ``cfstate_dep_id=None`` used to raise
        ``UnboundLocalError`` because the department-status check lived
        outside the ``if item.cfstate_dep_id is not None:`` block.
        """
        category = CrmCashflowCategory(cfcat_id=1, cfcat_name="รายรับ", comp_id=5, cfcat_status=1)
        source = CrmCashflowList(cflist_id=2, cflist_name="ขายของ", cfcat_id=1, comp_id=5, cflist_status=1)
        db = AsyncMock()
        db.execute.side_effect = [_Result(scalar=category), _Result(scalar=source)]

        await _ensure_statement_references(db, _statement_item(), comp_id=5)

        self.assertEqual(db.execute.await_count, 2)

    async def test_inactive_department_rejected(self):
        category = CrmCashflowCategory(cfcat_id=1, cfcat_name="รายรับ", comp_id=5, cfcat_status=1)
        source = CrmCashflowList(cflist_id=2, cflist_name="ขายของ", cfcat_id=1, comp_id=5, cflist_status=1)
        department = CrmCashflowDepartment(
            cfstate_dep_id=9, cfstate_dep_name="บัญชี", comp_id=5, cfstate_dep_status=0
        )
        db = AsyncMock()
        db.execute.side_effect = [
            _Result(scalar=category), _Result(scalar=source), _Result(scalar=department),
        ]

        with self.assertRaises(HTTPException) as raised:
            await _ensure_statement_references(db, _statement_item(cfstate_dep_id=9), comp_id=5)

        self.assertEqual(raised.exception.status_code, 409)


class FindDuplicateStatementTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_existing_id_when_found(self):
        db = AsyncMock()
        db.execute.return_value = _Result(scalar=77)

        result = await _find_duplicate_statement(
            db, comp_id=5, cfstate_date=date(2026, 8, 1), cfcat_id=1, cflist_id=2,
            cfstate_dep_id=None, cfstate_invoice=None, cfstate_refrain=1,
            cfstate_detail="ค่าเช่า", cfstate_amount=Decimal("1000.00"), cfstate_ref=None,
        )

        self.assertEqual(result, 77)

    async def test_returns_none_when_not_found(self):
        db = AsyncMock()
        db.execute.return_value = _Result(scalar=None)

        result = await _find_duplicate_statement(
            db, comp_id=5, cfstate_date=date(2026, 8, 1), cfcat_id=1, cflist_id=2,
            cfstate_dep_id=None, cfstate_invoice=None, cfstate_refrain=1,
            cfstate_detail="ค่าเช่า", cfstate_amount=Decimal("1000.00"), cfstate_ref=None,
        )

        self.assertIsNone(result)

    async def test_empty_strings_normalised_to_null_in_query(self):
        db = AsyncMock()
        db.execute.return_value = _Result(scalar=None)

        await _find_duplicate_statement(
            db, comp_id=5, cfstate_date=date(2026, 8, 1), cfcat_id=1, cflist_id=2,
            cfstate_dep_id=None, cfstate_invoice=None, cfstate_refrain=1,
            cfstate_detail="", cfstate_amount=Decimal("1000.00"), cfstate_ref="",
        )

        compiled_sql = str(
            db.execute.call_args.args[0].compile(compile_kwargs={"literal_binds": True})
        )
        self.assertIn("cfstate_detail IS NULL", compiled_sql)
        self.assertIn("cfstate_ref IS NULL", compiled_sql)


class CheckStatementDuplicatesTests(unittest.IsolatedAsyncioTestCase):
    async def test_reports_duplicate_items_with_existing_id(self):
        db = AsyncMock()
        db.execute.side_effect = [_Result(scalar=None), _Result(scalar=55)]
        payload = StatementBatchCreate(
            items=[_statement_item(), _statement_item(cfstate_amount=Decimal("2000"))]
        )

        result = await check_statement_duplicates(payload, db=db, company=_Company(5))

        self.assertEqual(len(result["duplicates"]), 1)
        self.assertEqual(result["duplicates"][0]["index"], 1)
        self.assertEqual(result["duplicates"][0]["existing_id"], 55)


class CreateStatementsDuplicateActionTests(unittest.IsolatedAsyncioTestCase):
    async def test_skip_action_does_not_insert_duplicate(self):
        category = CrmCashflowCategory(cfcat_id=1, cfcat_name="รายรับ", comp_id=5, cfcat_status=1)
        source = CrmCashflowList(cflist_id=2, cflist_name="ขายของ", cfcat_id=1, comp_id=5, cflist_status=1)
        db = _make_db()
        db.execute.side_effect = [
            _Result(scalar=category),
            _Result(scalar=source),
            _Result(scalar=99),
        ]
        payload = StatementBatchCreate(items=[_statement_item()], duplicate_action="skip")

        result = await create_statements(payload, db=db, current_user=_User(1), company=_Company(5))

        self.assertEqual(result, {"status": 1, "created": 0, "skipped": 1, "updated": 0})
        db.add.assert_not_called()

    async def test_update_action_updates_existing_row_user(self):
        category = CrmCashflowCategory(cfcat_id=1, cfcat_name="รายรับ", comp_id=5, cfcat_status=1)
        source = CrmCashflowList(cflist_id=2, cflist_name="ขายของ", cfcat_id=1, comp_id=5, cflist_status=1)
        existing_statement = CrmCashflowStatement(
            cfstate_id=99, comp_id=5, user_id=2, cfstate_status=1,
            cfstate_date=date(2026, 8, 1), cfcat_id=1, cflist_id=2,
            cfstate_amount=Decimal("1000.00"), cfstate_refrain=1,
        )
        db = _make_db()
        db.execute.side_effect = [
            _Result(scalar=category),
            _Result(scalar=source),
            _Result(scalar=99),
            _Result(scalar=existing_statement),
        ]
        payload = StatementBatchCreate(items=[_statement_item()], duplicate_action="update")

        result = await create_statements(payload, db=db, current_user=_User(7), company=_Company(5))

        self.assertEqual(result, {"status": 1, "created": 0, "skipped": 0, "updated": 1})
        self.assertEqual(existing_statement.user_id, 7)
        db.add.assert_not_called()

    async def test_no_duplicate_inserts_new_row(self):
        category = CrmCashflowCategory(cfcat_id=1, cfcat_name="รายรับ", comp_id=5, cfcat_status=1)
        source = CrmCashflowList(cflist_id=2, cflist_name="ขายของ", cfcat_id=1, comp_id=5, cflist_status=1)
        db = _make_db()
        db.execute.side_effect = [
            _Result(scalar=category),
            _Result(scalar=source),
            _Result(scalar=None),
        ]
        payload = StatementBatchCreate(items=[_statement_item()])

        result = await create_statements(payload, db=db, current_user=_User(1), company=_Company(5))

        self.assertEqual(result, {"status": 1, "created": 1, "skipped": 0, "updated": 0})
        db.add.assert_called_once()


class DeleteStatementAttachmentCleanupTests(unittest.IsolatedAsyncioTestCase):
    async def test_delete_statement_removes_attachment_files_and_rows(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            file_path = Path(tmp_dir) / "receipt.pdf"
            file_path.write_bytes(b"dummy")
            statement = CrmCashflowStatement(
                cfstate_id=10, comp_id=5, cfstate_status=1,
                cfstate_date=date(2026, 8, 1), cfcat_id=1, cflist_id=2,
                user_id=1, cfstate_amount=Decimal("1000.00"), cfstate_refrain=1,
            )
            attachment = CrmCashflowStatementAttachment(
                id=uuid4(), cfstate_id=10, comp_id=5, file_name="receipt.pdf",
                stored_name="stored.pdf", file_path=str(file_path),
                content_type="application/pdf", file_size=5, created_by=1,
            )
            db = AsyncMock()
            db.execute.side_effect = [
                _Result(scalar=statement),
                _Result(scalars_list=[attachment]),
            ]

            result = await delete_statement(10, db=db, company=_Company(5))

            self.assertEqual(result, {"status": 1})
            self.assertFalse(file_path.exists())
            self.assertEqual(db.delete.await_count, 2)
            db.delete.assert_any_await(attachment)
            db.delete.assert_any_await(statement)

    async def test_delete_statement_survives_missing_file_on_disk(self):
        statement = CrmCashflowStatement(
            cfstate_id=11, comp_id=5, cfstate_status=1,
            cfstate_date=date(2026, 8, 1), cfcat_id=1, cflist_id=2,
            user_id=1, cfstate_amount=Decimal("1000.00"), cfstate_refrain=1,
        )
        attachment = CrmCashflowStatementAttachment(
            id=uuid4(), cfstate_id=11, comp_id=5, file_name="missing.pdf",
            stored_name="stored.pdf", file_path="/nonexistent/missing.pdf",
            content_type="application/pdf", file_size=5, created_by=1,
        )
        db = AsyncMock()
        db.execute.side_effect = [
            _Result(scalar=statement),
            _Result(scalars_list=[attachment]),
        ]

        result = await delete_statement(11, db=db, company=_Company(5))

        self.assertEqual(result, {"status": 1})
        self.assertEqual(db.delete.await_count, 2)
        db.delete.assert_any_await(attachment)
        db.delete.assert_any_await(statement)


if __name__ == "__main__":
    unittest.main()
