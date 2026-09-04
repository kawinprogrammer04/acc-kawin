"""Add optional per-line-item VAT rate to expense request items.

Revision ID: 20260903_01
Revises: 20260902_01
Create Date: 2026-09-03
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260903_01"
down_revision: Union[str, None] = "20260902_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE expense_request_items
            ADD COLUMN vat_rate NUMERIC(5,2);
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE expense_request_items
            DROP COLUMN vat_rate;
    """)
