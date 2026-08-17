"""Assign an employee department per company membership.

Revision ID: 20260811_06
Revises: 20260811_05
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260811_06"
down_revision: Union[str, None] = "20260811_05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE user_companies
        ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;

        CREATE INDEX ix_user_companies_department_id
        ON user_companies(company_id, department_id);

        UPDATE user_companies membership
        SET department_id = (
            SELECT position.department_id
            FROM user_positions assignment
            JOIN positions position ON position.id = assignment.position_id
            WHERE assignment.user_id = membership.user_id
              AND assignment.company_id = membership.company_id
              AND assignment.is_active
              AND position.is_active
              AND position.department_id IS NOT NULL
            ORDER BY assignment.id
            LIMIT 1
        )
        WHERE membership.department_id IS NULL
          AND EXISTS (
              SELECT 1
              FROM user_positions assignment
              JOIN positions position ON position.id = assignment.position_id
              WHERE assignment.user_id = membership.user_id
                AND assignment.company_id = membership.company_id
                AND assignment.is_active
                AND position.is_active
                AND position.department_id IS NOT NULL
          );
    """)


def downgrade() -> None:
    op.execute("""
        DROP INDEX IF EXISTS ix_user_companies_department_id;
        ALTER TABLE user_companies DROP COLUMN IF EXISTS department_id;
    """)
