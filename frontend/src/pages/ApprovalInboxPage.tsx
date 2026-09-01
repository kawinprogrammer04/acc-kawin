import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Eraser, Eye, FileSignature, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { approvalInboxApi } from "@/api/approvals";
import type { InboxItem } from "@/api/approvals";
import { getApiErrorMessage } from "@/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataListMultiFilterSelect } from "@/components/data-list/DataListFilterSelect";
import { DataListPagination } from "@/components/data-list/DataListPagination";
import { dataListFilterPanelClass, dataListTableHeaderCellClass, dataListTableScrollClass } from "@/components/data-list/styles";
import { formatCurrency, formatDate } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";

const inboxStatusOptions = [
  { value: "pending", label: "รออนุมัติ" },
  { value: "approved", label: "อนุมัติแล้ว" },
  { value: "returned", label: "ส่งคืนแก้ไข" },
  { value: "rejected", label: "ไม่อนุมัติ" },
] as const;

type InboxStatus = InboxItem["status"];
const allInboxStatuses = inboxStatusOptions.map(option => option.value);

const inboxStatusStyle: Record<InboxStatus, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  returned: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200",
  rejected: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200",
};

export function ApprovalInboxPage() {
  const { user } = useAuth();
  const { currentCompany } = useCompany();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statuses, setStatuses] = useState<InboxStatus[]>(["pending"]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // super_admin ต้องเห็นรายการรออนุมัติของทุกคนในบริษัทเสมอ (ไม่ใช่แค่ของตัวเอง)
  // เพราะต้องใช้ตรวจสอบ/แก้ไขปัญหาที่พนักงานคนอื่นแจ้งมาได้
  const seesEveryonesInbox = Boolean(user?.is_platform_admin || currentCompany?.role === "super_admin");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await approvalInboxApi.list({
        scope: seesEveryonesInbox ? "all" : "mine",
        statuses: statuses.length > 0 ? statuses : [...allInboxStatuses],
      }));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "โหลดรายการรออนุมัติไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  }, [seesEveryonesInbox, statuses]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleItems = useMemo(() => pageSize === 0
    ? items
    : items.slice((page - 1) * pageSize, page * pageSize), [items, page, pageSize]);
  const statusLabel = statuses.length === 0
    ? "ทุกสถานะ"
    : statuses.map(status => inboxStatusOptions.find(option => option.value === status)?.label || status).join(", ");

  const changeStatuses = (nextStatuses: string[]) => {
    setPage(1);
    setStatuses(nextStatuses as InboxStatus[]);
  };

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="รายการรอคุณอนุมัติ"
        subtitle="ตรวจรายการที่รอพิจารณาและย้อนดูรายการที่คุณเคยดำเนินการ"
      />

      <form onSubmit={event => event.preventDefault()} className={`${dataListFilterPanelClass} rounded-2xl border bg-card/80 p-5 shadow-sm backdrop-blur-xl`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="w-full sm:max-w-xs">
            <DataListMultiFilterSelect
              label="สถานะ"
              values={statuses}
              allLabel="ทุกสถานะ"
              options={[...inboxStatusOptions]}
              onChange={changeStatuses}
            />
          </div>
          <button type="button" onClick={() => changeStatuses(["pending"])} disabled={statuses.length === 1 && statuses[0] === "pending"}
            className="inline-flex h-11 items-center gap-2 rounded-md border border-input bg-background px-5 text-sm font-bold text-muted-foreground transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-rose-950/30">
            <Eraser className="h-4 w-4" />ล้างตัวกรอง
          </button>
        </div>
        <p className="mt-3 border-t pt-3 text-xs font-medium text-muted-foreground">ตัวกรองทำงานอัตโนมัติ · ค่าเริ่มต้นคือ “รออนุมัติ”</p>
      </form>

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
              <h2 className="mt-4 font-semibold">ไม่พบรายการสถานะ {statusLabel}</h2>
              <p className="mt-1 text-sm text-muted-foreground">ลองเลือกสถานะอื่นเพื่อดูประวัติการพิจารณาของคุณ</p>
            </div>
          ) : (
            <div className={dataListTableScrollClass}>
              <table className="w-full min-w-[1180px] text-sm">
                <thead className="text-xs font-semibold text-muted-foreground">
                  <tr>
                    <th className={`${dataListTableHeaderCellClass} px-4 py-3 text-left`}>คำขอ</th>
                    <th className={`${dataListTableHeaderCellClass} px-4 py-3 text-left`}>วันที่เบิก</th>
                    <th className={`${dataListTableHeaderCellClass} px-4 py-3 text-left`}>ผู้ขอ</th>
                    <th className={`${dataListTableHeaderCellClass} px-4 py-3 text-left`}>แผนก</th>
                    <th className={`${dataListTableHeaderCellClass} px-4 py-3 text-left`}>วัตถุประสงค์</th>
                    <th className={`${dataListTableHeaderCellClass} px-4 py-3 text-right`}>ยอดเงิน</th>
                    <th className={`${dataListTableHeaderCellClass} px-4 py-3 text-left`}>สถานะ</th>
                    <th className={`${dataListTableHeaderCellClass} px-4 py-3 text-right`}>ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visibleItems.map((item) => (
                    <tr key={`${item.step_id}-${item.status}`} className="hover:bg-muted/20">
                      <td className="px-4 py-4">
                        <Link
                          to={`/expense-requests/${item.expense_request_id}`}
                          className="font-mono font-semibold text-primary hover:underline"
                        >
                          {item.request_no || `คำขอ #${item.expense_request_id.slice(0, 8)}`}
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">{item.expense_type_name || "-"}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-muted-foreground">
                        {formatDate(`${item.request_date}T00:00:00`)}
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-medium">{item.requester_name || "-"}</p>
                        {item.requester_position_name && <p className="mt-1 text-xs text-muted-foreground">{item.requester_position_name}</p>}
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">{item.department_name || "ไม่มีแผนก"}</td>
                      <td className="max-w-xs px-4 py-4">
                        <p className="line-clamp-2 text-muted-foreground">{item.title}</p>
                      </td>
                      <td className="px-4 py-4 text-right font-semibold">{formatCurrency(item.amount)}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${inboxStatusStyle[item.status]}`}>
                          {inboxStatusOptions.find(option => option.value === item.status)?.label || item.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Link
                          to={`/expense-requests/${item.expense_request_id}`}
                          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                        >
                          {item.status === "pending" ? <FileSignature className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          {item.status === "pending" ? "ตรวจและเซ็น" : "ดูรายละเอียด"}
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
      {!loading && <DataListPagination
        total={items.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={value => { setPage(1); setPageSize(value); }}
      />}
    </div>
  );
}
