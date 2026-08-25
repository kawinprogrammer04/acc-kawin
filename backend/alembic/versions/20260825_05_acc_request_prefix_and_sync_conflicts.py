"""Separate ACC request numbers and persist HR preflight conflicts.

Revision ID: 20260825_05
Revises: 20260825_04
Create Date: 2026-08-25
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260825_05"
down_revision: Union[str, None] = "20260825_04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE SEQUENCE IF NOT EXISTS acc_expense_request_no_seq START WITH 1;

        DO $$
        DECLARE
            latest_number BIGINT;
        BEGIN
            SELECT max(split_part(request_no, '-', 4)::bigint)
              INTO latest_number
              FROM expense_requests
             WHERE request_no ~ '^ACC-EXP-[0-9]{6}-[0-9]{6}$';
            IF latest_number IS NULL THEN
                PERFORM setval('acc_expense_request_no_seq', 1, false);
            ELSE
                PERFORM setval('acc_expense_request_no_seq', latest_number, true);
            END IF;
        END $$;

        ALTER TABLE expense_requests
            ALTER COLUMN request_no SET DEFAULT (
                'ACC-EXP-' || to_char(CURRENT_DATE, 'YYYYMM') || '-' ||
                lpad(nextval('acc_expense_request_no_seq')::text, 6, '0')
            );

        ALTER TABLE hr_sync_jobs
            ADD COLUMN conflicts JSONB NOT NULL DEFAULT '[]'::jsonb;

        ALTER TABLE hr_sync_jobs
            ADD CONSTRAINT ck_hr_sync_jobs_conflicts_array
            CHECK (jsonb_typeof(conflicts) = 'array');
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE hr_sync_jobs
            DROP CONSTRAINT IF EXISTS ck_hr_sync_jobs_conflicts_array;
        ALTER TABLE hr_sync_jobs DROP COLUMN IF EXISTS conflicts;

        ALTER TABLE expense_requests
            ALTER COLUMN request_no SET DEFAULT (
                'EXP-' || to_char(CURRENT_DATE, 'YYYYMM') || '-' ||
                lpad(nextval('expense_request_no_seq')::text, 6, '0')
            );

        DROP SEQUENCE IF EXISTS acc_expense_request_no_seq;
    """)
