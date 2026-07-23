import { useEffect, useState } from "react";
import {
  TrendingUp, TrendingDown, Wallet, AlertTriangle, Clock,
  Building2, User, ArrowUpCircle, ArrowDownCircle, Loader2
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { dashboardApi } from "@/api/cashflow";
import { formatCurrency, formatDate, isOverdue } from "@/lib/format";
import { PageHeader } from "@/components/layout/PageHeader";

const PIE_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#8b5cf6", "#f97316"];

function StatCard({
  label, value, sub, icon, trend, color = "indigo"
}: {
  label: string; value: string; sub?: string;
  icon: React.ReactNode; trend?: "up" | "down" | "neutral"; color?: string;
}) {
  const colorMap: Record<string, string> = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
    amber: "bg-amber-50 text-amber-600",
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-bold truncate">{value}</p>
            {sub && (
              <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${
                trend === "up" ? "text-emerald-600" : trend === "down" ? "text-rose-600" : "text-muted-foreground"
              }`}>
                {trend === "up" && <TrendingUp className="h-3 w-3" />}
                {trend === "down" && <TrendingDown className="h-3 w-3" />}
                {sub}
              </p>
            )}
          </div>
          <div className={`rounded-xl p-2.5 ml-3 ${colorMap[color] || colorMap.indigo}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const MONTH_NAMES = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export function CashflowDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [year, setYear] = useState(() => new Date().getFullYear());

  useEffect(() => {
    setLoading(true);
    dashboardApi.getCashflow({ month, year })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [month, year]);

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const s = data?.summary || {};
  const profit = s.profit_this_month || 0;
  const periodLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const curYear = new Date().getFullYear();

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="แดชบอร์ด" subtitle="ภาพรวมการเงินทั้งหมด" />

      {/* Month selector — affects the monthly cards & charts only; balances/overdue stay real-time */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">สรุปประจำเดือน</span>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="rounded-md border bg-white px-2 py-1 text-sm"
        >
          {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-md border bg-white px-2 py-1 text-sm"
        >
          {[curYear - 2, curYear - 1, curYear].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="ยอดเงินรวม"
          value={formatCurrency(s.total_balance)}
          icon={<Wallet className="h-5 w-5" />}
          color="indigo"
        />
        <StatCard
          label="ยอดเงินบริษัท"
          value={formatCurrency(s.company_balance)}
          icon={<Building2 className="h-5 w-5" />}
          color="indigo"
        />
        <StatCard
          label="ยอดเงินส่วนตัว"
          value={formatCurrency(s.personal_balance)}
          icon={<User className="h-5 w-5" />}
          color="amber"
        />
        <StatCard
          label={profit >= 0 ? "กำไรเดือนนี้" : "ขาดทุนเดือนนี้"}
          value={formatCurrency(Math.abs(profit))}
          trend={profit >= 0 ? "up" : "down"}
          sub={profit >= 0 ? "กำไร" : "ขาดทุน"}
          icon={profit >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
          color={profit >= 0 ? "emerald" : "rose"}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={`รายรับ ${periodLabel}`}
          value={formatCurrency(s.income_this_month)}
          icon={<ArrowUpCircle className="h-5 w-5" />}
          color="emerald"
          trend="up"
        />
        <StatCard
          label={`รายจ่าย ${periodLabel}`}
          value={formatCurrency(s.expense_this_month)}
          icon={<ArrowDownCircle className="h-5 w-5" />}
          color="rose"
          trend="down"
        />
        <StatCard
          label="เจ้าหนี้ค้างจ่าย"
          value={formatCurrency(s.total_payable)}
          sub={`${s.payable_count || 0} รายการ`}
          icon={<AlertTriangle className="h-5 w-5" />}
          color="amber"
        />
        <StatCard
          label="ลูกหนี้ค้างรับ"
          value={formatCurrency(s.total_receivable)}
          sub={`${s.receivable_count || 0} รายการ`}
          icon={<Clock className="h-5 w-5" />}
          color="indigo"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Monthly Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">รายรับ - รายจ่าย (6 เดือนล่าสุด)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data?.monthly_chart || []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Legend />
                <Bar dataKey="income" name="รายรับ" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" name="รายจ่าย" fill="#f43f5e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Expense by Category Pie */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">รายจ่ายตามหมวดหมู่</CardTitle>
          </CardHeader>
          <CardContent>
            {(data?.expense_by_category?.length ?? 0) > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={data.expense_by_category}
                    dataKey="total"
                    nameKey="name"
                    cx="50%" cy="50%"
                    outerRadius={75}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                    fontSize={10}
                  >
                    {data.expense_by_category.map((_: any, i: number) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                ยังไม่มีข้อมูลรายจ่ายเดือนนี้
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Accounts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ยอดเงินตามบัญชี</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data?.accounts || []).map((a: any) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{a.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {a.account_type === "bank" ? "ธนาคาร" : a.account_type === "cash" ? "เงินสด" : "e-Wallet"}
                      {" · "}
                      {a.owner_type === "company" ? "บริษัท" : "ส่วนตัว"}
                    </p>
                  </div>
                  <span className={`font-semibold text-sm ${a.current_balance >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {formatCurrency(a.current_balance)}
                  </span>
                </div>
              ))}
              {(data?.accounts?.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">ยังไม่มีบัญชีเงิน</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Holders */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ยอดเงินตาม Holder</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data?.holders || []).map((h: any) => (
                <div key={h.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{h.name}</p>
                    <p className="text-[11px] text-muted-foreground capitalize">{h.holder_type}</p>
                  </div>
                  <span className={`font-semibold text-sm ${h.current_balance >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {formatCurrency(h.current_balance)}
                  </span>
                </div>
              ))}
              {(data?.holders?.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">ยังไม่มี Holder</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Overdue */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-rose-600">
              <AlertTriangle className="h-4 w-4" /> รายการเลยกำหนด
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {[
                ...(data?.overdue_payables || []).map((p: any) => ({ ...p, dir: "จ่าย", name: p.creditor_name })),
                ...(data?.overdue_receivables || []).map((r: any) => ({ ...r, dir: "รับ", name: r.debtor_name })),
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-rose-50 px-3 py-2">
                  <div>
                    <Badge variant="destructive" className="mb-0.5 text-[10px]">{item.dir}</Badge>
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(item.due_date)}</p>
                  </div>
                  <span className="text-sm font-semibold text-rose-700">{formatCurrency(item.remaining_amount)}</span>
                </div>
              ))}
              {(data?.overdue_payables?.length + data?.overdue_receivables?.length === 0) && (
                <p className="text-center py-4 text-sm text-muted-foreground">ไม่มีรายการเลยกำหนด 🎉</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Upcoming 7 days */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-amber-600">
              <Clock className="h-4 w-4" /> ครบกำหนดใน 7 วัน
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {[
                ...(data?.upcoming_payables || []).map((p: any) => ({ ...p, dir: "จ่าย", name: p.creditor_name })),
                ...(data?.upcoming_receivables || []).map((r: any) => ({ ...r, dir: "รับ", name: r.debtor_name })),
              ].sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
               .map((item, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2">
                  <div>
                    <Badge className="mb-0.5 text-[10px] bg-amber-500">{item.dir}</Badge>
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(item.due_date)}</p>
                  </div>
                  <span className="text-sm font-semibold text-amber-700">{formatCurrency(item.remaining_amount)}</span>
                </div>
              ))}
              {(data?.upcoming_payables?.length + data?.upcoming_receivables?.length === 0) && (
                <p className="text-center py-4 text-sm text-muted-foreground">ไม่มีรายการในอีก 7 วัน</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
