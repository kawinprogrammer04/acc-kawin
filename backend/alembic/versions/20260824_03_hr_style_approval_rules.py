"""Add active state to approval rules for HR-style settings management."""
from typing import Sequence, Union

from alembic import op


revision: str = "20260824_03"
down_revision: Union[str, None] = "20260824_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE approval_rules ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE")


def downgrade() -> None:
    op.execute("ALTER TABLE approval_rules DROP COLUMN IF EXISTS is_active")
