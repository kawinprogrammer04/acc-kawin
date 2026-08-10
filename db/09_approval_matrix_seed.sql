-- Manual seed: default expense-approval matrix (positions, expense types, and the
-- 64-rule approval policy imported from "ทดตำแหน่งการอนุมัติเงิน.xlsx") for ONE company.
--
-- Edit v_company_code below to match the company you want to seed BEFORE running.
-- The imported policy version is created as DRAFT — review it in the Approval Matrix
-- admin page, set each position's primary approver, then click "Activate" there.
-- Safe to re-run: every insert is idempotent (ON CONFLICT / NOT EXISTS guarded).
--
-- Run: docker exec -i acc_db psql -U postgres -d accounting_db < db/09_approval_matrix_seed.sql

DO $$
DECLARE
    v_company_code VARCHAR := 'KAWIN_BROTHERS';  -- <<< แก้ให้ตรงกับบริษัทจริงก่อนรัน
    v_company_id INT;
    v_version_id INT;
BEGIN
    SELECT id INTO v_company_id FROM companies WHERE code = v_company_code;
    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'ไม่พบบริษัทรหัส % — แก้ v_company_code ให้ตรงกับบริษัทจริงก่อนรัน', v_company_code;
    END IF;

    -- ── Positions (org chart) ──────────────────────────────────────────
    INSERT INTO positions (company_id, name)
    SELECT v_company_id, p.name FROM (VALUES
        ('Accounting'),
        ('Admin ตอบแชท'),
        ('CEO'),
        ('CFO'),
        ('CMO'),
        ('COO'),
        ('CRM'),
        ('Content Creator'),
        ('Customer Service Officer'),
        ('Digital Marketing Manager'),
        ('Graphic Designer'),
        ('HR'),
        ('HRD'),
        ('HRM'),
        ('IT'),
        ('Manager Accountant'),
        ('Manager Marketing'),
        ('Marketing'),
        ('Marketplace'),
        ('Marketplace Manager'),
        ('R&D'),
        ('Senior Marketplace'),
        ('Supervisor Marketing'),
        ('Support Marketplace'),
        ('ธุระการบัญชี'),
        ('แม่บ้าน')
    ) AS p(name)
    ON CONFLICT (company_id, name) DO NOTHING;

    -- ── Expense types ────────────────────────────────────────────────
    INSERT INTO expense_types (company_id, code, name)
    VALUES
        (v_company_id, 'general', 'ทั่วไป'),
        (v_company_id, 'review_influencer', 'รีวิว/อินฟลูเอนเซอร์'),
        (v_company_id, 'purchase_order', 'สั่งสินค้า')
    ON CONFLICT (company_id, code) DO NOTHING;

    -- ── New draft policy version (review + activate from the admin UI) ──
    INSERT INTO approval_policy_versions (company_id, version_no, status, notes)
    SELECT v_company_id,
           (SELECT COALESCE(MAX(version_no), 0) + 1 FROM approval_policy_versions WHERE company_id = v_company_id),
           'draft',
           'Imported from ทดตำแหน่งการอนุมัติเงิน.xlsx (64 rules)'
    WHERE NOT EXISTS (
        SELECT 1 FROM approval_policy_versions
        WHERE company_id = v_company_id AND notes = 'Imported from ทดตำแหน่งการอนุมัติเงิน.xlsx (64 rules)'
    );

    SELECT id INTO v_version_id FROM approval_policy_versions
    WHERE company_id = v_company_id AND notes = 'Imported from ทดตำแหน่งการอนุมัติเงิน.xlsx (64 rules)';

    -- ── Staging: 64 rules as (requester, expense type, amount range, steps) ──
    CREATE TEMP TABLE staging_matrix (
        row_no INT, requester_name TEXT, expense_code TEXT,
        amount_min NUMERIC, amount_max NUMERIC,
        step1_name TEXT, step2_name TEXT, step3_name TEXT
    ) ON COMMIT DROP;

    INSERT INTO staging_matrix
        (row_no, requester_name, expense_code, amount_min, amount_max, step1_name, step2_name, step3_name)
    VALUES
        (1, 'Content Creator', 'general', 0, 10000, 'Supervisor Marketing', NULL, NULL),
        (2, 'Graphic Designer', 'general', 0, 10000, 'Supervisor Marketing', NULL, NULL),
        (3, 'Marketing', 'general', 0, 10000, 'Supervisor Marketing', NULL, NULL),
        (4, 'Supervisor Marketing', 'general', 0, 10000, 'Manager Marketing', NULL, NULL),
        (5, 'Manager Marketing', 'general', 0, 10000, 'CMO', NULL, NULL),
        (6, 'Content Creator', 'general', 10000, 25000, 'Supervisor Marketing', 'Manager Marketing', NULL),
        (7, 'Graphic Designer', 'general', 10000, 25000, 'Supervisor Marketing', 'Manager Marketing', NULL),
        (8, 'Marketing', 'general', 10000, 25000, 'Supervisor Marketing', 'Manager Marketing', NULL),
        (9, 'Supervisor Marketing', 'general', 10000, 25000, 'Manager Marketing', 'CMO', NULL),
        (10, 'Manager Marketing', 'general', 10000, 25000, 'CMO', NULL, NULL),
        (11, 'Content Creator', 'general', 25000, NULL, 'Supervisor Marketing', 'Manager Marketing', 'CMO'),
        (12, 'Graphic Designer', 'general', 25000, NULL, 'Supervisor Marketing', 'Manager Marketing', 'CMO'),
        (13, 'Marketing', 'general', 25000, NULL, 'Supervisor Marketing', 'Manager Marketing', 'CMO'),
        (14, 'Supervisor Marketing', 'general', 25000, NULL, 'Manager Marketing', 'CMO', NULL),
        (15, 'Manager Marketing', 'general', 25000, NULL, 'CMO', 'CEO', NULL),
        (16, 'Content Creator', 'review_influencer', 0, 30000, 'Supervisor Marketing', NULL, NULL),
        (17, 'Graphic Designer', 'review_influencer', 0, 30000, 'Supervisor Marketing', NULL, NULL),
        (18, 'Marketing', 'review_influencer', 0, 30000, 'Supervisor Marketing', NULL, NULL),
        (19, 'Supervisor Marketing', 'review_influencer', 0, 30000, 'Manager Marketing', NULL, NULL),
        (20, 'Manager Marketing', 'review_influencer', 0, 30000, 'CMO', NULL, NULL),
        (21, 'Content Creator', 'review_influencer', 30000, 60000, 'Supervisor Marketing', 'Manager Marketing', NULL),
        (22, 'Graphic Designer', 'review_influencer', 30000, 60000, 'Supervisor Marketing', 'Manager Marketing', NULL),
        (23, 'Marketing', 'review_influencer', 30000, 60000, 'Supervisor Marketing', 'Manager Marketing', NULL),
        (24, 'Supervisor Marketing', 'review_influencer', 30000, 60000, 'Manager Marketing', 'CMO', NULL),
        (25, 'Manager Marketing', 'review_influencer', 30000, 60000, 'CMO', 'CEO', NULL),
        (26, 'Content Creator', 'review_influencer', 60000, NULL, 'Supervisor Marketing', 'Manager Marketing', 'CMO'),
        (27, 'Graphic Designer', 'review_influencer', 60000, NULL, 'Supervisor Marketing', 'Manager Marketing', 'CMO'),
        (28, 'Marketing', 'review_influencer', 60000, NULL, 'Supervisor Marketing', 'Manager Marketing', 'CMO'),
        (29, 'Supervisor Marketing', 'review_influencer', 60000, NULL, 'Manager Marketing', 'CMO', NULL),
        (30, 'Manager Marketing', 'review_influencer', 60000, NULL, 'CMO', 'CEO', NULL),
        (31, 'R&D', 'general', 0, 10000, 'Manager Marketing', NULL, NULL),
        (32, 'R&D', 'general', 10000, NULL, 'Manager Marketing', 'CMO', NULL),
        (33, 'Admin ตอบแชท', 'general', 0, 10000, 'Manager Marketing', NULL, NULL),
        (34, 'Admin ตอบแชท', 'general', 10000, NULL, 'Manager Marketing', 'CMO', NULL),
        (35, 'Digital Marketing Manager', 'general', 0, 10000, 'Manager Marketing', NULL, NULL),
        (36, 'Digital Marketing Manager', 'general', 10000, NULL, 'Manager Marketing', 'CMO', NULL),
        (37, 'Customer Service Officer', 'general', 0, 10000, 'Manager Marketing', NULL, NULL),
        (38, 'Customer Service Officer', 'general', 10000, NULL, 'Manager Marketing', 'CMO', NULL),
        (39, 'Support Marketplace', 'general', 0, NULL, 'Marketplace Manager', NULL, NULL),
        (40, 'Marketplace', 'general', 0, NULL, 'Marketplace Manager', NULL, NULL),
        (41, 'Senior Marketplace', 'general', 0, NULL, 'Marketplace Manager', NULL, NULL),
        (42, 'Marketplace Manager', 'general', 0, NULL, 'Manager Marketing', NULL, NULL),
        (43, 'IT', 'general', 0, 10000, 'COO', NULL, NULL),
        (44, 'IT', 'general', 10000, NULL, 'COO', 'CEO', NULL),
        (45, 'CRM', 'general', 0, 10000, 'COO', NULL, NULL),
        (46, 'CRM', 'general', 10000, NULL, 'COO', 'CEO', NULL),
        (47, 'ธุระการบัญชี', 'general', 0, 10000, 'Accounting', NULL, NULL),
        (48, 'ธุระการบัญชี', 'general', 10000, NULL, 'Accounting', 'Manager Accountant', NULL),
        (49, 'Accounting', 'general', 0, 10000, 'Manager Accountant', NULL, NULL),
        (50, 'Accounting', 'general', 10000, NULL, 'Manager Accountant', 'CFO', NULL),
        (51, 'ธุระการบัญชี', 'purchase_order', 0, 99999, 'Accounting', 'Manager Accountant', NULL),
        (52, 'ธุระการบัญชี', 'purchase_order', 99999, 499999, 'Accounting', 'Manager Accountant', 'CFO'),
        (53, 'ธุระการบัญชี', 'purchase_order', 499999, NULL, 'Manager Accountant', 'CFO', 'CEO'),
        (54, 'Accounting', 'purchase_order', 0, 99999, 'Manager Accountant', NULL, NULL),
        (55, 'Accounting', 'purchase_order', 99999, 499999, 'Manager Accountant', 'CFO', NULL),
        (56, 'Accounting', 'purchase_order', 499999, NULL, 'Manager Accountant', 'CFO', 'CEO'),
        (57, 'HRM', 'general', 0, 10000, 'Manager Accountant', NULL, NULL),
        (58, 'HRM', 'general', 10000, NULL, 'Manager Accountant', 'CFO', NULL),
        (59, 'HRD', 'general', 0, 10000, 'Manager Accountant', NULL, NULL),
        (60, 'HRD', 'general', 10000, NULL, 'Manager Accountant', 'CFO', NULL),
        (61, 'HR', 'general', 0, 10000, 'Manager Accountant', NULL, NULL),
        (62, 'HR', 'general', 10000, NULL, 'Manager Accountant', 'CFO', NULL),
        (63, 'แม่บ้าน', 'general', 0, 10000, 'Manager Accountant', NULL, NULL),
        (64, 'แม่บ้าน', 'general', 10000, NULL, 'Manager Accountant', 'CFO', NULL);

    -- ── Rules: resolve names -> ids, build the amount NUMRANGE ──────────
    INSERT INTO approval_rules (policy_version_id, requester_position_id, expense_type_id, amount_range)
    SELECT v_version_id, pos.id, et.id, numrange(sm.amount_min, sm.amount_max, '(]')
    FROM staging_matrix sm
    JOIN positions pos ON pos.company_id = v_company_id AND pos.name = sm.requester_name
    JOIN expense_types et ON et.company_id = v_company_id AND et.code = sm.expense_code
    WHERE NOT EXISTS (
        SELECT 1 FROM approval_rules r
        WHERE r.policy_version_id = v_version_id
          AND r.requester_position_id = pos.id AND r.expense_type_id = et.id
          AND r.amount_range = numrange(sm.amount_min, sm.amount_max, '(]')
    );

    -- ── Steps: unnest step1/2/3 -> approval_rule_steps (unlimited steps
    -- supported by the schema; this seed data tops out at 3) ──────────
    INSERT INTO approval_rule_steps (approval_rule_id, step_no, approver_position_id)
    SELECT r.id, s.step_no, p.id
    FROM staging_matrix sm
    JOIN positions pos ON pos.company_id = v_company_id AND pos.name = sm.requester_name
    JOIN expense_types et ON et.company_id = v_company_id AND et.code = sm.expense_code
    JOIN approval_rules r ON r.policy_version_id = v_version_id
        AND r.requester_position_id = pos.id AND r.expense_type_id = et.id
        AND r.amount_range = numrange(sm.amount_min, sm.amount_max, '(]')
    CROSS JOIN LATERAL (VALUES (1, sm.step1_name), (2, sm.step2_name), (3, sm.step3_name)) AS s(step_no, name)
    JOIN positions p ON p.company_id = v_company_id AND p.name = s.name
    WHERE NOT EXISTS (
        SELECT 1 FROM approval_rule_steps ars WHERE ars.approval_rule_id = r.id AND ars.step_no = s.step_no
    );
