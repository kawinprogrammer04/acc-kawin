import { Badge } from "@/components/ui/badge";

/** Read-only display for cfstate_invoice — shared by /crm-cashflow/statements
 * and /crm-cashflow/invoices so both show the same labels/colors. */
export function InvoiceStatusBadge({ invoice }: { invoice: 0 | 1 | null }) {
  if (invoice == null) return <Badge variant="outline">ไม่มีใบกำกับ</Badge>;
  return invoice === 1
    ? <Badge variant="success">ได้รับแล้ว</Badge>
    : <Badge variant="warning">รอใบกำกับ</Badge>;
}
