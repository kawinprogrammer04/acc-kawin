"""Add environment-safe multi-tenant boundaries to accounting data.

Revision ID: 20260723_01
Revises:
Create Date: 2026-07-23
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260723_01"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TENANT_TABLES = (
    "fiscal_years",
    "accounting_periods",
    "accounts",
    "parties",
    "journals",
    "invoices",
    "payments",
    "vat_records",
    "wht_records",
    "account_balances",
)
RLS_TABLES = TENANT_TABLES + (
    "wallet_accounts",
    "holders",
    "cashflow_categories",
    "income_entries",
    "expense_entries",
    "payables",
    "receivables",
    "transfers",
    "documents",
    "cash_transactions",
    "activity_logs",
    "budgets",
)


def upgrade() -> None:
    # Existing installations are assigned to the first company. No business
    # rows are deleted and existing primary keys remain unchanged.
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM companies) THEN
                RAISE EXCEPTION 'tenant migration requires at least one company';
            END IF;
        END $$;
    """)

    op.execute("""
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;
        UPDATE users SET is_platform_admin = TRUE WHERE role = 'admin';

        ALTER TABLE user_companies
            ADD COLUMN IF NOT EXISTS role VARCHAR(30) NOT NULL DEFAULT 'viewer',
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
        UPDATE user_companies uc
        SET role = CASE
            WHEN u.role IN ('admin', 'approver', 'accountant', 'viewer') THEN u.role
            ELSE 'viewer'
        END
        FROM users u
        WHERE u.id = uc.user_id;
        ALTER TABLE user_companies
            DROP CONSTRAINT IF EXISTS ck_user_companies_role;
        ALTER TABLE user_companies
            ADD CONSTRAINT ck_user_companies_role
            CHECK (role IN ('admin', 'approver', 'accountant', 'viewer'));
    """)

    for table in TENANT_TABLES:
        op.execute(
            f"ALTER TABLE {table} "
            "ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id);"
        )

    op.execute("""
        UPDATE fiscal_years SET company_id = 1 WHERE company_id IS NULL;
        UPDATE accounting_periods ap
        SET company_id = fy.company_id
        FROM fiscal_years fy
        WHERE ap.fiscal_year_id = fy.id AND ap.company_id IS NULL;
        UPDATE accounts SET company_id = 1 WHERE company_id IS NULL;
        UPDATE parties SET company_id = 1 WHERE company_id IS NULL;
        UPDATE journals SET company_id = 1 WHERE company_id IS NULL;
        UPDATE invoices SET company_id = 1 WHERE company_id IS NULL;
        UPDATE payments SET company_id = 1 WHERE company_id IS NULL;
        UPDATE vat_records SET company_id = 1 WHERE company_id IS NULL;
        UPDATE wht_records SET company_id = 1 WHERE company_id IS NULL;
        UPDATE account_balances SET company_id = 1 WHERE company_id IS NULL;
    """)

    for table in TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ALTER COLUMN company_id SET NOT NULL;")
        op.execute(
            f"CREATE INDEX IF NOT EXISTS ix_{table}_company_id "
            f"ON {table} (company_id);"
        )

    # Codes and document numbers only need to be unique inside a company.
    op.execute("""
        ALTER TABLE fiscal_years DROP CONSTRAINT IF EXISTS uq_fiscal_year_name;
        ALTER TABLE accounting_periods DROP CONSTRAINT IF EXISTS uq_period;
        ALTER TABLE accounts DROP CONSTRAINT IF EXISTS uq_account_code;
        ALTER TABLE parties DROP CONSTRAINT IF EXISTS uq_party_code;
        ALTER TABLE journals DROP CONSTRAINT IF EXISTS uq_journal_number;
        ALTER TABLE invoices DROP CONSTRAINT IF EXISTS uq_invoice_number;
        ALTER TABLE payments DROP CONSTRAINT IF EXISTS uq_payment_number;

        ALTER TABLE fiscal_years
            ADD CONSTRAINT uq_fiscal_year_company_name UNIQUE (company_id, name);
        ALTER TABLE accounting_periods
            ADD CONSTRAINT uq_period_company UNIQUE (company_id, fiscal_year_id, period_number);
        ALTER TABLE accounts
            ADD CONSTRAINT uq_account_company_code UNIQUE (company_id, code);
        ALTER TABLE parties
            ADD CONSTRAINT uq_party_company_code UNIQUE (company_id, code);
        ALTER TABLE journals
            ADD CONSTRAINT uq_journal_company_number UNIQUE (company_id, entry_number);
        ALTER TABLE invoices
            ADD CONSTRAINT uq_invoice_company_number UNIQUE (company_id, invoice_number);
        ALTER TABLE payments
            ADD CONSTRAINT uq_payment_company_number UNIQUE (company_id, payment_number);
    """)

    # Make companies that existed before this migration immediately usable.
    # Only master data is copied; transactions remain assigned to company 1.
    op.execute("""
        INSERT INTO accounts
            (code, name_th, name_en, account_type, category, normal_balance,
             parent_id, level, is_header, is_active, description, company_id)
        SELECT source.code, source.name_th, source.name_en, source.account_type,
               source.category, source.normal_balance, NULL, source.level,
               source.is_header, source.is_active, source.description, company.id
        FROM accounts source
        CROSS JOIN companies company
        WHERE source.company_id = 1
          AND company.id <> 1
          AND company.is_active = TRUE
        ON CONFLICT (company_id, code) DO NOTHING;

        UPDATE accounts target
        SET parent_id = target_parent.id
        FROM accounts source
        JOIN accounts source_parent ON source_parent.id = source.parent_id
        JOIN accounts target_parent
          ON target_parent.code = source_parent.code
         AND target_parent.company_id <> 1
        WHERE source.company_id = 1
          AND target.company_id = target_parent.company_id
          AND target.code = source.code;

        INSERT INTO fiscal_years
            (name, start_date, end_date, is_closed, company_id)
        SELECT source.name, source.start_date, source.end_date, FALSE, company.id
        FROM fiscal_years source
        CROSS JOIN companies company
        WHERE source.company_id = 1
          AND company.id <> 1
          AND company.is_active = TRUE
        ON CONFLICT (company_id, name) DO NOTHING;

        INSERT INTO accounting_periods
            (fiscal_year_id, period_number, start_date, end_date, is_closed, company_id)
        SELECT target_fy.id, source_period.period_number,
               source_period.start_date, source_period.end_date, FALSE,
               target_fy.company_id
        FROM accounting_periods source_period
        JOIN fiscal_years source_fy ON source_fy.id = source_period.fiscal_year_id
        JOIN fiscal_years target_fy
          ON target_fy.name = source_fy.name
         AND target_fy.company_id <> 1
        WHERE source_period.company_id = 1
        ON CONFLICT (company_id, fiscal_year_id, period_number) DO NOTHING;
    """)

    # RLS is a second line of defence. Production should run the application
    # with a non-owner DB role so these policies are enforced by PostgreSQL.
    for table in RLS_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table};")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (
                company_id = NULLIF(
                    current_setting('app.current_company_id', true), ''
                )::INTEGER
            )
            WITH CHECK (
                company_id = NULLIF(
                    current_setting('app.current_company_id', true), ''
                )::INTEGER
            );
            """
        )


def downgrade() -> None:
    for table in reversed(RLS_TABLES):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table};")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")

    op.execute("""
        ALTER TABLE fiscal_years DROP CONSTRAINT IF EXISTS uq_fiscal_year_company_name;
        ALTER TABLE accounting_periods DROP CONSTRAINT IF EXISTS uq_period_company;
        ALTER TABLE accounts DROP CONSTRAINT IF EXISTS uq_account_company_code;
        ALTER TABLE parties DROP CONSTRAINT IF EXISTS uq_party_company_code;
        ALTER TABLE journals DROP CONSTRAINT IF EXISTS uq_journal_company_number;
        ALTER TABLE invoices DROP CONSTRAINT IF EXISTS uq_invoice_company_number;
        ALTER TABLE payments DROP CONSTRAINT IF EXISTS uq_payment_company_number;
    """)

    for table in reversed(TENANT_TABLES):
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_company_id;")
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS company_id;")

    op.execute("""
        ALTER TABLE user_companies DROP CONSTRAINT IF EXISTS ck_user_companies_role;
        ALTER TABLE user_companies DROP COLUMN IF EXISTS is_active;
        ALTER TABLE user_companies DROP COLUMN IF EXISTS role;
        ALTER TABLE users DROP COLUMN IF EXISTS is_platform_admin;
    """)
