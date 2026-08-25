import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock3, FileText, SlidersHorizontal, WalletCards, XCircle } from "lucide-react";
import { expenseDashboardApi, type ExpenseDashboardData, type ExpenseDashboardOption } from "@/api/approvals";
import { getApiErrorMessage } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import { formatCurrency } from "@/lib/format";

const COLORS = ["#5B7DB1", "#8E6BAF", "#3E9C7B", "#D98A3D", "#9AA3AD", "#C0708A", "#4E9A9A"];
const statusCards = [
  { key: "requested", label: "ขอเบิก", icon: FileText, tone: "text-slate-500 bg-slate-100" },
  { key: "pending_approval", label: "รออนุมัติ", icon: Clock3, tone: "text-amber-700 bg-amber-100" },
  { key: "approved", label: "อนุมัติแล้ว", icon: CheckCircle2, tone: "text-blue-700 bg-blue-100" },
  { key: "paid", label: "เบิกจ่ายแล้ว", icon: WalletCards, tone: "text-emerald-700 bg-emerald-100" },
  { key: "cancelled", label: "ยกเลิก", icon: XCircle, tone: "text-rose-700 bg-rose-100" },
] as const;

function money(value: number) {
  return formatCurrency(value).replace(/\.00$/, "");
}

function MultiFilter({ label, placeholder, options, value, onChange }: {
  label: string; placeholder: string; options: ExpenseDashboardOption[]; value: number[]; onChange: (value: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Set(value);
  const summary = value.length ? `${value.length} ${label}` : placeholder;
  return <div className="relative min-w-[190px] flex-1">
    <label className="mb-1 block text-xs font-semibold text-[#7c8592]">{label}</label>
    <button type="button" onClick={() => setOpen(current => !current)} className="flex h-10 w-full items-center justify-between rounded-lg border border-[#e4dfd2] bg-white px-3 text-left text-sm text-[#1e2a38]">
      <span className="truncate">{summary}</span><span className="text-xs text-[#7c8592]">⌄</span>
    </button>
    {open && <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-[#e4dfd2] bg-white p-2 shadow-xl">
      {options.length === 0 && <p className="p-2 text-xs text-[#7c8592]">ไม่มีข้อมูล</p>}
      {options.map(option => <label key={option.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-[#f5f2ea]">
        <input type="checkbox" checked={selected.has(option.id)} onChange={event => {
          const next = new Set(value);
          event.target.checked ? next.add(option.id) : next.delete(option.id);
          onChange(Array.from(next));
        }} />
        <span className="truncate">{option.name}</span>
      </label>)}
      {value.length > 0 && <button type="button" onClick={() => onChange([])} className="mt-1 w-full border-t pt-2 text-xs font-semibold text-[#b8874a]">ล้างการเลือก</button>}
    </div>}
  </div>;
}

export function ExpenseDashboardPage() {
  const { currentCompany } = useCompany();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [filters, setFilters] = useState({ department_ids: [] as number[], position_ids: [] as number[], requester_ids: [] as number[] });
  const [data, setData] = useState<ExpenseDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!currentCompany) return;
    setLoading(true); setError("");
    expenseDashboardApi.get({ year, ...filters })
      .then(setData)
      .catch(err => setError(getApiErrorMessage(err, "โหลดแดชบอร์ดค่าใช้จ่ายไม่สำเร็จ")))
      .finally(() => setLoading(false));
  }, [currentCompany?.id, year, filters]);

  const categoryTotal = useMemo(() => (data?.category_usage ?? []).reduce((sum, item) => sum + Number(item.total), 0), [data]);
  const overBudget = (data?.total_used ?? 0) > (data?.total_budget ?? 0);

  return <div className="min-h-full bg-[#f5f2ea] p-5 text-[#1e2a38] md:p-7">
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1e2a38] text-[#b8874a]"><WalletCards className="h-5 w-5" /></div>
          <div><h1 className="text-xl font-bold">แดชบอร์ดค่าใช้จ่าย</h1><p className="text-xs text-[#7c8592]">สรุปสถานะคำขอเบิกและงบประมาณรายปีจากข้อมูล ACC</p></div>
        </div>
        <Link to="/budgets" className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#e4dfd2] bg-white px-4 text-sm font-semibold hover:bg-[#faf8f3]"><SlidersHorizontal className="h-4 w-4" />ตั้งค่างบ</Link>
      </div>

      <div className="mb-4 rounded-xl border border-[#e4dfd2] bg-white p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28"><label className="mb-1 block text-xs font-semibold text-[#7c8592]">ปี</label><select value={year} onChange={event => setYear(Number(event.target.value))} className="h-10 w-full rounded-lg border border-[#e4dfd2] bg-white px-3 text-sm">{(data?.available_years ?? [year]).map(item => <option key={item} value={item}>ปี {item}</option>)}</select></div>
          <MultiFilter label="แผนก" placeholder="ทุกแผนก" options={data?.options.departments ?? []} value={filters.department_ids} onChange={value => setFilters(current => ({ ...current, department_ids: value }))} />
          <MultiFilter label="ตำแหน่ง" placeholder="ทุกตำแหน่ง" options={data?.options.positions ?? []} value={filters.position_ids} onChange={value => setFilters(current => ({ ...current, position_ids: value }))} />
          <MultiFilter label="ผู้เบิก" placeholder="ทุกคน" options={data?.options.requesters ?? []} value={filters.requester_ids} onChange={value => setFilters(current => ({ ...current, requester_ids: value }))} />
          <button type="button" onClick={() => setFilters({ department_ids: [], position_ids: [], requester_ids: [] })} className="h-10 rounded-lg border border-[#e4dfd2] bg-white px-4 text-sm font-semibold hover:bg-[#f5f2ea]">ล้างตัวกรอง</button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {loading && <div className="mb-4 rounded-lg border border-[#e4dfd2] bg-white px-4 py-3 text-sm text-[#7c8592]">กำลังโหลดข้อมูล...</div>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{statusCards.map(card => { const Icon = card.icon; return <div key={card.key} className="rounded-xl border border-[#e4dfd2] bg-white p-4 shadow-sm"><div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold text-[#7c8592]">{card.label}</span><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${card.tone}`}><Icon className="h-4 w-4" /></span></div><div className="font-mono text-2xl font-semibold">{(data?.status_counts?.[card.key] ?? 0).toLocaleString("th-TH")}</div></div>; })}</div>

      <div className="mb-4 flex flex-wrap items-center gap-6 rounded-xl bg-gradient-to-br from-[#1e2a38] to-[#2c3e50] p-5 text-white shadow-sm"><div><p className="text-xs font-semibold opacity-70">งบประมาณรวมทั้งปี {year}</p><p className="font-mono text-2xl font-bold">{money(data?.total_budget ?? 0)}</p></div><div className="h-10 w-px bg-white/20" /><div><p className="text-xs font-semibold opacity-70">ใช้ไปแล้วทั้งปี</p><p className="font-mono text-2xl font-bold text-[#f0b95c]">{money(data?.total_used ?? 0)}</p></div><div className="h-10 w-px bg-white/20" /><div><p className="text-xs font-semibold opacity-70">{overBudget ? "ติดลบทั้งปี" : "คงเหลือทั้งปี"}</p><p className={`font-mono text-2xl font-bold ${overBudget ? "text-[#ff8a75]" : "text-[#7fdba6]"}`}>{overBudget ? "-" : ""}{money(Math.abs(data?.total_remaining ?? 0))}</p></div>{overBudget && <p className="ml-auto text-xs font-semibold text-[#ff8a75]">⚠ ใช้จ่ายเกินงบประมาณที่ตั้งไว้ของปีนี้</p>}</div>

      <div className="mb-4 rounded-xl border border-[#e4dfd2] bg-white p-5"><h2 className="text-sm font-bold">งบประมาณเทียบกับยอดใช้จ่ายรายเดือน</h2><p className="mb-3 text-xs text-[#7c8592]">คำนวณ “ใช้ไปแล้ว” จากคำขอสถานะอนุมัติแล้วและเบิกจ่ายแล้ว</p><ResponsiveContainer width="100%" height={260}><BarChart data={data?.monthly ?? []}><CartesianGrid strokeDasharray="3 3" stroke="#e4dfd2" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={value => value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)} /><Tooltip formatter={(value: number) => money(value)} /><Legend /><Bar dataKey="budget" name="งบประมาณ" fill="#b8874a" radius={[4, 4, 0, 0]} /><Bar dataKey="used" name="ใช้ไปแล้ว" radius={[4, 4, 0, 0]}>{(data?.monthly ?? []).map(item => <Cell key={item.month} fill={item.over_budget ? "#c0392b" : "#2b6cb0"} />)}</Bar></BarChart></ResponsiveContainer></div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]"><div className="overflow-hidden rounded-xl border border-[#e4dfd2] bg-white"><div className="px-5 py-4 text-sm font-bold">รายละเอียดงบประมาณรายเดือน</div><div className="max-h-[360px] overflow-y-auto"><table className="w-full text-sm"><thead className="sticky top-0 border-b border-[#e4dfd2] bg-white text-xs text-[#7c8592]"><tr><th className="px-5 py-2 text-left">เดือน</th><th className="px-5 py-2 text-right">งบตั้งต้น</th><th className="px-5 py-2 text-right">ใช้ไปแล้ว</th><th className="px-5 py-2 text-right">คงเหลือ/ติดลบ</th></tr></thead><tbody>{(data?.monthly ?? []).map(item => <tr key={item.month} className="border-b border-[#e4dfd2] last:border-0"><td className="px-5 py-2.5 font-medium">{item.label}</td><td className="px-5 py-2.5 text-right font-mono">{money(item.budget)}</td><td className="px-5 py-2.5 text-right font-mono">{money(item.used)}</td><td className={`px-5 py-2.5 text-right font-mono font-bold ${item.over_budget ? "text-rose-600" : "text-emerald-700"}`}>{item.over_budget ? `เกินงบ ${money(Math.abs(item.remaining))}` : money(item.remaining)}</td></tr>)}</tbody></table></div></div>
        <div className="rounded-xl border border-[#e4dfd2] bg-white p-5"><h2 className="text-sm font-bold">สัดส่วนการใช้จ่ายตามหมวดหมู่</h2><p className="mb-2 text-xs text-[#7c8592]">ปี {year} • เฉพาะรายการที่อนุมัติ/เบิกจ่ายแล้ว</p>{categoryTotal > 0 ? <><ResponsiveContainer width="100%" height={190}><PieChart><Pie data={data?.category_usage ?? []} dataKey="total" nameKey="category" innerRadius={48} outerRadius={78} paddingAngle={2}>{(data?.category_usage ?? []).map((item, index) => <Cell key={item.category} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip formatter={(value: number) => money(value)} /></PieChart></ResponsiveContainer><div className="space-y-2">{(data?.category_usage ?? []).map((item, index) => <div key={item.category} className="flex items-center justify-between text-xs"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />{item.category}</span><span className="font-mono font-bold">{money(item.total)} <span className="font-normal text-[#7c8592]">({Math.round(item.total / categoryTotal * 100)}%)</span></span></div>)}</div></> : <div className="py-14 text-center text-sm text-[#7c8592]">ยังไม่มีข้อมูลการใช้จ่าย</div>}</div></div>
    </div>
  </div>;
}
