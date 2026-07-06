import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
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
  const [activeCompanyId, setActive] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["companies", session?.user.id],
    queryFn: () => api.get<Company[]>("/companies"),
    enabled: !!session,
  });

  const companies = data ?? [];

  // Default the active company to the first available once loaded.
  useEffect(() => {
    if (!activeCompanyId && companies.length > 0) {
      setActiveCompanyId(companies[0].id);
    }
  }, [companies, activeCompanyId]);

  function setActiveCompanyId(id: string) {
    localStorage.setItem(STORAGE_KEY, id);
    setActive(id);
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
