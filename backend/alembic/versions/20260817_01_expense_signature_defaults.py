"""Remember HR-style signature placement defaults for required documents.

Revision ID: 20260817_01
Revises: 20260814_02
Create Date: 2026-08-17
"""
from alembic import op


revision = "20260817_01"
down_revision = "20260814_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE expense_attachment_requirements
            ADD COLUMN IF NOT EXISTS default_signature_page INTEGER,
            ADD COLUMN IF NOT EXISTS default_signature_x NUMERIC(8,6),
            ADD COLUMN IF NOT EXISTS default_signature_y NUMERIC(8,6),
            ADD COLUMN IF NOT EXISTS default_signature_width NUMERIC(8,6),
            ADD COLUMN IF NOT EXISTS default_signature_height NUMERIC(8,6);
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE expense_attachment_requirements
            DROP COLUMN IF EXISTS default_signature_height,
            DROP COLUMN IF EXISTS default_signature_width,
            DROP COLUMN IF EXISTS default_signature_y,
            DROP COLUMN IF EXISTS default_signature_x,
            DROP COLUMN IF EXISTS default_signature_page;
    """)
