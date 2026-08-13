"""Add customizable column-mapping templates for CRM cashflow import.

Revision ID: 20260811_07
Revises: 20260810_01
Create Date: 2026-08-11
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260811_07"
down_revision: Union[str, None] = "20260810_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE cashflow_import_template (
            cfimptpl_id SERIAL PRIMARY KEY,
            comp_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            cfimptpl_name VARCHAR(255) NOT NULL,
            cfimptpl_header_row SMALLINT NOT NULL DEFAULT 1,
            cfimptpl_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
            cfimptpl_status SMALLINT NOT NULL DEFAULT 1,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );

        CREATE INDEX ix_cashflow_import_template_company
            ON cashflow_import_template(comp_id, cfimptpl_status);
    """)

    op.execute("ALTER TABLE cashflow_import_template ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON cashflow_import_template
        USING (
            comp_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER
        )
        WITH CHECK (
            comp_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER
        );
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS cashflow_import_template;")
