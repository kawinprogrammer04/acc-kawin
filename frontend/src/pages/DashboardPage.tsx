import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, FileText, AlertCircle, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { reportsApi, invoicesApi } from "@/api/client";
import { formatCurrency, formatNumber } from "@/lib/utils";
import type { IncomeStatement, Invoice } from "@/types";

const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  trend?: "up" | "down" | "neutral";
}

function StatCard({ label, value, sub, icon, trend }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
            {sub && (
              <p className={`mt-1 flex items-center gap-1 text-xs ${
                trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-500" : "text-muted-foreground"
              }`}>
                {trend === "up" && <TrendingUp className="h-3 w-3" />}
                {trend === "down" && <TrendingDown className="h-3 w-3" />}
                {sub}
              </p>
            )}
          </div>
          <div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const [report, setReport] = useState<IncomeStatement | null>(null);
  const [overdueInvoices, setOverdueInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const currentMonth = now.getMonth() + 1;

  useEffect(() => {
    Promise.all([
      reportsApi.incomeStatement({ fiscal_year_id: 3, period_from: 1, period_to: currentMonth }),
      invoicesApi.list({ invoice_type: "ar", status: "overdue", limit: 5 }),
    ])
      .then(([r, inv]) => { setReport(r); setOverdueInvoices(inv); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentMonth]);

  // Build monthly chart data (mock for demo — replace with real per-period API)
  const chartData = MONTHS.slice(0, currentMonth).map((m, i) => ({
    month: m,
    รายได้: i === currentMonth - 1 ? Number(report?.revenue.total ?? 0) : 0,
    ค่าใช้จ่าย: i === currentMonth - 1 ? Number(report?.operating_expenses.total ?? 0) : 0,
  }));

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="แดชบอร์ด"
        description={`ภาพรวมการเงิน ${MONTHS[currentMonth - 1]} ${now.getFullYear() + 543}`}
      />
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard
            label="รายได้รวม (YTD)"
            value={formatCurrency(Number(report?.revenue.total ?? 0))}
            sub={`กำไรขั้นต้น ${formatNumber(Number(report?.gross_margin_pct ?? 0))}%`}
            icon={<TrendingUp className="h-5 w-5" />}
            trend="up"
          />
          <StatCard
            label="ต้นทุนขาย (YTD)"
            value={formatCurrency(Number(report?.cost_of_goods.total ?? 0))}
            icon={<TrendingDown className="h-5 w-5" />}
            trend="down"
          />
          <StatCard
            label="ค่าใช้จ่ายดำเนินงาน"
            value={formatCurrency(Number(report?.operating_expenses.total ?? 0))}
            icon={<FileText className="h-5 w-5" />}
          />
          <StatCard
            label="กำไรสุทธิ (YTD)"
            value={formatCurrency(Number(report?.net_profit ?? 0))}
            sub={Number(report?.net_profit ?? 0) >= 0 ? "กำไร" : "ขาดทุน"}
            icon={<TrendingUp className="h-5 w-5" />}
            trend={Number(report?.net_profit ?? 0) >= 0 ? "up" : "down"}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* Revenue vs Expense Chart */}
          <Card className="col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">รายได้ vs ค่าใช้จ่าย (รายเดือน)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="รายได้" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="ค่าใช้จ่าย" fill="#f87171" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Income breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">สรุปงบกำไรขาดทุน</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {[
                { label: "รายได้รวม", value: report?.revenue.total ?? 0, color: "text-emerald-600" },
                { label: "หัก: ต้นทุนขาย", value: -(report?.cost_of_goods.total ?? 0), color: "text-red-500" },
                { label: "กำไรขั้นต้น", value: report?.gross_profit ?? 0, color: "font-semibold" },
                { label: "หัก: ค่าใช้จ่าย", value: -(report?.operating_expenses.total ?? 0), color: "text-red-500" },
                { label: "กำไรจากการดำเนินงาน", value: report?.operating_profit ?? 0, color: "font-semibold" },
                { label: "รายได้/ค่าใช้จ่ายอื่น", value: Number(report?.other_revenue.total ?? 0) - Number(report?.other_expenses.total ?? 0), color: "" },
                { label: "กำไรสุทธิ", value: report?.net_profit ?? 0, color: "font-bold text-base" },
              ].map((row) => (
                <div key={row.label} className="flex justify-between">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className={row.color}>{formatCurrency(Number(row.value))}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Overdue invoices */}
        {overdueInvoices.length > 0 && (
          <Card className="border-amber-200 bg-amber-50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-amber-700">
                <AlertCircle className="h-4 w-4" />
                ใบแจ้งหนี้เกินกำหนด ({overdueInvoices.length} รายการ)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {overdueInvoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm border border-amber-100">
                    <div>
                      <span className="font-medium">{inv.invoice_number}</span>
                      <span className="ml-2 text-muted-foreground">{inv.party_name}</span>
                    </div>
                    <span className="font-semibold text-amber-700">{formatCurrency(Number(inv.balance_due))}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
