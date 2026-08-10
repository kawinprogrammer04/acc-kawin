"""Scope VAT document uniqueness to each company.

Revision ID: 20260723_02
Revises: 20260723_01
Create Date: 2026-07-23
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260723_02"
down_revision: Union[str, None] = "20260723_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE vat_records DROP CONSTRAINT IF EXISTS uq_vat_record;
        ALTER TABLE vat_records
            ADD CONSTRAINT uq_vat_record_company
            UNIQUE (company_id, record_type, tax_invoice_number);
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE vat_records
            DROP CONSTRAINT IF EXISTS uq_vat_record_company;
    """)
