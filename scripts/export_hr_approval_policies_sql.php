<?php
/** Export active HR finance approval policies as an atomic PostgreSQL sync. */
$password = getenv('HR_DB_PASSWORD');
if (!$password) { fwrite(STDERR, "HR_DB_PASSWORD is required\n"); exit(2); }
$pdo = new PDO('mysql:host=212.80.214.52;port=3306;dbname=kawin_hr;charset=utf8mb4',
    'kawin_select', $password,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);

$rows = $pdo->query(<<<'SQL'
SELECT p.id policy_id, p.name policy_name, c.name company_name, d.name department_name,
       rp.name requester_position_name, et.code expense_type_code, et.name expense_type_name,
       p.request_kind, p.minimum_amount, p.maximum_amount, p.priority,
       s.id step_id, s.step_order, s.name step_name, s.target_type,
       s.target_id, s.approve_mode, tp.name target_position_name,
       COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.title_name, u.thai_first_name, u.thai_last_name)), ''), u.name) target_user_name
FROM expense_approval_policies p
JOIN expense_approval_policy_steps s ON s.expense_approval_policy_id=p.id
LEFT JOIN companies c ON c.id=p.company_id
LEFT JOIN departments d ON d.id=p.department_id
LEFT JOIN positions rp ON rp.id=p.requester_position_id
LEFT JOIN expense_request_types et ON et.id=p.expense_request_type_id
LEFT JOIN positions tp ON s.target_type='position' AND tp.id=s.target_id
LEFT JOIN users u ON s.target_type='user' AND u.id=s.target_id
WHERE p.is_active=1
ORDER BY p.id,s.step_order
SQL)->fetchAll();

function lit($v): string { return $v === null ? 'NULL' : "'".str_replace("'", "''", (string)$v)."'"; }

echo "BEGIN;\n";
echo <<<'SQL'
CREATE TEMP TABLE hr_policy_stage(
 policy_id bigint, policy_name text, company_name text, department_name text, requester_position_name text,
 expense_type_code text, expense_type_name text, request_kind text, minimum_amount numeric, maximum_amount numeric,
 priority int, step_id bigint, step_order int, step_name text, target_type text,
 target_id bigint, approve_mode text, target_position_name text, target_user_name text
) ON COMMIT DROP;
SQL;
foreach ($rows as $r) {
    $vals=[];
    foreach (['policy_id','policy_name','company_name','department_name','requester_position_name','expense_type_code','expense_type_name','request_kind','minimum_amount','maximum_amount','priority','step_id','step_order','step_name','target_type','target_id','approve_mode','target_position_name','target_user_name'] as $k) $vals[]=lit($r[$k]);
    echo "INSERT INTO hr_policy_stage VALUES (".implode(',', $vals).");\n";
}
echo <<<'SQL'

-- ACC's finance request form supports these three kinds. HR's two standalone
-- OT/allowance policies remain in HR because they are not finance-menu requests.
CREATE TEMP TABLE hr_policy_expanded ON COMMIT DROP AS
SELECT DISTINCT s.policy_id,s.policy_name,s.request_kind,s.minimum_amount,s.maximum_amount,
       s.priority,
       ((s.department_name IS NOT NULL)::int + (s.requester_position_name IS NOT NULL)::int
        + (s.expense_type_code IS NOT NULL)::int + (s.request_kind IS NOT NULL)::int)::smallint specificity,
       rp.id requester_position_id, et.id expense_type_id,
       ('hr:' || s.policy_id::text) logical_group_key,
       jsonb_build_object(
         'company_name',s.company_name,
         'department_name',s.department_name,
         'requester_position_name',s.requester_position_name,
         'expense_type_code',s.expense_type_code,
         'expense_type_name',s.expense_type_name,
         'request_kind',s.request_kind
       ) source_scope
FROM hr_policy_stage s
JOIN positions rp ON rp.company_id=1 AND rp.is_active
 AND ((s.requester_position_name IS NOT NULL AND rp.name=s.requester_position_name)
   OR (s.requester_position_name IS NULL AND s.department_name IS NOT NULL
       AND rp.department_id=(SELECT id FROM departments WHERE company_id=1 AND name=s.department_name LIMIT 1)))
