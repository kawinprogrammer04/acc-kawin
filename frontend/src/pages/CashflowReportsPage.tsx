import { useState } from "react";
import { Download, Loader2, BarChart3, TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { dashboardApi } from "@/api/cashflow";
import { formatCurrency, today, monthStart } from "@/lib/format";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend
} from "recharts";

const PIE_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#8b5cf6", "#f97316", "#06b6d4"];

const REPORT_TYPES = [
  { value: "summary", label: "สรุปภาพรวม" },
  { value: "profit_loss", label: "กำไรขาดทุน" },
  { value: "account_balance", label: "ยอดเงินตามบัญชี" },
];

export function CashflowReportsPage() {
  const [reportType, setReportType] = useState("summary");
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(today());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const result = await dashboardApi.getReport({
        start_date: startDate, end_date: endDate, report_type: reportType
      });
      setData(result);
    } finally { setLoading(false); }
  };

  const exportCsv = () => {
    if (!data) return;
    let csv = "";
    if (reportType === "profit_loss") {
      csv = "ประเภท,จำนวนเงิน\n";
      csv += `รายรับรวม,${data.total_income}\n`;
      csv += `รายจ่ายรวม,${data.total_expense}\n`;
      csv += `กำไร/ขาดทุน,${data.profit}\n`;
    } else if (reportType === "account_balance") {
      csv = "บัญชี,ประเภท,เจ้าของ,ยอดเงิน\n";
      data.accounts?.forEach((a: any) => {
        csv += `${a.name},${a.type},${a.owner_type},${a.balance}\n`;
      });
    } else {
      csv = "รายรับ,รายจ่าย,กำไร\n";
      csv += `${data.income?.total},${data.expense?.total},${data.profit}\n`;
    }
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `report_${reportType}_${startDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="รายงาน" subtitle="วิเคราะห์ข้อมูลทางการเงิน">
        {data && (
          <button onClick={exportCsv}
            className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-accent">
            <Download className="h-4 w-4" /> Export CSV
          </button>
        )}
      </PageHeader>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">ประเภทรายงาน</p>
              <select value={reportType} onChange={e => setReportType(e.target.value)}
                className="rounded-md border px-3 py-1.5 text-sm">
                {REPORT_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
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
            <button onClick={generate} disabled={loading}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
              สร้างรายงาน
            </button>
          </div>
        </CardContent>
      </Card>

      {data && (
        <>
          {/* Summary Report */}
          {reportType === "summary" && (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">รายรับ ({data.income?.count || 0} รายการ)</p>
                <p className="text-xl font-bold text-emerald-600">{formatCurrency(data.income?.total)}</p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">รายจ่าย ({data.expense?.count || 0} รายการ)</p>
                <p className="text-xl font-bold text-rose-600">{formatCurrency(data.expense?.total)}</p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{data.profit >= 0 ? "กำไร" : "ขาดทุน"}</p>
                <p className={`text-xl font-bold ${data.profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {formatCurrency(Math.abs(data.profit))}
                </p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">เจ้าหนี้ค้าง</p>
                <p className="text-xl font-bold text-amber-600">{formatCurrency(data.outstanding_payable?.total)}</p>
              </CardContent></Card>
            </div>
          )}

          {/* P&L Report */}
          {reportType === "profit_loss" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <Card><CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-emerald-600" />
                    <p className="text-xs text-muted-foreground">รายรับรวม</p>
                  </div>
                  <p className="text-2xl font-bold text-emerald-600 mt-1">{formatCurrency(data.total_income)}</p>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-rose-600" />
                    <p className="text-xs text-muted-foreground">รายจ่ายรวม</p>
                  </div>
                  <p className="text-2xl font-bold text-rose-600 mt-1">{formatCurrency(data.total_expense)}</p>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{data.profit >= 0 ? "กำไรสุทธิ" : "ขาดทุนสุทธิ"}</p>
                  <p className={`text-2xl font-bold mt-1 ${data.profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {formatCurrency(Math.abs(data.profit))}
                  </p>
                </CardContent></Card>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">รายรับตามหมวดหมู่</CardTitle></CardHeader>
                  <CardContent>
                    {data.income_by_category?.length > 0 ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={data.income_by_category} dataKey="total" nameKey="name"
                            cx="50%" cy="50%" outerRadius={80}
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                            labelLine={false} fontSize={10}>
                            {data.income_by_category.map((_: any, i: number) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number) => formatCurrency(v)} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <p className="text-center py-8 text-muted-foreground text-sm">ไม่มีข้อมูล</p>}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">รายจ่ายตามหมวดหมู่</CardTitle></CardHeader>
                  <CardContent>
                    {data.expense_by_category?.length > 0 ? (
                      <div className="space-y-2">
                        {data.expense_by_category.map((item: any, i: number) => (
                          <div key={i} className="flex items-center gap-3">
                            <div className="h-3 w-3 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                            <div className="flex-1 flex justify-between text-sm">
                              <span className="truncate">{item.name || "ไม่ระบุหมวดหมู่"}</span>
                              <span className="font-medium shrink-0 ml-2">{formatCurrency(item.total)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <p className="text-center py-8 text-muted-foreground text-sm">ไม่มีข้อมูล</p>}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* Account Balance Report */}
          {reportType === "account_balance" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Card><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">ยอดเงินรวม (บัญชี)</p>
                  <p className="text-2xl font-bold">{formatCurrency(data.total_account_balance)}</p>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">ยอดเงินรวม (Holder)</p>
                  <p className="text-2xl font-bold">{formatCurrency(data.total_holder_balance)}</p>
                </CardContent></Card>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">บัญชีเงิน</CardTitle></CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <thead><tr className="border-b">
                        <th className="pb-2 text-left text-xs text-muted-foreground">บัญชี</th>
                        <th className="pb-2 text-left text-xs text-muted-foreground">ประเภท</th>
                        <th className="pb-2 text-right text-xs text-muted-foreground">ยอดเงิน</th>
                      </tr></thead>
                      <tbody className="divide-y">
                        {data.accounts?.map((a: any) => (
                          <tr key={a.id}>
                            <td className="py-2">{a.name}</td>
                            <td className="py-2 text-muted-foreground capitalize">{a.owner_type}</td>
                            <td className={`py-2 text-right font-medium ${a.balance >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                              {formatCurrency(a.balance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Holder</CardTitle></CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <thead><tr className="border-b">
                        <th className="pb-2 text-left text-xs text-muted-foreground">Holder</th>
                        <th className="pb-2 text-left text-xs text-muted-foreground">ประเภท</th>
                        <th className="pb-2 text-right text-xs text-muted-foreground">ยอดเงิน</th>
                      </tr></thead>
                      <tbody className="divide-y">
                        {data.holders?.map((h: any) => (
                          <tr key={h.id}>
                            <td className="py-2">{h.name}</td>
                            <td className="py-2 text-muted-foreground capitalize">{h.type}</td>
                            <td className={`py-2 text-right font-medium ${h.balance >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                              {formatCurrency(h.balance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </>
      )}

      {!data && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <BarChart3 className="h-12 w-12 mb-3" />
          <p className="text-base">เลือกช่วงเวลาและกด "สร้างรายงาน"</p>
        </div>
      )}
    </div>
  );
}
