-- ============================================================
-- Phase 1: Multi-Company Support Migration
-- ============================================================

BEGIN;

-- 1. Create companies table
CREATE TABLE IF NOT EXISTS companies (
    id                      SERIAL PRIMARY KEY,
    code                    VARCHAR(20) UNIQUE NOT NULL,
    name_th                 VARCHAR(200) NOT NULL,
    name_en                 VARCHAR(200),
    tax_id                  VARCHAR(20),
    address                 TEXT,
    phone                   VARCHAR(50),
    email                   VARCHAR(200),
    website                 VARCHAR(200),
    logo_url                VARCHAR(500),
    fiscal_year_start_month SMALLINT DEFAULT 1,
    default_currency        VARCHAR(3) DEFAULT 'THB',
    vat_rate                NUMERIC(5,2) DEFAULT 7.00,
    is_active               BOOLEAN DEFAULT TRUE,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Seed the 3 companies
INSERT INTO companies (code, name_th, name_en, tax_id, address, phone)
VALUES
  ('KAWIN_BROTHERS',  'บริษัท กวิน บราเธอร์ส จำกัด',         'Kawin Brothers Co., Ltd.',
   '0105561208119',
   '88/6-7 ซอยกาญจนาภิเษก 0010 แยก 2 ถนนกาญจนาภิเษก แขวงบางแค เขตบางแค กรุงเทพฯ 10160',
   '082-494-9524'),
  ('KAWIN_FULFILL',   'บริษัท กวิน ฟูลฟิลล์เม้นท์ จำกัด',   'Kawin Fulfillment Co., Ltd.',
   '0105566152626',
   '88/6 หมู่บ้าน เดอะวินน์ กาญจนาภิเษก-สาทร ซอยกาญจนาภิเษก 0010 แยก 2 แขวงบางแค เขตบางแค กรุงเทพฯ 10160',
   '082-494-9524'),
  ('KAWIN_CONSULT',   'บริษัท กวิน คอนเซาท์ จำกัด',          'Kawin Consult Co., Ltd.',
   '0105566152405',
   '88/6 หมู่บ้าน เดอะวินน์ กาญจนาภิเษก-สาทร ซอยกาญจนาภิเษก 0010 แยก 2 แขวงบางแค เขตบางแค กรุงเทพฯ 10160',
   '082-494-9524')
ON CONFLICT (code) DO NOTHING;

-- Migrate existing company_settings into company id=1
UPDATE companies SET
    email   = COALESCE((SELECT value FROM company_settings WHERE key='email' LIMIT 1), email),
    website = COALESCE((SELECT value FROM company_settings WHERE key='website' LIMIT 1), website),
    vat_rate = COALESCE((SELECT value::numeric FROM company_settings WHERE key='vat_rate' LIMIT 1), vat_rate)
WHERE id = 1;

-- 3. Create user_companies junction
CREATE TABLE IF NOT EXISTS user_companies (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    granted_by INTEGER REFERENCES users(id),
    PRIMARY KEY (user_id, company_id)
);
CREATE INDEX IF NOT EXISTS idx_user_companies_user    ON user_companies(user_id);
CREATE INDEX IF NOT EXISTS idx_user_companies_company ON user_companies(company_id);

-- Grant admin (id=1) access to all companies
INSERT INTO user_companies (user_id, company_id)
SELECT 1, id FROM companies
ON CONFLICT DO NOTHING;

-- 4. Add company_id to all data tables (nullable first)
ALTER TABLE wallet_accounts      ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id);
ALTER TABLE holders              ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id);
ALTER TABLE cashflow_categories  ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id);
ALTER TABLE income_entries       ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id);
ALTER TABLE expense_entries      ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id);
ALTER TABLE payables             ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id);
ALTER TABLE receivables          ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id);
ALTER TABLE transfers            ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id);
ALTER TABLE documents            ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id);
ALTER TABLE cash_transactions    ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id);
ALTER TABLE activity_logs        ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id);

-- 5. Backfill: assign existing wallet accounts to correct companies
UPDATE wallet_accounts SET company_id = 2 WHERE id = 1 AND company_id IS NULL;  -- SCB ฟูลฟิลล์เม้นท์
UPDATE wallet_accounts SET company_id = 3 WHERE id = 2 AND company_id IS NULL;  -- SCB คอนเซาท์

-- Everything else → company 1 (กวิน บราเธอร์ส) as default
UPDATE wallet_accounts      SET company_id = 1 WHERE company_id IS NULL;
UPDATE holders              SET company_id = 1 WHERE company_id IS NULL;
UPDATE cashflow_categories  SET company_id = 1 WHERE company_id IS NULL;
UPDATE income_entries       SET company_id = 1 WHERE company_id IS NULL;
UPDATE expense_entries      SET company_id = 1 WHERE company_id IS NULL;
UPDATE payables             SET company_id = 1 WHERE company_id IS NULL;
UPDATE receivables          SET company_id = 1 WHERE company_id IS NULL;
UPDATE transfers            SET company_id = 1 WHERE company_id IS NULL;
UPDATE documents            SET company_id = 1 WHERE company_id IS NULL;
UPDATE cash_transactions    SET company_id = 1 WHERE company_id IS NULL;
UPDATE activity_logs        SET company_id = 1 WHERE company_id IS NULL;

-- 6. Add NOT NULL + indexes
ALTER TABLE wallet_accounts      ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE holders              ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE cashflow_categories  ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE income_entries       ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE expense_entries      ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE payables             ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE receivables          ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE transfers            ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE documents            ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE cash_transactions    ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE activity_logs        ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_accounts_company      ON wallet_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_holders_company              ON holders(company_id);
CREATE INDEX IF NOT EXISTS idx_cashflow_categories_company  ON cashflow_categories(company_id);
CREATE INDEX IF NOT EXISTS idx_income_entries_company       ON income_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_expense_entries_company      ON expense_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_payables_company             ON payables(company_id);
CREATE INDEX IF NOT EXISTS idx_receivables_company          ON receivables(company_id);
CREATE INDEX IF NOT EXISTS idx_transfers_company            ON transfers(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_company            ON documents(company_id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_company    ON cash_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_company        ON activity_logs(company_id);

-- 7. Categories: uniqueness is per-company (not global), and the default category
--    set (company 1) is seeded into every other company that has none yet.
ALTER TABLE cashflow_categories DROP CONSTRAINT IF EXISTS uq_category_name_type;
ALTER TABLE cashflow_categories ADD CONSTRAINT uq_category_name_type UNIQUE (company_id, type, name);
INSERT INTO cashflow_categories (type, name, parent_id, color, icon, sort_order, is_active, company_id)
SELECT src.type, src.name, NULL, src.color, src.icon, src.sort_order, src.is_active, c.id
FROM cashflow_categories src CROSS JOIN companies c
WHERE src.company_id = 1 AND c.id <> 1
  AND NOT EXISTS (SELECT 1 FROM cashflow_categories x WHERE x.company_id = c.id);

COMMIT;
