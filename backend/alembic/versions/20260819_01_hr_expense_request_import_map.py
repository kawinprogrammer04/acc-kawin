"""Add missing hr_expense_request_import_map table.

hr_production_bundle.py (and related HR import commands) reference this
table extensively for mapping legacy HR expense-request ids to production
expense_requests rows, but the migration that shipped alongside
hr_user_import_map / hr_production_import_runs (20260818_03) never created
it. Discovered when the HR bundle import preflight failed with:
    ValueError: run alembic upgrade head first; missing tables:
    hr_expense_request_import_map

Revision ID: 20260819_01
Revises: 20260818_03
Create Date: 2026-08-19
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260819_01"
down_revision: Union[str, None] = "20260818_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE hr_expense_request_import_map (
            hr_expense_request_id BIGINT PRIMARY KEY,
            expense_request_id UUID NOT NULL REFERENCES expense_requests(id) ON DELETE RESTRICT,
            source_status VARCHAR(50) NOT NULL,
            source_item_count INTEGER NOT NULL DEFAULT 0,
            source_payment_count INTEGER NOT NULL DEFAULT 0,
            imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_hr_expense_request_import_map_request UNIQUE (expense_request_id)
        );
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS hr_expense_request_import_map")
