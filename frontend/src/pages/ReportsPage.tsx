import { useState } from "react";
import { useParams } from "react-router-dom";
import { Download, RefreshCw, Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { reportsApi } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatCurrency, formatNumber } from "@/lib/utils";
import type { IncomeStatement, BalanceSheet, TrialBalance, AgingReport, VatPP30 } from "@/types";

const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

// ── Income Statement ──────────────────────────────────────────────────────────
function IncomeStatementReport() {
  const [params, setParams] = useState({ fiscal_year_id: 3, period_from: 1, period_to: 12 });
  const [data, setData] = useState<IncomeStatement | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setData(await reportsApi.incomeStatement(params)); }
    finally { setLoading(false); }
  };

  const SectionRows = ({ section }: { section: { title: string; lines: { account_code: string; account_name: string; amount: number }[]; total: number } }) => (
    <>
      <tr className="bg-muted/40">
        <td colSpan={3} className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</td>
      </tr>
      {section.lines.map((l) => (
        <tr key={l.account_code} className="border-b hover:bg-muted/20">
          <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{l.account_code}</td>
          <td className="px-4 py-2 text-sm">{l.account_name}</td>
          <td className="px-4 py-2 text-right font-mono text-sm">{formatCurrency(Number(l.amount))}</td>
        </tr>
      ))}
      <tr className="border-b-2">
        <td colSpan={2} className="px-4 py-2 text-sm font-semibold">รวม{section.title}</td>
        <td className="px-4 py-2 text-right font-mono font-semibold">{formatCurrency(Number(section.total))}</td>
      </tr>
    </>
  );

  const SummaryRow = ({ label, value, bold, indent, colored }: { label: string; value: number; bold?: boolean; indent?: boolean; colored?: boolean }) => (
    <div className={`flex justify-between py-1.5 ${indent ? "pl-4" : ""} ${bold ? "font-bold border-t mt-1 pt-2" : ""}`}>
      <span className="text-sm">{label}</span>
      <span className={`font-mono text-sm ${colored ? (value >= 0 ? "text-emerald-600" : "text-red-500") : ""}`}>
        {formatCurrency(value)}
      </span>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="p-4 flex items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">ปีบัญชี</Label>
            <Input type="number" className="w-24" value={params.fiscal_year_id} onChange={(e) => setParams({ ...params, fiscal_year_id: Number(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">งวดเริ่ม</Label>
            <Select value={String(params.period_from)} onValueChange={(v) => setParams({ ...params, period_from: Number(v) })}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">งวดสิ้นสุด</Label>
            <Select value={String(params.period_to)} onValueChange={(v) => setParams({ ...params, period_to: Number(v) })}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            แสดงรายงาน
          </Button>
        </CardContent>
      </Card>

      {data && (
        <div className="grid grid-cols-3 gap-4">
          {/* Detailed table */}
          <Card className="col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                งบกำไรขาดทุน — งวด {MONTHS[data.period_from - 1]} ถึง {MONTHS[data.period_to - 1]}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="px-4 py-2 text-left text-xs text-muted-foreground w-24">รหัสบัญชี</th>
                    <th className="px-4 py-2 text-left text-xs text-muted-foreground">ชื่อบัญชี</th>
                    <th className="px-4 py-2 text-right text-xs text-muted-foreground">จำนวนเงิน</th>
                  </tr>
                </thead>
                <tbody>
                  <SectionRows section={data.revenue} />
                  <SectionRows section={data.cost_of_goods} />
                  <SectionRows section={data.operating_expenses} />
                  {data.other_revenue.lines.length > 0 && <SectionRows section={data.other_revenue} />}
                  {data.other_expenses.lines.length > 0 && <SectionRows section={data.other_expenses} />}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Summary panel */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">สรุปผลประกอบการ</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <SummaryRow label="รายได้จากการขาย" value={Number(data.revenue.total)} />
              <SummaryRow label="หัก: ต้นทุนขาย" value={-Number(data.cost_of_goods.total)} indent />
              <SummaryRow label="กำไรขั้นต้น" value={Number(data.gross_profit)} bold colored />
              <p className="text-xs text-muted-foreground text-right">Gross Margin {formatNumber(Number(data.gross_margin_pct))}%</p>
              <div className="mt-2">
                <SummaryRow label="หัก: ค่าใช้จ่ายดำเนินงาน" value={-Number(data.operating_expenses.total)} indent />
                <SummaryRow label="กำไรจากการดำเนินงาน" value={Number(data.operating_profit)} bold colored />
              </div>
              <div className="mt-2">
                {Number(data.other_revenue.total) !== 0 && (
                  <SummaryRow label="บวก: รายได้อื่น" value={Number(data.other_revenue.total)} indent />
                )}
                {Number(data.other_expenses.total) !== 0 && (
                  <SummaryRow label="หัก: ค่าใช้จ่ายอื่น" value={-Number(data.other_expenses.total)} indent />
                )}
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between font-bold text-base pt-1">
                <span>กำไร (ขาดทุน) สุทธิ</span>
                <span className={`font-mono ${Number(data.net_profit) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {Number(data.net_profit) >= 0 ? <TrendingUp className="h-4 w-4 inline mr-1" /> : <TrendingDown className="h-4 w-4 inline mr-1" />}
                  {formatCurrency(Number(data.net_profit))}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Balance Sheet ─────────────────────────────────────────────────────────────
function BalanceSheetReport() {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split("T")[0]);
  const [data, setData] = useState<BalanceSheet | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setData(await reportsApi.balanceSheet({ as_of_date: asOfDate })); }
    finally { setLoading(false); }
  };

  const Section = ({ section, color }: { section: { title: string; lines: { account_code: string; account_name: string; amount: number }[]; total: number }; color: string }) => (
    <div>
      <h3 className={`text-sm font-semibold mb-2 ${color}`}>{section.title}</h3>
      <div className="space-y-1">
        {section.lines.map((l) => (
          <div key={l.account_code} className="flex justify-between text-sm">
            <span className="text-muted-foreground"><span className="font-mono text-xs mr-2">{l.account_code}</span>{l.account_name}</span>
            <span className="font-mono">{formatCurrency(Number(l.amount))}</span>
          </div>
        ))}
      </div>
      <div className={`flex justify-between font-semibold text-sm mt-2 pt-2 border-t ${color}`}>
        <span>รวม{section.title}</span>
        <span className="font-mono">{formatCurrency(Number(section.total))}</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">ณ วันที่</Label>
            <Input type="date" className="w-40" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            แสดงรายงาน
          </Button>
        </CardContent>
      </Card>

      {data && (
        <>
          {!data.is_balanced && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="p-3 text-sm text-red-700">⚠️ งบดุลไม่สมดุล — กรุณาตรวจสอบรายการ</CardContent>
            </Card>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-blue-700">สินทรัพย์</CardTitle>
              </CardHeader>
              <CardContent>
                <Section section={data.assets} color="text-blue-700" />
              </CardContent>
            </Card>
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-red-600">หนี้สิน</CardTitle>
                </CardHeader>
                <CardContent>
                  <Section section={data.liabilities} color="text-red-600" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-emerald-600">ส่วนของเจ้าของ</CardTitle>
                </CardHeader>
                <CardContent>
                  <Section section={data.equity} color="text-emerald-600" />
                  <Separator className="my-3" />
                  <div className="flex justify-between font-bold text-sm">
                    <span>รวมหนี้สินและส่วนของเจ้าของ</span>
                    <span className="font-mono">{formatCurrency(Number(data.total_liabilities_and_equity))}</span>
                  </div>
                  <div className={`mt-1 text-xs ${data.is_balanced ? "text-emerald-600" : "text-red-500"}`}>
                    {data.is_balanced ? "✓ งบดุลสมดุล" : "✗ งบดุลไม่สมดุล"}
                    {" — "}สินทรัพย์: {formatCurrency(Number(data.assets.total))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Trial Balance ─────────────────────────────────────────────────────────────
function TrialBalanceReport() {
  const [params, setParams] = useState({ fiscal_year_id: 3, period_number: new Date().getMonth() + 1 });
  const [data, setData] = useState<TrialBalance | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setData(await reportsApi.trialBalance(params)); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">ปีบัญชี</Label>
            <Input type="number" className="w-24" value={params.fiscal_year_id} onChange={(e) => setParams({ ...params, fiscal_year_id: Number(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">งวด</Label>
            <Select value={String(params.period_number)} onValueChange={(v) => setParams({ ...params, period_number: Number(v) })}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            แสดงรายงาน
          </Button>
        </CardContent>
      </Card>

      {data && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">งบทดลอง — งวด {MONTHS[data.period_number - 1]}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left text-xs text-muted-foreground">รหัสบัญชี</th>
                  <th className="px-4 py-2 text-left text-xs text-muted-foreground">ชื่อบัญชี</th>
                  <th className="px-4 py-2 text-right text-xs text-muted-foreground">ประเภท</th>
                  <th className="px-4 py-2 text-right text-xs text-muted-foreground">เดบิต</th>
                  <th className="px-4 py-2 text-right text-xs text-muted-foreground">เครดิต</th>
                  <th className="px-4 py-2 text-right text-xs text-muted-foreground">ยอดสุทธิ</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l) => (
                  <tr key={l.account_code} className="border-b hover:bg-muted/20">
                    <td className="px-4 py-2 font-mono text-xs">{l.account_code}</td>
                    <td className="px-4 py-2">{l.account_name}</td>
                    <td className="px-4 py-2 text-right text-xs text-muted-foreground">{typeLabel(l.account_type)}</td>
                    <td className="px-4 py-2 text-right font-mono">{Number(l.total_debit) > 0 ? formatCurrency(Number(l.total_debit)) : ""}</td>
                    <td className="px-4 py-2 text-right font-mono">{Number(l.total_credit) > 0 ? formatCurrency(Number(l.total_credit)) : ""}</td>
                    <td className={`px-4 py-2 text-right font-mono font-medium ${Number(l.net_balance) < 0 ? "text-red-500" : ""}`}>
                      {formatCurrency(Number(l.net_balance))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 bg-muted/50 font-semibold">
                  <td colSpan={3} className="px-4 py-2">รวมทั้งสิ้น</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(Number(data.total_debit))}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(Number(data.total_credit))}</td>
                  <td className="px-4 py-2 text-right text-xs">
                    {Math.abs(Number(data.total_debit) - Number(data.total_credit)) < 0.01
                      ? <span className="text-emerald-600">✓ สมดุล</span>
                      : <span className="text-red-500">✗ ไม่สมดุล</span>}
                  </td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── AR Aging ──────────────────────────────────────────────────────────────────
function AgingReport() {
  const [data, setData] = useState<AgingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<"ar" | "ap">("ar");

  const load = async () => {
    setLoading(true);
    try { setData(type === "ar" ? await reportsApi.arAging() : await reportsApi.apAging()); }
    finally { setLoading(false); }
  };

  const BUCKET_COLORS: Record<string, string> = {
    "ยังไม่ถึงกำหนด": "text-emerald-600",
    "เกิน 1-30 วัน": "text-amber-500",
    "เกิน 31-60 วัน": "text-orange-500",
    "เกิน 61-90 วัน": "text-red-400",
    "เกิน 90 วันขึ้นไป": "text-red-700 font-bold",
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">ประเภท</Label>
            <Select value={type} onValueChange={(v) => setType(v as "ar" | "ap")}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ar">ลูกหนี้ (AR)</SelectItem>
                <SelectItem value="ap">เจ้าหนี้ (AP)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            แสดงรายงาน
          </Button>
        </CardContent>
      </Card>
      {data && (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">รายงานอายุ{type === "ar" ? "ลูกหนี้" : "เจ้าหนี้"}</CardTitle>
            <span className="text-sm font-semibold">ยอดรวม: {formatCurrency(Number(data.total_balance))}</span>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  {["รหัส", type === "ar" ? "ลูกค้า" : "ผู้ขาย", "เลขที่", "วันครบกำหนด", "ยอดรวม", "ค้างชำระ", "เกิน (วัน)", "ช่วงอายุ"].map((h) => (
                    <th key={h} className="px-4 py-2 text-left text-xs text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.lines.length === 0 && (
                  <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">ไม่มีรายการค้างชำระ</td></tr>
                )}
                {data.lines.map((l, i) => (
                  <tr key={i} className="border-b hover:bg-muted/20">
                    <td className="px-4 py-2 text-xs text-muted-foreground">{l.customer_code}</td>
                    <td className="px-4 py-2 font-medium">{l.customer_name}</td>
                    <td className="px-4 py-2 font-mono text-xs">{l.invoice_number}</td>
                    <td className="px-4 py-2 text-xs">{l.due_date}</td>
                    <td className="px-4 py-2 text-right font-mono">{formatCurrency(Number(l.total_amount))}</td>
                    <td className="px-4 py-2 text-right font-mono font-semibold">{formatCurrency(Number(l.balance_due))}</td>
                    <td className={`px-4 py-2 text-right ${BUCKET_COLORS[l.aging_bucket] ?? ""}`}>
                      {l.days_overdue > 0 ? l.days_overdue : "-"}
                    </td>
                    <td className={`px-4 py-2 text-xs ${BUCKET_COLORS[l.aging_bucket] ?? ""}`}>{l.aging_bucket}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── VAT PP30 ──────────────────────────────────────────────────────────────────
function VatPP30Report() {
  const now = new Date();
  const [params, setParams] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [data, setData] = useState<VatPP30 | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setData(await reportsApi.vatPP30(params)); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">ปี (ค.ศ.)</Label>
            <Input type="number" className="w-28" value={params.year} onChange={(e) => setParams({ ...params, year: Number(e.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">เดือน</Label>
            <Select value={String(params.month)} onValueChange={(v) => setParams({ ...params, month: Number(v) })}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            แสดงรายงาน
          </Button>
        </CardContent>
      </Card>

      {data && (
        <div className="grid grid-cols-2 gap-4">
          {[
            { title: "ภาษีขาย (Output VAT)", data: data.output_vat, color: "text-blue-700" },
            { title: "ภาษีซื้อ (Input VAT)", data: data.input_vat, color: "text-purple-700" },
          ].map((section) => (
            <Card key={section.title}>
              <CardHeader className="pb-2"><CardTitle className={`text-sm ${section.color}`}>{section.title}</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">จำนวนใบกำกับ</span>
                  <span className="font-semibold">{section.data.doc_count} ฉบับ</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ยอดขาย/ซื้อก่อน VAT</span>
                  <span className="font-mono">{formatCurrency(Number(section.data.total_taxable))}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-bold">
                  <span>VAT 7%</span>
                  <span className="font-mono">{formatCurrency(Number(section.data.total_vat))}</span>
                </div>
              </CardContent>
            </Card>
          ))}
          <Card className={`col-span-2 ${Number(data.net_vat_payable) > 0 ? "border-blue-200 bg-blue-50" : "border-green-200 bg-green-50"}`}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{Number(data.net_vat_payable) >= 0 ? "VAT ที่ต้องนำส่ง" : "VAT ที่ขอคืนได้"}</p>
                <p className="text-xs text-muted-foreground">ภาษีขาย − ภาษีซื้อ</p>
              </div>
              <p className={`text-3xl font-bold font-mono ${Number(data.net_vat_payable) >= 0 ? "text-blue-700" : "text-green-700"}`}>
                {formatCurrency(Math.abs(Number(data.net_vat_payable)))}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────
const reportConfig: Record<string, { title: string; desc: string; component: React.ComponentType }> = {
  "income-statement": { title: "งบกำไรขาดทุน", desc: "รายได้ ต้นทุน และกำไรตามงวด", component: IncomeStatementReport },
  "balance-sheet":    { title: "งบดุล",         desc: "สินทรัพย์ หนี้สิน ส่วนของเจ้าของ ณ วันที่", component: BalanceSheetReport },
  "trial-balance":    { title: "งบทดลอง",       desc: "ยอดรวม Debit/Credit ต่อบัญชีในงวด", component: TrialBalanceReport },
  "ar-aging":         { title: "อายุลูกหนี้",   desc: "รายงานลูกหนี้เกินกำหนดชำระ", component: AgingReport },
  vat:                { title: "รายงาน ภพ.30",  desc: "สรุปภาษีมูลค่าเพิ่มรายเดือน", component: VatPP30Report },
};

function typeLabel(t: string) {
  const m: Record<string, string> = { asset: "สินทรัพย์", liability: "หนี้สิน", equity: "ทุน", revenue: "รายได้", expense: "ค่าใช้จ่าย" };
  return m[t] ?? t;
}

export function ReportsPage() {
  const { report } = useParams<{ report: string }>();
  const cfg = reportConfig[report ?? "income-statement"];
  const Component = cfg?.component ?? IncomeStatementReport;

  return (
    <div className="flex flex-col h-full">
      <PageHeader title={cfg?.title ?? "รายงาน"} description={cfg?.desc} actions={
        <Button variant="outline" size="sm"><Download className="h-4 w-4" /> ส่งออก</Button>
      } />
      <div className="flex-1 overflow-auto p-6">
        <Component />
      </div>
    </div>
  );
}
