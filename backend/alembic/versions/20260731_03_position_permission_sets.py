"""Allow permission sets to be assigned to a position, not just an individual user.

Revision ID: 20260731_03
Revises: 20260731_02
Create Date: 2026-07-31
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260731_03"
down_revision: Union[str, None] = "20260731_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE position_permission_sets (
            id SERIAL PRIMARY KEY,
            position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
            permission_set_id INTEGER NOT NULL REFERENCES permission_sets(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_position_permission_sets_position_set UNIQUE (position_id, permission_set_id)
        );
        CREATE INDEX ix_position_permission_sets_position_id ON position_permission_sets(position_id);
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS position_permission_sets;")
