"""Add HR expense-form tax and gross-up fields.

Revision ID: 20260813_01
Revises: 20260811_06, 20260811_07
Create Date: 2026-08-13
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260813_01"
down_revision: Union[str, Sequence[str], None] = ("20260811_06", "20260811_07")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE expense_requests
            ADD COLUMN IF NOT EXISTS taxpayer_type VARCHAR(20),
            ADD COLUMN IF NOT EXISTS taxpayer_branch VARCHAR(255),
            ADD COLUMN IF NOT EXISTS requested_net_amount NUMERIC(15,2);
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE expense_requests
            DROP COLUMN IF EXISTS requested_net_amount,
            DROP COLUMN IF EXISTS taxpayer_branch,
            DROP COLUMN IF EXISTS taxpayer_type;
    """)
