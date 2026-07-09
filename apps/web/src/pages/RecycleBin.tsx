import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { useConfirm } from "../state/ConfirmContext";
import { EmptyCell } from "../components/Empty";

interface BinRow { type: string; id: string; label: string; sub: string | null; deleted_at: string }

const TYPE_LABEL: Record<string, string> = {
  invoice: "Invoice", bill: "Bill", expense: "Expense",
  item: "Item", customer: "Customer", supplier: "Supplier",
};

export function RecycleBinPage() {
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();
  const confirm = useConfirm();

  const { data, isLoading } = useQuery({
    queryKey: ["recycle-bin", activeCompanyId],
    queryFn: () => api.get<BinRow[]>("/recycle-bin"),
    enabled: !!activeCompanyId,
  });
  const invalidate = () => {
    // A restore/purge can re-surface a record everywhere, so refresh broadly.
    ["recycle-bin", "invoices", "bills", "expenses", "items", "customers", "suppliers", "reports", "dashboard"]
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const restore = useMutation({
    mutationFn: (r: BinRow) => api.post("/recycle-bin/restore", { type: r.type, id: r.id }),
    onSuccess: invalidate, meta: { successMessage: "Record restored" },
  });
  const purge = useMutation({
    mutationFn: (r: BinRow) => api.delete(`/recycle-bin/${r.type}/${r.id}`),
    onSuccess: invalidate, meta: { successMessage: "Record permanently deleted" },
  });

  return (
    <div>
      <div className="page-head"><h1>Recycle Bin</h1></div>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Deleted invoices, bills, expenses, items, customers and suppliers land here. Restoring an
          invoice/bill/expense re-posts its ledger entry; permanent delete cannot be undone.
        </p>
        {isLoading ? <p className="muted">Loading…</p> : (
          <table>
            <thead><tr><th>Type</th><th>Record</th><th>Detail</th><th>Deleted</th><th /></tr></thead>
            <tbody>
              {(data ?? []).map((r) => (
                <tr key={`${r.type}-${r.id}`}>
                  <td><span className="badge info">{TYPE_LABEL[r.type] ?? r.type}</span></td>
                  <td>{r.label}</td>
                  <td className="muted">{r.sub || "—"}</td>
                  <td className="muted">{r.deleted_at?.slice(0, 10)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="link" onClick={() => restore.mutate(r)}>Restore</button>
                    <button className="link danger" onClick={() => confirm({
                      title: "Delete permanently",
                      message: `Permanently delete “${r.label}”? This cannot be undone.`,
                      confirmLabel: "Delete permanently", danger: true,
                    }).then((ok) => ok && purge.mutate(r))}>Delete permanently</button>
                  </td>
                </tr>
              ))}
              {data?.length === 0 && <tr><td colSpan={5}><EmptyCell>Recycle Bin is empty.</EmptyCell></td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
