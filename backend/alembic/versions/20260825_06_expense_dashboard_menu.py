"""Expose the ACC expense dashboard in the finance menu.

Revision ID: 20260825_06
Revises: 20260825_05
Create Date: 2026-08-25
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260825_06"
down_revision: Union[str, None] = "20260825_05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # app_menus/permission_items are created by the existing menu-permission
    # setup SQL.  Keep this migration idempotent for already-seeded databases.
    op.execute("""
        INSERT INTO app_menus
            (key, label, path, icon, group_key, group_label, sort_order, is_active, is_system)
        VALUES
            ('expense_accounting', 'แดชบอร์ดค่าใช้จ่าย', '/expense-requests/dashboard',
             'WalletCards', 'cashflow', 'กระแสเงินสด', 146, TRUE, TRUE)
        ON CONFLICT (key) DO UPDATE SET
            label = EXCLUDED.label,
            path = EXCLUDED.path,
            icon = EXCLUDED.icon,
            group_key = EXCLUDED.group_key,
            group_label = EXCLUDED.group_label,
            sort_order = EXCLUDED.sort_order,
            is_active = EXCLUDED.is_active,
            is_system = TRUE,
            updated_at = NOW();

        INSERT INTO permission_items
            (key, menu_id, menu_key, action_key, label, source, sort_order, is_active)
        SELECT
            'expense_accounting.' || action.action_key,
            m.id,
            m.key,
            action.action_key,
            action.label,
            'migration',
            m.sort_order + action.sort_offset,
            TRUE
        FROM app_menus m
        CROSS JOIN (
            VALUES
                ('view', 'เข้าเมนู', 1),
                ('create', 'เพิ่มข้อมูล', 2),
                ('update', 'แก้ไขข้อมูล', 3),
                ('delete', 'ลบข้อมูล', 4),
                ('approve', 'อนุมัติ', 5),
                ('export', 'Export', 6)
        ) AS action(action_key, label, sort_offset)
        WHERE m.key = 'expense_accounting'
        ON CONFLICT (key) DO UPDATE SET
            menu_id = EXCLUDED.menu_id,
            menu_key = EXCLUDED.menu_key,
            action_key = EXCLUDED.action_key,
            label = EXCLUDED.label,
            updated_at = NOW();

        -- Keep the legacy per-user menu model aligned with existing accountant
        -- roles.  This does not grant normal employees access to the menu.
        INSERT INTO menu_permissions
            (user_id, menu_id, can_view, can_create, can_update, can_delete, can_approve, can_export)
        SELECT u.id, m.id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE
        FROM users u
        CROSS JOIN app_menus m
        WHERE m.key = 'expense_accounting'
          AND (u.is_platform_admin IS TRUE OR u.role IN ('admin', 'accountant'))
        ON CONFLICT (user_id, menu_id) DO NOTHING;

        -- For catalog permissions, mirror the existing accounting view grant
        -- when that permission item already exists in a permission set.
        INSERT INTO permission_set_items (permission_set_id, permission_item_id)
        SELECT old_set.permission_set_id, dashboard_item.id
        FROM permission_set_items old_set
        JOIN permission_items accounting_item
          ON accounting_item.id = old_set.permission_item_id
         AND accounting_item.key = 'expense_accounting.view'
        CROSS JOIN permission_items dashboard_item
        WHERE dashboard_item.key = 'expense_accounting.view'
        ON CONFLICT (permission_set_id, permission_item_id) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM permission_set_items
        WHERE permission_item_id IN (
            SELECT id FROM permission_items WHERE menu_key = 'expense_accounting'
        );
        DELETE FROM menu_permissions
        WHERE menu_id IN (SELECT id FROM app_menus WHERE key = 'expense_accounting');
        DELETE FROM permission_items WHERE menu_key = 'expense_accounting';
        DELETE FROM app_menus WHERE key = 'expense_accounting';
    """)
