"""Support HR-compatible approval policy targets and overlapping priorities."""
from typing import Union

from alembic import op

revision: str = "20260818_02"
down_revision: Union[str, None] = "20260818_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE approval_rules DROP CONSTRAINT IF EXISTS ex_approval_rules_no_overlap;
        ALTER TABLE approval_rules
            ADD COLUMN source_system VARCHAR(20),
            ADD COLUMN source_policy_id BIGINT,
            ADD COLUMN source_policy_name VARCHAR(255),
            ADD COLUMN priority INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN specificity SMALLINT NOT NULL DEFAULT 3,
            ADD COLUMN request_kind VARCHAR(30);
        CREATE UNIQUE INDEX uq_approval_rules_source_expansion
            ON approval_rules(policy_version_id, source_system, source_policy_id,
                              requester_position_id, expense_type_id)
            WHERE source_system IS NOT NULL;

        ALTER TABLE approval_rule_steps
            ALTER COLUMN approver_position_id DROP NOT NULL,
            ADD COLUMN name VARCHAR(180),
            ADD COLUMN approve_mode VARCHAR(10) NOT NULL DEFAULT 'any',
            ADD COLUMN target_type VARCHAR(30) NOT NULL DEFAULT 'position',
            ADD COLUMN target_user_id INTEGER REFERENCES users(id);
        ALTER TABLE approval_request_steps ALTER COLUMN approver_position_id DROP NOT NULL;
    """)


def downgrade() -> None:
    op.execute("""
        DROP INDEX IF EXISTS uq_approval_rules_source_expansion;
        DELETE FROM approval_rule_steps WHERE approver_position_id IS NULL;
        DELETE FROM approval_request_steps WHERE approver_position_id IS NULL;
        ALTER TABLE approval_rule_steps DROP COLUMN IF EXISTS target_user_id,
            DROP COLUMN IF EXISTS target_type, DROP COLUMN IF EXISTS approve_mode,
            DROP COLUMN IF EXISTS name, ALTER COLUMN approver_position_id SET NOT NULL;
        ALTER TABLE approval_request_steps ALTER COLUMN approver_position_id SET NOT NULL;
        ALTER TABLE approval_rules DROP COLUMN IF EXISTS request_kind,
            DROP COLUMN IF EXISTS specificity, DROP COLUMN IF EXISTS priority,
            DROP COLUMN IF EXISTS source_policy_name, DROP COLUMN IF EXISTS source_policy_id,
            DROP COLUMN IF EXISTS source_system;
        ALTER TABLE approval_rules ADD CONSTRAINT ex_approval_rules_no_overlap
            EXCLUDE USING gist (policy_version_id WITH =, requester_position_id WITH =,
                                expense_type_id WITH =, amount_range WITH &&);
    """)
