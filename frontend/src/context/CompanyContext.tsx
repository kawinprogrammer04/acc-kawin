import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";

export interface Company {
  id: number;
  code: string;
  name_th: string;
  name_en?: string;
  tax_id?: string;
  is_active: boolean;
  role: "admin" | "approver" | "accountant" | "viewer" | "super_admin" | (string & {});
  department_id?: number;
  department_name?: string;
}

interface CompanyContextValue {
  companies: Company[];
  currentCompany: Company | null;
  setCurrentCompany: (c: Company) => void;
}

const CompanyContext = createContext<CompanyContextValue>({
  companies: [],
  currentCompany: null,
  setCurrentCompany: () => {},
});

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const companies: Company[] = user?.companies ?? [];

  // Restore from localStorage or default to first company
  const [currentCompany, setCurrentCompanyState] = useState<Company | null>(() => {
    const saved = localStorage.getItem("company_id");
    if (saved && companies.length > 0) {
      const found = companies.find(c => c.id === Number(saved));
      if (found) return found;
    }
    return companies[0] ?? null;
  });

  // When companies list changes (after login), sync selection
  useEffect(() => {
    if (companies.length === 0) return;
    const saved = localStorage.getItem("company_id");
    if (saved) {
      const found = companies.find(c => c.id === Number(saved));
      if (found) { setCurrentCompanyState(found); return; }
    }
    setCurrentCompanyState(companies[0]);
    localStorage.setItem("company_id", String(companies[0].id));
  }, [companies.length]);

  function setCurrentCompany(c: Company) {
    setCurrentCompanyState(c);
    localStorage.setItem("company_id", String(c.id));
    // Force re-fetch: reload page so all data re-loads for the new company
    window.location.reload();
  }

  return (
    <CompanyContext.Provider value={{ companies, currentCompany, setCurrentCompany }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  return useContext(CompanyContext);
}
