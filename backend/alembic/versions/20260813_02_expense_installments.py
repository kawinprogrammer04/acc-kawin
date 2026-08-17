"""Add installment_enabled flag to expense requests.

Revision ID: 20260813_02
Revises: 20260813_01
Create Date: 2026-08-13
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260813_02"
down_revision: Union[str, None] = "20260813_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE expense_requests
            ADD COLUMN IF NOT EXISTS installment_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE expense_requests
            DROP COLUMN IF EXISTS installment_enabled;
    """)
