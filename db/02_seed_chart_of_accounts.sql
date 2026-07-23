-- ============================================================
-- ผังบัญชีมาตรฐาน สำหรับ SME ไทย
-- อ้างอิงมาตรฐานการบัญชีไทย (TFRS for NPAEs)
-- ============================================================

INSERT INTO accounts (code, name_th, name_en, account_type, category, normal_balance, level, is_header) VALUES

-- ============================================================
-- 1. สินทรัพย์ (Assets)
-- ============================================================
('1000', 'สินทรัพย์',                      'Assets',                       'asset', 'current_asset',     'debit', 1, TRUE),

-- สินทรัพย์หมุนเวียน
('1100', 'สินทรัพย์หมุนเวียน',              'Current Assets',               'asset', 'current_asset',     'debit', 2, TRUE),
('1101', 'เงินสด',                          'Cash',                         'asset', 'current_asset',     'debit', 3, FALSE),
('1102', 'เงินฝากธนาคาร',                   'Bank Deposits',                'asset', 'current_asset',     'debit', 3, FALSE),
('1103', 'เงินฝากออมทรัพย์',                'Savings Account',              'asset', 'current_asset',     'debit', 3, FALSE),
('1104', 'เงินฝากประจำ',                    'Fixed Deposit',                'asset', 'current_asset',     'debit', 3, FALSE),
('1201', 'ลูกหนี้การค้า',                   'Accounts Receivable',          'asset', 'current_asset',     'debit', 3, FALSE),
('1202', 'ค่าเผื่อหนี้สงสัยจะสูญ',          'Allowance for Doubtful Accounts','asset','current_asset',   'credit',3, FALSE),
('1203', 'ลูกหนี้อื่น',                     'Other Receivables',            'asset', 'current_asset',     'debit', 3, FALSE),
('1204', 'ตั๋วเงินรับ',                     'Notes Receivable',             'asset', 'current_asset',     'debit', 3, FALSE),
('1301', 'สินค้าคงเหลือ',                   'Inventory',                    'asset', 'current_asset',     'debit', 3, FALSE),
('1302', 'วัตถุดิบ',                         'Raw Materials',                'asset', 'current_asset',     'debit', 3, FALSE),
('1303', 'งานระหว่างทำ',                    'Work in Progress',             'asset', 'current_asset',     'debit', 3, FALSE),
('1401', 'ภาษีมูลค่าเพิ่มรอเรียกคืน',       'VAT Input Recoverable',        'asset', 'current_asset',     'debit', 3, FALSE),
('1402', 'ภาษีซื้อ',                        'Input VAT',                    'asset', 'current_asset',     'debit', 3, FALSE),
('1403', 'ภาษีหัก ณ ที่จ่ายถูกหัก',         'WHT Receivable',               'asset', 'current_asset',     'debit', 3, FALSE),
('1501', 'ค่าใช้จ่ายล่วงหน้า',              'Prepaid Expenses',             'asset', 'current_asset',     'debit', 3, FALSE),
('1502', 'รายได้ค้างรับ',                   'Accrued Revenue',              'asset', 'current_asset',     'debit', 3, FALSE),

