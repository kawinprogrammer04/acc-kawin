-- ============================================================
-- Thai SME Accounting System — PostgreSQL Schema
-- Double-Entry Bookkeeping + Thai Tax (VAT 7%, WHT)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE account_type AS ENUM (
    'asset',        -- สินทรัพย์
    'liability',    -- หนี้สิน
    'equity',       -- ส่วนของเจ้าของ
    'revenue',      -- รายได้
    'expense'       -- ค่าใช้จ่าย
);

CREATE TYPE account_category AS ENUM (
    'current_asset',        -- สินทรัพย์หมุนเวียน
    'fixed_asset',          -- สินทรัพย์ถาวร
    'current_liability',    -- หนี้สินหมุนเวียน
    'long_term_liability',  -- หนี้สินระยะยาว
    'equity',
    'operating_revenue',    -- รายได้จากการดำเนินงาน
    'other_revenue',        -- รายได้อื่น
    'cost_of_goods',        -- ต้นทุนขาย
    'operating_expense',    -- ค่าใช้จ่ายดำเนินงาน
    'other_expense'         -- ค่าใช้จ่ายอื่น
);

CREATE TYPE normal_balance AS ENUM ('debit', 'credit');

CREATE TYPE journal_status AS ENUM ('draft', 'posted', 'voided');

CREATE TYPE invoice_type AS ENUM ('ar', 'ap');  -- ลูกหนี้ / เจ้าหนี้

CREATE TYPE invoice_status AS ENUM (
    'draft',
    'sent',
    'partial',
    'paid',
    'overdue',
    'voided'
);

CREATE TYPE payment_method AS ENUM (
    'cash',
    'bank_transfer',
    'cheque',
    'credit_card'
);

CREATE TYPE wht_type AS ENUM (
    '3',   -- ค่าบริการ 3%
    '5',   -- ค่าเช่า 5%
    '15',  -- ดอกเบี้ย/เงินปันผล 15%
    '1',   -- ค่าจ้างแรงงาน 1%
    '2'    -- อื่นๆ 2%
);

CREATE TYPE party_type AS ENUM ('customer', 'vendor', 'both');

-- ============================================================
-- 1. FISCAL YEAR & PERIODS
-- ============================================================

CREATE TABLE fiscal_years (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(20) NOT NULL,           -- เช่น "2567", "2024"
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    is_closed       BOOLEAN DEFAULT FALSE,
    closed_at       TIMESTAMP,
    created_at      TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_fiscal_year_name UNIQUE (name),
    CONSTRAINT chk_fiscal_date CHECK (end_date > start_date)
);

CREATE TABLE accounting_periods (
    id              SERIAL PRIMARY KEY,
    fiscal_year_id  INTEGER NOT NULL REFERENCES fiscal_years(id),
    period_number   SMALLINT NOT NULL,              -- 1-12
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    is_closed       BOOLEAN DEFAULT FALSE,
    closed_at       TIMESTAMP,
    CONSTRAINT uq_period UNIQUE (fiscal_year_id, period_number)
);

-- ============================================================
-- 2. CHART OF ACCOUNTS (ผังบัญชี)
-- ============================================================

CREATE TABLE accounts (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(20) NOT NULL,           -- รหัสบัญชี เช่น 1101
    name_th         VARCHAR(200) NOT NULL,          -- ชื่อบัญชีภาษาไทย
    name_en         VARCHAR(200),                   -- ชื่อบัญชีภาษาอังกฤษ
    account_type    account_type NOT NULL,
    category        account_category NOT NULL,
    normal_balance  normal_balance NOT NULL,        -- debit หรือ credit ปกติ
    parent_id       INTEGER REFERENCES accounts(id),
    level           SMALLINT DEFAULT 1,             -- ระดับของบัญชี (1=หลัก, 2=ย่อย)
    is_header       BOOLEAN DEFAULT FALSE,          -- บัญชีหัวข้อ (ไม่ post ได้)
    is_active       BOOLEAN DEFAULT TRUE,
    description     TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_account_code UNIQUE (code)
);

-- Index สำหรับค้นหาผังบัญชี
CREATE INDEX idx_accounts_type ON accounts(account_type);
CREATE INDEX idx_accounts_parent ON accounts(parent_id);
CREATE INDEX idx_accounts_code ON accounts(code);

-- ============================================================
-- 3. PARTIES (ลูกค้า / ผู้ขาย)
-- ============================================================

