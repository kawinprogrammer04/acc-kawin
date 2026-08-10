import { useEffect, useState } from "react";
import { Calendar, ArrowUpCircle, ArrowDownCircle, Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/PageHeader";
import { dashboardApi } from "@/api/cashflow";
import { formatCurrency, formatDate, today, isOverdue, localDateInput } from "@/lib/format";

export function SchedulePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return localDateInput(d);
  });

  useEffect(() => {
    setLoading(true);
    dashboardApi.getSchedule({ start_date: startDate, end_date: endDate })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  const schedule: any[] = data?.schedule || [];
  const inTotal = schedule.filter(i => i.direction === "in").reduce((s: number, i: any) => s + i.amount, 0);
  const outTotal = schedule.filter(i => i.direction === "out").reduce((s: number, i: any) => s + i.amount, 0);

  const groupedByDate = schedule.reduce((acc: Record<string, any[]>, item: any) => {
    const d = item.date || "ไม่ระบุวัน";
    if (!acc[d]) acc[d] = [];
    acc[d].push(item);
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="กำหนดการจ่าย / รับเงิน" subtitle="ดูกำหนดการเงินสดในอนาคต">
        <div className="flex items-center gap-2">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="rounded-md border px-3 py-1.5 text-sm" />
          <span className="text-muted-foreground text-sm">ถึง</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="rounded-md border px-3 py-1.5 text-sm" />
        </div>
      </PageHeader>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">รายการรับเงิน</p>
          <p className="text-xl font-bold text-emerald-600">{formatCurrency(inTotal)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">รายการจ่ายเงิน</p>
          <p className="text-xl font-bold text-rose-600">{formatCurrency(outTotal)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">กระแสเงินสดสุทธิ</p>
          <p className={`text-xl font-bold ${inTotal - outTotal >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {formatCurrency(inTotal - outTotal)}
          </p>
        </CardContent></Card>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedByDate).map(([dateKey, items]) => {
            const dayIn = (items as any[]).filter(i => i.direction === "in").reduce((s: number, i: any) => s + i.amount, 0);
            const dayOut = (items as any[]).filter(i => i.direction === "out").reduce((s: number, i: any) => s + i.amount, 0);
            const isToday = dateKey === today();
            const isPast = dateKey < today();

            return (
              <Card key={dateKey} className={isToday ? "ring-2 ring-primary" : isPast ? "opacity-70" : ""}>
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold">{formatDate(dateKey)}</span>
                      {isToday && <Badge className="text-[10px]">วันนี้</Badge>}
                      {isPast && <Badge variant="outline" className="text-[10px] text-muted-foreground">ผ่านมาแล้ว</Badge>}
                    </div>
                    <div className="flex gap-4 text-sm">
                      <span className="text-emerald-600">รับ +{formatCurrency(dayIn)}</span>
                      <span className="text-rose-600">จ่าย -{formatCurrency(dayOut)}</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="space-y-2">
                    {(items as any[]).map((item: any, i: number) => (
                      <div key={i} className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                        item.overdue ? "border-rose-200 bg-rose-50" : "border-border"
                      }`}>
                        <div className="flex items-center gap-3">
                          {item.direction === "in"
                            ? <ArrowUpCircle className="h-4 w-4 text-emerald-600 shrink-0" />
                            : <ArrowDownCircle className="h-4 w-4 text-rose-600 shrink-0" />}
                          <div>
                            <p className="text-sm font-medium">{item.name}</p>
                            <p className="text-[11px] text-muted-foreground capitalize">
                              {item.type === "payable" ? "เจ้าหนี้" :
                               item.type === "receivable" ? "ลูกหนี้" :
                               item.type === "expense" ? "รายจ่าย" : "รายรับ"}
                              {item.overdue && <span className="ml-1 text-rose-600">⚠ เลยกำหนด</span>}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold text-sm ${item.direction === "in" ? "text-emerald-600" : "text-rose-600"}`}>
                            {item.direction === "in" ? "+" : "-"}{formatCurrency(item.amount)}
                          </p>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] ${
                            item.status === "overdue" ? "bg-rose-100 text-rose-700" :
                            item.status === "pending" ? "bg-yellow-50 text-yellow-700" : "bg-gray-100 text-gray-700"
                          }`}>{item.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {Object.keys(groupedByDate).length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Calendar className="h-10 w-10 mb-3" />
              <p>ไม่มีกำหนดการในช่วงเวลานี้</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
