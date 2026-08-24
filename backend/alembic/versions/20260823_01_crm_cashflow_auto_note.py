"""Classify CRM cashflow Description values for invoice tracking.

Revision ID: 20260823_01
Revises: 20260821_01
Create Date: 2026-08-23
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260823_01"
down_revision: Union[str, None] = "20260821_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE cashflow_statement ADD COLUMN IF NOT EXISTS cfstate_note TEXT")
    op.execute("""
        UPDATE cashflow_statement
        SET
            cfstate_note = CASE
                WHEN lower(btrim(coalesce(cfstate_detail, ''))) LIKE '%kbank x7675%' THEN 'ADS AMEX'
                WHEN lower(btrim(coalesce(cfstate_detail, ''))) LIKE '%scb x2988%' THEN 'ADS SCB'
                WHEN lower(btrim(coalesce(cfstate_detail, ''))) LIKE '%scb x9566%' THEN 'ADS'
                WHEN lower(btrim(coalesce(cfstate_detail, ''))) LIKE '%1892112988%' THEN 'ADS SCB'
                WHEN lower(btrim(coalesce(cfstate_detail, ''))) LIKE '%scb x699%' THEN 'ค่า ADS Shopee'
                WHEN lower(btrim(coalesce(cfstate_detail, ''))) LIKE '%pay%' THEN 'รายการอื่นๆ'
            END,
            cfstate_verified = 1
        WHERE cfstate_status = 1
          AND (
              lower(btrim(coalesce(cfstate_detail, ''))) LIKE '%kbank x7675%'
              OR lower(btrim(coalesce(cfstate_detail, ''))) LIKE '%scb x2988%'
              OR lower(btrim(coalesce(cfstate_detail, ''))) LIKE '%scb x9566%'
              OR lower(btrim(coalesce(cfstate_detail, ''))) LIKE '%1892112988%'
              OR lower(btrim(coalesce(cfstate_detail, ''))) LIKE '%scb x699%'
              OR lower(btrim(coalesce(cfstate_detail, ''))) LIKE '%pay%'
          )
    """)


def downgrade() -> None:
    # The verification flag is intentionally not reset: some rows may have
    # been manually verified after this migration ran.
    op.execute("ALTER TABLE cashflow_statement DROP COLUMN IF EXISTS cfstate_note")
