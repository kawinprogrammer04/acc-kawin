"""Track files and runs owned by the read-only HR incremental sync.

Revision ID: 20260825_03
Revises: 20260825_02, 20260819_01
Create Date: 2026-08-25
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260825_03"
down_revision: Union[str, Sequence[str], None] = ("20260825_02", "20260819_01")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE hr_expense_attachment_import_map (
            hr_expense_request_id BIGINT NOT NULL
                REFERENCES hr_expense_request_import_map(hr_expense_request_id) ON DELETE CASCADE,
            source_key VARCHAR(80) NOT NULL,
            attachment_id UUID NOT NULL
                REFERENCES expense_request_attachments(id) ON DELETE RESTRICT,
            source_sha256 VARCHAR(64) NOT NULL,
            source_signed_sha256 VARCHAR(64),
            synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (hr_expense_request_id, source_key),
            CONSTRAINT uq_hr_expense_attachment_map_attachment UNIQUE (attachment_id)
        );

        CREATE TABLE hr_user_position_import_map (
            hr_user_id INTEGER NOT NULL
                REFERENCES hr_user_import_map(hr_user_id) ON DELETE CASCADE,
            hr_position_id BIGINT NOT NULL,
            user_position_id INTEGER NOT NULL
                REFERENCES user_positions(id) ON DELETE RESTRICT,
            synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (hr_user_id, hr_position_id),
            CONSTRAINT uq_hr_user_position_map_target UNIQUE (user_position_id)
        );

        CREATE TABLE hr_incremental_sync_runs (
            id UUID PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
            source_snapshot_sha256 VARCHAR(64) NOT NULL,
            source_created_at TIMESTAMPTZ NOT NULL,
            source_from_date DATE NOT NULL,
            source_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
            result_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
            imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX ix_hr_incremental_sync_runs_company
            ON hr_incremental_sync_runs(company_id, imported_at DESC);

        ALTER TABLE hr_incremental_sync_runs ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON hr_incremental_sync_runs
            USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::integer)
            WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::integer);
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS hr_incremental_sync_runs")
    op.execute("DROP TABLE IF EXISTS hr_user_position_import_map")
    op.execute("DROP TABLE IF EXISTS hr_expense_attachment_import_map")
