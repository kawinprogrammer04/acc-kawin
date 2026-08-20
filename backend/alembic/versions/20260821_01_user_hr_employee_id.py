"""Add hr_employee_id to users for HR SSO login linking.

Revision ID: 20260821_01
Revises: 20260818_03
Create Date: 2026-08-21
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260821_01"
down_revision: Union[str, None] = "20260818_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS hr_employee_id VARCHAR(30);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_users_hr_employee_id
            ON users (hr_employee_id)
            WHERE hr_employee_id IS NOT NULL;
    """)


def downgrade() -> None:
    op.execute("""
        DROP INDEX IF EXISTS uq_users_hr_employee_id;
        ALTER TABLE users DROP COLUMN IF EXISTS hr_employee_id;
    """)
