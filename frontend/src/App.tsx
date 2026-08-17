import { BrowserRouter, Navigate, Route, Routes, useParams, useSearchParams } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { CompanyProvider } from "@/context/CompanyContext";
import { FilterProvider } from "@/context/FilterContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { RequirePermission } from "@/components/auth/RequirePermission";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { JournalPage } from "@/pages/JournalPage";
import { InvoicePage } from "@/pages/InvoicePage";
import { ReportsPage } from "@/pages/ReportsPage";
import { AccountsPage } from "@/pages/AccountsPage";

// Cash Flow Module
import { CashflowDashboardPage } from "@/pages/CashflowDashboardPage";
import { IncomePage } from "@/pages/IncomePage";
import { ExpensePage } from "@/pages/ExpensePage";
import { PayablePage } from "@/pages/PayablePage";
import { ReceivablePage } from "@/pages/ReceivablePage";
import { SchedulePage } from "@/pages/SchedulePage";
import { WalletAccountPage } from "@/pages/WalletAccountPage";
import { HolderPage } from "@/pages/HolderPage";
import { TransferPage } from "@/pages/TransferPage";
import { CategoryPage } from "@/pages/CategoryPage";
import { CashflowReportsPage } from "@/pages/CashflowReportsPage";
import { ActivityLogPage } from "@/pages/ActivityLogPage";
import { UserManagementPage } from "@/pages/UserManagementPage";
import { BudgetPage } from "@/pages/BudgetPage";
import { CompanySettingsPage } from "@/pages/CompanySettingsPage";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { CompaniesPage } from "@/pages/CompaniesPage";
import { StatementPage } from "@/pages/StatementPage";
import { TaxInvoicePage } from "@/pages/TaxInvoicePage";
import { PermissionPage } from "@/pages/PermissionPage";
import { MenuManagementPage } from "@/pages/MenuManagementPage";
import { BankReconciliationPage } from "@/pages/BankReconciliationPage";
import { ExpenseRequestPage, ExpenseRequestWizardPage } from "@/pages/ExpenseRequestPage";
import { ExpenseRequestDetailPage } from "@/pages/ExpenseRequestDetailPage";
import { ApprovalInboxPage } from "@/pages/ApprovalInboxPage";
import { ExpenseAccountingPage } from "@/pages/ExpenseAccountingPage";
import { ExpenseSettingsPage } from "@/pages/ExpenseSettingsPage";
import { RoleManagementPage } from "@/pages/RoleManagementPage";
import { CrmCashflowStatementPage } from "@/pages/CrmCashflowStatementPage";
import { CrmCashflowInvoicePage } from "@/pages/CrmCashflowInvoicePage";

function guarded(menuKey: string, page: JSX.Element) {
  return <RequirePermission menuKey={menuKey}>{page}</RequirePermission>;
}

function GuardedStatementPage() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "review";
  const menuKeyByTab: Record<string, string> = {
    review: "statement_transactions",
    upload: "statement_upload",
    references: "statement_manual_edit",
    transactions: "statement_transactions",
    "manual-edit": "statement_manual_edit",
    summary: "statement_summary",
    audit: "statement_summary",
    cards: "statement_cards",
  };
  return guarded(menuKeyByTab[tab] ?? "statement_transactions", <StatementPage />);
}

function GuardedInvoicePage() {
  const { type } = useParams();
  return guarded(type === "ap" ? "invoices_ap" : "invoices_ar", <InvoicePage />);
}

function GuardedReportsPage() {
  const { report } = useParams();
  const menuKeyByReport: Record<string, string> = {
    "income-statement": "report_income_statement",
    "balance-sheet": "report_balance_sheet",
    "trial-balance": "report_trial_balance",
    "ar-aging": "report_ar_aging",
    vat: "report_vat",
  };
  return guarded(menuKeyByReport[report ?? ""] ?? "report_income_statement", <ReportsPage />);
}

