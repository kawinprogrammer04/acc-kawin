"""Preserve HR logical approval scopes alongside expanded ACC routes."""
from typing import Sequence, Union

from alembic import op


revision: str = "20260825_01"
down_revision: Union[str, None] = "20260824_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE approval_rules
            ADD COLUMN IF NOT EXISTS logical_group_key VARCHAR(100),
            ADD COLUMN IF NOT EXISTS source_scope JSONB;

        UPDATE approval_rules
        SET logical_group_key = CASE
            WHEN source_system = 'hr' AND source_policy_id IS NOT NULL
                THEN 'hr:' || source_policy_id::text
            ELSE 'acc:' || id::text
        END
        WHERE logical_group_key IS NULL;

        CREATE INDEX IF NOT EXISTS ix_approval_rules_logical_group
            ON approval_rules(policy_version_id, logical_group_key);
    """)


def downgrade() -> None:
    op.execute("""
        DROP INDEX IF EXISTS ix_approval_rules_logical_group;
        ALTER TABLE approval_rules
            DROP COLUMN IF EXISTS source_scope,
            DROP COLUMN IF EXISTS logical_group_key;
    """)
