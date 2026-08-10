"""Add durable bank statement reconciliation.

Revision ID: 20260729_01
Revises: 20260724_02
Create Date: 2026-07-29
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260729_01"
down_revision: Union[str, None] = "20260724_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE bank_statement_imports (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            company_id INTEGER NOT NULL REFERENCES companies(id),
            wallet_account_id INTEGER NOT NULL REFERENCES wallet_accounts(id),
            original_filename VARCHAR(500) NOT NULL,
            stored_path VARCHAR(1000) NOT NULL,
            content_type VARCHAR(150),
            file_size BIGINT NOT NULL,
            file_sha256 VARCHAR(64) NOT NULL,
            row_count INTEGER NOT NULL DEFAULT 0,
            imported_count INTEGER NOT NULL DEFAULT 0,
            duplicate_count INTEGER NOT NULL DEFAULT 0,
            date_from DATE,
            date_to DATE,
            status VARCHAR(30) NOT NULL DEFAULT 'processed'
                CHECK (status IN ('processed', 'failed')),
            uploaded_by INTEGER REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE bank_statement_lines (
            id BIGSERIAL PRIMARY KEY,
            import_id UUID NOT NULL REFERENCES bank_statement_imports(id) ON DELETE CASCADE,
            company_id INTEGER NOT NULL REFERENCES companies(id),
            wallet_account_id INTEGER NOT NULL REFERENCES wallet_accounts(id),
            transaction_date DATE NOT NULL,
            transaction_time VARCHAR(8),
            description TEXT NOT NULL,
            reference VARCHAR(200),
            channel VARCHAR(100),
            amount NUMERIC(15,2) NOT NULL CHECK (amount <> 0),
            row_hash VARCHAR(64) NOT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'unmatched'
                CHECK (status IN ('unmatched', 'suggested', 'reconciled')),
            suggested_cash_transaction_id BIGINT REFERENCES cash_transactions(id) ON DELETE SET NULL,
            suggested_score INTEGER CHECK (suggested_score BETWEEN 0 AND 100),
            suggestion_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
            reconciled_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_bank_statement_line_hash
                UNIQUE (company_id, wallet_account_id, row_hash)
        );

        CREATE TABLE bank_reconciliations (
            id BIGSERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id),
            wallet_account_id INTEGER NOT NULL REFERENCES wallet_accounts(id),
            statement_line_id BIGINT NOT NULL REFERENCES bank_statement_lines(id),
            cash_transaction_id BIGINT NOT NULL REFERENCES cash_transactions(id),
            status VARCHAR(20) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'cancelled')),
            match_score INTEGER CHECK (match_score BETWEEN 0 AND 100),
            match_method VARCHAR(30) NOT NULL DEFAULT 'automatic'
                CHECK (match_method IN ('automatic', 'manual')),
            matched_by INTEGER REFERENCES users(id),
            matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            cancelled_by INTEGER REFERENCES users(id),
            cancelled_at TIMESTAMPTZ,
            cancel_reason TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE
        );

        CREATE INDEX ix_bank_imports_company_account
            ON bank_statement_imports(company_id, wallet_account_id, created_at DESC);
        CREATE INDEX ix_bank_imports_sha
            ON bank_statement_imports(company_id, wallet_account_id, file_sha256);
        CREATE INDEX ix_bank_lines_account_date
            ON bank_statement_lines(company_id, wallet_account_id, transaction_date DESC);
        CREATE INDEX ix_bank_lines_status
            ON bank_statement_lines(company_id, wallet_account_id, status);
        CREATE INDEX ix_bank_reconciliations_company
            ON bank_reconciliations(company_id, wallet_account_id, matched_at DESC);
        CREATE UNIQUE INDEX uq_bank_reconciliation_active_line
            ON bank_reconciliations(statement_line_id) WHERE is_active;
        CREATE UNIQUE INDEX uq_bank_reconciliation_active_cash_transaction
            ON bank_reconciliations(cash_transaction_id) WHERE is_active;

        ALTER TABLE bank_statement_imports ENABLE ROW LEVEL SECURITY;
        ALTER TABLE bank_statement_lines ENABLE ROW LEVEL SECURITY;
        ALTER TABLE bank_reconciliations ENABLE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON bank_statement_imports
        USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER)
        WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER);
        CREATE POLICY tenant_isolation ON bank_statement_lines
        USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER)
        WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER);
        CREATE POLICY tenant_isolation ON bank_reconciliations
        USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER)
        WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER);
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE IF EXISTS bank_reconciliations;
        DROP TABLE IF EXISTS bank_statement_lines;
        DROP TABLE IF EXISTS bank_statement_imports;
    """)
