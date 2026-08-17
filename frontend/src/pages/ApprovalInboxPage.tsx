import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileSignature, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { approvalInboxApi } from "@/api/approvals";
import type { InboxItem } from "@/api/approvals";
import { getApiErrorMessage } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatCurrency, formatDate } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";

export function ApprovalInboxPage() {
  const { user } = useAuth();
  const { currentCompany } = useCompany();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // super_admin ต้องเห็นรายการรออนุมัติของทุกคนในบริษัทเสมอ (ไม่ใช่แค่ของตัวเอง)
  // เพราะต้องใช้ตรวจสอบ/แก้ไขปัญหาที่พนักงานคนอื่นแจ้งมาได้
  const seesEveryonesInbox = Boolean(user?.is_platform_admin || currentCompany?.role === "super_admin");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await approvalInboxApi.list({ scope: seesEveryonesInbox ? "all" : "mine" }));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "โหลดรายการรออนุมัติไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  }, [seesEveryonesInbox]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="รายการรอคุณอนุมัติ"
        subtitle="เปิดเอกสาร ตรวจรายละเอียด วาดลายเซ็น และวางลง PDF ก่อนอนุมัติ"
      />

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <h2 className="mt-4 font-semibold">ไม่มีรายการค้างอนุมัติ</h2>
              <p className="mt-1 text-sm text-muted-foreground">รายการใหม่ที่มาถึงขั้นของคุณจะแสดงที่นี่</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    {[
                      "คำขอ",
                      "ผู้ขอ / แผนก",
                      "วัตถุประสงค์",
                      "ส่งเมื่อ",
                      "ยอดเบิก",
                      "ดำเนินการ",
                    ].map((heading) => (
                      <th
                        key={heading}
                        className={`px-4 py-3 text-left text-xs font-semibold text-muted-foreground ${
                          ["ยอดเบิก", "ดำเนินการ"].includes(heading) ? "text-right" : ""
                        }`}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item) => (
                    <tr key={item.step_id} className="hover:bg-muted/20">
                      <td className="px-4 py-4">
                        <Link
                          to={`/expense-requests/${item.expense_request_id}`}
                          className="font-mono font-semibold text-primary hover:underline"
                        >
                          {item.request_no || `คำขอ #${item.expense_request_id.slice(0, 8)}`}
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">{item.expense_type_name || "-"}</p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-medium">{item.requester_name || "-"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.department_name || "ไม่มีแผนก"}
                        </p>
                      </td>
                      <td className="max-w-xs px-4 py-4">
                        <p className="line-clamp-2 text-muted-foreground">{item.title}</p>
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">
                        {item.submitted_at ? formatDate(item.submitted_at) : "-"}
                      </td>
                      <td className="px-4 py-4 text-right font-semibold">{formatCurrency(item.amount)}</td>
                      <td className="px-4 py-4 text-right">
                        <Link
                          to={`/expense-requests/${item.expense_request_id}`}
                          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                        >
                          <FileSignature className="h-4 w-4" />
                          ตรวจและเซ็น
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
