<?php

declare(strict_types=1);

use Dompdf\Dompdf;
use Dompdf\Options;
use Kawin\TaxInvoice\TaxInvoiceTemplate;

require dirname(__DIR__) . '/vendor/autoload.php';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

if ($_SERVER['REQUEST_METHOD'] === 'GET' && $path === '/health') {
    header('Content-Type: text/plain; charset=utf-8');
    echo 'ok';
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || $path !== '/render') {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['detail' => 'not found'], JSON_UNESCAPED_UNICODE);
    exit;
}

try {
    $rawBody = file_get_contents('php://input');
    if ($rawBody === false || strlen($rawBody) > 2_000_000) {
        throw new InvalidArgumentException('request body ไม่ถูกต้องหรือมีขนาดใหญ่เกินไป');
    }

    $payload = json_decode($rawBody, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($payload)) {
        throw new InvalidArgumentException('payload ต้องเป็น JSON object');
    }

    $options = new Options();
    $options->set('defaultFont', 'Garuda');
    $options->set('isRemoteEnabled', false);
    $options->set('isHtml5ParserEnabled', true);
    $options->set('isPhpEnabled', false);
    $options->set('chroot', [dirname(__DIR__)]);
    $options->set('fontDir', dirname(__DIR__) . '/storage/fonts');
    $options->set('fontCache', dirname(__DIR__) . '/storage/fonts');
    $options->set('tempDir', sys_get_temp_dir());

    $dompdf = new Dompdf($options);
    $dompdf->setPaper('A4', 'portrait');
    $dompdf->loadHtml(
        TaxInvoiceTemplate::render($payload, __DIR__ . '/assets'),
        'UTF-8'
    );
    $dompdf->render();

    header('Content-Type: application/pdf');
    header('X-PDF-Renderer: dompdf');
    header('Content-Disposition: inline; filename="tax-invoice.pdf"');
    echo $dompdf->output();
} catch (JsonException | InvalidArgumentException $exception) {
    http_response_code(422);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(
        ['detail' => $exception->getMessage()],
        JSON_UNESCAPED_UNICODE
    );
} catch (Throwable $exception) {
    error_log((string) $exception);
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(
        ['detail' => 'Dompdf render failed'],
        JSON_UNESCAPED_UNICODE
    );
}
