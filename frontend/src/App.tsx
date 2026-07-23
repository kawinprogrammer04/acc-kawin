import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { CompanyProvider } from "@/context/CompanyContext";
import { FilterProvider } from "@/context/FilterContext";
import { AppLayout } from "@/components/layout/AppLayout";
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
              <Route path="/" element={<CashflowDashboardPage />} />
              <Route path="/income" element={<IncomePage />} />
              <Route path="/expenses" element={<ExpensePage />} />
              <Route path="/payables" element={<PayablePage />} />
              <Route path="/receivables" element={<ReceivablePage />} />
              <Route path="/schedule" element={<SchedulePage />} />
              <Route path="/wallet-accounts" element={<WalletAccountPage />} />
              <Route path="/holders" element={<HolderPage />} />
              <Route path="/transfers" element={<TransferPage />} />
              <Route path="/categories" element={<CategoryPage />} />
              <Route path="/cashflow-reports" element={<CashflowReportsPage />} />
              <Route path="/activity-logs" element={<ActivityLogPage />} />
              <Route path="/users" element={<UserManagementPage />} />
              <Route path="/budgets" element={<BudgetPage />} />
              <Route path="/settings" element={<CompanySettingsPage />} />
              <Route path="/companies" element={<CompaniesPage />} />
              <Route path="/documents" element={<DocumentsPage />} />
              <Route path="/statement" element={<StatementPage />} />
              {/* Accounting Module (เดิม) */}
              <Route path="/accounting" element={<DashboardPage />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/journals" element={<JournalPage />} />
              <Route path="/invoices/:type" element={<InvoicePage />} />
              <Route path="/reports/:report" element={<ReportsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </FilterProvider>
      </CompanyProvider>
    </AuthProvider>
  );
}
