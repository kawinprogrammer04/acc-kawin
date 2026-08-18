<?php
/**
 * Read-only audit of one HR expense request and its current approval trail.
 *
 * Usage:
 *   HR_DB_PASSWORD=... php scripts/audit_hr_expense_request.php 13868
 */

$password = getenv('HR_DB_PASSWORD');
$requestId = filter_var($argv[1] ?? null, FILTER_VALIDATE_INT);
if ($password === false || $password === '' || $requestId === false || $requestId === null) {
    fwrite(STDERR, "HR_DB_PASSWORD and a numeric expense request id are required\n");
    exit(2);
}

$pdo = new PDO(
    'mysql:host=212.80.214.52;port=3306;dbname=kawin_hr;charset=utf8mb4',
    'kawin_select',
    $password,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);

$statement = $pdo->prepare(<<<'SQL'
SELECT
    er.id,
    er.request_number,
    er.current_revision,
    step.id AS source_step_id,
    step.step_order,
    step.name AS step_name,
    step.status AS step_status,
    step.activated_at,
    step.completed_at,
    approver.user_id,
    user.employee_id,
    user.name AS hr_display_name,
    COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', user.title_name, user.thai_first_name, user.thai_last_name)), ''),
        user.name
    ) AS approver_name,
    position.id AS position_id,
    position.name AS position_name,
    user.status AS user_status,
    user.deleted_at AS user_deleted_at,
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
WHERE er.id = :request_id
  AND er.deleted_at IS NULL
ORDER BY step.step_order, approver.id
SQL);
$statement->execute(['request_id' => $requestId]);
$approvalSteps = $statement->fetchAll();

$documentStatement = $pdo->prepare(<<<'SQL'
SELECT request_pdf_path, request_pdf_hash, signed_request_pdf_path
FROM expense_requests
WHERE id = :request_id AND deleted_at IS NULL
SQL);
$documentStatement->execute(['request_id' => $requestId]);

$attachmentStatement = $pdo->prepare(<<<'SQL'
SELECT
    id,
    expense_attachment_requirement_id,
    revision,
    category,
    original_name,
    file_path,
    latest_signed_path,
    mime_type,
    file_size,
    sha256,
    requires_signature,
    is_active,
    uploaded_by,
    created_at,
    updated_at
FROM expense_request_attachments
WHERE expense_request_id = :request_id
ORDER BY revision, id
SQL);
$attachmentStatement->execute(['request_id' => $requestId]);

echo json_encode(
    [
        'approval_steps' => $approvalSteps,
        'request_document' => $documentStatement->fetch() ?: null,
        'attachments' => $attachmentStatement->fetchAll(),
    ],
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR
), "\n";
