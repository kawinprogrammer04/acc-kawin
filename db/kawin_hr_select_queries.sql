-- Read-only queries for the kawin_hr MariaDB database.
-- No password hash from kawin_hr.users is selected.
--
-- Important mapping note:
--   hr_*_id values belong to kawin_hr only. Do not insert those IDs directly
--   into the accounting database. Map company/department/position by name (or
--   maintain an explicit cross-system mapping table) before creating users.

USE kawin_hr;

-- ============================================================================
-- 1) Users ready for accounting-system user creation
-- ============================================================================
-- Set to NULL for every eligible employee, or to one employee code.
SET @employee_code = NULL;
-- Example:
-- SET @employee_code = 'EMP0001';

SELECT
    u.id AS hr_user_id,
    TRIM(u.employee_id) AS username,
    TRIM(u.employee_id) AS initial_password,
    COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', u.title_name, u.thai_first_name, u.thai_last_name)), ''),
        NULLIF(TRIM(u.name), '')
    ) AS full_name,
    COALESCE(
        NULLIF(TRIM(u.company_email), ''),
        NULLIF(TRIM(u.email), ''),
        NULLIF(TRIM(u.personal_email), '')
    ) AS email,
    u.phone,
    u.company_id AS hr_company_id,
    c.name AS company_name,
    COALESCE(direct_department.id, primary_position_department.id) AS hr_department_id,
    COALESCE(direct_department.name, primary_position_department.name) AS department_name,
    position_list.hr_position_ids,
    position_list.position_names,
    u.employee_type,
    u.hire_date,
    u.status AS hr_user_status,
    u.employment_status
FROM users AS u
LEFT JOIN companies AS c
    ON c.id = u.company_id
LEFT JOIN departments AS direct_department
    ON direct_department.id = u.department_id
   AND direct_department.deleted_at IS NULL
LEFT JOIN position_user AS primary_position_link
    ON primary_position_link.user_id = u.id
   AND primary_position_link.is_primary = 1
LEFT JOIN positions AS primary_position
    ON primary_position.id = COALESCE(u.position_id, primary_position_link.position_id)
   AND primary_position.deleted_at IS NULL
LEFT JOIN departments AS primary_position_department
    ON primary_position_department.id = primary_position.department_id
   AND primary_position_department.deleted_at IS NULL
LEFT JOIN (
    SELECT
        employee_positions.user_id,
        GROUP_CONCAT(
            employee_positions.position_id
            ORDER BY employee_positions.is_primary DESC, p.name
            SEPARATOR ','
        ) AS hr_position_ids,
        GROUP_CONCAT(
            p.name
            ORDER BY employee_positions.is_primary DESC, p.name
            SEPARATOR ' | '
        ) AS position_names
    FROM (
        SELECT
            combined.user_id,
            combined.position_id,
            MAX(combined.is_primary) AS is_primary
        FROM (
            SELECT id AS user_id, position_id, 1 AS is_primary
            FROM users
            WHERE position_id IS NOT NULL

            UNION ALL

            SELECT user_id, position_id, is_primary
            FROM position_user
        ) AS combined
        GROUP BY combined.user_id, combined.position_id
    ) AS employee_positions
    INNER JOIN positions AS p
        ON p.id = employee_positions.position_id
       AND p.status = 'active'
       AND p.deleted_at IS NULL
    GROUP BY employee_positions.user_id
) AS position_list
    ON position_list.user_id = u.id
WHERE u.deleted_at IS NULL
  AND u.status = 'active'
  AND u.employment_status = 'คงอยู่'
  AND u.employee_id IS NOT NULL
  AND TRIM(u.employee_id) <> ''
  AND (@employee_code IS NULL OR TRIM(u.employee_id) = TRIM(@employee_code))
ORDER BY TRIM(u.employee_id);

-- Notes for creating the user in the accounting system:
--   username       = username from this result
--   password       = initial_password from this result (send through the API so
--                    the accounting app hashes it; never insert plain text into
--                    users.password_hash)
--   email/full_name = values from this result
--   department_id  = the accounting department ID matched by department_name
--   position_ids   = accounting position IDs matched by position_names


-- ============================================================================
-- 2) Expense-request summary (one row per request)
-- ============================================================================
-- Inclusive dates based on expense_requests.created_at. Set either value to NULL
-- to leave that side unbounded.
SET @date_from = '2026-01-01';
SET @date_to   = '2026-12-31';
SET @request_status = NULL;
-- Examples: 'draft', 'pending_approval', 'accounting_review', 'ready_to_pay',
--           'settlement_due', 'completed', 'rejected', 'cancelled'

