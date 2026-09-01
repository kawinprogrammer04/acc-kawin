"""Add the HR expense requests link to the Finance menu.

Revision ID: 20260901_01
Revises: 20260826_01
Create Date: 2026-09-01
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260901_01"
down_revision: Union[str, None] = "20260826_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO app_menus
            (key, label, path, icon, group_key, group_label, description,
             sort_order, is_active, is_system)
        VALUES
            ('hr_expense_requests', 'กลับไประบบ HR',
             'https://hr.kawinbrothers.com/hr/expense-requests', 'ExternalLink',
             'finance', 'การเงิน', 'กลับไปยังรายการเบิกค่าใช้จ่ายในระบบ HR',
             149, TRUE, TRUE)
        ON CONFLICT (key) DO UPDATE SET
            label = EXCLUDED.label,
            path = EXCLUDED.path,
            icon = EXCLUDED.icon,
            group_key = EXCLUDED.group_key,
            group_label = EXCLUDED.group_label,
            description = EXCLUDED.description,
            sort_order = EXCLUDED.sort_order,
            is_active = EXCLUDED.is_active,
            is_system = TRUE,
            updated_at = NOW();

        INSERT INTO permission_items
            (key, menu_id, menu_key, action_key, label, source,
             sort_order, is_active)
        SELECT
            'hr_expense_requests.view', menu.id, menu.key, 'view',
            'เข้าเมนู', 'migration', menu.sort_order + 1, TRUE
        FROM app_menus menu
        WHERE menu.key = 'hr_expense_requests'
        ON CONFLICT (key) DO UPDATE SET
            menu_id = EXCLUDED.menu_id,
            menu_key = EXCLUDED.menu_key,
            action_key = EXCLUDED.action_key,
            label = EXCLUDED.label,
            source = EXCLUDED.source,
            sort_order = EXCLUDED.sort_order,
            is_active = TRUE,
            updated_at = NOW();

        -- Legacy permissions: anyone who can see the ACC expense request menu
        -- can also use the return link to the HR expense request list.
        INSERT INTO menu_permissions
            (user_id, menu_id, can_view, can_create, can_update,
             can_delete, can_approve, can_export)
        SELECT permission.user_id, hr_menu.id, permission.can_view,
               FALSE, FALSE, FALSE, FALSE, FALSE
        FROM menu_permissions permission
        JOIN app_menus expense_menu
          ON expense_menu.id = permission.menu_id
         AND expense_menu.key = 'expense_requests'
        CROSS JOIN app_menus hr_menu
        WHERE hr_menu.key = 'hr_expense_requests'
        ON CONFLICT (user_id, menu_id) DO UPDATE SET
            can_view = EXCLUDED.can_view,
            updated_at = NOW();

        -- Catalog permissions: mirror the expense_requests.view assignment
        -- for permission sets and explicit per-user overrides.
        INSERT INTO permission_set_items (permission_set_id, permission_item_id)
        SELECT assignment.permission_set_id, hr_item.id
        FROM permission_set_items assignment
        JOIN permission_items expense_item
          ON expense_item.id = assignment.permission_item_id
         AND expense_item.key = 'expense_requests.view'
        CROSS JOIN permission_items hr_item
        WHERE hr_item.key = 'hr_expense_requests.view'
        ON CONFLICT (permission_set_id, permission_item_id) DO NOTHING;

        INSERT INTO user_permission_overrides
            (user_id, permission_item_id, is_allowed)
        SELECT override_row.user_id, hr_item.id, override_row.is_allowed
        FROM user_permission_overrides override_row
        JOIN permission_items expense_item
          ON expense_item.id = override_row.permission_item_id
         AND expense_item.key = 'expense_requests.view'
        CROSS JOIN permission_items hr_item
        WHERE hr_item.key = 'hr_expense_requests.view'
        ON CONFLICT (user_id, permission_item_id) DO UPDATE SET
            is_allowed = EXCLUDED.is_allowed,
            updated_at = NOW();
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM user_permission_overrides
        WHERE permission_item_id IN (
            SELECT id FROM permission_items
            WHERE key = 'hr_expense_requests.view'
        );
        DELETE FROM permission_set_items
        WHERE permission_item_id IN (
            SELECT id FROM permission_items
            WHERE key = 'hr_expense_requests.view'
        );
        DELETE FROM menu_permissions
        WHERE menu_id IN (
            SELECT id FROM app_menus WHERE key = 'hr_expense_requests'
        );
        DELETE FROM permission_items WHERE key = 'hr_expense_requests.view';
        DELETE FROM app_menus WHERE key = 'hr_expense_requests';
    """)
