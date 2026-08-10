"""Add attachments for CRM cashflow statements.

Revision ID: 20260807_02
Revises: 20260807_01
Create Date: 2026-08-07
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260807_02"
down_revision: Union[str, None] = "20260807_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE cashflow_statement_attachments (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            cfstate_id INTEGER NOT NULL
                REFERENCES cashflow_statement(cfstate_id) ON DELETE CASCADE,
            comp_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            file_name VARCHAR(255) NOT NULL,
            stored_name VARCHAR(255) NOT NULL,
            file_path VARCHAR(500) NOT NULL,
            content_type VARCHAR(100) NOT NULL,
            file_size INTEGER NOT NULL,
            created_by INTEGER NOT NULL REFERENCES users(id),
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE INDEX ix_cashflow_statement_attachments_statement
            ON cashflow_statement_attachments(cfstate_id, created_at DESC);
        CREATE INDEX ix_cashflow_statement_attachments_company
            ON cashflow_statement_attachments(comp_id, created_at DESC);
    """)

    op.execute("ALTER TABLE cashflow_statement_attachments ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON cashflow_statement_attachments
        USING (
            comp_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER
        )
        WITH CHECK (
            comp_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER
        );
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS cashflow_statement_attachments;")
