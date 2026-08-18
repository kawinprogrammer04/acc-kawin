<?php
/**
 * Read-only audit of the HR finance source database.
 *
 * Usage:
 *   HR_DB_PASSWORD='...' php scripts/audit_hr_finance_source.php
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

function scalar(PDO $pdo, string $sql): int
{
    return (int) $pdo->query($sql)->fetchColumn();
}

$result = [
    'requests_2026' => scalar($pdo, "SELECT COUNT(*) FROM expense_requests WHERE deleted_at IS NULL AND created_at >= '2026-01-01' AND created_at < '2027-01-01'"),
    'requests_with_bank_ciphertext' => scalar($pdo, "SELECT COUNT(*) FROM expense_requests WHERE deleted_at IS NULL AND created_at >= '2026-01-01' AND created_at < '2027-01-01' AND bank_account_number IS NOT NULL"),
    'requests_with_generated_pdf' => scalar($pdo, "SELECT COUNT(DISTINCT expense_request_id) FROM expense_approval_chains WHERE request_pdf_path IS NOT NULL"),
    'requests_with_signed_pdf' => scalar($pdo, "SELECT COUNT(DISTINCT expense_request_id) FROM expense_approval_chains WHERE signed_request_pdf_path IS NOT NULL"),
    'attachment_rows' => scalar($pdo, "SELECT COUNT(*) FROM expense_request_attachments"),
    'active_attachment_rows' => scalar($pdo, "SELECT COUNT(*) FROM expense_request_attachments WHERE is_active = 1"),
    'requests_with_active_attachments' => scalar($pdo, "SELECT COUNT(DISTINCT expense_request_id) FROM expense_request_attachments WHERE is_active = 1"),
    'payments_with_proof' => scalar($pdo, "SELECT COUNT(*) FROM expense_payments WHERE proof_path IS NOT NULL"),
    'active_policies' => scalar($pdo, "SELECT COUNT(*) FROM expense_approval_policies WHERE is_active = 1"),
];

$result['policy_target_types'] = $pdo->query(<<<'SQL'
SELECT s.target_type, COUNT(DISTINCT p.id) AS policies, COUNT(*) AS steps
FROM expense_approval_policies p
JOIN expense_approval_policy_steps s ON s.expense_approval_policy_id = p.id
WHERE p.is_active = 1
GROUP BY s.target_type
ORDER BY s.target_type
SQL)->fetchAll();

$result['policy_scopes'] = $pdo->query(<<<'SQL'
SELECT
    SUM(company_id IS NULL) AS global_company,
    SUM(company_id IS NOT NULL) AS company_specific,
    SUM(department_id IS NOT NULL AND requester_position_id IS NULL) AS department_wide,
    SUM(requester_position_id IS NOT NULL) AS position_specific,
    SUM(expense_request_type_id IS NULL) AS expense_type_wildcard,
    SUM(request_kind IS NOT NULL) AS request_kind_specific
FROM expense_approval_policies
WHERE is_active = 1
SQL)->fetch();

$result['policy_step_modes'] = $pdo->query(<<<'SQL'
SELECT approve_mode, COUNT(*) AS steps
FROM expense_approval_policy_steps s
JOIN expense_approval_policies p ON p.id = s.expense_approval_policy_id
WHERE p.is_active = 1
GROUP BY approve_mode
ORDER BY approve_mode
SQL)->fetchAll();

$result['latest_source_update'] = $pdo->query(
    "SELECT MAX(updated_at) FROM expense_approval_policies WHERE is_active = 1"
)->fetchColumn();

// When local PostgreSQL credentials are available, report source requests
// which have not been imported yet without changing either database.
if (getenv('POSTGRES_PASSWORD')) {
    $pg = new PDO(
        'pgsql:host=127.0.0.1;port=5432;dbname='.(getenv('POSTGRES_DB') ?: 'accounting_db'),
        getenv('POSTGRES_USER') ?: 'postgres', getenv('POSTGRES_PASSWORD'),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    $mapped = array_flip($pg->query('SELECT hr_expense_request_id FROM hr_expense_request_import_map')->fetchAll(PDO::FETCH_COLUMN));
    $sourceRows = $pdo->query("SELECT id, request_number FROM expense_requests WHERE deleted_at IS NULL AND created_at >= '2026-01-01' AND created_at < '2027-01-01' ORDER BY id")->fetchAll();
    $result['not_imported'] = array_values(array_filter($sourceRows, fn ($row) => !isset($mapped[$row['id']])));
}

echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR), "\n";
