import { Link, NavLink, useLocation, useSearchParams } from "react-router-dom";
import {
  LayoutDashboard, BookOpen, FileText, BarChart3, ChevronRight,
  LogOut, ArrowUpCircle, ArrowDownCircle, CreditCard, HelpingHand,
  Calendar, Wallet, Package, ArrowLeftRight, Tag, FileBarChart,
  Building2, ChevronDown, ChevronUp, ClipboardList, Users,
  PiggyBank, Settings, FolderOpen, ChevronsUpDown, FileSearch,
  Upload, List, PenSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { Separator } from "@/components/ui/separator";
import { useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
type NavLeaf = { label: string; href: string; icon?: React.ComponentType<any> };
type NavGroup = { label: string; icon: React.ComponentType<any>; children: NavLeaf[] };
type NavItem = NavLeaf | NavGroup;

// ── Navigation config ─────────────────────────────────────────────────────────
const cashflowNav: NavItem[] = [
  { label: "แดชบอร์ด", href: "/", icon: LayoutDashboard },
  { label: "รายรับ", href: "/income", icon: ArrowUpCircle },
  { label: "รายจ่าย", href: "/expenses", icon: ArrowDownCircle },
  { label: "เจ้าหนี้", href: "/payables", icon: CreditCard },
  { label: "ลูกหนี้", href: "/receivables", icon: HelpingHand },
  { label: "กำหนดการจ่าย / รับ", href: "/schedule", icon: Calendar },
  { label: "บัญชีเงิน / Wallet", href: "/wallet-accounts", icon: Wallet },
  { label: "Holder / กระเป๋าย่อย", href: "/holders", icon: Package },
  { label: "โอนเงิน", href: "/transfers", icon: ArrowLeftRight },
  { label: "หมวดหมู่", href: "/categories", icon: Tag },
  { label: "รายงาน", href: "/cashflow-reports", icon: FileBarChart },
  { label: "เอกสาร", href: "/documents", icon: FolderOpen },
  { label: "งบประมาณ", href: "/budgets", icon: PiggyBank },
  { label: "Activity Log", href: "/activity-logs", icon: ClipboardList },
];

const accountingNav: NavItem[] = [
  { label: "ภาพรวมบัญชี", href: "/accounting", icon: LayoutDashboard },
  { label: "ผังบัญชี", href: "/accounts", icon: Building2 },
  { label: "สมุดรายวัน", href: "/journals", icon: BookOpen },
  {
    label: "ใบแจ้งหนี้",
    icon: FileText,
    children: [
      { label: "ลูกหนี้ (AR)", href: "/invoices/ar" },
      { label: "เจ้าหนี้ (AP)", href: "/invoices/ap" },
    ],
  },
  {
    label: "รายงานบัญชี",
    icon: BarChart3,
    children: [
      { label: "งบกำไรขาดทุน", href: "/reports/income-statement" },
      { label: "งบดุล", href: "/reports/balance-sheet" },
      { label: "งบทดลอง", href: "/reports/trial-balance" },
      { label: "อายุลูกหนี้", href: "/reports/ar-aging" },
      { label: "ภพ.30", href: "/reports/vat" },
    ],
  },
];

// Sub-tabs for the embedded Credit Statement Matcher. The matcher is reverse-
// proxied under /statement/ (nginx → matcher), so these can't be real router
// routes; each switches the framed iframe via ?tab=, read by StatementPage.
type StatementTab = { tab: string; label: string; icon: React.ComponentType<any> };
const statementNav: StatementTab[] = [
  { tab: "upload", label: "Upload", icon: Upload },
  { tab: "transactions", label: "รายการทั้งหมด", icon: List },
  { tab: "manual-edit", label: "Manual Edit", icon: PenSquare },
  { tab: "summary", label: "Summary", icon: BarChart3 },
  { tab: "cards", label: "จัดการบัตร", icon: CreditCard },
];

// ── Styles ────────────────────────────────────────────────────────────────────
const activeCls = "bg-primary text-primary-foreground font-medium";
const inactiveCls = "text-muted-foreground hover:bg-accent hover:text-foreground";
const baseCls = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors w-full";

// ── Components ────────────────────────────────────────────────────────────────
function LeafLink({ item, compact = false }: { item: NavLeaf; compact?: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.href}
      end={item.href === "/"}
      className={({ isActive }) => cn(baseCls, isActive ? activeCls : inactiveCls)}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      {!Icon && compact && <ChevronRight className="h-3 w-3 shrink-0" />}
      {item.label}
    </NavLink>
  );
}

function GroupLink({ item }: { item: NavGroup }) {
  const location = useLocation();
  const anyActive = item.children.some(c => location.pathname === c.href || location.pathname.startsWith(c.href + "/"));
  const [open, setOpen] = useState(anyActive);
  const Icon = item.icon;

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(baseCls, anyActive ? "text-foreground" : inactiveCls)}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">{item.label}</span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="ml-7 mt-0.5 flex flex-col gap-0.5">
          {item.children.map(child => (
            <NavLink
              key={child.href}
              to={child.href}
              className={({ isActive }) => cn(baseCls, isActive ? activeCls : inactiveCls)}
            >
              <ChevronRight className="h-3 w-3 shrink-0" />
              {child.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function NavSection({ items }: { items: NavItem[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      {items.map(item => {
        if ("children" in item) {
          return <GroupLink key={item.label} item={item as NavGroup} />;
        }
        return <LeafLink key={(item as NavLeaf).href} item={item as NavLeaf} />;
      })}
    </div>
  );
}

// Statement tabs all share the /statement path, so NavLink's pathname-based
// active state can't tell them apart — compare ?tab= ourselves instead.
function StatementSubmenu() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const activeTab = location.pathname === "/statement" ? (searchParams.get("tab") ?? "upload") : null;

  return (
    <div className="flex flex-col gap-0.5">
      {statementNav.map(({ tab, label, icon: Icon }) => (
        <Link
          key={tab}
          to={`/statement?tab=${tab}`}
          className={cn(baseCls, activeTab === tab ? activeCls : inactiveCls)}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </Link>
      ))}
    </div>
  );
}

const adminNav: NavItem[] = [
  { label: "บริษัท", href: "/companies", icon: Building2 },
  { label: "ผู้ใช้งาน", href: "/users", icon: Users },
  { label: "ตั้งค่าบริษัท", href: "/settings", icon: Settings },
];

// ── Sidebar ───────────────────────────────────────────────────────────────────
export function Sidebar() {
  const { user, logout } = useAuth();
  const { companies, currentCompany, setCurrentCompany } = useCompany();
  const location = useLocation();
  const [showAccounting, setShowAccounting] = useState(false);
  const [showStatement, setShowStatement] = useState(location.pathname === "/statement");
  const [showAdmin, setShowAdmin] = useState(false);
  const [showCompanySwitcher, setShowCompanySwitcher] = useState(false);

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-white">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <LayoutDashboard className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold">ระบบบัญชี</p>
          <p className="text-[10px] text-muted-foreground">SME Thailand</p>
        </div>
      </div>

      {/* Company Switcher */}
      {companies.length > 0 && (
        <div className="relative px-3 pb-2 border-b">
          <button
            onClick={() => setShowCompanySwitcher(o => !o)}
            className="flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm hover:bg-muted transition-colors"
          >
            <Building2 className="h-4 w-4 shrink-0 text-primary" />
            <span className="flex-1 text-left text-xs font-medium truncate">
              {currentCompany?.name_th ?? "เลือกบริษัท"}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </button>
          {showCompanySwitcher && (
            <div className="absolute left-3 right-3 top-full mt-1 z-50 rounded-lg border bg-white shadow-lg py-1">
              {companies.map(c => (
                <button
                  key={c.id}
                  onClick={() => { setShowCompanySwitcher(false); if (c.id !== currentCompany?.id) setCurrentCompany(c); }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors text-left",
                    c.id === currentCompany?.id && "bg-primary/10 text-primary font-medium"
                  )}
                >
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{c.name_th}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Cash Flow Section */}
        <NavSection items={cashflowNav} />

        <Separator />

        {/* Statement Section (Collapsible) — same pattern as บัญชีคู่ below */}
        <div>
          <button
            onClick={() => setShowStatement(o => !o)}
            className="flex w-full items-center gap-2 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground"
          >
            <FileSearch className="h-3 w-3" />
            ตรวจ Statement บัตร
            {showStatement ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
          </button>
          {showStatement && (
            <div className="mt-1">
              <StatementSubmenu />
            </div>
          )}
        </div>

        <Separator />

        {/* Accounting Section (Collapsible) */}
        <div>
          <button
            onClick={() => setShowAccounting(o => !o)}
            className="flex w-full items-center gap-2 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground"
          >
            <BookOpen className="h-3 w-3" />
            บัญชีคู่ (Advanced)
            {showAccounting ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
          </button>
          {showAccounting && (
            <div className="mt-1">
              <NavSection items={accountingNav} />
            </div>
          )}
        </div>

        {/* Admin Section */}
        {user?.role === "admin" && (
          <>
            <Separator />
            <div>
              <button
                onClick={() => setShowAdmin(o => !o)}
                className="flex w-full items-center gap-2 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground"
              >
                <Settings className="h-3 w-3" />
                ผู้ดูแลระบบ
                {showAdmin ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
              </button>
              {showAdmin && (
                <div className="mt-1">
                  <NavSection items={adminNav} />
                </div>
              )}
            </div>
          </>
        )}
      </nav>

      <Separator />

      {/* User */}
      <div className="p-3 space-y-1">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
            {user?.full_name?.[0] ?? user?.username?.[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.full_name ?? user?.username}</p>
            <p className="text-[10px] text-muted-foreground">{roleLabel(user?.role)}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" />
          ออกจากระบบ
        </button>
      </div>
    </aside>
  );
}

function roleLabel(role?: string) {
  const labels: Record<string, string> = {
    admin: "ผู้ดูแลระบบ", approver: "ผู้อนุมัติ",
    accountant: "นักบัญชี", viewer: "ผู้ดู",
  };
  return labels[role ?? ""] ?? role;
}
