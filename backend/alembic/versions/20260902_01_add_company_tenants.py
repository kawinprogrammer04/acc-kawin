"""Add the Good Fertilizer and Heng Heng Pang Pang tenants.

Revision ID: 20260902_01
Revises: 20260901_01
Create Date: 2026-09-02
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260902_01"
down_revision: Union[str, None] = "20260901_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO companies (code, name_th, name_en, is_active)
        VALUES
            ('GOOD_FERTILIZER', 'บริษัท กู๊ด เฟอร์ติไลเซอร์ จำกัด',
             'Good Fertilizer Co., Ltd.', TRUE),
            ('HENGHENG_PANGPANG', 'บริษัท ขอให้เฮงเฮงปังปัง จำกัด',
             'Kho Hai Heng Heng Pang Pang Co., Ltd.', TRUE)
        ON CONFLICT (code) DO UPDATE SET
            name_th = EXCLUDED.name_th,
            name_en = EXCLUDED.name_en,
            is_active = TRUE,
            updated_at = NOW();

        INSERT INTO user_companies
            (user_id, company_id, granted_by, role, is_active)
        SELECT users.id, companies.id, users.id, 'admin', TRUE
        FROM users
        CROSS JOIN companies
        WHERE users.is_platform_admin IS TRUE
          AND companies.code IN ('GOOD_FERTILIZER', 'HENGHENG_PANGPANG')
        ON CONFLICT (user_id, company_id) DO UPDATE SET
            is_active = TRUE,
            role = 'admin';

        INSERT INTO cashflow_categories
            (type, name, parent_id, color, icon, sort_order, is_active, company_id)
        SELECT source.type, source.name, NULL, source.color, source.icon,
               source.sort_order, source.is_active, target.id
        FROM cashflow_categories source
        CROSS JOIN companies target
        WHERE source.company_id = 1
          AND target.code IN ('GOOD_FERTILIZER', 'HENGHENG_PANGPANG')
        ON CONFLICT DO NOTHING;

        INSERT INTO accounts
            (code, name_th, name_en, account_type, category, normal_balance,
             parent_id, level, is_header, is_active, description, company_id)
        SELECT source.code, source.name_th, source.name_en, source.account_type,
               source.category, source.normal_balance, NULL, source.level,
               source.is_header, source.is_active, source.description, target.id
        FROM accounts source
        CROSS JOIN companies target
        WHERE source.company_id = 1
          AND target.code IN ('GOOD_FERTILIZER', 'HENGHENG_PANGPANG')
        ON CONFLICT (company_id, code) DO NOTHING;

        UPDATE accounts target_account
        SET parent_id = target_parent.id
        FROM companies target_company,
             accounts source_account
        JOIN accounts source_parent ON source_parent.id = source_account.parent_id
        JOIN accounts target_parent
          ON target_parent.code = source_parent.code
        WHERE target_company.code IN ('GOOD_FERTILIZER', 'HENGHENG_PANGPANG')
          AND target_account.company_id = target_company.id
          AND target_parent.company_id = target_company.id
          AND source_account.company_id = 1
          AND target_account.code = source_account.code;

        INSERT INTO fiscal_years
            (name, start_date, end_date, is_closed, company_id)
        SELECT source.name, source.start_date, source.end_date, FALSE, target.id
        FROM fiscal_years source
        CROSS JOIN companies target
        WHERE source.company_id = 1
          AND target.code IN ('GOOD_FERTILIZER', 'HENGHENG_PANGPANG')
        ON CONFLICT (company_id, name) DO NOTHING;

        INSERT INTO accounting_periods
            (fiscal_year_id, period_number, start_date, end_date, is_closed, company_id)
        SELECT target_year.id, source_period.period_number,
               source_period.start_date, source_period.end_date, FALSE, target_company.id
        FROM accounting_periods source_period
        JOIN fiscal_years source_year ON source_year.id = source_period.fiscal_year_id
        CROSS JOIN companies target_company
        JOIN fiscal_years target_year
          ON target_year.company_id = target_company.id
         AND target_year.name = source_year.name
        WHERE source_period.company_id = 1
          AND target_company.code IN ('GOOD_FERTILIZER', 'HENGHENG_PANGPANG')
        ON CONFLICT (company_id, fiscal_year_id, period_number) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM accounting_periods
        WHERE company_id IN (
            SELECT id FROM companies
            WHERE code IN ('GOOD_FERTILIZER', 'HENGHENG_PANGPANG')
        );
        DELETE FROM fiscal_years
        WHERE company_id IN (
            SELECT id FROM companies
            WHERE code IN ('GOOD_FERTILIZER', 'HENGHENG_PANGPANG')
        );
        DELETE FROM accounts
        WHERE company_id IN (
            SELECT id FROM companies
            WHERE code IN ('GOOD_FERTILIZER', 'HENGHENG_PANGPANG')
        );
        DELETE FROM cashflow_categories
        WHERE company_id IN (
            SELECT id FROM companies
            WHERE code IN ('GOOD_FERTILIZER', 'HENGHENG_PANGPANG')
        );
        DELETE FROM user_companies
        WHERE company_id IN (
            SELECT id FROM companies
            WHERE code IN ('GOOD_FERTILIZER', 'HENGHENG_PANGPANG')
        );
        DELETE FROM companies
        WHERE code IN ('GOOD_FERTILIZER', 'HENGHENG_PANGPANG');
    """)
