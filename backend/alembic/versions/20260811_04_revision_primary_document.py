"""Scope generated primary documents to an expense revision.

Revision ID: 20260811_04
Revises: 20260811_03
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260811_04"
down_revision: Union[str, None] = "20260811_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        DROP INDEX IF EXISTS uq_expense_request_primary_attachment;
        CREATE UNIQUE INDEX uq_expense_request_revision_primary_attachment
        ON expense_request_attachments(expense_request_id, revision)
        WHERE attachment_type='primary' AND is_active;
    """)


def downgrade() -> None:
    op.execute("""
        DROP INDEX IF EXISTS uq_expense_request_revision_primary_attachment;
        CREATE UNIQUE INDEX uq_expense_request_primary_attachment
        ON expense_request_attachments(expense_request_id)
        WHERE attachment_type='primary';
    """)