SELECT
    er.id AS hr_expense_request_id,
    er.request_number,
    er.request_kind,
    CASE er.request_kind
        WHEN 'advance' THEN 'เงินทดรองจ่าย'
        WHEN 'reimbursement' THEN 'เบิกคืน'
        WHEN 'direct_payment' THEN 'จ่ายตรง'
        ELSE er.request_kind
    END AS request_kind_name,
    er.status,
    ert.code AS expense_type_code,
    ert.name AS expense_type_name,
    requester.employee_id AS requester_employee_code,
    er.requester_name,
    requester.email AS requester_email,
    COALESCE(request_position.name, current_position.name) AS requester_position_name,
    COALESCE(er.department_name, request_department.name, current_department.name) AS department_name,
    COALESCE(er.company_name, request_company.name) AS company_name,
    er.purpose,
    er.required_date,
    er.payee_type,
    er.payee_name,
    er.bank_name,
    er.bank_account_name,
    er.bank_account_number,
    er.gross_amount,
    er.discount_amount,
    er.estimated_vat_amount,
    er.withholding_tax_rate,
    er.withholding_tax_amount,
    er.net_amount,
    current_items.item_count,
    current_items.items_total,
    payments.payment_count,
    payments.paid_gross_amount,
    payments.paid_vat_amount,
    payments.paid_withholding_tax_amount,
    payments.paid_net_amount,
    payments.last_paid_date,
    payments.payment_references,
    settlement.actual_amount AS settlement_actual_amount,
    settlement.balance_type AS settlement_balance_type,
    settlement.balance_amount AS settlement_balance_amount,
    settlement.submitted_at AS settlement_submitted_at,
    settlement.verified_at AS settlement_verified_at,
    er.submitted_at,
    er.approved_at,
    er.paid_at,
    er.settlement_due_at,
    er.completed_at,
    er.created_at,
    er.updated_at
FROM expense_requests AS er
INNER JOIN expense_request_types AS ert
    ON ert.id = er.expense_request_type_id
INNER JOIN users AS requester
    ON requester.id = er.requester_id
LEFT JOIN positions AS request_position
    ON request_position.id = er.requester_position_id
LEFT JOIN positions AS current_position
    ON current_position.id = requester.position_id
LEFT JOIN departments AS request_department
    ON request_department.id = er.department_id
LEFT JOIN departments AS current_department
    ON current_department.id = requester.department_id
LEFT JOIN companies AS request_company
    ON request_company.id = er.company_id
LEFT JOIN (
    SELECT
        eri.expense_request_id,
        eri.revision,
        COUNT(*) AS item_count,
        SUM(eri.line_total) AS items_total
    FROM expense_request_items AS eri
    GROUP BY eri.expense_request_id, eri.revision
) AS current_items
    ON current_items.expense_request_id = er.id
   AND current_items.revision = er.current_revision
LEFT JOIN (
    SELECT
        ep.expense_request_id,
        COUNT(*) AS payment_count,
        SUM(ep.gross_amount) AS paid_gross_amount,
        SUM(ep.vat_amount) AS paid_vat_amount,
        SUM(ep.withholding_tax_amount) AS paid_withholding_tax_amount,
        SUM(ep.net_amount) AS paid_net_amount,
        MAX(ep.paid_date) AS last_paid_date,
        GROUP_CONCAT(
            NULLIF(TRIM(ep.reference_number), '')
            ORDER BY ep.paid_date, ep.id
            SEPARATOR ' | '
        ) AS payment_references
    FROM expense_payments AS ep
    GROUP BY ep.expense_request_id
) AS payments
    ON payments.expense_request_id = er.id
LEFT JOIN expense_settlements AS settlement
    ON settlement.expense_request_id = er.id
WHERE er.deleted_at IS NULL
  AND (@date_from IS NULL OR er.created_at >= @date_from)
  AND (@date_to IS NULL OR er.created_at < DATE_ADD(@date_to, INTERVAL 1 DAY))
  AND (@request_status IS NULL OR er.status = @request_status)
ORDER BY er.created_at DESC, er.id DESC;


-- ============================================================================
-- 3) Current expense items (one row per item)
-- ============================================================================
SET @request_number = NULL;
-- Example: SET @request_number = 'EXP-2026-0001';

SELECT
    er.request_number,
    er.status,
    er.requester_name,
    er.current_revision,
    eri.id AS hr_expense_item_id,
    eri.sort_order,
    eri.description,
    eri.quantity,
    eri.unit,
    eri.unit_price,
    eri.line_total
FROM expense_requests AS er
INNER JOIN expense_request_items AS eri
    ON eri.expense_request_id = er.id
   AND eri.revision = er.current_revision
WHERE er.deleted_at IS NULL
  AND (@request_number IS NULL OR er.request_number = @request_number)
ORDER BY er.created_at DESC, er.request_number, eri.sort_order, eri.id;


-- ============================================================================
-- 4) Approval trail for an expense request
-- ============================================================================
SET @approval_request_number = NULL;
-- Example: SET @approval_request_number = 'EXP-2026-0001';

SELECT
    er.request_number,
    chain.revision,
    chain.chain_no,
    chain.status AS chain_status,
    step.step_order,
    step.name AS approval_step_name,
    step.status AS step_status,
    approver_user.employee_id AS approver_employee_code,
    approver_user.name AS approver_name,
    approver.status AS approver_status,
    approver.comments,
    approver.acted_at
FROM expense_requests AS er
INNER JOIN expense_approval_chains AS chain
    ON chain.expense_request_id = er.id
INNER JOIN expense_approval_steps AS step
    ON step.expense_approval_chain_id = chain.id
LEFT JOIN expense_approval_approvers AS approver
    ON approver.expense_approval_step_id = step.id
LEFT JOIN users AS approver_user
    ON approver_user.id = approver.user_id
WHERE er.deleted_at IS NULL
  AND (@approval_request_number IS NULL OR er.request_number = @approval_request_number)
ORDER BY er.created_at DESC, er.request_number, chain.revision, chain.chain_no,
         step.step_order, approver.id;
