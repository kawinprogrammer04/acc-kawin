"""Add Statement evidence metadata, archive history, and group matching.

Revision ID: 20260729_02
Revises: 20260729_01
Create Date: 2026-07-29
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260729_02"
down_revision: Union[str, None] = "20260729_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE bank_statement_imports
            ADD COLUMN source_type VARCHAR(30) NOT NULL DEFAULT 'manual',
            ADD COLUMN trust_level VARCHAR(30) NOT NULL DEFAULT 'unverified',
            ADD COLUMN processing_method VARCHAR(30),
            ADD COLUMN parse_message TEXT,
            ADD COLUMN archived_by INTEGER REFERENCES users(id),
            ADD COLUMN archived_at TIMESTAMPTZ;
        ALTER TABLE bank_statement_imports
            DROP CONSTRAINT IF EXISTS bank_statement_imports_status_check;
        ALTER TABLE bank_statement_imports
            ADD CONSTRAINT bank_statement_imports_status_check
            CHECK (status IN ('processing', 'processed', 'failed'));

        ALTER TABLE bank_statement_lines
            ADD COLUMN suggested_cash_transaction_ids JSONB;

        ALTER TABLE bank_reconciliations
            ADD COLUMN group_id UUID;

        DROP INDEX IF EXISTS uq_bank_reconciliation_active_line;
        CREATE INDEX ix_bank_reconciliation_active_line
            ON bank_reconciliations(statement_line_id) WHERE is_active;
        CREATE INDEX ix_bank_imports_active_history
            ON bank_statement_imports(company_id, wallet_account_id, created_at DESC)
            WHERE archived_at IS NULL;
    """)


def downgrade() -> None:
    op.execute("""
        DROP INDEX IF EXISTS ix_bank_imports_active_history;
        DROP INDEX IF EXISTS ix_bank_reconciliation_active_line;
        CREATE UNIQUE INDEX uq_bank_reconciliation_active_line
            ON bank_reconciliations(statement_line_id) WHERE is_active;

        ALTER TABLE bank_reconciliations DROP COLUMN IF EXISTS group_id;
        ALTER TABLE bank_statement_lines DROP COLUMN IF EXISTS suggested_cash_transaction_ids;
        ALTER TABLE bank_statement_imports
            DROP CONSTRAINT IF EXISTS bank_statement_imports_status_check;
        ALTER TABLE bank_statement_imports
            ADD CONSTRAINT bank_statement_imports_status_check
            CHECK (status IN ('processed', 'failed'));
        ALTER TABLE bank_statement_imports
            DROP COLUMN IF EXISTS archived_at,
            DROP COLUMN IF EXISTS archived_by,
            DROP COLUMN IF EXISTS parse_message,
            DROP COLUMN IF EXISTS processing_method,
            DROP COLUMN IF EXISTS trust_level,
            DROP COLUMN IF EXISTS source_type;
    """)
