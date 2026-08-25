"""Nest the expense dashboard and accounting menus under Finance.

Revision ID: 20260825_08
Revises: 20260825_07
Create Date: 2026-08-25
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260825_08"
down_revision: Union[str, None] = "20260825_07"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE app_menus
        SET group_key = 'finance',
            group_label = 'การเงิน',
            updated_at = NOW()
        WHERE key IN ('expense_dashboard', 'expense_accounting');
    """)


def downgrade() -> None:
    op.execute("""
        UPDATE app_menus
        SET group_key = 'cashflow',
            group_label = 'กระแสเงินสด',
            updated_at = NOW()
        WHERE key IN ('expense_dashboard', 'expense_accounting');
    """)
