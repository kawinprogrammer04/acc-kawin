import { Badge } from "@/components/ui/badge";
import type { CrmCashflowDocumentType } from "@/api/crmCashflow";

/** Read-only effective document status, with documentType taking priority over
 * the legacy cfstate_invoice value on both CRM cashflow pages. */
export function InvoiceStatusBadge({
  invoice,
  documentType,
}: {
  invoice: 0 | 1 | null;
  documentType?: CrmCashflowDocumentType | null;
}) {
  if (documentType === "tax_invoice") return <Badge variant="success">ใบกำกับภาษี</Badge>;
  if (documentType === "cash_bill") return <Badge variant="info">บิลเงินสด</Badge>;
  if (documentType === "other") return <Badge variant="secondary">อื่นๆ</Badge>;
  if (invoice == null) return <Badge variant="outline">ไม่มีใบกำกับ</Badge>;
  return invoice === 1
    ? <Badge variant="success">ได้รับแล้ว</Badge>
    : <Badge variant="warning">รอใบกำกับ</Badge>;
}
