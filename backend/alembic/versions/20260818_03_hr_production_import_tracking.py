"""Track production-safe HR user and snapshot imports.

Revision ID: 20260818_03
Revises: 20260818_02
Create Date: 2026-08-18
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260818_03"
down_revision: Union[str, None] = "20260818_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE hr_user_import_map (
            hr_user_id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            username VARCHAR(50) NOT NULL,
            imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_hr_user_import_map_user UNIQUE (user_id),
            CONSTRAINT uq_hr_user_import_map_username UNIQUE (username)
        );

        CREATE TABLE hr_production_import_runs (
            bundle_id UUID PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
            manifest_sha256 VARCHAR(64) NOT NULL,
            source_created_at TIMESTAMPTZ NOT NULL,
            source_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
            imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX ix_hr_production_import_runs_company
            ON hr_production_import_runs(company_id, imported_at DESC);

        ALTER TABLE hr_production_import_runs ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON hr_production_import_runs
            USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::integer)
            WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::integer);
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS hr_production_import_runs")
    op.execute("DROP TABLE IF EXISTS hr_user_import_map")