-- สินทรัพย์ไม่หมุนเวียน
('1600', 'สินทรัพย์ไม่หมุนเวียน',           'Non-Current Assets',           'asset', 'fixed_asset',       'debit', 2, TRUE),
('1601', 'ที่ดิน',                          'Land',                         'asset', 'fixed_asset',       'debit', 3, FALSE),
('1602', 'อาคาร',                           'Buildings',                    'asset', 'fixed_asset',       'debit', 3, FALSE),
('1603', 'ค่าเสื่อมราคาสะสม-อาคาร',         'Accumulated Depreciation-Bldg','asset', 'fixed_asset',      'credit',3, FALSE),
('1604', 'เครื่องจักรและอุปกรณ์',           'Machinery & Equipment',        'asset', 'fixed_asset',       'debit', 3, FALSE),
('1605', 'ค่าเสื่อมราคาสะสม-เครื่องจักร',   'Accum. Depr.-Machinery',       'asset', 'fixed_asset',      'credit',3, FALSE),
('1606', 'เฟอร์นิเจอร์และเครื่องใช้สำนักงาน','Furniture & Office Equipment', 'asset','fixed_asset',      'debit', 3, FALSE),
('1607', 'ค่าเสื่อมราคาสะสม-เฟอร์นิเจอร์',  'Accum. Depr.-Furniture',       'asset', 'fixed_asset',     'credit',3, FALSE),
('1608', 'ยานพาหนะ',                        'Vehicles',                     'asset', 'fixed_asset',       'debit', 3, FALSE),
('1609', 'ค่าเสื่อมราคาสะสม-ยานพาหนะ',      'Accum. Depr.-Vehicles',        'asset', 'fixed_asset',     'credit',3, FALSE),
('1610', 'คอมพิวเตอร์และอุปกรณ์ IT',        'Computer & IT Equipment',      'asset', 'fixed_asset',       'debit', 3, FALSE),
('1611', 'ค่าเสื่อมราคาสะสม-คอมพิวเตอร์',   'Accum. Depr.-Computer',        'asset', 'fixed_asset',     'credit',3, FALSE),
('1700', 'สินทรัพย์ไม่มีตัวตน',             'Intangible Assets',            'asset', 'fixed_asset',       'debit', 3, FALSE),
('1701', 'โปรแกรมคอมพิวเตอร์',             'Software',                     'asset', 'fixed_asset',       'debit', 3, FALSE),
('1702', 'ค่าตัดจำหน่ายสะสม-โปรแกรม',      'Accum. Amort.-Software',       'asset', 'fixed_asset',      'credit',3, FALSE),

-- ============================================================
-- 2. หนี้สิน (Liabilities)
-- ============================================================
('2000', 'หนี้สิน',                         'Liabilities',                  'liability','current_liability','credit',1,TRUE),

-- หนี้สินหมุนเวียน
('2100', 'หนี้สินหมุนเวียน',               'Current Liabilities',          'liability','current_liability','credit',2,TRUE),
('2101', 'เจ้าหนี้การค้า',                 'Accounts Payable',             'liability','current_liability','credit',3,FALSE),
('2102', 'เจ้าหนี้อื่น',                   'Other Payables',               'liability','current_liability','credit',3,FALSE),
('2103', 'ตั๋วเงินจ่าย',                   'Notes Payable',                'liability','current_liability','credit',3,FALSE),
('2201', 'ภาษีมูลค่าเพิ่มค้างจ่าย',        'VAT Payable',                  'liability','current_liability','credit',3,FALSE),
('2202', 'ภาษีขาย',                        'Output VAT',                   'liability','current_liability','credit',3,FALSE),
('2203', 'ภาษีหัก ณ ที่จ่ายค้างนำส่ง',     'WHT Payable',                  'liability','current_liability','credit',3,FALSE),
('2204', 'ภาษีเงินได้นิติบุคคลค้างจ่าย',   'Corporate Income Tax Payable', 'liability','current_liability','credit',3,FALSE),
('2301', 'เงินเดือนและค่าจ้างค้างจ่าย',    'Accrued Salaries & Wages',     'liability','current_liability','credit',3,FALSE),
('2302', 'เงินประกันสังคมค้างจ่าย',         'Social Security Payable',      'liability','current_liability','credit',3,FALSE),
('2303', 'กองทุนสำรองเลี้ยงชีพค้างจ่าย',  'Provident Fund Payable',       'liability','current_liability','credit',3,FALSE),
('2401', 'รายได้รับล่วงหน้า',              'Deferred Revenue',             'liability','current_liability','credit',3,FALSE),
('2402', 'ค่าใช้จ่ายค้างจ่าย',             'Accrued Expenses',             'liability','current_liability','credit',3,FALSE),
('2501', 'เงินกู้ยืมระยะสั้น',             'Short-term Loans',             'liability','current_liability','credit',3,FALSE),

