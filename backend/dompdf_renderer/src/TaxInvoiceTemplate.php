<?php

declare(strict_types=1);

namespace Kawin\TaxInvoice;

use InvalidArgumentException;

final class TaxInvoiceTemplate
{
    private const ROWS_PER_PAGE = 22;

    private const COPIES = [
        'customer' => [
            'logo' => 'logo-customer.png',
            'background' => 'template-customer.png',
        ],
        'company' => [
            'logo' => 'logo-company.png',
            'background' => 'template-company.png',
        ],
        'accounting' => [
            'logo' => 'logo-accounting.png',
            'background' => 'template-accounting.png',
        ],
    ];

    public static function render(array $payload, string $assetDirectory): string
    {
        $copyType = (string) ($payload['copy_type'] ?? 'all');
        if ($copyType !== 'all' && !isset(self::COPIES[$copyType])) {
            throw new InvalidArgumentException('ประเภทสำเนาไม่ถูกต้อง');
        }

        $document = $payload['document'] ?? null;
        $totals = $payload['totals'] ?? null;
        if (!is_array($document) || !is_array($totals)) {
            throw new InvalidArgumentException('ข้อมูลเอกสารไม่ครบถ้วน');
        }

        $lines = $document['lines'] ?? [];
        if (!is_array($lines)) {
            throw new InvalidArgumentException('รายการสินค้าไม่ถูกต้อง');
        }

        $fontPath = $assetDirectory . '/Garuda.ttf';
        $boldFontPath = $assetDirectory . '/Garuda-Bold.ttf';
        foreach ([$fontPath, $boldFontPath] as $requiredAsset) {
            if (!is_file($requiredAsset)) {
                throw new InvalidArgumentException('ไม่พบไฟล์ประกอบแม่แบบ Dompdf');
            }
        }

        $copyKeys = $copyType === 'all'
            ? ['customer', 'company', 'accounting']
            : [$copyType];
        $linePages = self::paginateLines($lines);
        $pageCount = count($linePages);
        $pages = '';

        foreach ($copyKeys as $copyKey) {
            $copy = self::COPIES[$copyKey];
            $background = self::imageDataUri(
                $assetDirectory . '/' . $copy['background'],
                'ไม่พบภาพพื้นหลังของแม่แบบ Dompdf'
            );

            foreach ($linePages as $pageIndex => $pageLines) {
                $pages .= self::renderPage(
                    $document,
                    $totals,
                    $copyKey,
                    $pageLines,
                    $pageIndex + 1,
                    $pageCount,
                    $pageIndex === $pageCount - 1,
                    $background
                );
            }
        }

        return '<!doctype html><html lang="th"><head><meta charset="UTF-8">'
            . '<style>'
            . '@page{size:950px 1080px;margin:0;}'
            . '@font-face{font-family:Garuda;src:url("file://' . self::h($fontPath) . '") format("truetype");font-weight:400;}'
            . '@font-face{font-family:Garuda;src:url("file://' . self::h($boldFontPath) . '") format("truetype");font-weight:700;}'
            . '*{box-sizing:border-box;}'
            . 'html,body{margin:0;padding:0;font-family:Garuda,Arial,sans-serif;color:#111;}'
            . '.page{position:relative;width:950px;height:1080px;overflow:hidden;page-break-after:always;background:#fff;}'
            . '.page:last-child{page-break-after:auto;}'
            . '.template,.layer{position:absolute;left:0;top:0;width:950px;height:1080px;}'
            . '.template{z-index:1;}'
            . '.layer{z-index:2;font-size:14px;line-height:1.15;color:#111;}'
            . '.field{position:absolute;overflow:visible;white-space:nowrap;}'
            . '.input-field{color:#0070c0;}'
            . '.strong-field{font-weight:700;}'
            . '.copy-title-erase,.copy-badge-erase{position:absolute;background:#fff;}'
            . '.copy-title-erase{left:220px;top:155px;width:540px;height:86px;}'
            . '.copy-badge-erase{left:760px;top:0;width:180px;height:70px;}'
            . '.copy-title,.copy-badge{position:absolute;background:#fff;text-align:center;font-weight:700;}'
            . '.copy-title{left:215px;top:168px;width:520px;height:56px;border:3px solid;border-radius:7px;}'
            . '.copy-title-main,.copy-title-sub{position:absolute;left:0;width:100%;text-align:center;white-space:nowrap;}'
            . '.copy-title-main{top:8px;font-size:20px;line-height:1;}'
            . '.copy-title-sub{top:31px;font-size:12px;line-height:1;}'
            . '.copy-badge{left:797px;top:18px;width:126px;height:35px;border:3px solid;border-radius:7px;font-size:13px;line-height:1;}'
            . '.copy-badge-text{position:absolute;left:0;top:9px;width:100%;text-align:center;white-space:nowrap;}'
            . '.copy-customer{border-color:#79201b;}'
            . '.copy-company{border-color:#d5732e;}'
            . '.copy-accounting{border-color:#4a849b;}'
            . '.customer-name{left:84px;top:248px;width:300px;height:24px;}'
            . '.customer-address{left:84px;top:270px;width:310px;height:42px;white-space:normal;line-height:19px;}'
            . '.invoice-number{left:786px;top:248px;width:138px;height:24px;text-align:left;}'
            . '.invoice-date{left:786px;top:270px;width:138px;height:24px;text-align:left;}'
            . '.tax-id{left:168px;top:298px;width:195px;height:24px;}'
            . '.branch-number{left:548px;top:300px;width:45px;height:24px;}'
            . '.check{position:absolute;top:299px;width:22px;height:22px;text-align:center;font-size:18px;font-weight:700;line-height:22px;color:#111;box-shadow: none;}'
            . '.head-check{left:362px;}.branch-check{left:500px;}'
            . '.page-number{position:absolute;right:10px;top:309px;font-size:11px;color:#444;}'
            . '.item-row{position:absolute;left:0;width:950px;height:18px;font-size:14px;line-height:1;}'
            . '.item-cell{position:absolute;top:-2px;height:24px;padding:3px 4px 0;line-height:1.15;overflow:visible;white-space:nowrap;}'
            . '.seq{left:0;width:85px;text-align:center;}'
            . '.code{left:85px;width:125px;text-align:center;}'
            . '.description{left:210px;width:292px;text-align:left;}'
            . '.quantity{left:502px;width:83px;text-align:right;}'
            . '.unit{left:585px;width:75px;text-align:center;}'
            . '.price{left:660px;width:124px;text-align:right;}'
            . '.amount{left:784px;width:166px;text-align:right;}'
            . '.erase{position:absolute;background:#fff;}'
            . '.amount-erase{left:84px;top:779px;width:492px;height:24px;}'
            . '.amount-text{left:86px;top:780px;width:488px;height:24px;font-size:14px;}'
            . '.notes-erase{left:84px;top:846px;width:490px;height:50px;}'
            . '.notes-text{left:86px;top:846px;width:488px;height:48px;font-size:14px;white-space:normal;line-height:19px;}'
            . '.total-erase{left:786px;width:158px;background:#fff;}'
            . '.total-value{left:790px;width:150px;text-align:right;font-size:14px;line-height:1.15;padding-top:0;}'
            . '.rate-erase{left:728px;width:48px;background:#fff;}'
            . '.rate-value{left:730px;width:44px;text-align:center;font-size:14px;line-height:1.15;padding-top:0;}'
            . '.t1{top:773px;height:36px;}.tv1{top:780px;height:24px;}'
            . '.t2{top:811px;height:44px;}.tv2{top:826px;height:24px;}'
            . '.t3{top:856px;height:44px;}.tv3{top:870px;height:24px;}'
            . '.t4{top:901px;height:44px;}.tv4{top:914px;height:24px;}'
            . '</style></head><body>' . $pages . '</body></html>';
    }

