"""Add cfstate_verified flag to CRM cashflow statements.

Separate from cfstate_invoice — set automatically when a statement's invoice
is marked "ได้รับแล้ว" via /crm-cashflow/invoices, and surfaced as its own
"ตรวจสอบแล้ว" column on /crm-cashflow/statements.

Revision ID: 20260808_01
Revises: 20260807_02
Create Date: 2026-08-08
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260808_01"
down_revision: Union[str, None] = "20260807_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE cashflow_statement
            ADD COLUMN cfstate_verified SMALLINT NOT NULL DEFAULT 0;
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE cashflow_statement DROP COLUMN IF EXISTS cfstate_verified;")
