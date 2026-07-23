import { useCallback, useEffect, useState } from "react";
import { Plus, Search, ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import { accountsApi } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/layout/PageHeader";
import type { Account } from "@/types";

const TYPE_LABELS: Record<string, string> = {
  asset: "สินทรัพย์", liability: "หนี้สิน", equity: "ส่วนของเจ้าของ",
  revenue: "รายได้", expense: "ค่าใช้จ่าย",
};
const TYPE_COLORS: Record<string, string> = {
  asset: "info", liability: "warning", equity: "success", revenue: "secondary", expense: "outline",
};

export function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const data = await accountsApi.list();
    setAccounts(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = accounts.filter((a) => {
    const matchType = typeFilter === "all" || a.account_type === typeFilter;
    const matchSearch = !search || a.code.includes(search) || a.name_th.includes(search);
    return matchType && matchSearch;
  });

  const roots = filtered.filter((a) => !a.parent_id);
  const childrenOf = (parentId: number) => filtered.filter((a) => a.parent_id === parentId);
  const toggle = (id: number) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  function AccountRow({ account, depth = 0 }: { account: Account; depth?: number }) {
    const children = childrenOf(account.id);
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(account.id);

    return (
      <>
        <tr className={`border-b hover:bg-muted/20 ${account.is_header ? "bg-muted/30" : ""}`}>
          <td className="px-4 py-2" style={{ paddingLeft: `${16 + depth * 20}px` }}>
            <div className="flex items-center gap-2">
              {hasChildren ? (
                <button onClick={() => toggle(account.id)} className="text-muted-foreground">
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              ) : <span className="w-3.5" />}
              <span className={`font-mono text-xs ${account.is_header ? "font-bold" : "text-muted-foreground"}`}>{account.code}</span>
            </div>
          </td>
          <td className={`px-4 py-2 text-sm ${account.is_header ? "font-semibold" : ""}`}>{account.name_th}</td>
          <td className="px-4 py-2 text-xs text-muted-foreground">{account.name_en}</td>
          <td className="px-4 py-2">
            <Badge variant={(TYPE_COLORS[account.account_type] as "info" | "warning" | "success" | "secondary" | "outline") ?? "secondary"}>
              {TYPE_LABELS[account.account_type]}
            </Badge>
          </td>
          <td className="px-4 py-2 text-center">
            {account.is_header
              ? <Badge variant="outline" className="text-[10px]">หัวข้อ</Badge>
              : <span className="text-xs text-muted-foreground">{account.normal_balance === "debit" ? "Dr" : "Cr"}</span>}
          </td>
          <td className="px-4 py-2 text-center">
            {account.is_active
              ? <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              : <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" />}
          </td>
        </tr>
        {isExpanded && children.map((c) => <AccountRow key={c.id} account={c} depth={depth + 1} />)}
      </>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="ผังบัญชี"
        description="Chart of Accounts — รหัสบัญชีมาตรฐาน SME ไทย"
        actions={
          <Button size="sm">
            <Plus className="h-4 w-4" /> เพิ่มบัญชี
          </Button>
        }
      />
      <div className="flex-1 overflow-auto p-6 space-y-4">
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="ค้นหารหัสหรือชื่อบัญชี..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกประเภท</SelectItem>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setExpanded(new Set(accounts.filter((a) => a.is_header).map((a) => a.id)))}>
            ขยายทั้งหมด
          </Button>
          <Button variant="outline" size="sm" onClick={() => setExpanded(new Set())}>
            ยุบทั้งหมด
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2 text-left text-xs text-muted-foreground">รหัส</th>
                    <th className="px-4 py-2 text-left text-xs text-muted-foreground">ชื่อภาษาไทย</th>
                    <th className="px-4 py-2 text-left text-xs text-muted-foreground">ชื่อภาษาอังกฤษ</th>
                    <th className="px-4 py-2 text-left text-xs text-muted-foreground">ประเภท</th>
                    <th className="px-4 py-2 text-center text-xs text-muted-foreground">ยอดปกติ</th>
                    <th className="px-4 py-2 text-center text-xs text-muted-foreground">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {roots.length === 0 && (
                    <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">ไม่พบบัญชี</td></tr>
                  )}
                  {roots.map((a) => <AccountRow key={a.id} account={a} />)}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