-- หนี้สินระยะยาว
('2600', 'หนี้สินระยะยาว',                 'Long-term Liabilities',        'liability','long_term_liability','credit',2,TRUE),
('2601', 'เงินกู้ยืมระยะยาว',              'Long-term Loans',              'liability','long_term_liability','credit',3,FALSE),
('2602', 'หุ้นกู้',                         'Debentures',                   'liability','long_term_liability','credit',3,FALSE),
('2603', 'สำรองผลประโยชน์พนักงาน',          'Employee Benefit Provision',   'liability','long_term_liability','credit',3,FALSE),

-- ============================================================
-- 3. ส่วนของเจ้าของ (Equity)
-- ============================================================
('3000', 'ส่วนของเจ้าของ',                 'Equity',                       'equity','equity','credit',1,TRUE),
('3101', 'ทุนจดทะเบียน',                   'Registered Capital',           'equity','equity','credit',3,FALSE),
('3102', 'ทุนที่ออกและชำระแล้ว',            'Paid-up Capital',              'equity','equity','credit',3,FALSE),
('3103', 'ส่วนเกินมูลค่าหุ้น',              'Share Premium',                'equity','equity','credit',3,FALSE),
('3201', 'กำไรสะสม',                        'Retained Earnings',            'equity','equity','credit',3,FALSE),
('3202', 'กำไร(ขาดทุน)สุทธิปีปัจจุบัน',    'Current Year Net Profit',      'equity','equity','credit',3,FALSE),
('3301', 'เงินปันผลจ่าย',                   'Dividends Paid',               'equity','equity','debit', 3,FALSE),

-- ============================================================
-- 4. รายได้ (Revenue)
-- ============================================================
('4000', 'รายได้',                          'Revenue',                      'revenue','operating_revenue','credit',1,TRUE),
('4100', 'รายได้จากการขาย',                'Sales Revenue',                'revenue','operating_revenue','credit',2,TRUE),
('4101', 'รายได้จากการขายสินค้า',           'Product Sales Revenue',        'revenue','operating_revenue','credit',3,FALSE),
('4102', 'รายได้จากการให้บริการ',           'Service Revenue',              'revenue','operating_revenue','credit',3,FALSE),
('4103', 'ส่วนลดจ่าย',                      'Sales Discounts',              'revenue','operating_revenue','debit', 3,FALSE),
('4104', 'สินค้าส่งคืน',                    'Sales Returns',                'revenue','operating_revenue','debit', 3,FALSE),
('4200', 'รายได้อื่น',                      'Other Revenue',                'revenue','other_revenue',    'credit',2,TRUE),
('4201', 'ดอกเบี้ยรับ',                     'Interest Income',              'revenue','other_revenue',    'credit',3,FALSE),
('4202', 'กำไรจากอัตราแลกเปลี่ยน',          'FX Gain',                      'revenue','other_revenue',    'credit',3,FALSE),
('4203', 'รายได้อื่นๆ',                     'Miscellaneous Income',         'revenue','other_revenue',    'credit',3,FALSE),

-- ============================================================
-- 5. ต้นทุนขาย (Cost of Goods Sold)
-- ============================================================
('5000', 'ต้นทุนขาย',                       'Cost of Goods Sold',           'expense','cost_of_goods',   'debit', 1,TRUE),
('5101', 'ต้นทุนสินค้าขาย',                 'Cost of Products Sold',        'expense','cost_of_goods',   'debit', 3,FALSE),
('5102', 'ต้นทุนบริการ',                    'Cost of Services',             'expense','cost_of_goods',   'debit', 3,FALSE),
('5103', 'ค่าแรงงานทางตรง',                 'Direct Labor',                 'expense','cost_of_goods',   'debit', 3,FALSE),
('5104', 'ค่าโสหุ้ยการผลิต',               'Manufacturing Overhead',        'expense','cost_of_goods',   'debit', 3,FALSE),

-- ============================================================
-- 6. ค่าใช้จ่าย (Expenses)
-- ============================================================
('6000', 'ค่าใช้จ่ายในการดำเนินงาน',        'Operating Expenses',           'expense','operating_expense','debit',1,TRUE),

