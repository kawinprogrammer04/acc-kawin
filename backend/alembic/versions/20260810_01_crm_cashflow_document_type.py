"""Add a document type to CRM cashflow statements.

Revision ID: 20260810_01
Revises: 20260808_01
Create Date: 2026-08-10
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260810_01"
down_revision: Union[str, None] = "20260808_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE cashflow_statement
            ADD COLUMN cfstate_document_type VARCHAR(30),
            ADD CONSTRAINT ck_cashflow_statement_document_type
                CHECK (cfstate_document_type IN ('tax_invoice', 'cash_bill', 'other'));
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE cashflow_statement
            DROP CONSTRAINT IF EXISTS ck_cashflow_statement_document_type,
            DROP COLUMN IF EXISTS cfstate_document_type;
    """)
