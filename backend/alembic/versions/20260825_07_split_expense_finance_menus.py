"""Restore accounting menu and add expense dashboard separately.

Revision ID: 20260825_07
Revises: 20260825_06
Create Date: 2026-08-25
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260825_07"
down_revision: Union[str, None] = "20260825_06"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        -- Migration 06 reused expense_accounting for the dashboard. Restore
        -- the original accounting menu and create a distinct dashboard menu.
        UPDATE app_menus
        SET label = 'บัญชีตรวจจ่าย',
            path = '/expense-requests/accounting',
            icon = 'WalletCards',
            group_key = 'cashflow',
            group_label = 'กระแสเงินสด',
            sort_order = 148,
            is_active = TRUE,
            is_system = TRUE,
            updated_at = NOW()
        WHERE key = 'expense_accounting';

        INSERT INTO app_menus
            (key, label, path, icon, group_key, group_label, sort_order, is_active, is_system)
        VALUES
            ('expense_dashboard', 'แดชบอร์ดค่าใช้จ่าย', '/expense-requests/dashboard',
             'LayoutDashboard', 'cashflow', 'กระแสเงินสด', 146, TRUE, TRUE)
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
            'expense_dashboard.' || action.action_key,
            dashboard.id,
            dashboard.key,
            action.action_key,
            action.label,
            'migration',
            dashboard.sort_order + action.sort_offset,
            TRUE
        FROM app_menus dashboard
        CROSS JOIN (
            VALUES
                ('view', 'เข้าเมนู', 1),
                ('create', 'เพิ่มข้อมูล', 2),
                ('update', 'แก้ไขข้อมูล', 3),
                ('delete', 'ลบข้อมูล', 4),
                ('approve', 'อนุมัติ', 5),
                ('export', 'Export', 6)
        ) AS action(action_key, label, sort_offset)
        WHERE dashboard.key = 'expense_dashboard'
        ON CONFLICT (key) DO UPDATE SET
            menu_id = EXCLUDED.menu_id,
            menu_key = EXCLUDED.menu_key,
            action_key = EXCLUDED.action_key,
            label = EXCLUDED.label,
            updated_at = NOW();

        -- Mirror legacy per-user permissions from accounting to dashboard.
        INSERT INTO menu_permissions
            (user_id, menu_id, can_view, can_create, can_update, can_delete, can_approve, can_export)
        SELECT permission.user_id, dashboard.id,
               permission.can_view, permission.can_create, permission.can_update,
               permission.can_delete, permission.can_approve, permission.can_export
        FROM menu_permissions permission
        JOIN app_menus accounting ON accounting.id = permission.menu_id
        CROSS JOIN app_menus dashboard
        WHERE accounting.key = 'expense_accounting'
          AND dashboard.key = 'expense_dashboard'
        ON CONFLICT (user_id, menu_id) DO UPDATE SET
            can_view = EXCLUDED.can_view,
            can_create = EXCLUDED.can_create,
            can_update = EXCLUDED.can_update,
            can_delete = EXCLUDED.can_delete,
            can_approve = EXCLUDED.can_approve,
            can_export = EXCLUDED.can_export,
            updated_at = NOW();

        -- Mirror permission-set assignments action by action.
        INSERT INTO permission_set_items (permission_set_id, permission_item_id)
        SELECT assignment.permission_set_id, dashboard_item.id
        FROM permission_set_items assignment
        JOIN permission_items accounting_item
          ON accounting_item.id = assignment.permission_item_id
         AND accounting_item.menu_key = 'expense_accounting'
        JOIN permission_items dashboard_item
          ON dashboard_item.menu_key = 'expense_dashboard'
         AND dashboard_item.action_key = accounting_item.action_key
        ON CONFLICT (permission_set_id, permission_item_id) DO NOTHING;

        -- Mirror explicit user overrides as well.
        INSERT INTO user_permission_overrides
            (user_id, permission_item_id, is_allowed)
        SELECT override_row.user_id, dashboard_item.id, override_row.is_allowed
        FROM user_permission_overrides override_row
        JOIN permission_items accounting_item
          ON accounting_item.id = override_row.permission_item_id
         AND accounting_item.menu_key = 'expense_accounting'
        JOIN permission_items dashboard_item
          ON dashboard_item.menu_key = 'expense_dashboard'
         AND dashboard_item.action_key = accounting_item.action_key
        ON CONFLICT (user_id, permission_item_id) DO UPDATE SET
            is_allowed = EXCLUDED.is_allowed,
            updated_at = NOW();
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM user_permission_overrides
        WHERE permission_item_id IN (
            SELECT id FROM permission_items WHERE menu_key = 'expense_dashboard'
        );
        DELETE FROM permission_set_items
        WHERE permission_item_id IN (
            SELECT id FROM permission_items WHERE menu_key = 'expense_dashboard'
        );
        DELETE FROM menu_permissions
        WHERE menu_id IN (SELECT id FROM app_menus WHERE key = 'expense_dashboard');
        DELETE FROM permission_items WHERE menu_key = 'expense_dashboard';
        DELETE FROM app_menus WHERE key = 'expense_dashboard';

        UPDATE app_menus
        SET label = 'แดชบอร์ดค่าใช้จ่าย',
            path = '/expense-requests/dashboard',
            icon = 'WalletCards',
            sort_order = 146,
            updated_at = NOW()
        WHERE key = 'expense_accounting';
    """)
