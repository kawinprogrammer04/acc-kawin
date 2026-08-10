"""Add per-company external integration settings.

Revision ID: 20260724_02
Revises: 20260724_01
Create Date: 2026-07-24
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260724_02"
down_revision: Union[str, None] = "20260724_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS company_integrations (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            provider VARCHAR(50) NOT NULL,
            base_url VARCHAR(500),
            orders_path VARCHAR(300),
            api_token TEXT,
            external_company_id VARCHAR(100),
            is_active BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            CONSTRAINT uq_company_integration_provider
                UNIQUE (company_id, provider)
        );

        CREATE INDEX IF NOT EXISTS ix_company_integrations_company_id
            ON company_integrations (company_id);

        ALTER TABLE company_integrations ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS tenant_isolation ON company_integrations;
        CREATE POLICY tenant_isolation ON company_integrations
        USING (
            company_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER
        )
        WITH CHECK (
            company_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER
        );
    """)


def downgrade() -> None:
    op.execute("""
        DROP POLICY IF EXISTS tenant_isolation ON company_integrations;
        ALTER TABLE company_integrations DISABLE ROW LEVEL SECURITY;
        DROP TABLE IF EXISTS company_integrations;
    """)
