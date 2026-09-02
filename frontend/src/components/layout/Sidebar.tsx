import { Link, NavLink, useLocation, useSearchParams } from "react-router-dom";
import {
  LayoutDashboard, BookOpen, FileText, BarChart3, ChevronRight,
  LogOut, ArrowUpCircle, ArrowDownCircle, CreditCard, HelpingHand,
  Calendar, Wallet, Package, ArrowLeftRight, Tag, FileBarChart,
  Building2, ChevronDown, ChevronUp, ClipboardList, Users,
  PiggyBank, Settings, FolderOpen, ChevronsUpDown, FileSearch,
  Upload, List, PenSquare,
  Receipt, ShieldCheck, ListTree,
  RefreshCcw, Send, Inbox, Workflow, KeyRound, X,
  ExternalLink,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { cn } from "@/lib/utils";
import { APPROVAL_INBOX_CHANGED_EVENT, approvalInboxApi } from "@/api/approvals";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { getCompanyIcon } from "@/lib/companyPresentation";
import { Separator } from "@/components/ui/separator";
import { useCallback, useEffect, useState } from "react";
import type { AppMenu } from "@/types";

// ── Types ─────────────────────────────────────────────────────────────────────
type NavLeaf = {
  key: string; label: string; href: string; icon?: React.ComponentType<any>;
  external?: boolean;
  // Sub-routes nested under `href` that are actually a different section
  // (e.g. /expense-requests/accounting is "บัญชีตรวจจ่าย", not "เบิกเงิน / ขออนุมัติ")
  // and have no nav entry of their own — NavLink's default prefix matching would
  // otherwise light this tab up while viewing them.
  excludePrefixes?: string[];
};
type NavGroup = { label: string; icon: React.ComponentType<any>; children: NavLeaf[] };
type NavItem = NavLeaf | NavGroup;

// ── Navigation config ─────────────────────────────────────────────────────────
const hrExpenseRequestsNav: NavLeaf = {
  key: "hr_expense_requests",
  label: "กลับไประบบ HR",
  href: "https://hr.kawinbrothers.com/hr/expense-requests",
  icon: ExternalLink,
  external: true,
};

const cashflowNav: NavItem[] = [
  { key: "dashboard", label: "แดชบอร์ด", href: "/", icon: LayoutDashboard },
  { key: "income", label: "รายรับ", href: "/income", icon: ArrowUpCircle },
  { key: "expenses", label: "รายจ่าย", href: "/expenses", icon: ArrowDownCircle },
  { key: "payables", label: "เจ้าหนี้", href: "/payables", icon: CreditCard },
  { key: "receivables", label: "ลูกหนี้", href: "/receivables", icon: HelpingHand },
  { key: "schedule", label: "กำหนดการจ่าย / รับ", href: "/schedule", icon: Calendar },
  { key: "wallet_accounts", label: "บัญชีเงิน / Wallet", href: "/wallet-accounts", icon: Wallet },
  { key: "wallet_accounts", label: "กระทบยอดธนาคาร", href: "/bank-reconciliation", icon: RefreshCcw },
  { key: "holders", label: "Holder / กระเป๋าย่อย", href: "/holders", icon: Package },
  { key: "transfers", label: "โอนเงิน", href: "/transfers", icon: ArrowLeftRight },
  { key: "categories", label: "หมวดหมู่", href: "/categories", icon: Tag },
  { key: "cashflow_reports", label: "รายงาน", href: "/cashflow-reports", icon: FileBarChart },
  { key: "crm_cashflow_statement", label: "รายรับ-รายจ่าย (CRM)", href: "/crm-cashflow/statements", icon: ListTree },
  { key: "crm_cashflow_invoice", label: "ติดตามใบกำกับภาษี (CRM)", href: "/crm-cashflow/invoices", icon: Receipt },
  { key: "documents", label: "เอกสาร", href: "/documents", icon: FolderOpen },
  { key: "tax_invoices", label: "ใบกำกับภาษี", href: "/tax-invoices", icon: Receipt },
  { key: "budgets", label: "งบประมาณ", href: "/budgets", icon: PiggyBank },
  {
    key: "expense_requests", label: "เบิกเงิน / ขออนุมัติ", href: "/expense-requests", icon: Send,
    excludePrefixes: ["/expense-requests/accounting", "/expense-requests/dashboard", "/expense-requests/settings"],
  },
  hrExpenseRequestsNav,
  { key: "approvals_inbox", label: "รออนุมัติของฉัน", href: "/approvals/inbox", icon: Inbox },
  { key: "activity_logs", label: "Activity Log", href: "/activity-logs", icon: ClipboardList },
];

const accountingNav: NavItem[] = [
  { key: "accounting", label: "ภาพรวมบัญชี", href: "/accounting", icon: LayoutDashboard },
  { key: "accounts", label: "ผังบัญชี", href: "/accounts", icon: Building2 },
  { key: "journals", label: "สมุดรายวัน", href: "/journals", icon: BookOpen },
  {
    label: "ใบแจ้งหนี้",
    icon: FileText,
    children: [
      { key: "invoices_ar", label: "ลูกหนี้ (AR)", href: "/invoices/ar" },
      { key: "invoices_ap", label: "เจ้าหนี้ (AP)", href: "/invoices/ap" },
    ],
  },
  {
    label: "รายงานบัญชี",
    icon: BarChart3,
    children: [
      { key: "report_income_statement", label: "งบกำไรขาดทุน", href: "/reports/income-statement" },
      { key: "report_balance_sheet", label: "งบดุล", href: "/reports/balance-sheet" },
      { key: "report_trial_balance", label: "งบทดลอง", href: "/reports/trial-balance" },
      { key: "report_ar_aging", label: "อายุลูกหนี้", href: "/reports/ar-aging" },
      { key: "report_vat", label: "ภพ.30", href: "/reports/vat" },
    ],
  },
];

// Sub-tabs for the embedded Credit Statement Matcher. The matcher is reverse-
// proxied under /statement/ (nginx → matcher), so these can't be real router
// routes; each switches the framed iframe via ?tab=, read by StatementPage.
type StatementTab = { tab: string; label: string; icon: React.ComponentType<any> };
const statementNav: StatementTab[] = [
  { tab: "upload",      label: "1. อัปโหลด Statement / TikTok", icon: Upload },
  { tab: "review",      label: "2. จับคู่ & ดูผล",              icon: FileSearch },
  { tab: "summary",     label: "3. รายงาน / Export",            icon: BarChart3 },
  { tab: "references",  label: "TikTok Refs",                    icon: ArrowLeftRight },
  { tab: "manual-edit", label: "จับคู่เอง",                      icon: PenSquare },
];

const statementKeyByTab: Record<string, string> = {
  review: "statement_transactions",
  upload: "statement_upload",
  references: "statement_manual_edit",
  transactions: "statement_transactions",
  "manual-edit": "statement_manual_edit",
  summary: "statement_summary",
  audit: "statement_summary",
  cards: "statement_cards",
};

const iconMap: Record<string, React.ComponentType<any>> = {
  LayoutDashboard, BookOpen, FileText, BarChart3, ChevronRight,
  ArrowUpCircle, ArrowDownCircle, CreditCard, HelpingHand,
  Calendar, Wallet, Package, ArrowLeftRight, Tag, FileBarChart,
  Building2, ClipboardList, Users, PiggyBank, Settings, FolderOpen,
  FileSearch, Upload, List, PenSquare, Receipt, ShieldCheck, ListTree,
  RefreshCcw,
};

const lucideIconMap = LucideIcons as unknown as Record<string, React.ComponentType<any>>;

function resolveIcon(icon?: string | null) {
  if (!icon) return undefined;
  return iconMap[icon] ?? lucideIconMap[icon];
}

// ── Styles ────────────────────────────────────────────────────────────────────
const activeCls = "bg-primary text-primary-foreground font-medium";
const inactiveCls = "text-muted-foreground hover:bg-accent hover:text-foreground";
const baseCls = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors w-full";

// ── Components ────────────────────────────────────────────────────────────────
function LeafLink({
  item, compact = false, badgeCount = 0,
}: { item: NavLeaf; compact?: boolean; badgeCount?: number }) {
  const Icon = item.icon;
  const location = useLocation();
  const excluded = item.excludePrefixes?.some(
    (prefix) => location.pathname === prefix || location.pathname.startsWith(prefix + "/"),
  );
  if (item.external) {
    return (
      <a href={item.href} className={cn(baseCls, inactiveCls)}>
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </a>
    );
  }
  return (
    <NavLink
      to={item.href}
      end={item.href === "/" || excluded}
      className={({ isActive }) => cn(baseCls, isActive && !excluded ? activeCls : inactiveCls)}
      aria-label={badgeCount > 0 ? `${item.label} มี ${badgeCount} รายการรออนุมัติ` : item.label}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      {!Icon && compact && <ChevronRight className="h-3 w-3 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badgeCount > 0 && (
        <span aria-hidden="true" className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-black leading-none text-destructive-foreground shadow-sm">
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </NavLink>
  );
}

function GroupLink({ item, badgeCounts }: { item: NavGroup; badgeCounts: Record<string, number> }) {
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
            <LeafLink key={child.href} item={child} compact badgeCount={badgeCounts[child.key]} />
          ))}
        </div>
      )}
    </div>
  );
}

