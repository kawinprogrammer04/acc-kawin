import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export const DEPARTMENTS = ["Center", "Online", "Call Center", "Marketplace", "Live"] as const;
export const CATEGORIES  = ["Fixed Cost", "Variable Cost"] as const;

export type Department = typeof DEPARTMENTS[number];
export type Category   = typeof CATEGORIES[number];

interface FilterState {
  departments: Set<Department>;
  categories:  Set<Category>;
  toggleDept: (d: Department) => void;
  toggleCat:  (c: Category)   => void;
  allDeptsOn:  boolean;
  allCatsOn:   boolean;
  toggleAllDepts: () => void;
  toggleAllCats:  () => void;
  /** Returns true if a journal description matches the current filter */
  matchDesc: (desc: string) => boolean;
}

const FilterContext = createContext<FilterState | null>(null);

const LS_KEY = "acc_filter";

function load(): { depts: Department[]; cats: Category[] } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { depts: [...DEPARTMENTS], cats: [...CATEGORIES] };
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const init = load();
  const [departments, setDepts] = useState<Set<Department>>(new Set(init.depts));
  const [categories,  setCats]  = useState<Set<Category>>(new Set(init.cats));

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify({
      depts: [...departments],
      cats:  [...categories],
    }));
  }, [departments, categories]);

  const toggleDept = (d: Department) =>
    setDepts(prev => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n; });

  const toggleCat = (c: Category) =>
    setCats(prev => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; });

  const allDeptsOn = departments.size === DEPARTMENTS.length;
  const allCatsOn  = categories.size  === CATEGORIES.length;

  const toggleAllDepts = () =>
    setDepts(allDeptsOn ? new Set() : new Set(DEPARTMENTS));

  const toggleAllCats = () =>
    setCats(allCatsOn ? new Set() : new Set(CATEGORIES));

  // Match journal description format: "[Dept][Category] detail"
  const matchDesc = (desc: string): boolean => {
    const deptMatch = [...DEPARTMENTS].filter(d => desc.includes(`[${d}]`));
    const catMatch  = [...CATEGORIES].filter(c => desc.includes(`[${c}]`));

    const deptOk = deptMatch.length === 0
      ? true  // no dept tag → always show
      : deptMatch.some(d => departments.has(d));

    const catOk = catMatch.length === 0
      ? true
      : catMatch.some(c => categories.has(c));

    return deptOk && catOk;
  };

  return (
    <FilterContext.Provider value={{
      departments, categories,
      toggleDept, toggleCat,
      allDeptsOn, allCatsOn,
      toggleAllDepts, toggleAllCats,
      matchDesc,
    }}>
      {children}
    </FilterContext.Provider>
  );
}

export function useFilter() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilter must be used within FilterProvider");
  return ctx;
}

/** Parse "[Dept][Category] clean text" → { dept, category, clean } */
export function parseDesc(desc: string): { dept: string | null; category: string | null; clean: string } {
  const dept = DEPARTMENTS.find(d => desc.includes(`[${d}]`)) ?? null;
  const cat  = CATEGORIES.find(c => desc.includes(`[${c}]`)) ?? null;
  let clean = desc;
  if (dept) clean = clean.replace(`[${dept}]`, "");
  if (cat)  clean = clean.replace(`[${cat}]`, "");
  return { dept, category: cat, clean: clean.trim() };
}
