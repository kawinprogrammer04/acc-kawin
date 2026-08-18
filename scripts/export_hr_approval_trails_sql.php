<?php
/**
 * Export current HR approval trails as idempotent PostgreSQL upserts.
 *
 * Usage:
 *   HR_DB_PASSWORD=... php scripts/export_hr_approval_trails_sql.php |
 *     docker compose exec -T db psql -U postgres -d accounting_db
 *
 * The target SELECT joins hr_expense_request_import_map, so HR requests which
 * have not been imported into ACC are ignored. No HR data is modified.
 */

$password = getenv('HR_DB_PASSWORD');
if ($password === false || $password === '') {
    fwrite(STDERR, "HR_DB_PASSWORD is required\n");
    exit(2);
}

$pdo = new PDO(
    'mysql:host=212.80.214.52;port=3306;dbname=kawin_hr;charset=utf8mb4',
    'kawin_select',
    $password,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);

$sql = <<<'SQL'
SELECT
    er.id AS hr_expense_request_id,
    er.current_revision,
    step.id AS source_step_id,
    step.step_order,
    step.name AS step_name,
    step.approve_mode,
    step.status AS step_status,
    step.activated_at,
    step.completed_at,
    approver.user_id,
    COALESCE(NULLIF(TRIM(user.name), ''), NULLIF(TRIM(CONCAT_WS(' ', user.title_name, user.thai_first_name, user.thai_last_name)), '')) AS approver_name,
    position.name AS position_name,
    approver.status AS approver_status,
    approver.comments,
    approver.acted_at
FROM expense_requests er
INNER JOIN expense_approval_chains chain
    ON chain.expense_request_id = er.id
   AND chain.revision = er.current_revision
INNER JOIN expense_approval_steps step
    ON step.expense_approval_chain_id = chain.id
LEFT JOIN expense_approval_approvers approver
    ON approver.expense_approval_step_id = step.id
LEFT JOIN users user ON user.id = approver.user_id
LEFT JOIN positions position ON position.id = user.position_id
WHERE er.deleted_at IS NULL
  AND er.created_at >= '2026-01-01'
  AND er.created_at < '2027-01-01'
ORDER BY er.id, step.step_order, approver.id
SQL;

function pgLiteral(?string $value): string
{
    if ($value === null) return 'NULL';
    return "'".str_replace("'", "''", $value)."'";
}

$steps = [];
foreach ($pdo->query($sql) as $row) {
    $key = $row['hr_expense_request_id'].'/'.$row['current_revision'].'/'.$row['step_order'];
    if (!isset($steps[$key])) {
        $steps[$key] = [
            'request_id' => (int) $row['hr_expense_request_id'],
            'revision' => (int) $row['current_revision'],
            'source_step_id' => (int) $row['source_step_id'],
            'step_no' => (int) $row['step_order'],
            'name' => $row['step_name'],
            'approve_mode' => $row['approve_mode'] ?: 'any',
            'status' => $row['step_status'],
            'activated_at' => $row['activated_at'],
            'completed_at' => $row['completed_at'],
            'approvers' => [],
        ];
    }
    if ($row['user_id'] !== null) {
        $steps[$key]['approvers'][] = [
            'user_id' => (int) $row['user_id'],
            'name' => $row['approver_name'],
            'position_name' => $row['position_name'],
            'status' => $row['approver_status'],
            'comments' => $row['comments'],
            'acted_at' => $row['acted_at'],
        ];
    }
}

echo "BEGIN;\n";
foreach ($steps as $step) {
    $approvers = json_encode($step['approvers'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    echo "INSERT INTO expense_request_legacy_approval_steps (company_id, expense_request_id, source_step_id, revision, step_no, name, approve_mode, status, approvers, activated_at, completed_at, updated_at)\n";
    echo "SELECT r.company_id, m.expense_request_id, {$step['source_step_id']}, {$step['revision']}, {$step['step_no']}, ".pgLiteral($step['name']).", ".pgLiteral($step['approve_mode']).", ".pgLiteral($step['status']).", ".pgLiteral($approvers)."::jsonb, ".pgLiteral($step['activated_at'])."::timestamptz, ".pgLiteral($step['completed_at'])."::timestamptz, now() FROM hr_expense_request_import_map m JOIN expense_requests r ON r.id = m.expense_request_id WHERE m.hr_expense_request_id = {$step['request_id']} ON CONFLICT (expense_request_id, revision, step_no) DO UPDATE SET source_step_id=EXCLUDED.source_step_id, name=EXCLUDED.name, approve_mode=EXCLUDED.approve_mode, status=EXCLUDED.status, approvers=EXCLUDED.approvers, activated_at=EXCLUDED.activated_at, completed_at=EXCLUDED.completed_at, updated_at=now();\n";
}
echo "COMMIT;\n";
fwrite(STDERR, 'Exported '.count($steps)." HR approval steps\n");
