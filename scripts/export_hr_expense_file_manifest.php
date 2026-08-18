<?php
/**
 * Export a read-only manifest of HR expense-request documents and attachments.
 * The script never writes to HR; its only write is the requested local JSON file.
 *
 * Usage:
 *   HR_DB_PASSWORD=... php scripts/export_hr_expense_file_manifest.php /private/tmp/hr-expense-files.json
 */

$password = getenv('HR_DB_PASSWORD');
$outputPath = $argv[1] ?? '';
if ($password === false || $password === '' || !str_starts_with($outputPath, '/private/tmp/')) {
    fwrite(STDERR, "HR_DB_PASSWORD and an output path under /private/tmp are required\n");
    exit(2);
}

$pdo = new PDO(
    'mysql:host=212.80.214.52;port=3306;dbname=kawin_hr;charset=utf8mb4',
    'kawin_select',
    $password,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);

$requestSql = <<<'SQL'
SELECT
    id,
    request_number,
    request_kind,
    current_revision,
    request_pdf_path,
    request_pdf_hash,
    signed_request_pdf_path,
    requester_id,
    created_at,
    updated_at
FROM expense_requests
WHERE deleted_at IS NULL
  AND request_kind IN ('advance', 'reimbursement')
  AND created_at >= '2026-01-01'
  AND created_at < '2027-01-01'
ORDER BY id
SQL;

$attachmentSql = <<<'SQL'
SELECT
    attachment.id,
    attachment.expense_request_id,
    attachment.expense_attachment_requirement_id,
    requirement.name AS requirement_name,
    attachment.revision,
    attachment.category,
    attachment.original_name,
    attachment.file_path,
    attachment.latest_signed_path,
    attachment.mime_type,
    attachment.file_size,
    attachment.sha256,
    attachment.requires_signature,
    attachment.uploaded_by,
    attachment.created_at,
    attachment.updated_at
FROM expense_request_attachments attachment
LEFT JOIN expense_attachment_requirements requirement
    ON requirement.id = attachment.expense_attachment_requirement_id
INNER JOIN expense_requests request
    ON request.id = attachment.expense_request_id
   AND request.current_revision = attachment.revision
WHERE request.deleted_at IS NULL
  AND request.request_kind IN ('advance', 'reimbursement')
  AND request.created_at >= '2026-01-01'
  AND request.created_at < '2027-01-01'
  AND attachment.is_active = 1
ORDER BY attachment.expense_request_id, attachment.id
SQL;

$requests = [];
foreach ($pdo->query($requestSql) as $request) {
    $request['id'] = (int) $request['id'];
    $request['current_revision'] = (int) $request['current_revision'];
    $request['requester_id'] = (int) $request['requester_id'];
    $request['attachments'] = [];
    $requests[$request['id']] = $request;
}

foreach ($pdo->query($attachmentSql) as $attachment) {
    $requestId = (int) $attachment['expense_request_id'];
    if (!isset($requests[$requestId])) {
        continue;
    }
    $attachment['id'] = (int) $attachment['id'];
    $attachment['expense_request_id'] = $requestId;
    $attachment['revision'] = (int) $attachment['revision'];
    $attachment['file_size'] = (int) $attachment['file_size'];
    $attachment['requires_signature'] = (bool) $attachment['requires_signature'];
    $attachment['uploaded_by'] = (int) $attachment['uploaded_by'];
    $requests[$requestId]['attachments'][] = $attachment;
}

$payload = [
    'generated_at' => gmdate(DATE_ATOM),
    'requests' => array_values($requests),
];
$json = json_encode(
    $payload,
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR
)."\n";

if (file_put_contents($outputPath, $json, LOCK_EX) === false) {
    fwrite(STDERR, "Unable to write manifest\n");
    exit(1);
}

$withDocuments = count(array_filter($requests, fn ($request) =>
    $request['request_pdf_path'] !== null || $request['signed_request_pdf_path'] !== null
));
$attachmentCount = array_sum(array_map(fn ($request) => count($request['attachments']), $requests));
fwrite(STDERR, sprintf(
    "Exported %d requests, %d request documents, %d active current-revision attachments\n",
    count($requests),
    $withDocuments,
    $attachmentCount,
));
