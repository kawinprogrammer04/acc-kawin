"""Tests for hard-delete-when-unused behaviour of CRM cashflow master data
(categories, sources, departments) — deleting an unused item removes the row;
deleting one still referenced by a statement (or, for categories, by a
source) is blocked with 409 instead.
"""
import unittest
from unittest.mock import AsyncMock

from fastapi import HTTPException

from app.models.crm_cashflow import (
    CrmCashflowCategory,
    CrmCashflowDepartment,
    CrmCashflowList,
)
from app.routers.crm_cashflow import delete_category, delete_department, delete_source


class _Result:
    """Minimal stand-in for a SQLAlchemy ``Result`` (scalar queries only)."""

    def __init__(self, *, scalar=None):
        self._scalar = scalar

    def scalar_one_or_none(self):
        return self._scalar

    def scalar_one(self):
        return self._scalar


class _Company:
    def __init__(self, id=5):
        self.id = id


class DeleteSourceTests(unittest.IsolatedAsyncioTestCase):
    async def test_hard_deletes_when_unused(self):
        source = CrmCashflowList(cflist_id=2, cflist_name="ขายของ", cfcat_id=1, comp_id=5, cflist_status=1)
        db = AsyncMock()
        db.execute.side_effect = [
            _Result(scalar=source),  # _owned_row lookup
            _Result(scalar=0),       # usage_count
        ]

        result = await delete_source(2, db=db, company=_Company(5))

        self.assertEqual(result, {"status": 1})
        db.delete.assert_awaited_once_with(source)

    async def test_blocked_when_in_use(self):
        source = CrmCashflowList(cflist_id=2, cflist_name="ขายของ", cfcat_id=1, comp_id=5, cflist_status=1)
        db = AsyncMock()
        db.execute.side_effect = [
            _Result(scalar=source),
            _Result(scalar=3),
        ]

        with self.assertRaises(HTTPException) as raised:
            await delete_source(2, db=db, company=_Company(5))

        self.assertEqual(raised.exception.status_code, 409)
        db.delete.assert_not_called()


class DeleteCategoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_hard_deletes_when_no_sources_or_statements(self):
        category = CrmCashflowCategory(cfcat_id=1, cfcat_name="รายรับ", comp_id=5, cfcat_status=1)
        db = AsyncMock()
        db.execute.side_effect = [
            _Result(scalar=category),  # _owned_row
            _Result(scalar=0),         # source_count
            _Result(scalar=0),         # usage_count
        ]

        result = await delete_category(1, db=db, company=_Company(5))

        self.assertEqual(result, {"status": 1})
        db.delete.assert_awaited_once_with(category)

    async def test_blocked_when_sources_remain(self):
        category = CrmCashflowCategory(cfcat_id=1, cfcat_name="รายรับ", comp_id=5, cfcat_status=1)
        db = AsyncMock()
        db.execute.side_effect = [
            _Result(scalar=category),
            _Result(scalar=2),  # source_count > 0 — blocked before usage_count is even checked
        ]

        with self.assertRaises(HTTPException) as raised:
            await delete_category(1, db=db, company=_Company(5))

        self.assertEqual(raised.exception.status_code, 409)
        db.delete.assert_not_called()

    async def test_blocked_when_statements_reference_it_directly(self):
        category = CrmCashflowCategory(cfcat_id=1, cfcat_name="รายรับ", comp_id=5, cfcat_status=1)
        db = AsyncMock()
        db.execute.side_effect = [
            _Result(scalar=category),
            _Result(scalar=0),  # no sources left...
            _Result(scalar=4),  # ...but statements still reference the category directly
        ]

        with self.assertRaises(HTTPException) as raised:
            await delete_category(1, db=db, company=_Company(5))

        self.assertEqual(raised.exception.status_code, 409)
        db.delete.assert_not_called()


class DeleteDepartmentTests(unittest.IsolatedAsyncioTestCase):
    async def test_hard_deletes_when_unused(self):
        department = CrmCashflowDepartment(cfstate_dep_id=9, cfstate_dep_name="บัญชี", comp_id=5, cfstate_dep_status=1)
        db = AsyncMock()
        db.execute.side_effect = [
            _Result(scalar=department),
            _Result(scalar=0),
        ]

        result = await delete_department(9, db=db, company=_Company(5))

        self.assertEqual(result, {"status": 1})
        db.delete.assert_awaited_once_with(department)

    async def test_blocked_when_in_use(self):
        department = CrmCashflowDepartment(cfstate_dep_id=9, cfstate_dep_name="บัญชี", comp_id=5, cfstate_dep_status=1)
        db = AsyncMock()
        db.execute.side_effect = [
            _Result(scalar=department),
            _Result(scalar=1),
        ]

        with self.assertRaises(HTTPException) as raised:
            await delete_department(9, db=db, company=_Company(5))

        self.assertEqual(raised.exception.status_code, 409)
        db.delete.assert_not_called()


if __name__ == "__main__":
    unittest.main()
