"""Mark every generated primary expense document as signature-required.

Revision ID: 20260811_05
Revises: 20260811_04
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260811_05"
down_revision: Union[str, None] = "20260811_04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        UPDATE expense_request_attachments
        SET category = 'system_document', requires_signature = TRUE
        WHERE attachment_type = 'primary';
    """)


def downgrade() -> None:
    # Existing rows may have required a signature before this backfill, so a
    # downgrade must not silently remove that security requirement.
    pass
