import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Company } from "@ebizz/shared";
import { api } from "../lib/api";
import { useAuth } from "./AuthContext";

interface CompanyState {
  companies: Company[];
  activeCompany: Company | null;
  activeCompanyId: string | null;
  setActiveCompanyId: (id: string) => void;
  loading: boolean;
  refetch: () => void;
}

const CompanyContext = createContext<CompanyState | undefined>(undefined);
const STORAGE_KEY = "ebizz.companyId";

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [activeCompanyId, setActive] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["companies", session?.user.id],
    queryFn: () => api.get<Company[]>("/companies"),
    enabled: !!session,
  });

  const companies = data ?? [];

  // Select the first company once loaded, and self-heal a stale/foreign id
  // (e.g. a localStorage id left over from another account) so activeCompany
  // is never null while companies exist.
  useEffect(() => {
    if (companies.length === 0) return;
    const valid = activeCompanyId && companies.some((c) => c.id === activeCompanyId);
    if (!valid) setActiveCompanyId(companies[0].id);
  }, [companies, activeCompanyId]);

  function setActiveCompanyId(id: string) {
    if (id === activeCompanyId) return;
    localStorage.setItem(STORAGE_KEY, id);
    setActive(id);
    // Drop all cached, company-scoped data so every screen refetches for the
    // newly selected company (prevents showing the previous company's amounts).
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "companies" });
  }

  const value = useMemo<CompanyState>(
    () => ({
      companies,
      activeCompany: companies.find((c) => c.id === activeCompanyId) ?? null,
      activeCompanyId,
      setActiveCompanyId,
      loading: isLoading,
      refetch,
    }),
    [companies, activeCompanyId, isLoading, refetch],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany(): CompanyState {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within CompanyProvider");
  return ctx;
}
