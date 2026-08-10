"""Allow zero totals while an expense request is still a draft.

Revision ID: 20260803_02
Revises: 20260803_01
Create Date: 2026-08-03
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260803_02"
down_revision: Union[str, None] = "20260803_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE expense_requests
            DROP CONSTRAINT IF EXISTS expense_requests_amount_check;
        ALTER TABLE expense_requests
            ADD CONSTRAINT expense_requests_amount_check CHECK (amount >= 0);
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE expense_requests
            DROP CONSTRAINT IF EXISTS expense_requests_amount_check;
        ALTER TABLE expense_requests
            ADD CONSTRAINT expense_requests_amount_check CHECK (amount > 0) NOT VALID;
    """)
