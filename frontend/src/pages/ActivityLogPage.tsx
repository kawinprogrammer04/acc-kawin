import { useEffect, useState, useCallback } from "react";
import { Loader2, ClipboardList, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { api } from "@/api/client";
import { formatDate, today, monthStart } from "@/lib/format";

interface ActivityLog {
  id: number;
  user_id?: number;
  username?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  description?: string;
  ip_address?: string;
  created_at: string;
}

const ACTION_COLORS: Record<string, string> = {
  create: "bg-emerald-100 text-emerald-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-rose-100 text-rose-700",
  pay:    "bg-amber-100 text-amber-700",
  receive:"bg-purple-100 text-purple-700",
  cancel: "bg-gray-100 text-gray-600",
  login:  "bg-indigo-100 text-indigo-700",
};

export function ActivityLogPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(today());
  const [keyword, setKeyword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/activity-logs", {
        params: { start_date: startDate, end_date: endDate, limit: 500 },
      });
      setLogs(res.data);
    } finally { setLoading(false); }
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const filtered = logs.filter(l =>
    !keyword ||
    l.action?.toLowerCase().includes(keyword.toLowerCase()) ||
    l.resource_type?.toLowerCase().includes(keyword.toLowerCase()) ||
    l.description?.toLowerCase().includes(keyword.toLowerCase()) ||
    l.username?.toLowerCase().includes(keyword.toLowerCase())
  );

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Activity Log" subtitle="ประวัติการดำเนินการทั้งหมดในระบบ" />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">วันเริ่มต้น</p>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="rounded-md border px-3 py-1.5 text-sm" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">วันสิ้นสุด</p>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="rounded-md border px-3 py-1.5 text-sm" />
            </div>
            <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input placeholder="ค้นหา..." value={keyword}
                onChange={e => setKeyword(e.target.value)}
                className="outline-none text-sm bg-transparent w-40" />
            </div>
            <span className="text-xs text-muted-foreground ml-auto">{filtered.length} รายการ</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <ClipboardList className="h-10 w-10 mb-2" />
              <p>ยังไม่มีข้อมูล Activity Log</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr>
                    {["เวลา", "ผู้ใช้", "Action", "ประเภท", "รายละเอียด"].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map(log => (
                    <tr key={log.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-medium">{log.username || "-"}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[log.action] || "bg-gray-100 text-gray-600"}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{log.resource_type}</td>
                      <td className="px-4 py-2.5 text-xs max-w-xs truncate">{log.description || "-"}</td>
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
