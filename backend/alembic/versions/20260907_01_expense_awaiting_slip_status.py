"""Allow transfers awaiting their payment slip.

Revision ID: 20260907_01
Revises: 20260904_01
"""
from alembic import op

revision = "20260907_01"
down_revision = "20260904_01"
branch_labels = None
depends_on = None

STATUSES = (
    "draft", "pending_approval", "ready_to_pay", "settlement_due", "settlement_review",
    "completed", "returned_for_correction", "rejected", "pending_adjustment_approval",
    "cancelled", "accounting_review", "paid", "partially_paid",
)


def _set_constraint(statuses: tuple[str, ...]) -> None:
    op.drop_constraint("expense_requests_status_check", "expense_requests", type_="check")
    allowed = ", ".join(f"'{status}'" for status in statuses)
    op.create_check_constraint("expense_requests_status_check", "expense_requests", f"status IN ({allowed})")


def upgrade() -> None:
    _set_constraint((*STATUSES, "awaiting_slip"))


def downgrade() -> None:
    op.execute("""
        UPDATE expense_requests AS req SET status = COALESCE((
            SELECT h.from_status FROM expense_request_histories AS h
            WHERE h.expense_request_id = req.id AND h.company_id = req.company_id
              AND h.revision = req.current_revision AND h.event = 'transfer_marked'
              AND h.from_status IN ('ready_to_pay', 'partially_paid')
            ORDER BY h.id DESC LIMIT 1
        ), 'ready_to_pay') WHERE req.status = 'awaiting_slip'
    """)
    _set_constraint(STATUSES)
