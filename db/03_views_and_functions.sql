-- ============================================================
-- Views & Functions สำหรับรายงานบัญชี
-- ============================================================

-- ============================================================
-- VIEW: General Ledger (บัญชีแยกประเภท)
-- ============================================================
CREATE OR REPLACE VIEW vw_general_ledger AS
SELECT
    a.code              AS account_code,
    a.name_th           AS account_name,
    a.account_type,
    j.entry_date,
    j.entry_number,
    j.description       AS journal_description,
    jl.description      AS line_description,
    jl.debit,
    jl.credit,
    p.name_th           AS party_name,
    ap.period_number,
    fy.name             AS fiscal_year
FROM journal_lines jl
JOIN journals j         ON j.id = jl.journal_id
JOIN accounts a         ON a.id = jl.account_id
JOIN accounting_periods ap ON ap.id = j.period_id
JOIN fiscal_years fy    ON fy.id = ap.fiscal_year_id
LEFT JOIN parties p     ON p.id = jl.party_id
WHERE j.status = 'posted'
ORDER BY a.code, j.entry_date, j.entry_number;

-- ============================================================
-- VIEW: Trial Balance (งบทดลอง)
-- ============================================================
CREATE OR REPLACE VIEW vw_trial_balance AS
SELECT
    a.code,
    a.name_th,
    a.account_type,
    a.normal_balance,
    ap.fiscal_year_id,
    ap.period_number,
    COALESCE(SUM(jl.debit),  0) AS total_debit,
    COALESCE(SUM(jl.credit), 0) AS total_credit,
    COALESCE(SUM(jl.debit),  0) - COALESCE(SUM(jl.credit), 0) AS net_balance
FROM accounts a
LEFT JOIN journal_lines jl  ON jl.account_id = a.id
LEFT JOIN journals j        ON j.id = jl.journal_id AND j.status = 'posted'
LEFT JOIN accounting_periods ap ON ap.id = j.period_id
WHERE a.is_header = FALSE
GROUP BY a.id, a.code, a.name_th, a.account_type, a.normal_balance,
         ap.fiscal_year_id, ap.period_number
ORDER BY a.code;

-- ============================================================
-- VIEW: AR Aging (อายุลูกหนี้)
-- ============================================================
CREATE OR REPLACE VIEW vw_ar_aging AS
SELECT
    p.code          AS customer_code,
    p.name_th       AS customer_name,
    p.tax_id,
    i.invoice_number,
    i.invoice_date,
    i.due_date,
    i.total_amount,
    i.paid_amount,
    i.balance_due,
    CURRENT_DATE - i.due_date AS days_overdue,
    CASE
        WHEN CURRENT_DATE <= i.due_date THEN 'ยังไม่ถึงกำหนด'
        WHEN CURRENT_DATE - i.due_date <= 30  THEN 'เกิน 1-30 วัน'
        WHEN CURRENT_DATE - i.due_date <= 60  THEN 'เกิน 31-60 วัน'
        WHEN CURRENT_DATE - i.due_date <= 90  THEN 'เกิน 61-90 วัน'
        ELSE 'เกิน 90 วันขึ้นไป'
    END AS aging_bucket
FROM invoices i
JOIN parties p ON p.id = i.party_id
WHERE i.invoice_type = 'ar'
  AND i.status NOT IN ('paid', 'voided')
  AND i.balance_due > 0
ORDER BY days_overdue DESC;

-- ============================================================
-- VIEW: AP Aging (อายุเจ้าหนี้)
-- ============================================================
CREATE OR REPLACE VIEW vw_ap_aging AS
SELECT
    p.code          AS vendor_code,
    p.name_th       AS vendor_name,
    p.tax_id,
    i.invoice_number,
    i.reference     AS vendor_invoice_no,
    i.invoice_date,
    i.due_date,
    i.total_amount,
    i.paid_amount,
    i.balance_due,
    CURRENT_DATE - i.due_date AS days_overdue
FROM invoices i
JOIN parties p ON p.id = i.party_id
WHERE i.invoice_type = 'ap'
  AND i.status NOT IN ('paid', 'voided')
  AND i.balance_due > 0
ORDER BY days_overdue DESC;

-- ============================================================
-- VIEW: VAT Report ภพ.30 (Output + Input)
-- ============================================================
CREATE OR REPLACE VIEW vw_vat_pp30 AS
SELECT
    period_year,
    period_month,
    record_type,
    COUNT(*)                    AS doc_count,
    SUM(taxable_amount)         AS total_taxable,
    SUM(vat_amount)             AS total_vat
