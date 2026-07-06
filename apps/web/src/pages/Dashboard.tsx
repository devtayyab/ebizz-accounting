import { useQuery } from "@tanstack/react-query";
import type { Customer, Item, Paginated, Supplier } from "@ebizz/shared";
import { api } from "../lib/api";
import { useCompany } from "../state/CompanyContext";

function useCount<T>(path: string, key: string) {
  const { activeCompanyId } = useCompany();
  return useQuery({
    queryKey: [key, activeCompanyId, "count"],
    queryFn: () => api.get<Paginated<T>>(`${path}?page=1&page_size=1`),
    enabled: !!activeCompanyId,
  });
}

export function Dashboard() {
  const items = useCount<Item>("/items", "items");
  const suppliers = useCount<Supplier>("/suppliers", "suppliers");
  const customers = useCount<Customer>("/customers", "customers");

  return (
    <div>
      <div className="page-head">
        <h1>Dashboard</h1>
      </div>
      <div className="stat-row">
        <Stat label="Items" value={items.data?.total} />
        <Stat label="Suppliers" value={suppliers.data?.total} />
        <Stat label="Customers" value={customers.data?.total} />
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Welcome to Ebizz</h3>
        <p className="muted">
          Your workspace is ready with a default chart of accounts. Start by
          adding items, suppliers and customers. Recording a stock receipt or
          issue automatically posts a balanced double-entry journal to the
          general ledger.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="stat">
      <div className="value">{value ?? "—"}</div>
      <div className="label">{label}</div>
    </div>
  );
}