    /**
     * Convert each logical item to one or more fixed visual rows. This keeps the
     * original 22-row Excel grid intact and moves overflow to the next A4 page.
     *
     * @param array<int, mixed> $lines
     * @return array<int, array<int, array<string, string>>>
     */
    private static function paginateLines(array $lines): array
    {
        $visualRows = [];
        foreach ($lines as $lineIndex => $rawLine) {
            $line = is_array($rawLine) ? $rawLine : [];
            $codeLines = [trim((string) ($line['product_code'] ?? ''))];
            $descriptionLines = self::wrapCell((string) ($line['description'] ?? ''), 40);
            $rowCount = max(count($codeLines), count($descriptionLines), 1);
            $quantity = (float) ($line['quantity'] ?? 0);
            $unitPrice = (float) ($line['unit_price'] ?? 0);

            for ($rowIndex = 0; $rowIndex < $rowCount; $rowIndex++) {
                $isFirst = $rowIndex === 0;
                $visualRows[] = [
                    'sequence' => $isFirst ? (string) ($lineIndex + 1) : '',
                    'code' => $codeLines[$rowIndex] ?? '',
                    'description' => $descriptionLines[$rowIndex] ?? '',
                    'quantity' => $isFirst ? self::number($quantity, 2) : '',
                    'unit' => $isFirst ? (string) ($line['unit'] ?? '') : '',
                    'unit_price' => $isFirst ? self::number($unitPrice, 2) : '',
                    'amount' => $isFirst
                        ? self::number($quantity * $unitPrice, 2)
                        : '',
                ];
            }
        }

        if ($visualRows === []) {
            return [[]];
        }
        return array_chunk($visualRows, self::ROWS_PER_PAGE);
    }

