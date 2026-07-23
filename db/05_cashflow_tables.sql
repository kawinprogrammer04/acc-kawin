-- ============================================================
-- Thai SME Accounting System — Cash Flow Module
-- เพิ่มตาราง: wallet_accounts, holders, categories,
--             income_entries, expense_entries, payables,
--             receivables, transfers, documents, approvals,
--             cash_transactions, activity_logs
-- ============================================================

-- ============================================================
-- ENUMS สำหรับ Cash Flow Module
-- ============================================================

CREATE TYPE wallet_account_type AS ENUM (
    'bank',        -- บัญชีธนาคาร
    'cash',        -- เงินสด
    'ewallet',     -- e-Wallet (PromptPay, TrueMoney ฯลฯ)
    'credit_card', -- บัตรเครดิต
    'other'        -- อื่นๆ
);

CREATE TYPE money_owner_type AS ENUM (
    'company',   -- เงินบริษัท
    'personal',  -- เงินส่วนตัว
    'mixed'      -- ผสม
);

CREATE TYPE holder_type AS ENUM (
    'company',   -- เงินบริษัทหลัก
    'personal',  -- เงินส่วนตัว
    'tax',       -- เงินภาษี
    'salary',    -- เงินเดือน
    'project',   -- เงินโปรเจกต์
    'reserve',   -- เงินสำรอง
    'stock',     -- เงินสต็อก
    'other'      -- อื่นๆ
);

CREATE TYPE cashflow_category_type AS ENUM (
    'income',     -- รายรับ
    'expense',    -- รายจ่าย
    'payable',    -- เจ้าหนี้
    'receivable'  -- ลูกหนี้
);

CREATE TYPE entry_status AS ENUM (
    'pending',   -- รอดำเนินการ
    'completed', -- เสร็จสิ้น / รับ/จ่ายแล้ว
    'cancelled'  -- ยกเลิก
);

CREATE TYPE payable_status AS ENUM (
    'unpaid',        -- ยังไม่จ่าย
    'partial',       -- จ่ายบางส่วน
    'paid',          -- จ่ายครบ
    'overdue',       -- เลยกำหนด
    'cancelled'      -- ยกเลิก
);

CREATE TYPE receivable_status AS ENUM (
    'unreceived',    -- ยังไม่ได้รับ
    'partial',       -- รับบางส่วน
    'received',      -- รับครบ
    'overdue',       -- เลยกำหนด
    'cancelled'      -- ยกเลิก
);

CREATE TYPE transfer_type AS ENUM (
    'account_to_account', -- บัญชีไปบัญชี
    'holder_to_holder',   -- Holder ไป Holder
    'account_to_holder',  -- บัญชีไป Holder
    'holder_to_account',  -- Holder ไปบัญชี
    'owner_withdrawal',   -- ถอนเงินเจ้าของ
    'owner_advance',      -- เจ้าของสำรองจ่าย
    'salary',             -- เงินเดือน
    'dividend'            -- เงินปันผล
);

CREATE TYPE approval_status AS ENUM (
    'pending',   -- รออนุมัติ
    'approved',  -- อนุมัติ
    'rejected'   -- ปฏิเสธ
);

CREATE TYPE cash_direction AS ENUM (
    'in',           -- เงินเข้า
    'out',          -- เงินออก
    'transfer_in',  -- โอนเข้า (ภายใน)
    'transfer_out'  -- โอนออก (ภายใน)
);

-- ============================================================
-- 1. WALLET ACCOUNTS (บัญชีเงิน / กระเป๋า)
-- ============================================================

