"""Add the expense request wizard detail, items, tax, and attachments.

Revision ID: 20260803_01
Revises: 20260731_03
Create Date: 2026-08-03
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260803_01"
down_revision: Union[str, None] = "20260731_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE SEQUENCE expense_request_no_seq START WITH 1;

        ALTER TABLE expense_requests
            ADD COLUMN request_no VARCHAR(30),
            ADD COLUMN request_format VARCHAR(30) NOT NULL DEFAULT 'reimbursement',
            ADD COLUMN payer_company_name VARCHAR(200),
            ADD COLUMN recipient_type VARCHAR(30),
            ADD COLUMN recipient_name VARCHAR(300),
            ADD COLUMN bank_name VARCHAR(150),
            ADD COLUMN bank_account_name VARCHAR(300),
            ADD COLUMN bank_account_number_encrypted TEXT,
            ADD COLUMN bank_account_last4 VARCHAR(4),
            ADD COLUMN vat_mode VARCHAR(20) NOT NULL DEFAULT 'none',
            ADD COLUMN vat_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
            ADD COLUMN vat_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            ADD COLUMN withholding_required BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN withholding_mode VARCHAR(20) NOT NULL DEFAULT 'none',
            ADD COLUMN withholding_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
            ADD COLUMN withholding_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
            ADD COLUMN taxpayer_name VARCHAR(300),
            ADD COLUMN taxpayer_id VARCHAR(20),
            ADD COLUMN taxpayer_address TEXT;

        UPDATE expense_requests
        SET request_no = 'EXP-' || to_char(created_at, 'YYYYMM') || '-' ||
            lpad(nextval('expense_request_no_seq')::text, 6, '0');

        ALTER TABLE expense_requests
            ALTER COLUMN request_no SET NOT NULL,
            ALTER COLUMN request_no SET DEFAULT
                ('EXP-' || to_char(CURRENT_DATE, 'YYYYMM') || '-' ||
                 lpad(nextval('expense_request_no_seq')::text, 6, '0'));
        CREATE UNIQUE INDEX uq_expense_requests_request_no ON expense_requests(request_no);

        CREATE TABLE expense_request_items (
            id BIGSERIAL PRIMARY KEY,
            expense_request_id UUID NOT NULL REFERENCES expense_requests(id) ON DELETE CASCADE,
            sort_order SMALLINT NOT NULL DEFAULT 1,
            description VARCHAR(500) NOT NULL,
            quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
            unit VARCHAR(50) NOT NULL DEFAULT 'รายการ',
            unit_price NUMERIC(15,2) NOT NULL CHECK (unit_price >= 0),
            line_total NUMERIC(15,2) NOT NULL CHECK (line_total >= 0),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX ix_expense_request_items_request_id
            ON expense_request_items(expense_request_id, sort_order);

        CREATE TABLE expense_request_attachments (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            expense_request_id UUID NOT NULL REFERENCES expense_requests(id) ON DELETE CASCADE,
            attachment_type VARCHAR(30) NOT NULL CHECK (attachment_type IN ('primary', 'supporting')),
            file_name VARCHAR(255) NOT NULL,
            stored_name VARCHAR(255) NOT NULL,
            file_path TEXT NOT NULL,
            content_type VARCHAR(150),
            file_size BIGINT NOT NULL CHECK (file_size >= 0),
            uploaded_by INTEGER NOT NULL REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX ix_expense_request_attachments_request_id
            ON expense_request_attachments(expense_request_id, attachment_type, created_at);
        CREATE UNIQUE INDEX uq_expense_request_primary_attachment
            ON expense_request_attachments(expense_request_id)
            WHERE attachment_type = 'primary';
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE IF EXISTS expense_request_attachments;
        DROP TABLE IF EXISTS expense_request_items;
        DROP INDEX IF EXISTS uq_expense_requests_request_no;
        ALTER TABLE expense_requests
            DROP COLUMN IF EXISTS taxpayer_address,
            DROP COLUMN IF EXISTS taxpayer_id,
            DROP COLUMN IF EXISTS taxpayer_name,
            DROP COLUMN IF EXISTS withholding_amount,
            DROP COLUMN IF EXISTS withholding_rate,
            DROP COLUMN IF EXISTS withholding_mode,
            DROP COLUMN IF EXISTS withholding_required,
            DROP COLUMN IF EXISTS vat_amount,
            DROP COLUMN IF EXISTS vat_rate,
            DROP COLUMN IF EXISTS vat_mode,
            DROP COLUMN IF EXISTS bank_account_last4,
            DROP COLUMN IF EXISTS bank_account_number_encrypted,
            DROP COLUMN IF EXISTS bank_account_name,
            DROP COLUMN IF EXISTS bank_name,
            DROP COLUMN IF EXISTS recipient_name,
            DROP COLUMN IF EXISTS recipient_type,
            DROP COLUMN IF EXISTS payer_company_name,
            DROP COLUMN IF EXISTS request_format,
            DROP COLUMN IF EXISTS request_no;
        DROP SEQUENCE IF EXISTS expense_request_no_seq;
    """)