CREATE TABLE parties (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    party_type      party_type NOT NULL,
    code            VARCHAR(20) NOT NULL,           -- รหัสลูกค้า/ผู้ขาย
    name_th         VARCHAR(300) NOT NULL,
    name_en         VARCHAR(300),
    tax_id          CHAR(13),                       -- เลขประจำตัวผู้เสียภาษี 13 หลัก
    branch_code     VARCHAR(5) DEFAULT '00000',     -- รหัสสาขา
    branch_name     VARCHAR(100),
    address         TEXT,
    district        VARCHAR(100),
    province        VARCHAR(100),
    postal_code     VARCHAR(10),
    phone           VARCHAR(20),
    email           VARCHAR(200),
    website         VARCHAR(200),
    credit_days     SMALLINT DEFAULT 30,            -- เครดิตเทอม (วัน)
    credit_limit    NUMERIC(15,2) DEFAULT 0,
    ar_account_id   INTEGER REFERENCES accounts(id),  -- บัญชีลูกหนี้ที่ใช้
    ap_account_id   INTEGER REFERENCES accounts(id),  -- บัญชีเจ้าหนี้ที่ใช้
    is_vat_registered BOOLEAN DEFAULT FALSE,
    is_active       BOOLEAN DEFAULT TRUE,
    notes           TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_party_code UNIQUE (code),
    CONSTRAINT chk_tax_id CHECK (tax_id IS NULL OR length(tax_id) = 13)
);

CREATE INDEX idx_parties_type ON parties(party_type);
CREATE INDEX idx_parties_tax_id ON parties(tax_id);

-- ============================================================
-- 4. JOURNAL ENTRIES (สมุดรายวัน — Double-Entry)
-- ============================================================

CREATE TABLE journals (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entry_number    VARCHAR(20) NOT NULL,           -- เลขที่รายการ เช่น JV2567-0001
    entry_date      DATE NOT NULL,
    period_id       INTEGER NOT NULL REFERENCES accounting_periods(id),
    description     TEXT NOT NULL,
    reference       VARCHAR(100),                  -- เลขอ้างอิง (เลขที่ใบแจ้งหนี้ ฯลฯ)
    source_type     VARCHAR(50),                   -- 'invoice','payment','manual', etc.
    source_id       UUID,                          -- FK แบบ polymorphic
    status          journal_status DEFAULT 'draft',
    posted_at       TIMESTAMP,
    posted_by       INTEGER,
    voided_at       TIMESTAMP,
    voided_by       INTEGER,
    void_reason     TEXT,
    created_by      INTEGER,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_journal_number UNIQUE (entry_number)
);

CREATE TABLE journal_lines (
    id              SERIAL PRIMARY KEY,
    journal_id      UUID NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
    line_number     SMALLINT NOT NULL,
    account_id      INTEGER NOT NULL REFERENCES accounts(id),
    description     TEXT,
    debit           NUMERIC(15,2) NOT NULL DEFAULT 0,
    credit          NUMERIC(15,2) NOT NULL DEFAULT 0,
    party_id        UUID REFERENCES parties(id),   -- ระบุลูกค้า/ผู้ขายในบรรทัด
    CONSTRAINT chk_line_amount CHECK (
        (debit >= 0 AND credit >= 0) AND
        NOT (debit > 0 AND credit > 0)             -- ต้อง debit หรือ credit อย่างใดอย่างหนึ่ง
    )
);

CREATE INDEX idx_journal_lines_journal ON journal_lines(journal_id);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX idx_journals_date ON journals(entry_date);
CREATE INDEX idx_journals_period ON journals(period_id);
CREATE INDEX idx_journals_source ON journals(source_type, source_id);

-- Trigger: ตรวจสอบ debit = credit ก่อน post
CREATE OR REPLACE FUNCTION validate_journal_balance()
RETURNS TRIGGER AS $$
DECLARE
    total_debit  NUMERIC;
    total_credit NUMERIC;
BEGIN
    IF NEW.status = 'posted' THEN
        SELECT
            COALESCE(SUM(debit), 0),
            COALESCE(SUM(credit), 0)
        INTO total_debit, total_credit
        FROM journal_lines
        WHERE journal_id = NEW.id;

        IF total_debit <> total_credit THEN
            RAISE EXCEPTION
                'Journal % is unbalanced: debit=% credit=%',
                NEW.entry_number, total_debit, total_credit;
        END IF;

        IF total_debit = 0 THEN
            RAISE EXCEPTION
                'Journal % has no lines', NEW.entry_number;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_journal
BEFORE UPDATE ON journals
FOR EACH ROW EXECUTE FUNCTION validate_journal_balance();

-- ============================================================
-- 5. INVOICES — AR (ใบแจ้งหนี้ลูกค้า) & AP (ใบแจ้งหนี้ผู้ขาย)
-- ============================================================