CREATE TABLE wallet_accounts (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    account_type    wallet_account_type NOT NULL DEFAULT 'bank',
    owner_type      money_owner_type NOT NULL DEFAULT 'company',
    bank_name       VARCHAR(100),          -- ชื่อธนาคาร เช่น กสิกรไทย, SCB
    account_number  VARCHAR(50),           -- เลขบัญชี
    account_holder  VARCHAR(200),          -- ชื่อเจ้าของบัญชี
    currency        VARCHAR(3) DEFAULT 'THB',
    opening_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
    current_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE,
    notes           TEXT,
    created_by      INTEGER REFERENCES users(id),
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_wallet_accounts_type ON wallet_accounts(account_type);
CREATE INDEX idx_wallet_accounts_owner ON wallet_accounts(owner_type);

-- ============================================================
-- 2. HOLDERS (กระเป๋าย่อย)
-- ============================================================

CREATE TABLE holders (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(200) NOT NULL,
    holder_type         holder_type NOT NULL DEFAULT 'company',
    owner_type          money_owner_type NOT NULL DEFAULT 'company',
    wallet_account_id   INTEGER REFERENCES wallet_accounts(id),  -- บัญชีหลักที่ผูกอยู่
    purpose             TEXT,                      -- วัตถุประสงค์
    opening_balance     NUMERIC(15,2) NOT NULL DEFAULT 0,
    current_balance     NUMERIC(15,2) NOT NULL DEFAULT 0,
    responsible_user_id INTEGER REFERENCES users(id),
    is_active           BOOLEAN DEFAULT TRUE,
    notes               TEXT,
    created_by          INTEGER REFERENCES users(id),
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_holders_type ON holders(holder_type);
CREATE INDEX idx_holders_account ON holders(wallet_account_id);

-- ============================================================
-- 3. CASHFLOW CATEGORIES (หมวดหมู่)
-- ============================================================

CREATE TABLE cashflow_categories (
    id          SERIAL PRIMARY KEY,
    type        cashflow_category_type NOT NULL,
    name        VARCHAR(200) NOT NULL,
    parent_id   INTEGER REFERENCES cashflow_categories(id),
    color       VARCHAR(7),           -- Hex color เช่น #FF5733
    icon        VARCHAR(50),          -- Icon name
    sort_order  SMALLINT DEFAULT 0,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_category_name_type UNIQUE (type, name)
);

CREATE INDEX idx_cashflow_categories_type ON cashflow_categories(type);

-- ============================================================
-- 4. INCOME ENTRIES (รายรับ)
-- ============================================================

CREATE TABLE income_entries (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    income_date         DATE NOT NULL,
    document_no         VARCHAR(50),
    income_type         VARCHAR(50),           -- ประเภทรายรับ
    category_id         INTEGER REFERENCES cashflow_categories(id),
    customer_name       VARCHAR(300),           -- ชื่อลูกค้า / ผู้จ่าย
    description         TEXT NOT NULL,
    amount              NUMERIC(15,2) NOT NULL,
    vat_amount          NUMERIC(15,2) DEFAULT 0,
    withholding_tax     NUMERIC(15,2) DEFAULT 0,
    net_amount          NUMERIC(15,2) NOT NULL,
    payment_channel     VARCHAR(100),           -- ช่องทางรับเงิน
    wallet_account_id   INTEGER REFERENCES wallet_accounts(id),
    holder_id           INTEGER REFERENCES holders(id),
    status              entry_status DEFAULT 'pending',
    received_date       DATE,
    owner_type          money_owner_type DEFAULT 'company',
    notes               TEXT,
    receivable_id       UUID,                  -- เชื่อมกับลูกหนี้
    created_by          INTEGER REFERENCES users(id),
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_income_entries_date ON income_entries(income_date);
CREATE INDEX idx_income_entries_status ON income_entries(status);
CREATE INDEX idx_income_entries_account ON income_entries(wallet_account_id);
CREATE INDEX idx_income_entries_category ON income_entries(category_id);

-- ============================================================
-- 5. EXPENSE ENTRIES (รายจ่าย)
-- ============================================================

CREATE TABLE expense_entries (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    expense_date        DATE NOT NULL,
    document_no         VARCHAR(50),
    expense_type        VARCHAR(50),           -- ประเภทรายจ่าย
    category_id         INTEGER REFERENCES cashflow_categories(id),
    vendor_name         VARCHAR(300),           -- ผู้รับเงิน / Vendor
    description         TEXT NOT NULL,
    amount              NUMERIC(15,2) NOT NULL,
    vat_amount          NUMERIC(15,2) DEFAULT 0,
    withholding_tax     NUMERIC(15,2) DEFAULT 0,
    net_amount          NUMERIC(15,2) NOT NULL,
    payment_channel     VARCHAR(100),
    wallet_account_id   INTEGER REFERENCES wallet_accounts(id),
    holder_id           INTEGER REFERENCES holders(id),
    is_company_expense  BOOLEAN DEFAULT TRUE,
    status              entry_status DEFAULT 'pending',
    paid_date           DATE,
    owner_type          money_owner_type DEFAULT 'company',
    notes               TEXT,
    payable_id          UUID,                  -- เชื่อมกับเจ้าหนี้
    created_by          INTEGER REFERENCES users(id),
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_expense_entries_date ON expense_entries(expense_date);
CREATE INDEX idx_expense_entries_status ON expense_entries(status);
CREATE INDEX idx_expense_entries_account ON expense_entries(wallet_account_id);
CREATE INDEX idx_expense_entries_category ON expense_entries(category_id);

-- ============================================================
-- 6. PAYABLES (เจ้าหนี้)
-- ============================================================

CREATE TABLE payables (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creditor_name           VARCHAR(300) NOT NULL,
    creditor_type           VARCHAR(50),     -- supplier, employee, owner, external
    description             TEXT,
    issue_date              DATE NOT NULL,
    due_date                DATE,
    total_amount            NUMERIC(15,2) NOT NULL,
    paid_amount             NUMERIC(15,2) NOT NULL DEFAULT 0,
    remaining_amount        NUMERIC(15,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
    expected_account_id     INTEGER REFERENCES wallet_accounts(id),
    expected_holder_id      INTEGER REFERENCES holders(id),
    category_id             INTEGER REFERENCES cashflow_categories(id),
    status                  payable_status DEFAULT 'unpaid',
    reference_doc           VARCHAR(200),
    notes                   TEXT,
    created_by              INTEGER REFERENCES users(id),
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_payables_status ON payables(status);
CREATE INDEX idx_payables_due_date ON payables(due_date);
CREATE INDEX idx_payables_creditor ON payables(creditor_name);

-- ============================================================
-- 7. RECEIVABLES (ลูกหนี้)
-- ============================================================

CREATE TABLE receivables (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    debtor_name             VARCHAR(300) NOT NULL,
    debtor_type             VARCHAR(50),     -- customer, employee, owner, supplier, external
    description             TEXT,
    issue_date              DATE NOT NULL,
    due_date                DATE,
    total_amount            NUMERIC(15,2) NOT NULL,
    received_amount         NUMERIC(15,2) NOT NULL DEFAULT 0,
    remaining_amount        NUMERIC(15,2) GENERATED ALWAYS AS (total_amount - received_amount) STORED,
    expected_account_id     INTEGER REFERENCES wallet_accounts(id),
    expected_holder_id      INTEGER REFERENCES holders(id),
    category_id             INTEGER REFERENCES cashflow_categories(id),
    status                  receivable_status DEFAULT 'unreceived',
    reference_doc           VARCHAR(200),
    notes                   TEXT,
    created_by              INTEGER REFERENCES users(id),
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_receivables_status ON receivables(status);
CREATE INDEX idx_receivables_due_date ON receivables(due_date);
CREATE INDEX idx_receivables_debtor ON receivables(debtor_name);

-- ============================================================
-- 8. TRANSFERS (การโอนเงิน)
-- ============================================================

CREATE TABLE transfers (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_date       DATE NOT NULL,
    transfer_type       transfer_type NOT NULL DEFAULT 'account_to_account',
    from_account_id     INTEGER REFERENCES wallet_accounts(id),
    from_holder_id      INTEGER REFERENCES holders(id),
    to_account_id       INTEGER REFERENCES wallet_accounts(id),
    to_holder_id        INTEGER REFERENCES holders(id),
    amount              NUMERIC(15,2) NOT NULL,
    fee                 NUMERIC(15,2) DEFAULT 0,
    reason              TEXT,
    status              entry_status DEFAULT 'completed',
    notes               TEXT,
    created_by          INTEGER REFERENCES users(id),
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW(),
    CONSTRAINT chk_transfer_source CHECK (
        from_account_id IS NOT NULL OR from_holder_id IS NOT NULL
    ),
    CONSTRAINT chk_transfer_dest CHECK (
        to_account_id IS NOT NULL OR to_holder_id IS NOT NULL
    )
);

CREATE INDEX idx_transfers_date ON transfers(transfer_date);
CREATE INDEX idx_transfers_type ON transfers(transfer_type);

-- ============================================================
-- 9. DOCUMENTS (เอกสารแนบ)
-- ============================================================

CREATE TABLE documents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference_type  VARCHAR(50) NOT NULL,    -- income, expense, payable, receivable, transfer
    reference_id    UUID NOT NULL,
    file_name       VARCHAR(500) NOT NULL,
    file_path       VARCHAR(1000) NOT NULL,  -- path บน filesystem / S3
    file_type       VARCHAR(50),             -- image/jpeg, application/pdf, ...
    file_size       INTEGER,                 -- bytes
    doc_type        VARCHAR(50),             -- slip, receipt, tax_invoice, quotation, etc.
    description     VARCHAR(500),
    uploaded_by     INTEGER REFERENCES users(id),
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_documents_reference ON documents(reference_type, reference_id);
CREATE INDEX idx_documents_uploaded_by ON documents(uploaded_by);

-- ============================================================
-- 10. APPROVALS (การอนุมัติ)
-- ============================================================

CREATE TABLE approvals (
    id              SERIAL PRIMARY KEY,
    reference_type  VARCHAR(50) NOT NULL,    -- expense, transfer, payable_payment, etc.
    reference_id    UUID NOT NULL,
    requested_by    INTEGER NOT NULL REFERENCES users(id),
    approved_by     INTEGER REFERENCES users(id),
    status          approval_status DEFAULT 'pending',
    note            TEXT,
    reject_reason   TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_approvals_reference ON approvals(reference_type, reference_id);
CREATE INDEX idx_approvals_status ON approvals(status);
CREATE INDEX idx_approvals_requestor ON approvals(requested_by);

-- ============================================================
-- 11. CASH TRANSACTIONS (บันทึกการเคลื่อนไหวของเงิน)
-- ============================================================

CREATE TABLE cash_transactions (
    id                  BIGSERIAL PRIMARY KEY,
    transaction_date    DATE NOT NULL,
    direction           cash_direction NOT NULL,
    reference_type      VARCHAR(50) NOT NULL,    -- income, expense, transfer, payable_payment, receivable_payment, adjustment
    reference_id        UUID,
    wallet_account_id   INTEGER REFERENCES wallet_accounts(id),
    holder_id           INTEGER REFERENCES holders(id),
    amount              NUMERIC(15,2) NOT NULL,
    balance_after       NUMERIC(15,2),           -- ยอดหลังทำรายการ
    description         TEXT,
    created_by          INTEGER REFERENCES users(id),
    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_cash_transactions_date ON cash_transactions(transaction_date);
CREATE INDEX idx_cash_transactions_account ON cash_transactions(wallet_account_id);
CREATE INDEX idx_cash_transactions_holder ON cash_transactions(holder_id);
CREATE INDEX idx_cash_transactions_reference ON cash_transactions(reference_type, reference_id);

-- ============================================================
-- 12. ACTIVITY LOGS (ประวัติการทำรายการ — User-facing)
-- ============================================================

CREATE TABLE activity_logs (
    id              BIGSERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id),
    action          VARCHAR(50) NOT NULL,        -- create, update, delete, approve, reject, mark_paid, etc.
    resource_type   VARCHAR(50) NOT NULL,
    resource_id     TEXT,
    old_data        JSONB,
    new_data        JSONB,
    description     TEXT,
    ip_address      INET,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_resource ON activity_logs(resource_type, resource_id);
CREATE INDEX idx_activity_logs_created ON activity_logs(created_at);

-- ============================================================
-- 13. SEED DATA — หมวดหมู่เริ่มต้น
-- ============================================================

INSERT INTO cashflow_categories (type, name, sort_order) VALUES
-- รายรับ
('income', 'ยอดขายสินค้า', 1),
('income', 'รายได้จากบริการ', 2),
('income', 'รายได้จากค่าส่ง', 3),
('income', 'เงินคืน / Refund', 4),
('income', 'รายได้อื่นๆ', 99),
-- รายจ่าย
('expense', 'ต้นทุนสินค้า', 1),
('expense', 'ค่าโฆษณา / Marketing', 2),
('expense', 'เงินเดือน / ค่าแรง', 3),
('expense', 'ค่าขนส่ง / โลจิสติกส์', 4),
('expense', 'ค่าเช่า', 5),
('expense', 'ค่าระบบ / Software', 6),
('expense', 'ค่าบัญชี / ที่ปรึกษา', 7),
('expense', 'ค่าแพ็คของ', 8),
('expense', 'ค่าสาธารณูปโภค', 9),
('expense', 'ภาษี', 10),
('expense', 'ค่าใช้จ่ายส่วนตัว', 11),
('expense', 'ค่าใช้จ่ายอื่นๆ', 99),
-- เจ้าหนี้
('payable', 'Supplier / ผู้ขาย', 1),
('payable', 'พนักงาน', 2),
('payable', 'เจ้าของ', 3),
('payable', 'ค่าเช่า', 4),
('payable', 'ภาษีค้างจ่าย', 5),
('payable', 'อื่นๆ', 99),
-- ลูกหนี้
('receivable', 'ลูกค้า', 1),
('receivable', 'พนักงาน', 2),
('receivable', 'เจ้าของ', 3),
('receivable', 'Supplier', 4),
('receivable', 'เงินยืม', 5),
('receivable', 'อื่นๆ', 99)
ON CONFLICT (type, name) DO NOTHING;

-- ============================================================
-- 14. VIEWS สำหรับ Dashboard
-- ============================================================

CREATE OR REPLACE VIEW v_dashboard_summary AS
SELECT
    -- รายรับเดือนนี้
    COALESCE((
        SELECT SUM(net_amount) FROM income_entries
        WHERE status = 'completed'
          AND DATE_TRUNC('month', income_date) = DATE_TRUNC('month', CURRENT_DATE)
    ), 0) AS income_this_month,
    -- รายจ่ายเดือนนี้
    COALESCE((
        SELECT SUM(net_amount) FROM expense_entries
        WHERE status = 'completed'
          AND DATE_TRUNC('month', expense_date) = DATE_TRUNC('month', CURRENT_DATE)
    ), 0) AS expense_this_month,
    -- เจ้าหนี้ค้างจ่าย
    COALESCE((
        SELECT SUM(remaining_amount) FROM payables
        WHERE status IN ('unpaid', 'partial', 'overdue')
    ), 0) AS total_payable,
    -- ลูกหนี้ค้างรับ
    COALESCE((
        SELECT SUM(remaining_amount) FROM receivables
        WHERE status IN ('unreceived', 'partial', 'overdue')
    ), 0) AS total_receivable,
    -- ยอดเงินรวมทุกบัญชี
    COALESCE((
        SELECT SUM(current_balance) FROM wallet_accounts WHERE is_active = TRUE
    ), 0) AS total_balance,
    -- ยอดเงินบริษัท
    COALESCE((
        SELECT SUM(current_balance) FROM wallet_accounts
        WHERE is_active = TRUE AND owner_type = 'company'
    ), 0) AS company_balance,
    -- ยอดเงินส่วนตัว
    COALESCE((
        SELECT SUM(current_balance) FROM wallet_accounts
        WHERE is_active = TRUE AND owner_type = 'personal'
    ), 0) AS personal_balance;

-- ============================================================
-- 15. FUNCTION: อัปเดตยอดเงินใน wallet_account
-- ============================================================

CREATE OR REPLACE FUNCTION update_wallet_balance(
    p_account_id INTEGER,
    p_amount     NUMERIC,
    p_direction  cash_direction
) RETURNS NUMERIC AS $$
DECLARE
    new_balance NUMERIC;
BEGIN
    IF p_direction IN ('in', 'transfer_in') THEN
        UPDATE wallet_accounts
        SET current_balance = current_balance + p_amount,
            updated_at = NOW()
        WHERE id = p_account_id
        RETURNING current_balance INTO new_balance;
    ELSE
        UPDATE wallet_accounts
        SET current_balance = current_balance - p_amount,
            updated_at = NOW()
        WHERE id = p_account_id
        RETURNING current_balance INTO new_balance;
    END IF;
    RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 16. FUNCTION: อัปเดตยอดเงินใน holder
-- ============================================================

CREATE OR REPLACE FUNCTION update_holder_balance(
    p_holder_id  INTEGER,
    p_amount     NUMERIC,
    p_direction  cash_direction
) RETURNS NUMERIC AS $$
DECLARE
    new_balance NUMERIC;
BEGIN
    IF p_direction IN ('in', 'transfer_in') THEN
        UPDATE holders
        SET current_balance = current_balance + p_amount,
            updated_at = NOW()
        WHERE id = p_holder_id
        RETURNING current_balance INTO new_balance;
    ELSE
        UPDATE holders
        SET current_balance = current_balance - p_amount,
            updated_at = NOW()
        WHERE id = p_holder_id
        RETURNING current_balance INTO new_balance;
    END IF;
    RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 17. FUNCTION: อัปเดตสถานะ payable อัตโนมัติ
-- ============================================================

CREATE OR REPLACE FUNCTION auto_update_payable_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.paid_amount >= NEW.total_amount THEN
        NEW.status = 'paid';
    ELSIF NEW.paid_amount > 0 THEN
        NEW.status = 'partial';
    ELSIF NEW.due_date IS NOT NULL AND NEW.due_date < CURRENT_DATE AND NEW.paid_amount = 0 THEN
        NEW.status = 'overdue';
    END IF;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payable_status
BEFORE UPDATE OF paid_amount ON payables
FOR EACH ROW EXECUTE FUNCTION auto_update_payable_status();

-- ============================================================
-- 18. FUNCTION: อัปเดตสถานะ receivable อัตโนมัติ
-- ============================================================

CREATE OR REPLACE FUNCTION auto_update_receivable_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.received_amount >= NEW.total_amount THEN
        NEW.status = 'received';
    ELSIF NEW.received_amount > 0 THEN
        NEW.status = 'partial';
    ELSIF NEW.due_date IS NOT NULL AND NEW.due_date < CURRENT_DATE AND NEW.received_amount = 0 THEN
        NEW.status = 'overdue';
    END IF;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_receivable_status
BEFORE UPDATE OF received_amount ON receivables
FOR EACH ROW EXECUTE FUNCTION auto_update_receivable_status();

-- ============================================================
-- 19. Updated_at auto-update triggers
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wallet_accounts_updated BEFORE UPDATE ON wallet_accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_holders_updated BEFORE UPDATE ON holders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_income_entries_updated BEFORE UPDATE ON income_entries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_expense_entries_updated BEFORE UPDATE ON expense_entries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transfers_updated BEFORE UPDATE ON transfers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_approvals_updated BEFORE UPDATE ON approvals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
