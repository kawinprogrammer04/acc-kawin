"""Add crm-kawin compatible cashflow statement and invoice tracking.

Revision ID: 20260807_01
Revises: 20260803_02
Create Date: 2026-08-07
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260807_01"
down_revision: Union[str, None] = "20260803_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TENANT_TABLES = (
    "cashflow_category",
    "cashflow_list",
    "cashflow_statement_department",
    "cashflow_statement",
)


def upgrade() -> None:
    op.execute("""
        CREATE TABLE cashflow_category (
            cfcat_id SERIAL PRIMARY KEY,
            cfcat_name VARCHAR(255) NOT NULL,
            comp_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            cfcat_status SMALLINT NOT NULL DEFAULT 1 CHECK (cfcat_status IN (0, 1)),
            CONSTRAINT uq_cashflow_category_company_name UNIQUE (comp_id, cfcat_name)
        );

        CREATE TABLE cashflow_list (
            cflist_id SERIAL PRIMARY KEY,
            cflist_name VARCHAR(255) NOT NULL,
            cfcat_id INTEGER NOT NULL REFERENCES cashflow_category(cfcat_id),
            cflist_status SMALLINT NOT NULL DEFAULT 1 CHECK (cflist_status IN (0, 1)),
            comp_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            cflist_hide SMALLINT,
            CONSTRAINT uq_cashflow_list_company_category_name
                UNIQUE (comp_id, cfcat_id, cflist_name)
        );

        CREATE TABLE cashflow_statement_department (
            cfstate_dep_id SERIAL PRIMARY KEY,
            cfstate_dep_name VARCHAR(255) NOT NULL,
            cfstate_dep_status SMALLINT NOT NULL DEFAULT 1
                CHECK (cfstate_dep_status IN (0, 1)),
            comp_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            CONSTRAINT uq_cashflow_department_company_name
                UNIQUE (comp_id, cfstate_dep_name)
        );

        CREATE TABLE cashflow_statement (
            cfstate_id SERIAL PRIMARY KEY,
            cfstate_date DATE NOT NULL,
            cfcat_id INTEGER NOT NULL REFERENCES cashflow_category(cfcat_id),
            cflist_id INTEGER NOT NULL REFERENCES cashflow_list(cflist_id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            comp_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            cfstate_amount NUMERIC(15,2) NOT NULL,
            cfstate_refrain SMALLINT NOT NULL DEFAULT 1
                CHECK (cfstate_refrain IN (0, 1)),
            cfstate_invoice SMALLINT CHECK (cfstate_invoice IN (0, 1)),
            cfstate_detail TEXT,
            cfstate_status SMALLINT NOT NULL DEFAULT 1
                CHECK (cfstate_status IN (0, 1)),
            cfstate_dep_id INTEGER REFERENCES cashflow_statement_department(cfstate_dep_id),
            cfstate_ref VARCHAR(255)
        );

        CREATE INDEX ix_cashflow_category_company_status
            ON cashflow_category(comp_id, cfcat_status);
        CREATE INDEX ix_cashflow_list_company_category_status
            ON cashflow_list(comp_id, cfcat_id, cflist_status);
        CREATE INDEX ix_cashflow_department_company_status
            ON cashflow_statement_department(comp_id, cfstate_dep_status);
        CREATE INDEX ix_cashflow_statement_company_date
            ON cashflow_statement(comp_id, cfstate_date DESC, cfstate_id DESC);
        CREATE INDEX ix_cashflow_statement_pending_invoice
            ON cashflow_statement(comp_id, cfstate_date DESC)
            WHERE cfstate_status = 1 AND cfstate_invoice = 0;
    """)

    for table in TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (
                comp_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER
            )
            WITH CHECK (
                comp_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER
            );
            """
        )

    # Menu records are conditional because older installations may not have
    # enabled the optional dynamic permission subsystem yet.
    op.execute("""
        DO $$
        BEGIN
            IF to_regclass('public.app_menus') IS NOT NULL THEN
                INSERT INTO app_menus
                    (key, label, path, icon, group_key, group_label,
                     description, sort_order, is_active, is_system)
                VALUES
                    ('crm_cashflow_statement', 'รายรับ-รายจ่าย (CRM)',
                     '/crm-cashflow/statements', 'ListTree', 'cashflow',
                     'กระแสเงินสด', 'รายการรายรับรายจ่ายรูปแบบ crm-kawin',
                     115, TRUE, TRUE),
                    ('crm_cashflow_invoice', 'ติดตามใบกำกับภาษี (CRM)',
                     '/crm-cashflow/invoices', 'Receipt', 'cashflow',
                     'กระแสเงินสด', 'ติดตามใบกำกับภาษีจากรายการ CRM Cashflow',
                     116, TRUE, TRUE)
                ON CONFLICT (key) DO UPDATE SET
                    label = EXCLUDED.label,
                    path = EXCLUDED.path,
                    icon = EXCLUDED.icon,
                    group_key = EXCLUDED.group_key,
                    group_label = EXCLUDED.group_label,
                    description = EXCLUDED.description,
                    sort_order = EXCLUDED.sort_order,
                    is_active = TRUE,
                    updated_at = NOW();
            END IF;

            IF to_regclass('public.permission_items') IS NOT NULL THEN
                INSERT INTO permission_items
                    (key, menu_id, menu_key, action_key, label, source, sort_order, is_active)
                SELECT
                    menu.key || '.' || action.action_key,
                    menu.id,
                    menu.key,
                    action.action_key,
                    action.label,
                    'migration_seed',
                    menu.sort_order + action.sort_offset,
                    TRUE
                FROM app_menus menu
                CROSS JOIN (
                    VALUES
                        ('view', 'เข้าเมนู', 1),
                        ('create', 'เพิ่มข้อมูล', 2),
                        ('update', 'แก้ไขข้อมูล', 3),
                        ('delete', 'ลบข้อมูล', 4),
                        ('export', 'Export', 5)
                ) AS action(action_key, label, sort_offset)
                WHERE menu.key IN ('crm_cashflow_statement', 'crm_cashflow_invoice')
                ON CONFLICT (key) DO UPDATE SET
                    menu_id = EXCLUDED.menu_id,
                    menu_key = EXCLUDED.menu_key,
                    action_key = EXCLUDED.action_key,
                    label = EXCLUDED.label,
                    is_active = TRUE,
                    updated_at = NOW();
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("""
        DO $$
        BEGIN
            IF to_regclass('public.permission_items') IS NOT NULL THEN
                DELETE FROM permission_items
                WHERE menu_key IN ('crm_cashflow_statement', 'crm_cashflow_invoice');
            END IF;
            IF to_regclass('public.app_menus') IS NOT NULL THEN
                DELETE FROM app_menus
                WHERE key IN ('crm_cashflow_statement', 'crm_cashflow_invoice');
            END IF;
        END $$;

        DROP TABLE IF EXISTS cashflow_statement;
        DROP TABLE IF EXISTS cashflow_statement_department;
        DROP TABLE IF EXISTS cashflow_list;
        DROP TABLE IF EXISTS cashflow_category;
    """)
