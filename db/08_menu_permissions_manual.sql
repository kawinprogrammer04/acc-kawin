-- Manual setup for Menu Management / Permission.
-- Run this against the same PostgreSQL database that the backend uses.

CREATE TABLE IF NOT EXISTS app_menus (
    id SERIAL PRIMARY KEY,
    key VARCHAR(80) NOT NULL UNIQUE,
    label VARCHAR(200) NOT NULL,
    path VARCHAR(300),
    icon VARCHAR(80),
    group_key VARCHAR(80),
    group_label VARCHAR(200),
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_permissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    menu_id INTEGER NOT NULL REFERENCES app_menus(id) ON DELETE CASCADE,
    can_view BOOLEAN NOT NULL DEFAULT FALSE,
    can_create BOOLEAN NOT NULL DEFAULT FALSE,
    can_update BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete BOOLEAN NOT NULL DEFAULT FALSE,
    can_approve BOOLEAN NOT NULL DEFAULT FALSE,
    can_export BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_menu_permissions_user_menu UNIQUE (user_id, menu_id)
);

CREATE TABLE IF NOT EXISTS permission_items (
    id SERIAL PRIMARY KEY,
    key VARCHAR(160) NOT NULL UNIQUE,
    menu_id INTEGER REFERENCES app_menus(id) ON DELETE SET NULL,
    menu_key VARCHAR(80),
    action_key VARCHAR(80) NOT NULL,
    label VARCHAR(200) NOT NULL,
    route_method VARCHAR(12),
    route_path VARCHAR(400),
    source VARCHAR(30) NOT NULL DEFAULT 'route',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permission_sets (
    id SERIAL PRIMARY KEY,
    name VARCHAR(160) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permission_set_items (
    id SERIAL PRIMARY KEY,
    permission_set_id INTEGER NOT NULL REFERENCES permission_sets(id) ON DELETE CASCADE,
    permission_item_id INTEGER NOT NULL REFERENCES permission_items(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_permission_set_items_set_item UNIQUE (permission_set_id, permission_item_id)
);

CREATE TABLE IF NOT EXISTS user_permission_sets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_set_id INTEGER NOT NULL REFERENCES permission_sets(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_user_permission_sets_user_set UNIQUE (user_id, permission_set_id)
);

CREATE TABLE IF NOT EXISTS user_permission_overrides (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_item_id INTEGER NOT NULL REFERENCES permission_items(id) ON DELETE CASCADE,
    is_allowed BOOLEAN NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_user_permission_overrides_user_item UNIQUE (user_id, permission_item_id)
);

CREATE INDEX IF NOT EXISTS ix_app_menus_group_sort
    ON app_menus (group_key, sort_order, id);
CREATE INDEX IF NOT EXISTS ix_menu_permissions_user_id
    ON menu_permissions (user_id);
CREATE INDEX IF NOT EXISTS ix_menu_permissions_menu_id
    ON menu_permissions (menu_id);
CREATE INDEX IF NOT EXISTS ix_permission_items_menu_id
    ON permission_items (menu_id);
CREATE INDEX IF NOT EXISTS ix_permission_items_menu_action
    ON permission_items (menu_key, action_key);
CREATE INDEX IF NOT EXISTS ix_permission_set_items_set_id
    ON permission_set_items (permission_set_id);
CREATE INDEX IF NOT EXISTS ix_user_permission_sets_user_id
    ON user_permission_sets (user_id);
CREATE INDEX IF NOT EXISTS ix_user_permission_overrides_user_id
    ON user_permission_overrides (user_id);

INSERT INTO app_menus
    (key, label, path, icon, group_key, group_label, sort_order, is_active, is_system)
VALUES
    ('dashboard', 'แดชบอร์ด', '/', 'LayoutDashboard', 'cashflow', 'กระแสเงินสด', 10, TRUE, TRUE),
    ('income', 'รายรับ', '/income', 'ArrowUpCircle', 'cashflow', 'กระแสเงินสด', 20, TRUE, TRUE),
    ('expenses', 'รายจ่าย', '/expenses', 'ArrowDownCircle', 'cashflow', 'กระแสเงินสด', 30, TRUE, TRUE),
    ('payables', 'เจ้าหนี้', '/payables', 'CreditCard', 'cashflow', 'กระแสเงินสด', 40, TRUE, TRUE),
    ('receivables', 'ลูกหนี้', '/receivables', 'HelpingHand', 'cashflow', 'กระแสเงินสด', 50, TRUE, TRUE),
    ('schedule', 'กำหนดการจ่าย / รับ', '/schedule', 'Calendar', 'cashflow', 'กระแสเงินสด', 60, TRUE, TRUE),
    ('wallet_accounts', 'บัญชีเงิน / Wallet', '/wallet-accounts', 'Wallet', 'cashflow', 'กระแสเงินสด', 70, TRUE, TRUE),
    ('holders', 'Holder / กระเป๋าย่อย', '/holders', 'Package', 'cashflow', 'กระแสเงินสด', 80, TRUE, TRUE),
    ('transfers', 'โอนเงิน', '/transfers', 'ArrowLeftRight', 'cashflow', 'กระแสเงินสด', 90, TRUE, TRUE),
    ('categories', 'หมวดหมู่', '/categories', 'Tag', 'cashflow', 'กระแสเงินสด', 100, TRUE, TRUE),
    ('cashflow_reports', 'รายงาน', '/cashflow-reports', 'FileBarChart', 'cashflow', 'กระแสเงินสด', 110, TRUE, TRUE),
    ('documents', 'เอกสาร', '/documents', 'FolderOpen', 'cashflow', 'กระแสเงินสด', 120, TRUE, TRUE),
    ('tax_invoices', 'ใบกำกับภาษี', '/tax-invoices', 'Receipt', 'cashflow', 'กระแสเงินสด', 130, TRUE, TRUE),
    ('budgets', 'งบประมาณ', '/budgets', 'PiggyBank', 'cashflow', 'กระแสเงินสด', 140, TRUE, TRUE),
    ('activity_logs', 'Activity Log', '/activity-logs', 'ClipboardList', 'cashflow', 'กระแสเงินสด', 150, TRUE, TRUE),
    ('statement_review', 'Review', '/statement?tab=review', 'FileSearch', 'statement', 'ตรวจ Statement บัตร', 10, TRUE, TRUE),
    ('statement_upload', 'Upload', '/statement?tab=upload', 'Upload', 'statement', 'ตรวจ Statement บัตร', 20, TRUE, TRUE),
    ('statement_references', 'ข้อมูลอีกฝั่ง', '/statement?tab=references', 'ArrowLeftRight', 'statement', 'ตรวจ Statement บัตร', 30, TRUE, TRUE),
    ('statement_transactions', 'รายการทั้งหมด', '/statement?tab=transactions', 'List', 'statement', 'ตรวจ Statement บัตร', 40, TRUE, TRUE),
    ('statement_manual_edit', 'Manual Edit', '/statement?tab=manual-edit', 'PenSquare', 'statement', 'ตรวจ Statement บัตร', 50, TRUE, TRUE),
    ('statement_summary', 'Summary', '/statement?tab=summary', 'BarChart3', 'statement', 'ตรวจ Statement บัตร', 60, TRUE, TRUE),
    ('statement_audit', 'Audit', '/statement?tab=audit', 'ClipboardList', 'statement', 'ตรวจ Statement บัตร', 70, TRUE, TRUE),
    ('statement_cards', 'จัดการบัตร', '/statement?tab=cards', 'CreditCard', 'statement', 'ตรวจ Statement บัตร', 80, TRUE, TRUE),
    ('accounting', 'ภาพรวมบัญชี', '/accounting', 'LayoutDashboard', 'accounting', 'บัญชีคู่ (Advanced)', 10, TRUE, TRUE),
    ('accounts', 'ผังบัญชี', '/accounts', 'Building2', 'accounting', 'บัญชีคู่ (Advanced)', 20, TRUE, TRUE),
    ('journals', 'สมุดรายวัน', '/journals', 'BookOpen', 'accounting', 'บัญชีคู่ (Advanced)', 30, TRUE, TRUE),
    ('invoices_ar', 'ลูกหนี้ (AR)', '/invoices/ar', 'ChevronRight', 'accounting', 'บัญชีคู่ (Advanced)', 40, TRUE, TRUE),
    ('invoices_ap', 'เจ้าหนี้ (AP)', '/invoices/ap', 'ChevronRight', 'accounting', 'บัญชีคู่ (Advanced)', 50, TRUE, TRUE),
    ('report_income_statement', 'งบกำไรขาดทุน', '/reports/income-statement', 'ChevronRight', 'accounting', 'บัญชีคู่ (Advanced)', 60, TRUE, TRUE),
    ('report_balance_sheet', 'งบดุล', '/reports/balance-sheet', 'ChevronRight', 'accounting', 'บัญชีคู่ (Advanced)', 70, TRUE, TRUE),
    ('report_trial_balance', 'งบทดลอง', '/reports/trial-balance', 'ChevronRight', 'accounting', 'บัญชีคู่ (Advanced)', 80, TRUE, TRUE),
    ('report_ar_aging', 'อายุลูกหนี้', '/reports/ar-aging', 'ChevronRight', 'accounting', 'บัญชีคู่ (Advanced)', 90, TRUE, TRUE),
    ('report_vat', 'ภพ.30', '/reports/vat', 'ChevronRight', 'accounting', 'บัญชีคู่ (Advanced)', 100, TRUE, TRUE),
    ('companies', 'บริษัท', '/companies', 'Building2', 'admin', 'ผู้ดูแลระบบ', 10, TRUE, TRUE),
    ('users', 'ผู้ใช้งาน', '/users', 'Users', 'admin', 'ผู้ดูแลระบบ', 20, TRUE, TRUE),
    ('settings', 'ตั้งค่าบริษัท', '/settings', 'Settings', 'admin', 'ผู้ดูแลระบบ', 30, TRUE, TRUE),
    ('permissions', 'Permission', '/permissions', 'ShieldCheck', 'admin', 'ผู้ดูแลระบบ', 40, TRUE, TRUE),
    ('menus', 'จัดการเมนู', '/menus', 'ListTree', 'admin', 'ผู้ดูแลระบบ', 9999, TRUE, TRUE)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    path = EXCLUDED.path,
    icon = EXCLUDED.icon,
    group_key = EXCLUDED.group_key,
    group_label = EXCLUDED.group_label,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    is_system = TRUE,
    updated_at = NOW();

-- Seed baseline menu/action permissions. Route sync from the web UI can add
-- real backend-derived actions such as pay, receive, export_pdf, lookup later.
INSERT INTO permission_items
    (key, menu_id, menu_key, action_key, label, source, sort_order, is_active)
SELECT
    m.key || '.' || action.action_key,
    m.id,
    m.key,
    action.action_key,
    action.label,
    'manual_seed',
    m.sort_order + action.sort_offset,
    TRUE
FROM app_menus m
CROSS JOIN (
    VALUES
        ('view', 'เข้าเมนู', 1),
        ('create', 'เพิ่มข้อมูล', 2),
        ('update', 'แก้ไขข้อมูล', 3),
        ('delete', 'ลบข้อมูล', 4),
        ('approve', 'อนุมัติ', 5),
        ('export', 'Export', 6)
) AS action(action_key, label, sort_offset)
ON CONFLICT (key) DO UPDATE SET
    menu_id = EXCLUDED.menu_id,
    menu_key = EXCLUDED.menu_key,
    action_key = EXCLUDED.action_key,
    label = EXCLUDED.label,
    updated_at = NOW();

-- Make the selected user a platform admin.
-- Replace your_username_here with the username that logs in to the website.
UPDATE users
SET is_platform_admin = TRUE
WHERE username = 'your_username_here';

-- Optional: grant all menu actions to the selected user.
INSERT INTO menu_permissions
    (user_id, menu_id, can_view, can_create, can_update, can_delete, can_approve, can_export)
SELECT u.id, m.id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE
FROM users u
CROSS JOIN app_menus m
WHERE u.username = 'your_username_here'
ON CONFLICT (user_id, menu_id) DO UPDATE SET
    can_view = EXCLUDED.can_view,
    can_create = EXCLUDED.can_create,
    can_update = EXCLUDED.can_update,
    can_delete = EXCLUDED.can_delete,
    can_approve = EXCLUDED.can_approve,
    can_export = EXCLUDED.can_export,
    updated_at = NOW();