function NavSection({
  items, badgeCounts = {},
}: { items: NavItem[]; badgeCounts?: Record<string, number> }) {
  return (
    <div className="flex flex-col gap-0.5">
      {items.map(item => {
        if ("children" in item) {
          return <GroupLink key={item.label} item={item as NavGroup} badgeCounts={badgeCounts} />;
        }
        const leaf = item as NavLeaf;
        return <LeafLink key={leaf.href} item={leaf} badgeCount={badgeCounts[leaf.key]} />;
      })}
    </div>
  );
}

// Statement tabs all share the /statement path, so NavLink's pathname-based
// active state can't tell them apart — compare ?tab= ourselves instead.
function StatementSubmenu() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { can } = useAuth();
  const activeTab = location.pathname === "/statement" ? (searchParams.get("tab") ?? "upload") : null;
  const visibleStatementNav = statementNav.filter(({ tab }) => can(statementKeyByTab[tab]));

  const mainTabs = ["upload", "review", "summary"];
  const advTabs  = ["references", "manual-edit"];
  const visible  = new Set(visibleStatementNav.map(n => n.tab));

  return (
    <div className="flex flex-col gap-0.5">
      {statementNav.filter(n => mainTabs.includes(n.tab) && visible.has(n.tab)).map(({ tab, label, icon: Icon }) => (
        <Link
          key={tab}
          to={`/statement?tab=${tab}`}
          className={cn(baseCls, activeTab === tab ? activeCls : inactiveCls)}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </Link>
      ))}
      {advTabs.some(t => visible.has(t)) && (
        <div className="my-1 border-t border-border/50" />
      )}
      {statementNav.filter(n => advTabs.includes(n.tab) && visible.has(n.tab)).map(({ tab, label, icon: Icon }) => (
        <Link
          key={tab}
          to={`/statement?tab=${tab}`}
          className={cn(baseCls, activeTab === tab ? activeCls : inactiveCls, "text-muted-foreground/80")}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </Link>
      ))}
    </div>
  );
}

