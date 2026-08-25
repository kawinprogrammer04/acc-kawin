"""Allow global HR fallback approval rules without ACC document types."""
from typing import Union

from alembic import op

revision: str = "20260825_02"
down_revision: Union[str, None] = "20260825_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE approval_rules
            ALTER COLUMN requester_position_id DROP NOT NULL,
            ALTER COLUMN expense_type_id DROP NOT NULL;

        DROP INDEX IF EXISTS uq_approval_rules_source_expansion;
        CREATE UNIQUE INDEX uq_approval_rules_source_expansion
            ON approval_rules(policy_version_id, source_system, source_policy_id,
                              requester_position_id, expense_type_id) NULLS NOT DISTINCT
            WHERE source_system IS NOT NULL;
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM approval_rules
        WHERE requester_position_id IS NULL OR expense_type_id IS NULL;

        DROP INDEX IF EXISTS uq_approval_rules_source_expansion;
        CREATE UNIQUE INDEX uq_approval_rules_source_expansion
            ON approval_rules(policy_version_id, source_system, source_policy_id,
                              requester_position_id, expense_type_id)
            WHERE source_system IS NOT NULL;

        ALTER TABLE approval_rules
            ALTER COLUMN requester_position_id SET NOT NULL,
            ALTER COLUMN expense_type_id SET NOT NULL;
    """)