export default function App() {
  return (
    <AuthProvider>
      <CompanyProvider>
      <FilterProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<AppLayout />}>
              {/* Cash Flow Module */}
              <Route path="/" element={guarded("dashboard", <CashflowDashboardPage />)} />
              <Route path="/income" element={guarded("income", <IncomePage />)} />
              <Route path="/expenses" element={guarded("expenses", <ExpensePage />)} />
              <Route path="/payables" element={guarded("payables", <PayablePage />)} />
              <Route path="/receivables" element={guarded("receivables", <ReceivablePage />)} />
              <Route path="/schedule" element={guarded("schedule", <SchedulePage />)} />
              <Route path="/wallet-accounts" element={guarded("wallet_accounts", <WalletAccountPage />)} />
              <Route path="/bank-reconciliation" element={guarded("wallet_accounts", <BankReconciliationPage />)} />
              <Route path="/holders" element={guarded("holders", <HolderPage />)} />
              <Route path="/transfers" element={guarded("transfers", <TransferPage />)} />
              <Route path="/categories" element={guarded("categories", <CategoryPage />)} />
              <Route path="/cashflow-reports" element={guarded("cashflow_reports", <CashflowReportsPage />)} />
              <Route path="/crm-cashflow/statements" element={guarded("crm_cashflow_statement", <CrmCashflowStatementPage />)} />
              <Route path="/crm-cashflow/invoices" element={guarded("crm_cashflow_invoice", <CrmCashflowInvoicePage />)} />
              <Route path="/activity-logs" element={guarded("activity_logs", <ActivityLogPage />)} />
              <Route path="/users" element={guarded("users", <UserManagementPage />)} />
              <Route path="/budgets" element={guarded("budgets", <BudgetPage />)} />
              <Route path="/expense-requests" element={guarded("expense_requests", <ExpenseRequestPage />)} />
              <Route path="/expense-requests/create" element={guarded("expense_requests", <ExpenseRequestWizardPage />)} />
              <Route path="/expense-requests/:requestId/edit" element={guarded("expense_requests", <ExpenseRequestWizardPage />)} />
              <Route path="/expense-requests/:requestId" element={guarded("expense_requests", <ExpenseRequestDetailPage />)} />
              <Route path="/approvals/inbox" element={guarded("approvals_inbox", <ApprovalInboxPage />)} />
              <Route path="/expense-requests/accounting" element={guarded("expense_accounting", <ExpenseAccountingPage />)} />
              <Route path="/expense-requests/settings" element={guarded("expense_settings", <ExpenseSettingsPage />)} />
              <Route path="/approval-matrix" element={<Navigate to="/expense-requests/settings" replace />} />
              <Route path="/roles" element={guarded("roles", <RoleManagementPage />)} />
              <Route path="/settings" element={guarded("settings", <CompanySettingsPage />)} />
              <Route path="/companies" element={guarded("companies", <CompaniesPage />)} />
              <Route path="/documents" element={guarded("documents", <DocumentsPage />)} />
              <Route path="/statement" element={<GuardedStatementPage />} />
              <Route path="/tax-invoices" element={guarded("tax_invoices", <TaxInvoicePage />)} />
              <Route path="/permissions" element={guarded("permissions", <PermissionPage />)} />
              <Route path="/menus" element={guarded("menus", <MenuManagementPage />)} />
              {/* Accounting Module (เดิม) */}
              <Route path="/accounting" element={guarded("accounting", <DashboardPage />)} />
              <Route path="/accounts" element={guarded("accounts", <AccountsPage />)} />
              <Route path="/journals" element={guarded("journals", <JournalPage />)} />
              <Route path="/invoices/:type" element={<GuardedInvoicePage />} />
              <Route path="/reports/:report" element={<GuardedReportsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </FilterProvider>
      </CompanyProvider>
    </AuthProvider>
  );
}