-- ค่าใช้จ่ายในการขาย
('6100', 'ค่าใช้จ่ายในการขาย',              'Selling Expenses',             'expense','operating_expense','debit',2,TRUE),
('6101', 'เงินเดือนฝ่ายขาย',               'Sales Staff Salaries',         'expense','operating_expense','debit',3,FALSE),
('6102', 'ค่าคอมมิชชั่น',                  'Sales Commission',             'expense','operating_expense','debit',3,FALSE),
('6103', 'ค่าโฆษณาและประชาสัมพันธ์',        'Advertising & Promotion',      'expense','operating_expense','debit',3,FALSE),
('6104', 'ค่าขนส่งสินค้า',                  'Freight Out',                  'expense','operating_expense','debit',3,FALSE),

-- ค่าใช้จ่ายในการบริหาร
('6200', 'ค่าใช้จ่ายในการบริหาร',           'Administrative Expenses',      'expense','operating_expense','debit',2,TRUE),
('6201', 'เงินเดือนฝ่ายบริหาร',             'Administrative Salaries',      'expense','operating_expense','debit',3,FALSE),
('6202', 'ค่าเช่าสำนักงาน',                'Office Rent',                  'expense','operating_expense','debit',3,FALSE),
('6203', 'ค่าสาธารณูปโภค',                  'Utilities',                    'expense','operating_expense','debit',3,FALSE),
('6204', 'ค่าโทรศัพท์และอินเทอร์เน็ต',      'Telephone & Internet',         'expense','operating_expense','debit',3,FALSE),
('6205', 'ค่าเสื่อมราคา',                   'Depreciation Expense',         'expense','operating_expense','debit',3,FALSE),
('6206', 'ค่าตัดจำหน่าย',                   'Amortization Expense',         'expense','operating_expense','debit',3,FALSE),
('6207', 'ค่าซ่อมบำรุง',                    'Repair & Maintenance',         'expense','operating_expense','debit',3,FALSE),
('6208', 'ค่าประกันภัย',                    'Insurance',                    'expense','operating_expense','debit',3,FALSE),
('6209', 'ค่าเบี้ยเลี้ยงและค่าเดินทาง',     'Travel & Allowance',           'expense','operating_expense','debit',3,FALSE),
('6210', 'ค่าอุปกรณ์สำนักงาน',              'Office Supplies',              'expense','operating_expense','debit',3,FALSE),
('6211', 'ค่าธรรมเนียมวิชาชีพ',             'Professional Fees',            'expense','operating_expense','debit',3,FALSE),
('6212', 'ค่าธรรมเนียมธนาคาร',              'Bank Charges',                 'expense','operating_expense','debit',3,FALSE),
('6213', 'ค่าใช้จ่ายอื่นๆ',                'Miscellaneous Expenses',       'expense','operating_expense','debit',3,FALSE),

-- ค่าใช้จ่ายทางการเงิน
('6300', 'ค่าใช้จ่ายทางการเงิน',            'Financial Expenses',           'expense','other_expense',   'debit', 2,TRUE),
('6301', 'ดอกเบี้ยจ่าย',                    'Interest Expense',             'expense','other_expense',   'debit', 3,FALSE),
('6302', 'ขาดทุนจากอัตราแลกเปลี่ยน',        'FX Loss',                      'expense','other_expense',   'debit', 3,FALSE),

-- ภาษีเงินได้
('6401', 'ภาษีเงินได้นิติบุคคล',            'Corporate Income Tax',         'expense','other_expense',   'debit', 3,FALSE);

-- ============================================================
-- Fiscal Year 2567 (2024) ตัวอย่าง
-- ============================================================
INSERT INTO fiscal_years (name, start_date, end_date) VALUES
    ('2567', '2024-01-01', '2024-12-31');

INSERT INTO accounting_periods (fiscal_year_id, period_number, start_date, end_date)
SELECT
    1,
    generate_series,
    make_date(2024, generate_series, 1),
    (make_date(2024, generate_series, 1) + INTERVAL '1 month - 1 day')::DATE
FROM generate_series(1, 12);

-- ============================================================
-- Default Admin User
-- ============================================================
INSERT INTO users (username, email, password_hash, full_name, role)
VALUES ('admin', 'admin@company.th',
        crypt('changeme123', gen_salt('bf')),
        'ผู้ดูแลระบบ', 'admin');