const adminNav: NavLeaf[] = [
  { key: "companies", label: "บริษัท", href: "/companies", icon: Building2 },
  { key: "users", label: "ผู้ใช้งาน", href: "/users", icon: Users },
  { key: "settings", label: "ตั้งค่าบริษัท", href: "/settings", icon: Settings },
  { key: "roles", label: "จัดการบทบาท", href: "/roles", icon: KeyRound },
  { key: "permissions", label: "Permission", href: "/permissions", icon: ShieldCheck },
  { key: "menus", label: "จัดการเมนู", href: "/menus", icon: ListTree },
];

function filterNavItems(items: NavItem[], canView: (key: string) => boolean): NavItem[] {
  return items
    .map(item => {
      if ("children" in item) {
        const children = item.children.filter(child => canView(child.key));
        return children.length ? { ...item, children } : null;
      }
      return item.external || canView(item.key) ? item : null;
    })
    .filter(Boolean) as NavItem[];
}

function menuToLeaf(menu: AppMenu): NavLeaf | null {
  if (!menu.path) return null;
  return {
    key: menu.key,
    label: menu.label,
    href: menu.path,
    icon: resolveIcon(menu.icon),
    external: /^https?:\/\//i.test(menu.path),
    // These pages share the `/expense-requests` prefix but are separate
    // finance sections. Without this exclusion, NavLink marks both the
    // parent request menu and the accounting/settings menu as active.
    excludePrefixes: menu.key === "expense_requests"
      ? ["/expense-requests/accounting", "/expense-requests/dashboard", "/expense-requests/settings"]
      : undefined,
  };
}

