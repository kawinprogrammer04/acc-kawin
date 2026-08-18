<?php
/**
 * Export one HR finance request for a replay-safe ACC import.
 *
 * The HR connection is strictly read-only. The only write performed by this
 * script is the JSON file below /private/tmp supplied by the caller.
 *
 * Usage:
 *   HR_DB_PASSWORD=... php scripts/export_hr_expense_request_json.php 13931 /private/tmp/request.json
 */

$password = getenv('HR_DB_PASSWORD');
$requestId = filter_var($argv[1] ?? null, FILTER_VALIDATE_INT);
$outputPath = $argv[2] ?? '';
if ($password === false || $password === '' || $requestId === false || $requestId === null
    || !str_starts_with($outputPath, '/private/tmp/')) {
    fwrite(STDERR, "HR_DB_PASSWORD, a numeric request id, and an output path under /private/tmp are required\n");
    exit(2);
}

$pdo = new PDO(
    'mysql:host=212.80.214.52;port=3306;dbname=kawin_hr;charset=utf8mb4',
    'kawin_select',
    $password,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);

$requestStatement = $pdo->prepare(<<<'SQL'
SELECT
    er.id AS hr_expense_request_id,
    er.request_number,
    er.request_kind,
    er.status,
    er.current_revision,
    ert.code AS expense_type_code,
    requester.id AS requester_id,
    requester.employee_id AS requester_employee_code,
    er.requester_name,
    COALESCE(request_position.name, current_position.name) AS requester_position_name,
    COALESCE(er.department_name, request_department.name, current_department.name) AS department_name,
    COALESCE(er.company_name, request_company.name) AS company_name,
    er.purpose,
    er.required_date,
    er.payee_type,
    er.payee_name,
    er.bank_name,
    er.bank_account_name,
    er.gross_amount,
    er.discount_amount,
    er.estimated_vat_amount,
    er.withholding_tax_rate,
    er.withholding_tax_amount,
    er.net_amount,
    er.submitted_at,
    er.approved_at,
    er.paid_at,
    er.settlement_due_at,
    er.completed_at,
    er.created_at,
    er.updated_at
FROM expense_requests er
INNER JOIN expense_request_types ert ON ert.id = er.expense_request_type_id
INNER JOIN users requester ON requester.id = er.requester_id
LEFT JOIN positions request_position ON request_position.id = er.requester_position_id
LEFT JOIN positions current_position ON current_position.id = requester.position_id
LEFT JOIN departments request_department ON request_department.id = er.department_id
LEFT JOIN departments current_department ON current_department.id = requester.department_id
LEFT JOIN companies request_company ON request_company.id = er.company_id
WHERE er.id = :request_id AND er.deleted_at IS NULL
SQL);
$requestStatement->execute(['request_id' => $requestId]);
$request = $requestStatement->fetch();
if (!$request) {
    fwrite(STDERR, "Expense request not found\n");
    exit(1);
}

$itemStatement = $pdo->prepare(<<<'SQL'
SELECT id AS source_item_id, revision, description, quantity, unit, unit_price,
       line_total, sort_order, created_at
FROM expense_request_items
WHERE expense_request_id = :request_id
  AND revision = :revision
ORDER BY sort_order, id
SQL);
$itemStatement->execute([
    'request_id' => $requestId,
    'revision' => $request['current_revision'],
]);

$approvalStatement = $pdo->prepare(<<<'SQL'
SELECT step.id AS source_step_id, step.step_order, step.name,
       step.status AS step_status, step.activated_at, step.completed_at,
       approver.user_id, approver.status AS approver_status,
       approver.comments, approver.acted_at
FROM expense_approval_chains chain
INNER JOIN expense_approval_steps step
        ON step.expense_approval_chain_id = chain.id
LEFT JOIN expense_approval_approvers approver
       ON approver.expense_approval_step_id = step.id
WHERE chain.expense_request_id = :request_id
  AND chain.revision = :revision
ORDER BY step.step_order, approver.id
SQL);
$approvalStatement->execute([
    'request_id' => $requestId,
    'revision' => $request['current_revision'],
]);

$payload = [
    'generated_at' => gmdate(DATE_ATOM),
    'request' => $request,
    'items' => $itemStatement->fetchAll(),
    'approval_steps' => $approvalStatement->fetchAll(),
];
file_put_contents(
    $outputPath,
    json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR)."\n",
    LOCK_EX,
);
fwrite(STDERR, sprintf("Exported request %d with %d items and %d approval rows\n", $requestId, count($payload['items']), count($payload['approval_steps'])));
