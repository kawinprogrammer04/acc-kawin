import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, History, Loader2, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { getApiErrorMessage } from "@/api/client";
import { auditLogsApi, type AuditLog } from "@/api/statement";
import { formatDate } from "@/lib/format";
import { FilterPanel, FriendlyEmpty, ListPagination } from "./StatementUx";

export function AuditTab() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLogs(await auditLogsApi.list());
    } catch (err) {
      setError(getApiErrorMessage(err, "โหลดประวัติการทำงานไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [query, actionFilter]);

  const actions = useMemo(() => Array.from(new Set(logs.map((log) => log.action))).sort(), [logs]);
  const filteredLogs = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("th");
    return logs.filter((log) => {
      if (actionFilter && log.action !== actionFilter) return false;
      if (!keyword) return true;
      return [log.action, log.actor, log.entity_type, log.entity_id, log.detail]
        .some((value) => String(value ?? "").toLocaleLowerCase("th").includes(keyword));
    });
  }, [logs, query, actionFilter]);
  const pageLogs = pageSize === 0 ? filteredLogs : filteredLogs.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader title="ประวัติการทำงาน" subtitle="ใช้ตรวจย้อนหลังว่าใครทำอะไรกับข้อมูล และทำเมื่อใด" />

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <div className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /><p className="text-xs text-rose-700">{error}</p></div>
          <button onClick={() => setError(null)}><span className="text-rose-400">✕</span></button>
        </div>
      )}

      <FilterPanel resultText={`พบ ${filteredLogs.length} รายการ${pageSize === 0 ? " · แสดงทั้งหมด" : ` · แสดงครั้งละ ${pageSize} รายการ`}`}>
        <label className="min-w-[180px] text-[11px] font-medium text-muted-foreground">ประเภทการทำงาน
          <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} className="mt-1.5 h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground"><option value="">ทุกประเภท</option>{actions.map((action) => <option key={action}>{action}</option>)}</select>
        </label>
        <label className="min-w-[240px] flex-1 text-[11px] font-medium text-muted-foreground">ค้นหา
          <span className="mt-1.5 flex h-9 items-center gap-2 rounded-md border bg-background px-3"><Search className="h-3.5 w-3.5" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ชื่อผู้ใช้ รายการ หรือรายละเอียด" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none" /></span>
        </label>
        {(actionFilter || query) && <button type="button" onClick={() => { setActionFilter(""); setQuery(""); }} className="h-9 rounded-md px-3 text-xs font-medium text-sky-700 hover:bg-sky-50">ล้างตัวกรอง</button>}
      </FilterPanel>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : pageLogs.length === 0 ? (
            <FriendlyEmpty title="ไม่พบประวัติการทำงาน" description={logs.length ? "ลองเปลี่ยนประเภทหรือคำค้นหา" : "เมื่อมีการอัปโหลด แก้ไข หรือจับคู่รายการ ประวัติจะมาแสดงตรงนี้"} icon={<History className="h-5 w-5" />} />
          ) : (
            <div className="divide-y">
              {pageLogs.map((log) => (
                <div key={log.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{log.action}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(log.created_at)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{log.entity_type} #{log.entity_id} · โดย {log.actor}</p>
                  {log.detail && <p className="mt-1 text-xs text-slate-600">{log.detail}</p>}
                </div>
              ))}
            </div>
          )}
          <ListPagination page={page} pageSize={pageSize} total={filteredLogs.length} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />
        </CardContent>
      </Card>
    </div>
  );
}
