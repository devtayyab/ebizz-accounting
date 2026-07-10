import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Customer, Paginated, StatementRow, Supplier } from "@ebizz/shared";
import { api } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { money } from "../lib/format";
import { ExportButtons } from "../components/ExportButtons";
import { Pagination } from "../components/Pagination";

export function StatementsPage() {
  const { activeCompanyId, activeCompany } = useCompany();
  const [kind, setKind] = useState<"customer" | "supplier">("customer");
  const [partyId, setPartyId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const ccy = activeCompany?.base_currency ?? "USD";

  const { data: customers } = useQuery({ queryKey: ["customers", "all", activeCompanyId], queryFn: () => api.get<Paginated<Customer>>("/customers?page=1&page_size=200"), enabled: !!activeCompanyId });
  const { data: suppliers } = useQuery({ queryKey: ["suppliers", "all", activeCompanyId], queryFn: () => api.get<Paginated<Supplier>>("/suppliers?page=1&page_size=200"), enabled: !!activeCompanyId });
  const parties = kind === "customer" ? (customers?.data ?? []) : (suppliers?.data ?? []);

  // Always load (all parties by default); narrow when a party is chosen.
  const { data: rows } = useQuery({
    queryKey: ["statement", kind, activeCompanyId, partyId],
    queryFn: () => api.get<StatementRow[]>(`/reports/${kind}-statement${partyId ? `?party_id=${partyId}` : ""}`),
    enabled: !!activeCompanyId,
  });

  // Running balance only makes sense for a single party.
  const withBalance = useMemo(() => {
    if (!partyId) return (rows ?? []).map((r) => ({ ...r, balance: null as number | null }));
    let bal = 0;
    return (rows ?? []).map((r) => { bal += Number(r.charge) - Number(r.credit); return { ...r, balance: bal }; });
  }, [rows, partyId]);

  const totalCharge = (rows ?? []).reduce((a, r) => a + Number(r.charge), 0);
  const totalCredit = (rows ?? []).reduce((a, r) => a + Number(r.credit), 0);
  const pageRows = withBalance.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <div className="page-head">
        <h1>Statements</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ExportButtons
            rows={withBalance}
            filename={`${kind}-statement`}
            title={kind === "customer" ? "Customer Statement" : "Supplier Statement"}
            columns={[
              { header: "Date", value: (r) => r.txn_date },
              { header: kind === "customer" ? "Customer" : "Supplier", value: (r) => r.party_name },
              { header: "Type", value: (r) => r.doc_type },
              { header: "Reference", value: (r) => r.reference ?? "" },
              { header: kind === "customer" ? "Charge" : "Bill", value: (r) => Number(r.charge) },
              { header: kind === "customer" ? "Paid/Credit" : "Paid/Debit", value: (r) => Number(r.credit) },
              { header: "Balance", value: (r) => Number(r.balance ?? 0) },
            ]}
          />
        </div>
      </div>
      <div className="card">
        <div className="grid-2" style={{ maxWidth: 640 }}>
          <div className="field">
            <label>Type</label>
            <select value={kind} onChange={(e) => { setKind(e.target.value as "customer" | "supplier"); setPartyId(""); setPage(1); }}>
              <option value="customer">Customer statements</option>
              <option value="supplier">Supplier statements</option>
            </select>
          </div>
          <div className="field">
            <label>Filter by {kind}</label>
            <select value={partyId} onChange={(e) => { setPartyId(e.target.value); setPage(1); }}>
              <option value="">All {kind === "customer" ? "customers" : "suppliers"}</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <table>
          <thead><tr>
            <th>Date</th>
            {!partyId && <th>{kind === "customer" ? "Customer" : "Supplier"}</th>}
            <th>Type</th><th>Reference</th>
            <th style={{ textAlign: "right" }}>{kind === "customer" ? "Charge" : "Bill"}</th>
            <th style={{ textAlign: "right" }}>{kind === "customer" ? "Paid/Credit" : "Paid/Debit"}</th>
            {partyId && <th style={{ textAlign: "right" }}>Balance</th>}
          </tr></thead>
          <tbody>
            {pageRows.map((r, i) => (
              <tr key={i}>
                <td>{r.txn_date}</td>
                {!partyId && <td>{r.party_name}</td>}
                <td>{r.doc_type}</td><td className="muted">{r.reference ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{Number(r.charge) ? money(r.charge, ccy) : ""}</td>
                <td style={{ textAlign: "right" }}>{Number(r.credit) ? money(r.credit, ccy) : ""}</td>
                {partyId && <td style={{ textAlign: "right", fontWeight: 600 }}>{money(r.balance ?? 0, ccy)}</td>}
              </tr>
            ))}
            {withBalance.length === 0 && <tr><td colSpan={partyId ? 6 : 6} className="muted">No transactions.</td></tr>}
            {withBalance.length > 0 && (
              <tr>
                <td colSpan={partyId ? 4 : 4} style={{ fontWeight: 700 }}>Totals</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{money(totalCharge, ccy)}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{money(totalCredit, ccy)}</td>
                {partyId && <td style={{ textAlign: "right", fontWeight: 700 }}>{money(totalCharge - totalCredit, ccy)}</td>}
              </tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} pageSize={pageSize} total={withBalance.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
      </div>
    </div>
  );
}
