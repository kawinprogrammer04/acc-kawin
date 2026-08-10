"""Make user roles database-driven instead of hardcoded.

Revision ID: 20260731_02
Revises: 20260731_01
Create Date: 2026-07-31
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260731_02"
down_revision: Union[str, None] = "20260731_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE roles (
            id SERIAL PRIMARY KEY,
            code VARCHAR(30) NOT NULL UNIQUE,
            label VARCHAR(100) NOT NULL,
            level INTEGER NOT NULL,
            is_system BOOLEAN NOT NULL DEFAULT FALSE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- The 4 roles the codebase already relies on by name (require_viewer,
        -- require_accountant, require_approver, require_admin shortcuts) —
        -- protected from deletion/rename via is_system.
        INSERT INTO roles (code, label, level, is_system) VALUES
            ('admin', 'ผู้ดูแลระบบ', 4, TRUE),
            ('approver', 'ผู้อนุมัติ', 3, TRUE),
            ('accountant', 'นักบัญชี', 2, TRUE),
            ('viewer', 'ผู้ดู', 1, TRUE);

        ALTER TABLE user_companies DROP CONSTRAINT IF EXISTS ck_user_companies_role;
        ALTER TABLE user_companies
            ADD CONSTRAINT fk_user_companies_role FOREIGN KEY (role) REFERENCES roles(code);
        ALTER TABLE users
            ADD CONSTRAINT fk_users_role FOREIGN KEY (role) REFERENCES roles(code);
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_role;
        ALTER TABLE user_companies DROP CONSTRAINT IF EXISTS fk_user_companies_role;
        ALTER TABLE user_companies
            ADD CONSTRAINT ck_user_companies_role
            CHECK (role IN ('admin', 'approver', 'accountant', 'viewer'));
        DROP TABLE IF EXISTS roles;
    """)