function DynamicMenuGroup({
  label,
  icon,
  items,
  badgeCounts,
  defaultOpen = false,
}: {
  label: string;
  icon: React.ComponentType<any>;
  items: NavLeaf[];
  badgeCounts: Record<string, number>;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = icon;

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground"
      >
        <Icon className="h-3 w-3" />
        {label}
        {open ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
      </button>
      {open && (
        <div className="mt-1">
          <NavSection items={items} badgeCounts={badgeCounts} />
        </div>
      )}
    </div>
  );
}

function DynamicNav({
  menus, badgeCounts,
}: { menus: AppMenu[]; badgeCounts: Record<string, number> }) {
  const location = useLocation();
  const sortedMenus = [...menus].sort((a, b) =>
    a.sort_order - b.sort_order ||
    (a.group_key ?? "").localeCompare(b.group_key ?? "") ||
    a.id - b.id
  );
  const groups = sortedMenus.reduce<Record<string, { label: string; items: NavLeaf[] }>>((acc, menu) => {
    const leaf = menuToLeaf(menu);
    if (!leaf) return acc;
    const key = menu.group_key || "other";
    if (!acc[key]) acc[key] = { label: menu.group_label || "เมนู", items: [] };
    acc[key].items.push(leaf);
    return acc;
  }, {});

  const cashflow = [...(groups.cashflow?.items ?? [])];
  const hasReconciliation = cashflow.some(item => item.href === "/bank-reconciliation");
  const walletIndex = cashflow.findIndex(item => item.key === "wallet_accounts");
  if (!hasReconciliation && walletIndex >= 0) {
    cashflow.splice(walletIndex + 1, 0, {
      key: "wallet_accounts",
      label: "กระทบยอดธนาคาร",
      href: "/bank-reconciliation",
      icon: RefreshCcw,
    });
  }
  const otherGroups = Object.entries(groups).filter(([key]) => key !== "cashflow");
  const groupIcon: Record<string, React.ComponentType<any>> = {
    statement: FileSearch,
    accounting: BookOpen,
    admin: Settings,
  };

  return (
    <>
      {cashflow.length > 0 && <NavSection items={cashflow} badgeCounts={badgeCounts} />}
      {otherGroups.map(([key, group]) => (
        <div key={key}>
          {cashflow.length > 0 && <Separator />}
          <DynamicMenuGroup
            label={group.label}
            icon={groupIcon[key] ?? ListTree}
            items={group.items}
            badgeCounts={badgeCounts}
            defaultOpen={location.pathname === "/statement" || group.items.some(item => location.pathname === item.href)}
          />
        </div>
      ))}
    </>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const { user, logout, can } = useAuth();
  const { companies, currentCompany, setCurrentCompany } = useCompany();
  const location = useLocation();
  // Auto-close the mobile drawer whenever the route changes (link tap, back button, etc.)
  useEffect(() => { onMobileClose?.(); }, [location.pathname]);
  const [showAccounting, setShowAccounting] = useState(false);
  const [showStatement, setShowStatement] = useState(location.pathname === "/statement");
  const [showAdmin, setShowAdmin] = useState(false);
  const [showCompanySwitcher, setShowCompanySwitcher] = useState(false);
  const [approvalPendingCount, setApprovalPendingCount] = useState(0);
  const isCompanyAdmin = currentCompany?.role === "admin";
  const dynamicMenus = user?.permissions_configured && Array.isArray(user.allowed_menus)
    ? user.allowed_menus
    : (user?.menus ?? []);
  const useDynamicMenu = Boolean(dynamicMenus.length);
  const visibleCashflowNav = filterNavItems(cashflowNav, (key) => can(key));
  const visibleAccountingNav = filterNavItems(accountingNav, (key) => can(key));
  const visibleStatementNavCount = statementNav.filter(({ tab }) => can(statementKeyByTab[tab])).length;
  const visibleAdminNav = adminNav.filter((item) => {
    if (!can(item.key)) return false;
    if (item.href === "/users" || item.href === "/permissions" || item.href === "/menus" || item.href === "/roles") return user?.is_platform_admin;
    if (item.href === "/companies") return user?.is_platform_admin || isCompanyAdmin;
    return user?.is_platform_admin || isCompanyAdmin;
  });
  const canViewApprovalInbox = can("approvals_inbox");
  const seesEveryonesInbox = Boolean(user?.is_platform_admin || currentCompany?.role === "super_admin");
  const badgeCounts = { approvals_inbox: approvalPendingCount };

  const refreshApprovalPendingCount = useCallback(() => {
    if (!canViewApprovalInbox || !currentCompany) {
      setApprovalPendingCount(0);
      return Promise.resolve();
    }
    return approvalInboxApi.count({ scope: seesEveryonesInbox ? "all" : "mine" })
      .then(setApprovalPendingCount)
      .catch(() => undefined);
  }, [canViewApprovalInbox, currentCompany?.id, seesEveryonesInbox]);

  useEffect(() => {
    refreshApprovalPendingCount();
    const timer = window.setInterval(refreshApprovalPendingCount, 60_000);
    window.addEventListener("focus", refreshApprovalPendingCount);
    window.addEventListener(APPROVAL_INBOX_CHANGED_EVENT, refreshApprovalPendingCount);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshApprovalPendingCount);
      window.removeEventListener(APPROVAL_INBOX_CHANGED_EVENT, refreshApprovalPendingCount);
    };
  }, [refreshApprovalPendingCount, location.pathname]);

  return (
    <>
      {/* Mobile backdrop — tap to close the drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-screen w-60 flex-col border-r bg-white transition-transform duration-200 md:static md:z-auto md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <LayoutDashboard className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold">ระบบบัญชี</p>
          <p className="text-[10px] text-muted-foreground">SME Thailand</p>
        </div>
        <button
          type="button"
          onClick={onMobileClose}
          className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-muted md:hidden"
          aria-label="ปิดเมนู"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Company Switcher */}
      {companies.length > 0 && (
        <div className="relative px-3 pb-2 border-b">
          <button
            onClick={() => setShowCompanySwitcher(o => !o)}
            className="flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm hover:bg-muted transition-colors"
          >
            {currentCompany && getCompanyIcon(currentCompany) ? (
              <span className="w-4 shrink-0 text-center text-sm leading-none" aria-hidden="true">
                {getCompanyIcon(currentCompany)}
              </span>
            ) : (
              <Building2 className="h-4 w-4 shrink-0 text-primary" />
            )}
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
                  {getCompanyIcon(c) ? (
                    <span className="w-3.5 shrink-0 text-center text-sm leading-none" aria-hidden="true">{getCompanyIcon(c)}</span>
                  ) : (
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="truncate">{c.name_th}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-4">
        {useDynamicMenu ? (
          <DynamicNav menus={dynamicMenus} badgeCounts={badgeCounts} />
        ) : (
          <>
            {/* Cash Flow Section */}
            <NavSection items={visibleCashflowNav} badgeCounts={badgeCounts} />

            <Separator />

            {/* Statement Section (Collapsible) — same pattern as บัญชีคู่ below */}
            {visibleStatementNavCount > 0 && (
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
            )}

            <Separator />

            {/* Accounting Section (Collapsible) */}
            {visibleAccountingNav.length > 0 && (
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
                    <NavSection items={visibleAccountingNav} badgeCounts={badgeCounts} />
                  </div>
                )}
              </div>
            )}

            {/* Admin Section */}
            {visibleAdminNav.length > 0 && (
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
                      <NavSection items={visibleAdminNav} badgeCounts={badgeCounts} />
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
        {user?.is_platform_admin && (
          <>
            <Separator />
            <LeafLink item={{ key: "settings", label: "ซิงก์ข้อมูล HR", href: "/settings/hr-sync", icon: RefreshCcw }} />
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
            <p className="text-[10px] text-muted-foreground">
              {user?.is_platform_admin ? "ผู้ดูแลแพลตฟอร์ม" : roleLabel(currentCompany?.role)}
            </p>
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
    </>
  );
}

function roleLabel(role?: string) {
  const labels: Record<string, string> = {
    admin: "ผู้ดูแลระบบ", approver: "ผู้อนุมัติ",
    accountant: "นักบัญชี", viewer: "ผู้ดู",
  };
  return labels[role ?? ""] ?? role;
}