FROM vat_records
GROUP BY period_year, period_month, record_type
ORDER BY period_year, period_month, record_type;

-- ============================================================
-- FUNCTION: สร้าง Journal Entry จาก Invoice อัตโนมัติ
-- ============================================================
CREATE OR REPLACE FUNCTION fn_post_invoice(p_invoice_id UUID, p_user_id INTEGER)
RETURNS UUID AS $$
DECLARE
    v_invoice       invoices%ROWTYPE;
    v_party         parties%ROWTYPE;
    v_journal_id    UUID;
    v_entry_number  VARCHAR(20);
    v_period_id     INTEGER;
    v_seq           INTEGER;
BEGIN
    -- ดึงข้อมูล Invoice
    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found: %', p_invoice_id; END IF;
    IF v_invoice.status NOT IN ('draft', 'sent') THEN
        RAISE EXCEPTION 'Invoice % cannot be posted (status: %)', v_invoice.invoice_number, v_invoice.status;
    END IF;

    SELECT * INTO v_party FROM parties WHERE id = v_invoice.party_id;

    -- สร้างเลขที่รายการ
    SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number FROM 'JV\d{4}-(\d+)') AS INTEGER)), 0) + 1
    INTO v_seq FROM journals;
    v_entry_number := 'JV' || TO_CHAR(v_invoice.invoice_date, 'YYYY') || '-' || LPAD(v_seq::TEXT, 5, '0');

    -- สร้าง Journal Header
    INSERT INTO journals (entry_number, entry_date, period_id, description, source_type, source_id, created_by)
    VALUES (
        v_entry_number,
        v_invoice.invoice_date,
        v_invoice.period_id,
        CASE v_invoice.invoice_type WHEN 'ar'
            THEN 'ใบแจ้งหนี้ ' || v_invoice.invoice_number || ' - ' || v_party.name_th
            ELSE 'ใบวางบิล '   || v_invoice.invoice_number || ' - ' || v_party.name_th
        END,
        'invoice',
        p_invoice_id,
        p_user_id
    ) RETURNING id INTO v_journal_id;

    -- บันทึก Journal Lines
    IF v_invoice.invoice_type = 'ar' THEN
        -- AR: Dr ลูกหนี้, Cr รายได้ + VAT ขาย
        INSERT INTO journal_lines (journal_id, line_number, account_id, description, debit, credit, party_id)
        VALUES
            (v_journal_id, 1, v_invoice.ar_ap_account_id, 'ลูกหนี้ - ' || v_party.name_th,
             v_invoice.total_amount, 0, v_invoice.party_id),
            (v_journal_id, 2, v_invoice.revenue_expense_account_id, 'รายได้',
             0, v_invoice.subtotal - v_invoice.discount_amount, NULL);

        IF v_invoice.vat_amount > 0 THEN
            INSERT INTO journal_lines (journal_id, line_number, account_id, description, debit, credit)
            VALUES (v_journal_id, 3,
                (SELECT id FROM accounts WHERE code = '2202'), 'ภาษีขาย 7%',
                0, v_invoice.vat_amount);
        END IF;

    ELSE
        -- AP: Dr ค่าใช้จ่าย + VAT ซื้อ, Cr เจ้าหนี้
        INSERT INTO journal_lines (journal_id, line_number, account_id, description, debit, credit, party_id)
        VALUES
            (v_journal_id, 1, v_invoice.revenue_expense_account_id, 'ค่าใช้จ่าย',
             v_invoice.subtotal - v_invoice.discount_amount, 0, NULL),
            (v_journal_id, 2, v_invoice.ar_ap_account_id, 'เจ้าหนี้ - ' || v_party.name_th,
             0, v_invoice.total_amount, v_invoice.party_id);

        IF v_invoice.vat_amount > 0 THEN
            INSERT INTO journal_lines (journal_id, line_number, account_id, description, debit, credit)
            VALUES (v_journal_id, 3,
                (SELECT id FROM accounts WHERE code = '1402'), 'ภาษีซื้อ 7%',
                v_invoice.vat_amount, 0);
        END IF;
    END IF;

    -- Post Journal
    UPDATE journals SET status = 'posted', posted_at = NOW(), posted_by = p_user_id WHERE id = v_journal_id;

    -- อัปเดต Invoice
    UPDATE invoices SET status = 'sent', journal_id = v_journal_id, updated_at = NOW()
    WHERE id = p_invoice_id;

    RETURN v_journal_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCTION: คำนวณ VAT จากราคารวมหรือราคาไม่รวม