    /**
     * @return array<int, string>
     */
    private static function wrapCell(string $value, int $charactersPerLine): array
    {
        $paragraphs = preg_split('/\R/u', trim($value)) ?: [''];
        $result = [];

        foreach ($paragraphs as $paragraph) {
            if ($paragraph === '') {
                $result[] = '';
                continue;
            }
            while (mb_strlen($paragraph, 'UTF-8') > $charactersPerLine) {
                $candidate = mb_substr(
                    $paragraph,
                    0,
                    $charactersPerLine,
                    'UTF-8'
                );
                $breakAt = mb_strrpos($candidate, ' ', 0, 'UTF-8');
                if ($breakAt !== false && $breakAt >= (int) ($charactersPerLine * 0.6)) {
                    $candidate = mb_substr($candidate, 0, $breakAt, 'UTF-8');
                }
                $result[] = trim($candidate);
                $paragraph = ltrim(
                    mb_substr(
                        $paragraph,
                        mb_strlen($candidate, 'UTF-8'),
                        null,
                        'UTF-8'
                    )
                );
            }
            $result[] = trim($paragraph);
        }

        return $result === [] ? [''] : $result;
    }

    /**
     * @param array<int, array<string, string>> $pageLines
     */
    private static function renderPage(
        array $document,
        array $totals,
        string $copyKey,
        array $pageLines,
        int $pageNumber,
        int $pageCount,
        bool $isFinalPage,
        string $background
    ): string {
        $customer = is_array($document['customer'] ?? null)
            ? $document['customer']
            : [];
        $branch = (string) ($customer['branch'] ?? 'สำนักงานใหญ่');
        $isHeadOffice = str_contains($branch, 'สำนักงานใหญ่');
        $branchNumber = $isHeadOffice
            ? ''
            : trim(str_replace('สาขาที่', '', $branch));
        $rows = '';

        foreach ($pageLines as $rowIndex => $line) {
            $top = 368 + ($rowIndex * 18);
            $rows .= '<div class="item-row" style="top:' . $top . 'px">'
                . self::cell('seq', $line['sequence'])
                . self::cell('code', $line['code'])
                . self::cell('description', $line['description'])
                . self::cell('quantity', $line['quantity'])
                . self::cell('unit', $line['unit'])
                . self::cell('price', $line['unit_price'])
                . self::cell('amount', $line['amount'])
                . '</div>';
        }

        $summary = self::renderSummary(
            $document,
            $totals,
            $copyKey,
            $isFinalPage
        );
        $pageLabel = $pageCount > 1
            ? '<div class="page-number">หน้า '
                . $pageNumber . '/' . $pageCount . '</div>'
            : '';

        return '<section class="page">'
            . '<img class="template" src="' . $background . '" alt="">'
            . '<div class="layer">'
            . self::copyHeader($copyKey)
            . '<div class="field input-field customer-name">' . self::h((string) ($customer['name'] ?? '')) . '</div>'
            . '<div class="field input-field customer-address">' . nl2br(self::h((string) ($customer['address'] ?? ''))) . '</div>'
            . '<div class="field input-field strong-field invoice-number">' . self::h((string) ($document['invoice_number'] ?? '')) . '</div>'
            . '<div class="field input-field strong-field invoice-date">' . self::date((string) ($document['invoice_date'] ?? '')) . '</div>'
            . '<div class="field input-field tax-id">' . self::h((string) ($customer['tax_id'] ?? '')) . '</div>'
            . '<div class="check head-check">' . ($isHeadOffice ? '✓' : '') . '</div>'
            . '<div class="check branch-check">' . (!$isHeadOffice ? '✓' : '') . '</div>'
            . '<div class="field input-field branch-number">' . self::h($branchNumber) . '</div>'
            . $pageLabel
            . $rows
            . $summary
            . '</div></section>';
    }

