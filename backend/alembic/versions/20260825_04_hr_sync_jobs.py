"""Add durable admin-triggered HR sync job tracking.

Revision ID: 20260825_04
Revises: 20260825_03
Create Date: 2026-08-25
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260825_04"
down_revision: Union[str, None] = "20260825_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE hr_sync_jobs (
            id UUID PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
            requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            mode VARCHAR(20) NOT NULL CHECK (mode IN ('preflight', 'apply')),
            status VARCHAR(20) NOT NULL
                CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
            preflight_job_id UUID REFERENCES hr_sync_jobs(id) ON DELETE RESTRICT,
            expected_snapshot_sha256 VARCHAR(64),
            source_snapshot_sha256 VARCHAR(64),
            source_from_date DATE NOT NULL,
            source_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
            result_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
            backup_file_name VARCHAR(255),
            error_message TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_hr_sync_apply_has_preflight CHECK (
                (mode='preflight' AND preflight_job_id IS NULL
                    AND expected_snapshot_sha256 IS NULL)
                OR
                (mode='apply' AND preflight_job_id IS NOT NULL
                    AND expected_snapshot_sha256 IS NOT NULL)
            )
        );
        CREATE INDEX ix_hr_sync_jobs_company_created
            ON hr_sync_jobs(company_id, created_at DESC);
        CREATE INDEX ix_hr_sync_jobs_active
            ON hr_sync_jobs(company_id, status)
            WHERE status IN ('queued', 'running');

        ALTER TABLE hr_sync_jobs ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON hr_sync_jobs
            USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::integer)
            WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::integer);
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS hr_sync_jobs")
