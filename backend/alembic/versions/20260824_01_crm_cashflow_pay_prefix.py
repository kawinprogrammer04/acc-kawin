"""Restrict automatic PAY classification to Description prefixes.

Revision ID: 20260824_01
Revises: 20260823_01
Create Date: 2026-08-24
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260824_01"
down_revision: Union[str, None] = "20260823_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The previous migration used a contains match for PAY. Re-open those
    # false positives (for example EPAY) for invoice tracking.
    op.execute("""
        UPDATE cashflow_statement
        SET cfstate_note = NULL,
            cfstate_verified = 0
        WHERE cfstate_status = 1
          AND cfstate_note = 'รายการอื่นๆ'
          AND lower(btrim(coalesce(cfstate_detail, ''))) NOT LIKE 'pay%'
    """)


def downgrade() -> None:
    # Data correction is intentionally not reversed because rows may have been
    # manually verified after this migration ran.
    pass