CREATE TABLE invoices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_type    invoice_type NOT NULL,          -- 'ar' = ขาย, 'ap' = ซื้อ
    invoice_number  VARCHAR(30) NOT NULL,
    reference       VARCHAR(100),                  -- เลขที่ใบกำกับภาษีของผู้ขาย (สำหรับ AP)
    invoice_date    DATE NOT NULL,
    due_date        DATE NOT NULL,
    party_id        UUID NOT NULL REFERENCES parties(id),
    period_id       INTEGER NOT NULL REFERENCES accounting_periods(id),

    -- บัญชีที่ใช้บันทึก
    ar_ap_account_id    INTEGER NOT NULL REFERENCES accounts(id),   -- ลูกหนี้ / เจ้าหนี้
    revenue_expense_account_id INTEGER REFERENCES accounts(id),     -- รายได้ / ค่าใช้จ่าย

    -- จำนวนเงิน
    subtotal        NUMERIC(15,2) NOT NULL DEFAULT 0,   -- ก่อนภาษี
    discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    taxable_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,   -- ยอดที่คำนวณ VAT
    vat_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,   -- VAT 7%
    wht_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,   -- หัก ณ ที่จ่าย
    total_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,   -- ยอดสุทธิ
    paid_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,   -- ชำระแล้ว
    balance_due     NUMERIC(15,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,

    status          invoice_status DEFAULT 'draft',
    is_vat_included BOOLEAN DEFAULT FALSE,             -- ราคารวม VAT แล้วหรือไม่
    notes           TEXT,
    journal_id      UUID REFERENCES journals(id),       -- Journal ที่สร้างจาก Invoice นี้
    created_by      INTEGER,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_invoice_number UNIQUE (invoice_number),
    CONSTRAINT chk_due_date CHECK (due_date >= invoice_date)
);

CREATE TABLE invoice_lines (
    id              SERIAL PRIMARY KEY,
    invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    line_number     SMALLINT NOT NULL,
    description     TEXT NOT NULL,
    quantity        NUMERIC(12,4) NOT NULL DEFAULT 1,
    unit            VARCHAR(30),
    unit_price      NUMERIC(15,4) NOT NULL,
    discount_pct    NUMERIC(5,2) DEFAULT 0,            -- % ส่วนลด
    discount_amount NUMERIC(15,2) DEFAULT 0,
    line_total      NUMERIC(15,2) NOT NULL,            -- quantity * unit_price - discount
    account_id      INTEGER REFERENCES accounts(id),   -- บัญชีรายได้/ค่าใช้จ่ายต่อรายการ
    wht_type        wht_type,                          -- ประเภทการหัก ณ ที่จ่าย
    wht_rate        NUMERIC(5,2),                      -- % หัก ณ ที่จ่าย
    wht_amount      NUMERIC(15,2) DEFAULT 0
);

CREATE INDEX idx_invoices_party ON invoices(party_id);
CREATE INDEX idx_invoices_date ON invoices(invoice_date);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_type ON invoices(invoice_type);
CREATE INDEX idx_invoice_lines_invoice ON invoice_lines(invoice_id);

-- ============================================================
-- 6. PAYMENTS (การรับ/จ่ายชำระ)
-- ============================================================

CREATE TABLE payments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_number  VARCHAR(30) NOT NULL,
    payment_date    DATE NOT NULL,
    invoice_id      UUID NOT NULL REFERENCES invoices(id),
    party_id        UUID NOT NULL REFERENCES parties(id),
    period_id       INTEGER NOT NULL REFERENCES accounting_periods(id),
    payment_method  payment_method NOT NULL,
    amount          NUMERIC(15,2) NOT NULL,
    bank_account    VARCHAR(100),                   -- ชื่อบัญชีธนาคาร
    cheque_number   VARCHAR(50),
    cheque_date     DATE,
    reference       VARCHAR(100),
    cash_account_id INTEGER NOT NULL REFERENCES accounts(id),  -- บัญชีเงินสด/ธนาคาร
    journal_id      UUID REFERENCES journals(id),
    notes           TEXT,
    created_by      INTEGER,
    created_at      TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_payment_number UNIQUE (payment_number),
    CONSTRAINT chk_payment_amount CHECK (amount > 0)
);

CREATE INDEX idx_payments_invoice ON payments(invoice_id);
CREATE INDEX idx_payments_date ON payments(payment_date);

-- ============================================================
-- 7. TAX RECORDS — VAT (ภาษีมูลค่าเพิ่ม)
-- ============================================================

CREATE TABLE vat_records (
    id              SERIAL PRIMARY KEY,
    record_type     VARCHAR(10) NOT NULL CHECK (record_type IN ('output', 'input')),
                                                    -- output = ขาย (ภพ.30), input = ซื้อ
    tax_invoice_number  VARCHAR(50) NOT NULL,        -- เลขที่ใบกำกับภาษี
    tax_invoice_date    DATE NOT NULL,
    period_month    SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    period_year     SMALLINT NOT NULL,              -- พ.ศ. เช่น 2567
    party_id        UUID REFERENCES parties(id),
    party_name      VARCHAR(300) NOT NULL,           -- เก็บไว้เผื่อลูกค้า/ผู้ขายถูกลบ
    party_tax_id    CHAR(13),
    party_branch    VARCHAR(5),
    taxable_amount  NUMERIC(15,2) NOT NULL,
    vat_rate        NUMERIC(4,2) NOT NULL DEFAULT 7.00,
    vat_amount      NUMERIC(15,2) NOT NULL,
    invoice_id      UUID REFERENCES invoices(id),
    created_at      TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_vat_record UNIQUE (record_type, tax_invoice_number)
);

