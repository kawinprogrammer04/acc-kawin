"""Add the HR expense API projection and event cursor.

Revision ID: 20260911_01
Revises: 20260910_01
"""
from alembic import op


revision = "20260911_01"
down_revision = "20260910_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE hr_expense_request_projections (
            integration_id UUID PRIMARY KEY,
            hr_request_id BIGINT NOT NULL UNIQUE,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            company_code VARCHAR(80) NOT NULL,
            request_no VARCHAR(30) NOT NULL,
            source_version INTEGER NOT NULL,
            status VARCHAR(40) NOT NULL,
            allowed_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
            department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
            department_name VARCHAR(180),
            expense_type_id INTEGER REFERENCES expense_types(id) ON DELETE SET NULL,
            expense_type_name VARCHAR(180),
            request_kind VARCHAR(30),
            title VARCHAR(300) NOT NULL,
            requester_name VARCHAR(300),
            recipient_name VARCHAR(300),
            bank_name VARCHAR(150),
            bank_account_name VARCHAR(300),
            bank_account_number_encrypted TEXT,
            bank_account_last4 VARCHAR(4),
            request_date DATE NOT NULL,
            submitted_at TIMESTAMPTZ,
            approved_at TIMESTAMPTZ,
            source_updated_at TIMESTAMPTZ,
            gross_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            vat_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            withholding_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            net_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            remaining_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            withholding_related BOOLEAN NOT NULL DEFAULT FALSE,
            snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
            last_event_seq BIGINT NOT NULL DEFAULT 0,
            is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
            synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX ix_hr_expense_projection_company_status
            ON hr_expense_request_projections(company_id, status, source_updated_at DESC);
        CREATE INDEX ix_hr_expense_projection_filters
            ON hr_expense_request_projections(company_id, department_id, expense_type_id, request_date);
        CREATE INDEX ix_hr_expense_projection_request_no
            ON hr_expense_request_projections(company_id, request_no);
        ALTER TABLE hr_expense_request_projections ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON hr_expense_request_projections
        USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER)
        WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER);

        CREATE TABLE hr_expense_integration_states (
            provider VARCHAR(30) PRIMARY KEY,
            last_seq BIGINT NOT NULL DEFAULT 0,
            last_attempt_at TIMESTAMPTZ,
            last_success_at TIMESTAMPTZ,
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE hr_expense_integration_events (
            event_id UUID PRIMARY KEY,
            seq BIGINT NOT NULL UNIQUE,
            aggregate_integration_id UUID NOT NULL,
            aggregate_version INTEGER NOT NULL,
            event_type VARCHAR(120) NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            occurred_at TIMESTAMPTZ NOT NULL,
            processed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX ix_hr_expense_events_pending
            ON hr_expense_integration_events(processed_at, seq);
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE IF EXISTS hr_expense_integration_events;
        DROP TABLE IF EXISTS hr_expense_integration_states;
        DROP TABLE IF EXISTS hr_expense_request_projections;
    """)
