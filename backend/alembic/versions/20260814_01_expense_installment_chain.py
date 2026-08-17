"""Add expense-request installment chain columns.

Revision ID: 20260814_01
Revises: 20260813_02
Create Date: 2026-08-14
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260814_01"
down_revision: Union[str, None] = "20260813_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE expense_requests
            ADD COLUMN IF NOT EXISTS installment_chain_root_id UUID REFERENCES expense_requests(id),
            ADD COLUMN IF NOT EXISTS installment_no SMALLINT,
            ADD COLUMN IF NOT EXISTS installment_target_amount NUMERIC(15,2),
            ADD COLUMN IF NOT EXISTS installment_payment_amount NUMERIC(15,2),
            ADD COLUMN IF NOT EXISTS installment_chain_status VARCHAR(30);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_expense_requests_installment_chain_root_id
        ON expense_requests(installment_chain_root_id)
        WHERE installment_chain_root_id IS NOT NULL;
    """)


def downgrade() -> None:
    op.execute("""
        DROP INDEX IF EXISTS ix_expense_requests_installment_chain_root_id;
    """)
    op.execute("""
        ALTER TABLE expense_requests
            DROP COLUMN IF EXISTS installment_chain_status,
            DROP COLUMN IF EXISTS installment_payment_amount,
            DROP COLUMN IF EXISTS installment_target_amount,
            DROP COLUMN IF EXISTS installment_no,
            DROP COLUMN IF EXISTS installment_chain_root_id;
    """)
