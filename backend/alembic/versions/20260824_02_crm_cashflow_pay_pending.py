"""Keep PAY-classified rows pending while excluding them from invoices.

Revision ID: 20260824_02
Revises: 20260824_01
Create Date: 2026-08-24
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260824_02"
down_revision: Union[str, None] = "20260824_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PAY rows are excluded from invoice tracking by cfstate_note, not by the
    # accounting verification flag. Reset rows classified by the old behavior.
    op.execute("""
        UPDATE cashflow_statement
        SET cfstate_verified = 0
        WHERE cfstate_status = 1
          AND cfstate_note = 'รายการอื่นๆ'
    """)


def downgrade() -> None:
    # Do not re-apply the old incorrect verification behavior on downgrade.
    pass
