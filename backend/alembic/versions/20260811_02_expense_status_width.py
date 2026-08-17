"""Allow descriptive finance workflow status names.

Revision ID: 20260811_02
Revises: 20260811_01
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260811_02"
down_revision: Union[str, None] = "20260811_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE expense_requests ALTER COLUMN status TYPE VARCHAR(40)")


def downgrade() -> None:
    op.execute("ALTER TABLE expense_requests ALTER COLUMN status TYPE VARCHAR(20)")