JOIN expense_types et ON et.company_id=1 AND et.is_active
 AND (s.expense_type_code IS NULL OR et.code=CASE s.expense_type_code
      WHEN 'GENERAL' THEN 'general'
      WHEN 'REVIEW_INFLUENCER' THEN 'review_influencer'
      WHEN 'PURCHASE' THEN 'purchase_order'
      ELSE lower(s.expense_type_code) END)
WHERE s.request_kind IS NULL OR s.request_kind IN ('reimbursement','advance','direct_payment');

DO $$
DECLARE expected int; expanded int; bad_targets int;
BEGIN
  SELECT count(DISTINCT policy_id) INTO expected FROM hr_policy_stage
   WHERE request_kind IS NULL OR request_kind IN ('reimbursement','advance','direct_payment');
  SELECT count(DISTINCT policy_id) INTO expanded FROM hr_policy_expanded;
  IF expected <> expanded THEN
    RAISE EXCEPTION 'HR policy mapping incomplete: expected %, mapped %', expected, expanded;
  END IF;
  SELECT count(*) INTO bad_targets FROM hr_policy_stage s
   WHERE (s.request_kind IS NULL OR s.request_kind IN ('reimbursement','advance','direct_payment'))
     AND ((s.target_type='position' AND NOT EXISTS(SELECT 1 FROM positions p WHERE p.company_id=1 AND p.name=s.target_position_name))
       OR (s.target_type='user' AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=s.target_id AND u.is_active))
       OR s.target_type NOT IN ('position','user'));
  IF bad_targets > 0 THEN RAISE EXCEPTION 'HR approver target mapping incomplete: % step(s)', bad_targets; END IF;
END $$;

WITH next_version AS (
  SELECT COALESCE(max(version_no),0)+1 version_no FROM approval_policy_versions WHERE company_id=1
)
INSERT INTO approval_policy_versions(company_id,version_no,status,effective_from,notes,created_at,updated_at)
SELECT 1,version_no,'draft',current_date,
       'ซิงก์กฎอนุมัติจาก kawin_hr ปัจจุบัน (เฉพาะ policy ที่มีขั้นตอนและรองรับเมนูการเงิน)',now(),now()
FROM next_version;

CREATE TEMP TABLE new_policy_version ON COMMIT DROP AS
SELECT id FROM approval_policy_versions WHERE company_id=1 AND status='draft'
ORDER BY version_no DESC LIMIT 1;

INSERT INTO approval_rules(policy_version_id,requester_position_id,expense_type_id,amount_range,
 source_system,source_policy_id,source_policy_name,logical_group_key,source_scope,
 priority,specificity,request_kind)
SELECT v.id,e.requester_position_id,e.expense_type_id,
       numrange(e.minimum_amount,e.maximum_amount,'[]'),
       'hr',e.policy_id,e.policy_name,e.logical_group_key,e.source_scope,
       e.priority,e.specificity,e.request_kind
FROM hr_policy_expanded e CROSS JOIN new_policy_version v;

INSERT INTO approval_rule_steps(approval_rule_id,step_no,approver_position_id,name,approve_mode,target_type,target_user_id)
SELECT r.id,s.step_order,
       CASE WHEN s.target_type='position' THEN p.id END,
       s.step_name,COALESCE(s.approve_mode,'any'),
       CASE WHEN s.target_type='position' THEN 'hr_position' ELSE 'user' END,
       CASE WHEN s.target_type='user' THEN s.target_id::int END
FROM approval_rules r
JOIN new_policy_version v ON v.id=r.policy_version_id
JOIN hr_policy_stage s ON s.policy_id=r.source_policy_id
LEFT JOIN positions p ON p.company_id=1 AND p.name=s.target_position_name
WHERE s.request_kind IS NULL OR s.request_kind IN ('reimbursement','advance','direct_payment');

-- Keep old versions for historical requests; only switch which version is active.
UPDATE approval_policy_versions SET status='retired',updated_at=now()
WHERE company_id=1 AND status='active';
UPDATE approval_policy_versions SET status='active',updated_at=now()
WHERE id=(SELECT id FROM new_policy_version);
COMMIT;
SQL;
fwrite(STDERR, 'Exported '.count($rows)." HR policy steps\n");
