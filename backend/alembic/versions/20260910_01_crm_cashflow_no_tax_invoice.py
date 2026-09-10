"""Allow the CRM cashflow no-tax-invoice document type.

Revision ID: 20260910_01
Revises: 20260908_01
"""
from alembic import op


revision = "20260910_01"
down_revision = "20260908_01"
branch_labels = None
depends_on = None


CONSTRAINT_NAME = "ck_cashflow_statement_document_type"


def upgrade() -> None:
    op.drop_constraint(CONSTRAINT_NAME, "cashflow_statement", type_="check")
    op.create_check_constraint(
        CONSTRAINT_NAME,
        "cashflow_statement",
        "cfstate_document_type IN ('tax_invoice', 'cash_bill', 'no_tax_invoice', 'other')",
    )


def downgrade() -> None:
    op.execute(
        "UPDATE cashflow_statement "
        "SET cfstate_document_type = 'other' "
        "WHERE cfstate_document_type = 'no_tax_invoice'"
    )
    op.drop_constraint(CONSTRAINT_NAME, "cashflow_statement", type_="check")
    op.create_check_constraint(
        CONSTRAINT_NAME,
        "cashflow_statement",
        "cfstate_document_type IN ('tax_invoice', 'cash_bill', 'other')",
    )
