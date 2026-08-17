import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import HTTPException

from app.routers.approvals import _validate_position_department
from app.schemas.approval import PositionCreate, PositionOut, PositionUpdate


class _ScalarResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class PositionDepartmentSchemaTests(unittest.TestCase):
    def test_position_payloads_include_department(self):
        create = PositionCreate(name="นักบัญชี", department_id=12)
        update = PositionUpdate(department_id=None)
        output = PositionOut(id=7, name="นักบัญชี", department_id=12, is_active=True)

        self.assertEqual(create.department_id, 12)
        self.assertIn("department_id", update.model_fields_set)
        self.assertIsNone(update.department_id)
        self.assertEqual(output.department_id, 12)


class PositionDepartmentTenantValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_existing_active_department_is_allowed(self):
        db = AsyncMock()
        db.execute.return_value = _ScalarResult(SimpleNamespace(id=12))

        await _validate_position_department(db, 12, 3)

        db.execute.assert_awaited_once()

    async def test_unknown_or_inactive_department_is_rejected(self):
        db = AsyncMock()
        db.execute.return_value = _ScalarResult(None)

        with self.assertRaises(HTTPException) as raised:
            await _validate_position_department(db, 99, 3)

        self.assertEqual(raised.exception.status_code, 400)

    async def test_unassigned_department_skips_database_lookup(self):
        db = AsyncMock()

        await _validate_position_department(db, None, 3)

        db.execute.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