CREATE INDEX idx_vat_records_period ON vat_records(period_year, period_month);
CREATE INDEX idx_vat_records_type ON vat_records(record_type);
CREATE INDEX idx_vat_records_party ON vat_records(party_id);

-- ============================================================
-- 8. TAX RECORDS — WHT (ภาษีหัก ณ ที่จ่าย — 50 ทวิ)
-- ============================================================

CREATE TABLE wht_records (
    id              SERIAL PRIMARY KEY,
    wht_number      VARCHAR(30),                    -- เลขที่ใบหักภาษี ณ ที่จ่าย
    transaction_date DATE NOT NULL,
    period_month    SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    period_year     SMALLINT NOT NULL,
    payer_tax_id    CHAR(13),                       -- เลขของผู้จ่าย (บริษัทเรา)
    payee_id        UUID REFERENCES parties(id),    -- ผู้รับเงิน
    payee_name      VARCHAR(300) NOT NULL,
    payee_tax_id    CHAR(13),
    income_type     VARCHAR(100),                   -- ประเภทเงินได้
    wht_type        wht_type NOT NULL,
    wht_rate        NUMERIC(5,2) NOT NULL,
    income_amount   NUMERIC(15,2) NOT NULL,         -- ยอดก่อนหัก
    wht_amount      NUMERIC(15,2) NOT NULL,         -- ยอดที่หัก
    invoice_id      UUID REFERENCES invoices(id),
    payment_id      UUID REFERENCES payments(id),
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_wht_records_period ON wht_records(period_year, period_month);
CREATE INDEX idx_wht_records_payee ON wht_records(payee_id);

-- ============================================================
-- 9. ACCOUNT BALANCES (ยอดคงเหลือ — Materialized per period)
-- ============================================================

CREATE TABLE account_balances (
    id              SERIAL PRIMARY KEY,
    account_id      INTEGER NOT NULL REFERENCES accounts(id),
    period_id       INTEGER NOT NULL REFERENCES accounting_periods(id),
    opening_balance NUMERIC(15,2) NOT NULL DEFAULT 0,  -- ยอดยกมา
    total_debit     NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_credit    NUMERIC(15,2) NOT NULL DEFAULT 0,
    closing_balance NUMERIC(15,2) GENERATED ALWAYS AS (
        CASE
            WHEN opening_balance + total_debit - total_credit >= 0
            THEN opening_balance + total_debit - total_credit
            ELSE opening_balance + total_debit - total_credit
        END
    ) STORED,
    updated_at      TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_account_period UNIQUE (account_id, period_id)
);

CREATE INDEX idx_account_balances_account ON account_balances(account_id);
CREATE INDEX idx_account_balances_period ON account_balances(period_id);

-- ============================================================
-- 10. USERS & AUDIT
-- ============================================================

CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(50) NOT NULL,
    email           VARCHAR(200) NOT NULL,
    password_hash   TEXT NOT NULL,
    full_name       VARCHAR(200),
    role            VARCHAR(30) NOT NULL DEFAULT 'accountant',
                                                    -- 'admin','accountant','viewer','approver'
    is_active       BOOLEAN DEFAULT TRUE,
    last_login      TIMESTAMP,
    created_at      TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_username UNIQUE (username),
    CONSTRAINT uq_email UNIQUE (email)
);

-- เพิ่ม FK สำหรับ created_by / posted_by ย้อนกลับ
ALTER TABLE journals     ADD CONSTRAINT fk_journal_created  FOREIGN KEY (created_by)  REFERENCES users(id);
ALTER TABLE journals     ADD CONSTRAINT fk_journal_posted   FOREIGN KEY (posted_by)   REFERENCES users(id);
ALTER TABLE invoices     ADD CONSTRAINT fk_invoice_created  FOREIGN KEY (created_by)  REFERENCES users(id);
ALTER TABLE payments     ADD CONSTRAINT fk_payment_created  FOREIGN KEY (created_by)  REFERENCES users(id);

CREATE TABLE audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id),
    action          VARCHAR(20) NOT NULL,           -- 'INSERT','UPDATE','DELETE','POST','VOID'
    table_name      VARCHAR(50) NOT NULL,
    record_id       TEXT NOT NULL,
    old_values      JSONB,
    new_values      JSONB,
    ip_address      INET,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_table_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