-- ============================================================
CREATE OR REPLACE FUNCTION fn_calculate_vat(
    p_amount        NUMERIC,
    p_vat_rate      NUMERIC DEFAULT 7.0,
    p_inclusive     BOOLEAN DEFAULT FALSE  -- TRUE = ราคารวม VAT แล้ว
)
RETURNS TABLE (
    taxable_amount  NUMERIC,
    vat_amount      NUMERIC,
    total_amount    NUMERIC
) AS $$
BEGIN
    IF p_inclusive THEN
        -- แยก VAT ออกจากราคารวม
        RETURN QUERY SELECT
            ROUND(p_amount * 100 / (100 + p_vat_rate), 2),
            ROUND(p_amount - (p_amount * 100 / (100 + p_vat_rate)), 2),
            p_amount;
    ELSE
        -- บวก VAT เข้าไป
        RETURN QUERY SELECT
            p_amount,
            ROUND(p_amount * p_vat_rate / 100, 2),
            ROUND(p_amount + (p_amount * p_vat_rate / 100), 2);
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- FUNCTION: Income Statement (งบกำไรขาดทุน) สำหรับช่วงเวลา
-- ============================================================
CREATE OR REPLACE FUNCTION fn_income_statement(
    p_fiscal_year_id    INTEGER,
    p_period_from       SMALLINT DEFAULT 1,
    p_period_to         SMALLINT DEFAULT 12
)
RETURNS TABLE (
    section         TEXT,
    account_code    VARCHAR,
    account_name    VARCHAR,
    amount          NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH period_amounts AS (
        SELECT
            jl.account_id,
            SUM(jl.debit)  AS total_debit,
            SUM(jl.credit) AS total_credit
        FROM journal_lines jl
        JOIN journals j         ON j.id = jl.journal_id AND j.status = 'posted'
        JOIN accounting_periods ap ON ap.id = j.period_id
        WHERE ap.fiscal_year_id = p_fiscal_year_id
          AND ap.period_number BETWEEN p_period_from AND p_period_to
        GROUP BY jl.account_id
    )
    SELECT
        CASE a.account_type
            WHEN 'revenue' THEN 'รายได้'
            WHEN 'expense' THEN
                CASE a.category
                    WHEN 'cost_of_goods' THEN 'ต้นทุนขาย'
                    ELSE 'ค่าใช้จ่าย'
                END
        END::TEXT,
        a.code,
        a.name_th,
        CASE a.account_type
            WHEN 'revenue' THEN COALESCE(pa.total_credit, 0) - COALESCE(pa.total_debit, 0)
            WHEN 'expense' THEN COALESCE(pa.total_debit, 0)  - COALESCE(pa.total_credit, 0)
        END
    FROM accounts a
    LEFT JOIN period_amounts pa ON pa.account_id = a.id
    WHERE a.account_type IN ('revenue', 'expense')
      AND a.is_header = FALSE
    ORDER BY a.code;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCTION: Balance Sheet (งบดุล) ณ วันสิ้นงวด
-- ============================================================
CREATE OR REPLACE FUNCTION fn_balance_sheet(p_as_of_date DATE)
RETURNS TABLE (
    section         TEXT,
    account_code    VARCHAR,
    account_name    VARCHAR,
    balance         NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH cumulative AS (
        SELECT
            jl.account_id,
            SUM(jl.debit)  AS total_debit,
            SUM(jl.credit) AS total_credit
        FROM journal_lines jl
        JOIN journals j ON j.id = jl.journal_id
            AND j.status   = 'posted'
            AND j.entry_date <= p_as_of_date
        GROUP BY jl.account_id
    )
    SELECT
        CASE a.account_type
            WHEN 'asset'     THEN 'สินทรัพย์'
            WHEN 'liability' THEN 'หนี้สิน'
            WHEN 'equity'    THEN 'ส่วนของเจ้าของ'
        END::TEXT,
        a.code,
        a.name_th,
        CASE a.normal_balance
            WHEN 'debit'  THEN COALESCE(c.total_debit,  0) - COALESCE(c.total_credit, 0)
            WHEN 'credit' THEN COALESCE(c.total_credit, 0) - COALESCE(c.total_debit,  0)
        END
    FROM accounts a
    LEFT JOIN cumulative c ON c.account_id = a.id
    WHERE a.account_type IN ('asset', 'liability', 'equity')
      AND a.is_header = FALSE
    ORDER BY a.code;
END;
$$ LANGUAGE plpgsql;
