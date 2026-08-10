"""Store generated tax invoice documents.

Revision ID: 20260724_01
Revises: 20260723_02
Create Date: 2026-07-24
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260724_01"
down_revision: Union[str, None] = "20260723_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS tax_invoice_records (
            id UUID PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id),
            invoice_number VARCHAR(50) NOT NULL,
            invoice_date DATE NOT NULL,
            order_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
            source VARCHAR(20),
            copy_type VARCHAR(20) NOT NULL DEFAULT 'customer',
            customer_name VARCHAR(300) NOT NULL,
            customer_address TEXT NOT NULL DEFAULT '',
            customer_tax_id VARCHAR(20),
            customer_branch VARCHAR(50),
            payment_method VARCHAR(20) NOT NULL DEFAULT 'transfer',
            credit_days INTEGER NOT NULL DEFAULT 0,
            subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
            discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            taxable_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            vat_rate NUMERIC(5,2) NOT NULL DEFAULT 7,
            vat_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            notes TEXT,
            created_by INTEGER REFERENCES users(id),
            updated_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            CONSTRAINT chk_tax_invoice_record_copy_type
                CHECK (copy_type IN ('customer', 'company', 'accounting', 'all')),
            CONSTRAINT chk_tax_invoice_record_payment_method
                CHECK (payment_method IN ('cash', 'credit', 'transfer', 'other')),
            CONSTRAINT uq_tax_invoice_record_company_number
                UNIQUE (company_id, invoice_number)
        );

        CREATE TABLE IF NOT EXISTS tax_invoice_record_lines (
            id SERIAL PRIMARY KEY,
            tax_invoice_id UUID NOT NULL REFERENCES tax_invoice_records(id) ON DELETE CASCADE,
            line_number SMALLINT NOT NULL,
            order_number VARCHAR(100),
            product_code VARCHAR(100),
            description TEXT NOT NULL,
            quantity NUMERIC(12,4) NOT NULL DEFAULT 1,
            unit VARCHAR(30),
            unit_price NUMERIC(15,4) NOT NULL DEFAULT 0,
            line_total NUMERIC(15,2) NOT NULL DEFAULT 0,
            CONSTRAINT uq_tax_invoice_record_line_number
                UNIQUE (tax_invoice_id, line_number)
        );

        CREATE INDEX IF NOT EXISTS ix_tax_invoice_records_company_id
            ON tax_invoice_records (company_id);
        CREATE INDEX IF NOT EXISTS ix_tax_invoice_records_invoice_date
            ON tax_invoice_records (company_id, invoice_date DESC);
        CREATE INDEX IF NOT EXISTS ix_tax_invoice_record_lines_tax_invoice_id
            ON tax_invoice_record_lines (tax_invoice_id);

        ALTER TABLE tax_invoice_records ENABLE ROW LEVEL SECURITY;
        ALTER TABLE tax_invoice_record_lines ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS tenant_isolation ON tax_invoice_records;
        CREATE POLICY tenant_isolation ON tax_invoice_records
        USING (
            company_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER
        )
        WITH CHECK (
            company_id = NULLIF(current_setting('app.current_company_id', true), '')::INTEGER
        );
        DROP POLICY IF EXISTS tenant_line_isolation ON tax_invoice_record_lines;
        CREATE POLICY tenant_line_isolation ON tax_invoice_record_lines
        USING (
            EXISTS (
                SELECT 1
                FROM tax_invoice_records r
                WHERE r.id = tax_invoice_record_lines.tax_invoice_id
                  AND r.company_id = NULLIF(
                      current_setting('app.current_company_id', true), ''
                  )::INTEGER
            )
        )
        WITH CHECK (
            EXISTS (
                SELECT 1
                FROM tax_invoice_records r
                WHERE r.id = tax_invoice_record_lines.tax_invoice_id
                  AND r.company_id = NULLIF(
                      current_setting('app.current_company_id', true), ''
                  )::INTEGER
            )
        );
    """)


def downgrade() -> None:
    op.execute("""
        DROP POLICY IF EXISTS tenant_line_isolation ON tax_invoice_record_lines;
        ALTER TABLE tax_invoice_record_lines DISABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS tenant_isolation ON tax_invoice_records;
        ALTER TABLE tax_invoice_records DISABLE ROW LEVEL SECURITY;

        DROP TABLE IF EXISTS tax_invoice_record_lines;
        DROP TABLE IF EXISTS tax_invoice_records;
    """)