END $$;

-- ── Menu wiring for the 3 new pages (global, not company-scoped) ─────────────
-- Matches the app_menus / permission_items pattern from 08_menu_permissions_manual.sql
-- so the dynamic sidebar + permission catalog pick these pages up automatically.
INSERT INTO app_menus
    (key, label, path, icon, group_key, group_label, sort_order, is_active, is_system)
VALUES
    ('expense_requests', 'เบิกเงิน / ขออนุมัติ', '/expense-requests', 'Send', 'cashflow', 'กระแสเงินสด', 145, TRUE, TRUE),
    ('approvals_inbox', 'รออนุมัติของฉัน', '/approvals/inbox', 'Inbox', 'cashflow', 'กระแสเงินสด', 147, TRUE, TRUE),
    ('approval_matrix', 'สายอนุมัติ', '/approval-matrix', 'Workflow', 'admin', 'ผู้ดูแลระบบ', 35, TRUE, TRUE)
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
WHERE m.key IN ('expense_requests', 'approvals_inbox', 'approval_matrix')
ON CONFLICT (key) DO UPDATE SET
    menu_id = EXCLUDED.menu_id,
    menu_key = EXCLUDED.menu_key,
    action_key = EXCLUDED.action_key,
    label = EXCLUDED.label,
    updated_at = NOW();
