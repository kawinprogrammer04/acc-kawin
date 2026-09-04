"""add per-item withholding tax rate

Revision ID: 20260904_01
Revises: 20260903_01
Create Date: 2026-09-04
"""

from alembic import op
import sqlalchemy as sa


revision = "20260904_01"
down_revision = "20260903_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "expense_request_items",
        sa.Column("withholding_rate", sa.Numeric(5, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("expense_request_items", "withholding_rate")