    private static function copyHeader(string $copyKey): string
    {
        $labels = [
            'customer' => [
                'badge' => 'สำหรับลูกค้า',
                'main' => 'ต้นฉบับใบกำกับภาษี / ใบส่งสินค้า / ใบแจ้งหนี้',
                'sub' => 'ORIGINAL TAX INVOICE / DELIVERY ORDER / INVOICE',
            ],
            'company' => [
                'badge' => 'สำหรับบริษัท',
                'main' => 'สำเนาใบกำกับภาษี / ใบส่งสินค้า / ใบแจ้งหนี้',
                'sub' => 'COPY TAX INVOICE / DELIVERY ORDER / INVOICE',
            ],
            'accounting' => [
                'badge' => 'สำหรับบัญชี',
                'main' => 'สำเนาใบกำกับภาษี / ใบส่งสินค้า / ใบแจ้งหนี้',
                'sub' => 'COPY TAX INVOICE / DELIVERY ORDER / INVOICE',
            ],
        ];
        $label = $labels[$copyKey] ?? $labels['customer'];
        $className = 'copy-' . $copyKey;

        return '<div class="copy-title-erase"></div>'
            . '<div class="copy-badge-erase"></div>'
            . '<div class="copy-title ' . $className . '">'
            . '<span class="copy-title-main">' . self::h($label['main']) . '</span>'
            . '<span class="copy-title-sub">' . self::h($label['sub']) . '</span>'
            . '</div>'
            . '<div class="copy-badge ' . $className . '">'
            . '<span class="copy-badge-text">' . self::h($label['badge']) . '</span>'
            . '</div>';
    }

    private static function renderSummary(
        array $document,
        array $totals,
        string $copyKey,
        bool $isFinalPage
    ): string {
        $html = '<div class="erase amount-erase"></div>'
            . '<div class="erase notes-erase"></div>';

        for ($row = 1; $row <= 4; $row++) {
            $html .= '<div class="erase total-erase t' . $row . '"></div>';
        }

        if ($copyKey === 'accounting') {
            $html .= '<div class="erase rate-erase t2"></div>'
                . '<div class="erase rate-erase t4"></div>';
        } else {
            $html .= '<div class="erase rate-erase t3"></div>';
        }

        if (!$isFinalPage) {
            return $html;
        }

        $html .= '<div class="field amount-text">('
            . self::h((string) ($totals['amount_text'] ?? ''))
            . ')</div>'
            . '<div class="field notes-text">'
            . self::h((string) ($document['notes'] ?? '-'))
            . '</div>';

        if ($copyKey === 'accounting') {
            $subtotal = (float) ($totals['subtotal'] ?? 0);
            $discount = (float) ($totals['discount'] ?? 0);
            $discountRate = $subtotal > 0 ? ($discount / $subtotal) * 100 : 0;
            return $html
                . self::totalValue(1, $totals['subtotal'] ?? 0)
                . self::rateValue(2, $discountRate)
                . self::totalValue(2, $totals['discount'] ?? 0)
                . self::totalValue(3, $totals['after_discount'] ?? 0)
                . self::rateValue(4, (float) ($document['vat_rate'] ?? 7))
                . self::totalValue(4, $totals['vat_amount'] ?? 0);
        }

        return $html
            . self::totalValue(1, $totals['subtotal'] ?? 0)
            . self::totalValue(2, $totals['after_discount'] ?? 0)
            . self::rateValue(3, (float) ($document['vat_rate'] ?? 7))
            . self::totalValue(3, $totals['vat_amount'] ?? 0)
            . self::totalValue(4, $totals['grand_total'] ?? 0);
    }

    private static function cell(string $className, string $value): string
    {
        return '<span class="item-cell ' . $className . '">'
            . self::h($value) . '</span>';
    }

    private static function totalValue(int $row, mixed $value): string
    {
        return '<div class="field total-value tv' . $row . '">'
            . self::number((float) $value, 2) . '</div>';
    }

    private static function rateValue(int $row, float $value): string
    {
        $decimals = $value === floor($value) ? 0 : 2;
        return '<div class="field rate-value tv' . $row . '">'
            . self::number($value, $decimals) . '%</div>';
    }

    private static function imageDataUri(string $path, string $error): string
    {
        if (!is_file($path)) {
            throw new InvalidArgumentException($error);
        }
        return 'data:image/png;base64,'
            . base64_encode((string) file_get_contents($path));
    }

    private static function date(string $value): string
    {
        $parts = explode('-', $value);
        return count($parts) === 3
            ? self::h($parts[2] . '/' . $parts[1] . '/' . $parts[0])
            : self::h($value);
    }

    private static function number(float $value, int $decimals): string
    {
        return number_format($value, $decimals, '.', ',');
    }

    private static function h(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
