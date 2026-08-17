"""Allow 'partially_paid' in expense_requests.status check constraint.

The installment/partial-payment feature (installment_enabled flag,
record_payment()/void_payment() in expense_finance_service.py) sets
expense_requests.status = "partially_paid", but the CHECK constraint added
in 20260811_01_expense_finance_module.py never included this value — every
partial payment fails at the database layer with a CheckViolationError.
Caught by an end-to-end test of the approval/payment lifecycle.

Revision ID: 20260814_02
Revises: 20260814_01
Create Date: 2026-08-16
"""
from alembic import op

revision = "20260814_02"
down_revision = "20260814_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE expense_requests DROP CONSTRAINT IF EXISTS expense_requests_status_check")
    op.execute("""
        ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_status_check CHECK (status IN (
            'draft','pending_approval','ready_to_pay','settlement_due','settlement_review','completed',
            'returned_for_correction','rejected','pending_adjustment_approval','cancelled','accounting_review','paid',
            'partially_paid'
        ))
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE expense_requests DROP CONSTRAINT IF EXISTS expense_requests_status_check")
    op.execute("""
        ALTER TABLE expense_requests ADD CONSTRAINT expense_requests_status_check CHECK (status IN (
            'draft','pending_approval','ready_to_pay','settlement_due','settlement_review','completed',
            'returned_for_correction','rejected','pending_adjustment_approval','cancelled','accounting_review','paid'
        ))
    """)
