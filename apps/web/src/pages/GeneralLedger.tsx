import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Account, GeneralLedgerRow } from "@ebizz/shared";
import { api } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { money } from "../lib/format";
import { EmptyCell } from "../components/Empty";
import { ExportButtons } from "../components/ExportButtons";
import { Pagination } from "../components/Pagination";

export function GeneralLedgerPage() {
  const { activeCompanyId, activeCompany } = useCompany();
  const [accountId, setAccountId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const ccy = activeCompany?.base_currency ?? "USD";

  const { data: accounts } = useQuery({
    queryKey: ["accounts", activeCompanyId], queryFn: () => api.get<Account[]>("/accounts"), enabled: !!activeCompanyId,
  });
  const { data: rows } = useQuery({
    queryKey: ["gl", activeCompanyId, accountId],
    queryFn: () => api.get<GeneralLedgerRow[]>(`/reports/general-ledger${accountId ? `?account=${accountId}` : ""}`),
    enabled: !!activeCompanyId,
  });

  const withRunning = useMemo(() => {
    let bal = 0;
    return (rows ?? []).map((r) => { bal += Number(r.debit) - Number(r.credit); return { ...r, running: bal }; });
  }, [rows]);
  const pageRows = withRunning.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <div className="page-head">
        <h1>General Ledger</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ExportButtons
            rows={withRunning}
            filename="general-ledger"
            title="General Ledger"
            columns={[
              { header: "Date", value: (r) => r.entry_date },
              { header: "Account", value: (r) => `${r.code} ${r.name}` },
              { header: "Party", value: (r) => r.party ?? "" },
              { header: "Memo", value: (r) => r.memo ?? r.source_type ?? "" },
              { header: "Debit", value: (r) => Number(r.debit) },
              { header: "Credit", value: (r) => Number(r.credit) },
              { header: "Balance", value: (r) => Number(r.running) },
            ]}
          />
        </div>
      </div>
      <div className="card">
        <div className="field" style={{ maxWidth: 360 }}>
          <label>Account</label>
          <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setPage(1); }}>
            <option value="">All accounts</option>
            {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </div>
        <table>
          <thead><tr><th>Date</th><th>Account</th><th>Party</th><th>Memo</th><th style={{ textAlign: "right" }}>Debit</th><th style={{ textAlign: "right" }}>Credit</th>{accountId && <th style={{ textAlign: "right" }}>Balance</th>}</tr></thead>
          <tbody>
            {pageRows.map((r, i) => (
              <tr key={i}>
                <td>{r.entry_date}</td>
                <td className="muted">{r.code} {r.name}</td>
                <td>{r.party ?? "—"}</td>
                <td>{r.memo ?? r.source_type ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{Number(r.debit) ? money(r.debit, ccy) : ""}</td>
                <td style={{ textAlign: "right" }}>{Number(r.credit) ? money(r.credit, ccy) : ""}</td>
                {accountId && <td style={{ textAlign: "right" }}>{money(r.running, ccy)}</td>}
              </tr>
            ))}
            {withRunning.length === 0 && <tr><td colSpan={accountId ? 7 : 6}><EmptyCell>No posted transactions yet.</EmptyCell></td></tr>}
          </tbody>
        </table>
        <Pagination page={page} pageSize={pageSize} total={withRunning.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
      </div>
    </div>
  );
}
