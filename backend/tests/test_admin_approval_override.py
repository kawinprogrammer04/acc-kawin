import asyncio
import unittest
from types import SimpleNamespace

from app.models.approval import ApprovalAction
from app.services.approval_service import decide_step


class Result:
    def __init__(self, value=None):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class Database:
    def __init__(self, results):
        self.results = list(results)
        self.added = []
        self.committed = False

    async def execute(self, _statement):
        return Result(self.results.pop(0) if self.results else None)

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        self.committed = True

    async def refresh(self, _value):
        return None


def pending_step():
    return SimpleNamespace(
        id=12,
        expense_request_id="request-1",
        revision=1,
        step_no=1,
        status="pending",
        approve_mode="all",
        resolved_approver_user_id=88,
        decided_by=None,
        decided_at=None,
        comment=None,
    )


class AdminApprovalOverrideTests(unittest.TestCase):
    def test_platform_admin_can_complete_a_pending_all_mode_step(self):
        step = pending_step()
        request = SimpleNamespace(
            id="request-1",
            company_id=9,
            requester_user_id=50,
            request_no="EXP-001",
            title="ทดสอบอนุมัติ",
            current_revision=1,
            current_step_no=1,
            status="pending_approval",
            decided_at=None,
            approved_at=None,
        )
        database = Database([
            None,     # no action with this idempotency key
            step,
            None,     # admin is not an approval candidate
            request,
            None,     # skip the remaining candidates
            None,     # no next approval step
        ])

        result = asyncio.run(decide_step(
            database,
            step_id=12,
            actor_user_id=1,
            action="approve",
            comment="ทดสอบโดยผู้ดูแลระบบ",
            idempotency_key="admin-test-1",
            allow_admin_override=True,
        ))

        self.assertIs(result, step)
        self.assertEqual(step.status, "approved")
        self.assertEqual(step.decided_by, 1)
        self.assertEqual(request.status, "ready_to_pay")
        self.assertIsNone(request.current_step_no)
        self.assertTrue(database.committed)
        actions = [item for item in database.added if isinstance(item, ApprovalAction)]
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0].actor_user_id, 1)

    def test_non_admin_still_cannot_approve_an_unassigned_step(self):
        database = Database([None, pending_step(), None])

        with self.assertRaises(PermissionError):
            asyncio.run(decide_step(
                database,
                step_id=12,
                actor_user_id=1,
                action="approve",
                comment=None,
                idempotency_key="normal-user-test-1",
            ))

        self.assertFalse(database.committed)


if __name__ == "__main__":
    unittest.main()
