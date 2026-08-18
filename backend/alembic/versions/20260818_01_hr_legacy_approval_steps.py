"""Store display-only HR approval trails for migrated expense requests.

Revision ID: 20260818_01
Revises: 20260817_01
Create Date: 2026-08-18
"""
from alembic import op


revision = "20260818_01"
down_revision = "20260817_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS expense_request_legacy_approval_steps (
            id BIGSERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            expense_request_id UUID NOT NULL REFERENCES expense_requests(id) ON DELETE CASCADE,
            source_step_id BIGINT,
            revision INTEGER NOT NULL DEFAULT 1,
            step_no SMALLINT NOT NULL,
            name VARCHAR(180),
            approve_mode VARCHAR(10) NOT NULL DEFAULT 'any',
            status VARCHAR(30) NOT NULL,
            approvers JSONB NOT NULL DEFAULT '[]'::jsonb,
            activated_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_legacy_approval_request_revision_step
                UNIQUE (expense_request_id, revision, step_no)
        );
        CREATE INDEX IF NOT EXISTS ix_legacy_approval_request
            ON expense_request_legacy_approval_steps (expense_request_id, revision, step_no);
        ALTER TABLE expense_request_legacy_approval_steps ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS tenant_isolation ON expense_request_legacy_approval_steps;
        CREATE POLICY tenant_isolation ON expense_request_legacy_approval_steps
            USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::integer)
            WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::integer);
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS expense_request_legacy_approval_steps")
