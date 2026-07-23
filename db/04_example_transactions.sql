-- ============================================================
-- ตัวอย่างธุรกรรม — ทดสอบระบบ
-- ============================================================

-- ลูกค้าตัวอย่าง
INSERT INTO parties (party_type, code, name_th, name_en, tax_id, branch_code,
                     address, province, credit_days, is_vat_registered,
                     ar_account_id)
VALUES (
    'customer', 'C0001', 'บริษัท ลูกค้าดีจำกัด', 'Good Customer Co., Ltd.',
    '0105566012345', '00000',
    '123 ถนนสุขุมวิท แขวงคลองตัน เขตคลองเตย', 'กรุงเทพมหานคร',
    30, TRUE,
    (SELECT id FROM accounts WHERE code = '1201')
);

-- ผู้ขายตัวอย่าง
INSERT INTO parties (party_type, code, name_th, name_en, tax_id, branch_code,
                     address, province, credit_days, is_vat_registered,
                     ap_account_id)
VALUES (
    'vendor', 'V0001', 'บริษัท ซัพพลายเออร์ไทย จำกัด', 'Thai Supplier Co., Ltd.',
    '0105566067890', '00000',
    '456 ถนนพระราม 4 แขวงสีลม เขตบางรัก', 'กรุงเทพมหานคร',
    45, TRUE,
    (SELECT id FROM accounts WHERE code = '2101')
);

-- ============================================================
-- ตัวอย่างที่ 1: บันทึกรายได้จากการขาย (AR Invoice)
-- ============================================================
INSERT INTO invoices (
    invoice_type, invoice_number, invoice_date, due_date,
    party_id, period_id,
    ar_ap_account_id, revenue_expense_account_id,
    subtotal, discount_amount, taxable_amount,
    vat_amount, total_amount,
    is_vat_included, status
) VALUES (
    'ar', 'INV2567-0001', '2024-01-15', '2024-02-14',
    (SELECT id FROM parties WHERE code = 'C0001'),
    (SELECT id FROM accounting_periods WHERE period_number = 1 AND fiscal_year_id = 1),
    (SELECT id FROM accounts WHERE code = '1201'),
    (SELECT id FROM accounts WHERE code = '4101'),
    100000.00, 0.00, 100000.00,
    7000.00, 107000.00,
    FALSE, 'draft'
);

INSERT INTO invoice_lines (invoice_id, line_number, description, quantity, unit, unit_price, line_total)
VALUES (
    (SELECT id FROM invoices WHERE invoice_number = 'INV2567-0001'),
    1, 'สินค้า A จำนวน 100 ชิ้น', 100, 'ชิ้น', 1000.00, 100000.00
);

-- ============================================================
-- ตัวอย่างที่ 2: บันทึกค่าใช้จ่าย (AP Invoice) + WHT 3%
-- ============================================================
INSERT INTO invoices (
    invoice_type, invoice_number, reference, invoice_date, due_date,
    party_id, period_id,
    ar_ap_account_id, revenue_expense_account_id,
    subtotal, discount_amount, taxable_amount,
    vat_amount, wht_amount, total_amount,
    is_vat_included, status
) VALUES (
    'ap', 'AP2567-0001', 'VI-2024-001', '2024-01-20', '2024-03-05',
    (SELECT id FROM parties WHERE code = 'V0001'),
    (SELECT id FROM accounting_periods WHERE period_number = 1 AND fiscal_year_id = 1),
    (SELECT id FROM accounts WHERE code = '2101'),
    (SELECT id FROM accounts WHERE code = '6211'),
    50000.00, 0.00, 50000.00,
    3500.00, 1500.00,
    52000.00,   -- 50000 + 3500 VAT - 1500 WHT
    FALSE, 'draft'
);

INSERT INTO invoice_lines (invoice_id, line_number, description, quantity, unit, unit_price,
                            line_total, wht_type, wht_rate, wht_amount)
VALUES (
    (SELECT id FROM invoices WHERE invoice_number = 'AP2567-0001'),
    1, 'ค่าบริการที่ปรึกษา ม.ค. 2567', 1, 'งาน', 50000.00,
    50000.00, '3', 3.00, 1500.00
);

-- ============================================================
-- ตัวอย่าง VAT Record
-- ============================================================
INSERT INTO vat_records (
    record_type, tax_invoice_number, tax_invoice_date,
    period_month, period_year,
    party_id, party_name, party_tax_id, party_branch,
    taxable_amount, vat_rate, vat_amount, invoice_id
) VALUES (
    'output', 'INV2567-0001', '2024-01-15',
    1, 2567,
    (SELECT id FROM parties WHERE code = 'C0001'),
    'บริษัท ลูกค้าดีจำกัด', '0105566012345', '00000',
    100000.00, 7.00, 7000.00,
    (SELECT id FROM invoices WHERE invoice_number = 'INV2567-0001')
);

INSERT INTO vat_records (
    record_type, tax_invoice_number, tax_invoice_date,
    period_month, period_year,
    party_id, party_name, party_tax_id, party_branch,
    taxable_amount, vat_rate, vat_amount, invoice_id
) VALUES (
    'input', 'VI-2024-001', '2024-01-20',
    1, 2567,
    (SELECT id FROM parties WHERE code = 'V0001'),
    'บริษัท ซัพพลายเออร์ไทย จำกัด', '0105566067890', '00000',
    50000.00, 7.00, 3500.00,
    (SELECT id FROM invoices WHERE invoice_number = 'AP2567-0001')
);

-- ============================================================
-- ตัวอย่าง WHT Record
-- ============================================================
INSERT INTO wht_records (
    transaction_date, period_month, period_year,
    payer_tax_id, payee_id, payee_name, payee_tax_id,
    income_type, wht_type, wht_rate,
    income_amount, wht_amount, invoice_id
) VALUES (
    '2024-01-20', 1, 2567,
    '0105500012345',
    (SELECT id FROM parties WHERE code = 'V0001'),
    'บริษัท ซัพพลายเออร์ไทย จำกัด', '0105566067890',
    'ค่าบริการ', '3', 3.00,
    50000.00, 1500.00,
    (SELECT id FROM invoices WHERE invoice_number = 'AP2567-0001')
);

-- ============================================================
-- ทดสอบ: โพส Invoice เป็น Journal Entry อัตโนมัติ
-- ============================================================
-- SELECT fn_post_invoice(
--     (SELECT id FROM invoices WHERE invoice_number = 'INV2567-0001'),
--     1  -- user_id = admin
-- );

-- ============================================================
-- ทดสอบ: คำนวณ VAT
-- ============================================================
-- SELECT * FROM fn_calculate_vat(107000, 7, TRUE);   -- ราคารวม VAT
-- SELECT * FROM fn_calculate_vat(100000, 7, FALSE);  -- ราคาไม่รวม VAT

-- ============================================================
-- ทดสอบ: ดู AR Aging
-- ============================================================
-- SELECT * FROM vw_ar_aging;

-- ============================================================
-- ทดสอบ: ดู VAT ภพ.30
-- ============================================================
-- SELECT * FROM vw_vat_pp30 WHERE period_year = 2567 AND period_month = 1;
