-- Current KAWIN_BROTHERS expense master data snapshot (2026-08-17).
-- Source: accounting_db at Alembic revision 20260817_01.
--
-- Imports, without relying on environment-specific numeric IDs:
--   * 8 departments
--   * 45 positions and their departments
--   * 3 expense types
--   * one DRAFT approval policy containing 72 rules and their approval steps
--
-- The policy intentionally remains DRAFT. Assign production users to positions
-- (or configure position_primary_approvers), review the matrix, then activate it
-- from the expense settings page before running expense_preflight.
--
-- Safe to replay: master rows are upserted by natural key and the policy is
-- identified by its notes value. This file does not modify app menus or users.

DO $$
DECLARE
    v_company_code CONSTANT VARCHAR := 'KAWIN_BROTHERS';
    v_policy_notes CONSTANT TEXT := 'KAWIN expense approval matrix 2026-08-17 (72 rules)';
    v_company_id INTEGER;
    v_version_id INTEGER;
    v_rule_count INTEGER;
BEGIN
    SELECT id INTO v_company_id FROM companies WHERE code = v_company_code;
    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'Company code % was not found', v_company_code;
    END IF;

    CREATE TEMP TABLE staging_departments(name TEXT PRIMARY KEY) ON COMMIT DROP;
    INSERT INTO staging_departments(name) VALUES
        ('Back Office'),
        ('CRM'),
        ('HR'),
        ('IT'),
        ('Marketing'),
        ('การเงิน'),
        ('บริหาร'),
        ('บัญชี');

    INSERT INTO departments(company_id, name, is_active)
    SELECT v_company_id, name, TRUE FROM staging_departments
    ON CONFLICT(company_id, name) DO UPDATE
    SET is_active = TRUE, updated_at = NOW();

    CREATE TEMP TABLE staging_positions(
        position_name TEXT PRIMARY KEY,
        department_name TEXT NOT NULL
    ) ON COMMIT DROP;
    INSERT INTO staging_positions(position_name, department_name) VALUES
        ('แม่บ้าน', 'Back Office'),
        ('Admin Sales', 'CRM'),
        ('Telesale', 'CRM'),
        ('Telesale Outbound Onsite M-F', 'CRM'),
        ('Telesale Outbound WFH', 'CRM'),
        ('Telesales Supervisor', 'CRM'),
        ('HR', 'HR'),
        ('HRD', 'HR'),
        ('HRM', 'HR'),
        ('ธุรการHR', 'HR'),
        ('ฝึกงานHR', 'HR'),
        ('Programmer', 'IT'),
        ('Admin ตอบแชท', 'Marketing'),
        ('Ads Freelance', 'Marketing'),
        ('Ads Optimizer', 'Marketing'),
        ('Audit Freelance', 'Marketing'),
        ('Content Creator', 'Marketing'),
        ('Content Marketing', 'Marketing'),
        ('Customer Service Officer', 'Marketing'),
        ('Digital Marketing Manager', 'Marketing'),
        ('Digital Marketing WFH', 'Marketing'),
        ('Graphic Designer', 'Marketing'),
        ('Live Streamer', 'Marketing'),
        ('Manager Marketing', 'Marketing'),
        ('Marketing', 'Marketing'),
        ('Marketing Officer', 'Marketing'),
        ('Marketplace', 'Marketing'),
        ('Marketplace Manager', 'Marketing'),
        ('R&D', 'Marketing'),
        ('Senior Marketplace', 'Marketing'),
        ('Supervisor Marketing', 'Marketing'),
        ('Support Marketplace', 'Marketing'),
        ('Upsell + Service', 'Marketing'),
        ('ฝึกงาน Graphic Designer', 'Marketing'),
        ('ฝึกงานDigital', 'Marketing'),
        ('ฝึกงานMarketing', 'Marketing'),
        ('หัวหน้าฝ่ายขาย (Admin Sale Supervisor)', 'Marketing'),
        ('CEO', 'บริหาร'),
        ('CFO', 'บริหาร'),
        ('CMO', 'บริหาร'),
        ('COO', 'บริหาร'),
        ('Accounting', 'บัญชี'),
        ('Finance', 'บัญชี'),
        ('Manager Accountant', 'บัญชี'),
        ('ธุระการบัญชี', 'บัญชี');

    INSERT INTO positions(company_id, name, department_id, is_active)
    SELECT v_company_id, sp.position_name, d.id, TRUE
    FROM staging_positions sp
    JOIN departments d
      ON d.company_id = v_company_id AND d.name = sp.department_name
    ON CONFLICT(company_id, name) DO UPDATE
    SET department_id = EXCLUDED.department_id,
        is_active = TRUE,
        updated_at = NOW();

    INSERT INTO expense_types(
        company_id, code, name, allowed_kinds, requires_payment_proof,
        may_require_withholding_tax, settlement_days, is_active
    ) VALUES
        (v_company_id, 'general', 'ทั่วไป', '["reimbursement","advance","direct_payment"]'::jsonb, TRUE, TRUE, 7, TRUE),
        (v_company_id, 'review_influencer', 'รีวิว/อินฟลูเอนเซอร์', '["reimbursement","advance","direct_payment"]'::jsonb, TRUE, TRUE, 7, TRUE),
        (v_company_id, 'purchase_order', 'สั่งสินค้า', '["reimbursement","advance","direct_payment"]'::jsonb, TRUE, TRUE, 7, TRUE)
    ON CONFLICT(company_id, code) DO UPDATE
    SET name = EXCLUDED.name,
        allowed_kinds = EXCLUDED.allowed_kinds,
        requires_payment_proof = EXCLUDED.requires_payment_proof,
        may_require_withholding_tax = EXCLUDED.may_require_withholding_tax,
        settlement_days = EXCLUDED.settlement_days,
        is_active = TRUE,
        updated_at = NOW();

    SELECT id INTO v_version_id
    FROM approval_policy_versions
    WHERE company_id = v_company_id AND notes = v_policy_notes;

    IF v_version_id IS NULL THEN
        INSERT INTO approval_policy_versions(company_id, version_no, status, notes)
        VALUES (
            v_company_id,
            (SELECT COALESCE(MAX(version_no), 0) + 1
             FROM approval_policy_versions WHERE company_id = v_company_id),
            'draft',
            v_policy_notes
        )
        RETURNING id INTO v_version_id;
    END IF;

    IF (SELECT status FROM approval_policy_versions WHERE id = v_version_id) <> 'draft' THEN
        RAISE EXCEPTION 'Policy % already exists and is not draft; refusing to alter an active/retired policy', v_version_id;
    END IF;

    CREATE TEMP TABLE staging_matrix(
        requester_name TEXT NOT NULL,
        expense_code TEXT NOT NULL,
        amount_min NUMERIC NOT NULL,
        amount_max NUMERIC,
        step1_name TEXT NOT NULL,
        step2_name TEXT,
        step3_name TEXT
    ) ON COMMIT DROP;

    INSERT INTO staging_matrix(
        requester_name, expense_code, amount_min, amount_max,
        step1_name, step2_name, step3_name
    ) VALUES
        ('Accounting', 'general', 0, 10000, 'Manager Accountant', NULL, NULL),
        ('Accounting', 'general', 10000, NULL, 'Manager Accountant', 'CFO', NULL),
        ('Accounting', 'purchase_order', 0, 99999, 'Manager Accountant', NULL, NULL),
        ('Accounting', 'purchase_order', 99999, 499999, 'Manager Accountant', 'CFO', NULL),
        ('Accounting', 'purchase_order', 499999, NULL, 'Manager Accountant', 'CFO', 'CEO'),
        ('Admin Sales', 'general', 0, 10000, 'COO', NULL, NULL),
        ('Admin Sales', 'general', 10000, NULL, 'COO', 'CEO', NULL),
        ('Admin ตอบแชท', 'general', 0, 10000, 'Manager Marketing', NULL, NULL),
        ('Admin ตอบแชท', 'general', 10000, NULL, 'Manager Marketing', 'CMO', NULL),
        ('Content Creator', 'general', 0, 10000, 'Supervisor Marketing', NULL, NULL),
        ('Content Creator', 'general', 10000, 25000, 'Supervisor Marketing', 'Manager Marketing', NULL),
        ('Content Creator', 'general', 25000, NULL, 'Supervisor Marketing', 'Manager Marketing', 'CMO'),
        ('Content Creator', 'review_influencer', 0, 30000, 'Supervisor Marketing', NULL, NULL),
        ('Content Creator', 'review_influencer', 30000, 60000, 'Supervisor Marketing', 'Manager Marketing', NULL),
        ('Content Creator', 'review_influencer', 60000, NULL, 'Supervisor Marketing', 'Manager Marketing', 'CMO'),
        ('Customer Service Officer', 'general', 0, 10000, 'Manager Marketing', NULL, NULL),
        ('Customer Service Officer', 'general', 10000, NULL, 'Manager Marketing', 'CMO', NULL),
        ('Digital Marketing Manager', 'general', 0, 10000, 'Manager Marketing', NULL, NULL),
        ('Digital Marketing Manager', 'general', 10000, NULL, 'Manager Marketing', 'CMO', NULL),
        ('Graphic Designer', 'general', 0, 10000, 'Supervisor Marketing', NULL, NULL),
        ('Graphic Designer', 'general', 10000, 25000, 'Supervisor Marketing', 'Manager Marketing', NULL),
        ('Graphic Designer', 'general', 25000, NULL, 'Supervisor Marketing', 'Manager Marketing', 'CMO'),
        ('Graphic Designer', 'review_influencer', 0, 30000, 'Supervisor Marketing', NULL, NULL),
        ('Graphic Designer', 'review_influencer', 30000, 60000, 'Supervisor Marketing', 'Manager Marketing', NULL),
        ('Graphic Designer', 'review_influencer', 60000, NULL, 'Supervisor Marketing', 'Manager Marketing', 'CMO'),
        ('HR', 'general', 0, 10000, 'Manager Accountant', NULL, NULL),
        ('HR', 'general', 10000, NULL, 'Manager Accountant', 'CFO', NULL),
        ('HRD', 'general', 0, 10000, 'Manager Accountant', NULL, NULL),
        ('HRD', 'general', 10000, NULL, 'Manager Accountant', 'CFO', NULL),
        ('HRM', 'general', 0, 10000, 'Manager Accountant', NULL, NULL),
        ('HRM', 'general', 10000, NULL, 'Manager Accountant', 'CFO', NULL),
        ('Manager Marketing', 'general', 0, 10000, 'CMO', NULL, NULL),
        ('Manager Marketing', 'general', 10000, 25000, 'CMO', NULL, NULL),
        ('Manager Marketing', 'general', 25000, NULL, 'CMO', 'CEO', NULL),
        ('Manager Marketing', 'review_influencer', 0, 30000, 'CMO', NULL, NULL),
        ('Manager Marketing', 'review_influencer', 30000, 60000, 'CMO', 'CEO', NULL),
        ('Manager Marketing', 'review_influencer', 60000, NULL, 'CMO', 'CEO', NULL),
        ('Marketing', 'general', 0, 10000, 'Supervisor Marketing', NULL, NULL),
        ('Marketing', 'general', 10000, 25000, 'Supervisor Marketing', 'Manager Marketing', NULL),
        ('Marketing', 'general', 25000, NULL, 'Supervisor Marketing', 'Manager Marketing', 'CMO'),
        ('Marketing', 'review_influencer', 0, 30000, 'Supervisor Marketing', NULL, NULL),
        ('Marketing', 'review_influencer', 30000, 60000, 'Supervisor Marketing', 'Manager Marketing', NULL),
        ('Marketing', 'review_influencer', 60000, NULL, 'Supervisor Marketing', 'Manager Marketing', 'CMO'),
        ('Marketplace', 'general', 0, NULL, 'Marketplace Manager', NULL, NULL),
        ('Marketplace Manager', 'general', 0, NULL, 'Manager Marketing', NULL, NULL),
        ('Programmer', 'general', 0, 10000, 'COO', NULL, NULL),
        ('Programmer', 'general', 10000, NULL, 'COO', 'CEO', NULL),
        ('R&D', 'general', 0, 10000, 'Manager Marketing', NULL, NULL),
        ('R&D', 'general', 10000, NULL, 'Manager Marketing', 'CMO', NULL),
        ('Senior Marketplace', 'general', 0, NULL, 'Marketplace Manager', NULL, NULL),
        ('Supervisor Marketing', 'general', 0, 10000, 'Manager Marketing', NULL, NULL),
        ('Supervisor Marketing', 'general', 10000, 25000, 'Manager Marketing', 'CMO', NULL),
        ('Supervisor Marketing', 'general', 25000, NULL, 'Manager Marketing', 'CMO', NULL),
        ('Supervisor Marketing', 'review_influencer', 0, 30000, 'Manager Marketing', NULL, NULL),
        ('Supervisor Marketing', 'review_influencer', 30000, 60000, 'Manager Marketing', 'CMO', NULL),
        ('Supervisor Marketing', 'review_influencer', 60000, NULL, 'Manager Marketing', 'CMO', NULL),
        ('Support Marketplace', 'general', 0, NULL, 'Marketplace Manager', NULL, NULL),
        ('Telesale', 'general', 0, 10000, 'COO', NULL, NULL),
        ('Telesale', 'general', 10000, NULL, 'COO', 'CEO', NULL),
        ('Telesale Outbound Onsite M-F', 'general', 0, 10000, 'COO', NULL, NULL),
        ('Telesale Outbound Onsite M-F', 'general', 10000, NULL, 'COO', 'CEO', NULL),
        ('Telesale Outbound WFH', 'general', 0, 10000, 'COO', NULL, NULL),
        ('Telesale Outbound WFH', 'general', 10000, NULL, 'COO', 'CEO', NULL),
        ('Telesales Supervisor', 'general', 0, 10000, 'COO', NULL, NULL),
        ('Telesales Supervisor', 'general', 10000, NULL, 'COO', 'CEO', NULL),
        ('ธุระการบัญชี', 'general', 0, 10000, 'Accounting', NULL, NULL),
        ('ธุระการบัญชี', 'general', 10000, NULL, 'Accounting', 'Manager Accountant', NULL),
        ('ธุระการบัญชี', 'purchase_order', 0, 99999, 'Accounting', 'Manager Accountant', NULL),
        ('ธุระการบัญชี', 'purchase_order', 99999, 499999, 'Accounting', 'Manager Accountant', 'CFO'),
        ('ธุระการบัญชี', 'purchase_order', 499999, NULL, 'Manager Accountant', 'CFO', 'CEO'),
        ('แม่บ้าน', 'general', 0, 10000, 'Manager Accountant', NULL, NULL),
        ('แม่บ้าน', 'general', 10000, NULL, 'Manager Accountant', 'CFO', NULL);

    SELECT COUNT(*) INTO v_rule_count FROM staging_matrix;
    IF v_rule_count <> 72 THEN
        RAISE EXCEPTION 'Expected 72 staged approval rules, found %', v_rule_count;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM staging_matrix sm
        CROSS JOIN LATERAL (
            VALUES (sm.requester_name), (sm.step1_name), (sm.step2_name), (sm.step3_name)
        ) AS required_position(name)
        WHERE required_position.name IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM positions p
              WHERE p.company_id = v_company_id
                AND p.name = required_position.name
          )
    ) THEN
        RAISE EXCEPTION 'At least one approval-rule position could not be resolved';
    END IF;

    INSERT INTO approval_rules(
        policy_version_id, requester_position_id, expense_type_id, amount_range
    )
    SELECT v_version_id, requester.id, expense_type.id,
           numrange(sm.amount_min, sm.amount_max, '(]')
    FROM staging_matrix sm
    JOIN positions requester
      ON requester.company_id = v_company_id AND requester.name = sm.requester_name
    JOIN expense_types expense_type
      ON expense_type.company_id = v_company_id AND expense_type.code = sm.expense_code
    WHERE NOT EXISTS (
        SELECT 1 FROM approval_rules existing
        WHERE existing.policy_version_id = v_version_id
          AND existing.requester_position_id = requester.id
          AND existing.expense_type_id = expense_type.id
          AND existing.amount_range = numrange(sm.amount_min, sm.amount_max, '(]')
    );

    INSERT INTO approval_rule_steps(approval_rule_id, step_no, approver_position_id)
    SELECT rule.id, step.step_no, approver.id
    FROM staging_matrix sm
    JOIN positions requester
      ON requester.company_id = v_company_id AND requester.name = sm.requester_name
    JOIN expense_types expense_type
      ON expense_type.company_id = v_company_id AND expense_type.code = sm.expense_code
    JOIN approval_rules rule
      ON rule.policy_version_id = v_version_id
     AND rule.requester_position_id = requester.id
     AND rule.expense_type_id = expense_type.id
     AND rule.amount_range = numrange(sm.amount_min, sm.amount_max, '(]')
    CROSS JOIN LATERAL (
        VALUES (1, sm.step1_name), (2, sm.step2_name), (3, sm.step3_name)
    ) AS step(step_no, position_name)
    JOIN positions approver
      ON approver.company_id = v_company_id AND approver.name = step.position_name
    WHERE NOT EXISTS (
        SELECT 1 FROM approval_rule_steps existing
        WHERE existing.approval_rule_id = rule.id
          AND existing.step_no = step.step_no
    );

    SELECT COUNT(*) INTO v_rule_count
    FROM approval_rules WHERE policy_version_id = v_version_id;
    IF v_rule_count <> 72 THEN
        RAISE EXCEPTION 'Expected policy % to contain 72 rules, found %', v_version_id, v_rule_count;
    END IF;

    DROP TABLE staging_matrix;
    DROP TABLE staging_positions;
    DROP TABLE staging_departments;

    RAISE NOTICE 'Seeded company %, policy id % (draft), 8 departments, 45 positions, 72 rules',
        v_company_code, v_version_id;
END $$;
