"""Track HR expense requests intentionally removed from ACC.

Revision ID: 20260826_01
Revises: 20260825_08
Create Date: 2026-08-26
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260826_01"
down_revision: Union[str, None] = "20260825_08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE hr_expense_request_sync_exclusions (
            hr_expense_request_id BIGINT PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
            request_no VARCHAR(30) NOT NULL UNIQUE,
            reason TEXT NOT NULL,
            excluded_by VARCHAR(100) NOT NULL,
            excluded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX ix_hr_expense_sync_exclusions_company
            ON hr_expense_request_sync_exclusions(company_id, excluded_at DESC);

        CREATE TABLE expense_request_purge_log (
            expense_request_id UUID PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
            request_no VARCHAR(30),
            hr_expense_request_id BIGINT,
            status VARCHAR(40) NOT NULL,
            title VARCHAR(300) NOT NULL,
            amount NUMERIC(15,2) NOT NULL,
            snapshot JSONB NOT NULL,
            reason TEXT NOT NULL,
            backup_file_name VARCHAR(255) NOT NULL,
            purged_by VARCHAR(100) NOT NULL,
            purged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX ix_expense_request_purge_log_company
            ON expense_request_purge_log(company_id, purged_at DESC);
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE IF EXISTS expense_request_purge_log;
        DROP TABLE IF EXISTS hr_expense_request_sync_exclusions;
    """)
