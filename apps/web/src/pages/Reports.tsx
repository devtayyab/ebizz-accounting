import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  Account, AgingRow, BalanceSheet, InventoryValuationRow, LowStockRow, ProfitAndLoss, ReportLine, TrialBalanceRow,
} from "@ebizz/shared";
import { api } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { money } from "../lib/format";
import { ExportButtons } from "../components/ExportButtons";

const TABS = [
  { key: "pnl", label: "Profit & Loss" },
  { key: "balance", label: "Balance Sheet" },
  { key: "trial", label: "Trial Balance" },
  { key: "ar", label: "A/R Aging" },
  { key: "ap", label: "A/P Aging" },
  { key: "valuation", label: "Inventory Valuation" },
  { key: "lowstock", label: "Low Stock" },
  { key: "taxsummary", label: "Tax Summary" },
  { key: "daybook", label: "Day Book" },
  { key: "salesreg", label: "Sales Register" },
  { key: "purchasereg", label: "Purchase Register" },
  { key: "ledger", label: "Account Ledger" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function ReportsPage() {
  const { activeCompany } = useCompany();
  const [tab, setTab] = useState<TabKey>("pnl");
  const ccy = activeCompany?.base_currency ?? "USD";

  return (
    <div>
      <div className="page-head"><h1>Reports</h1></div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "primary" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="card">
        {tab === "pnl" && <ProfitLoss ccy={ccy} />}
        {tab === "balance" && <BalanceSheetView ccy={ccy} />}
        {tab === "trial" && <TrialBalance ccy={ccy} />}
        {tab === "ar" && <Aging kind="ar" ccy={ccy} />}
        {tab === "ap" && <Aging kind="ap" ccy={ccy} />}
        {tab === "valuation" && <Valuation ccy={ccy} />}
        {tab === "lowstock" && <LowStock />}
        {tab === "taxsummary" && <TaxSummary ccy={ccy} />}
        {tab === "daybook" && <DayBook ccy={ccy} />}
        {tab === "salesreg" && <Register kind="sales" ccy={ccy} />}
        {tab === "purchasereg" && <Register kind="purchase" ccy={ccy} />}
        {tab === "ledger" && <AccountLedger ccy={ccy} />}
      </div>
    </div>
  );
}

function ProfitLoss({ ccy }: { ccy: string }) {
  const { activeCompanyId } = useCompany();
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "pnl", activeCompanyId],
    queryFn: () => api.get<ProfitAndLoss>("/reports/profit-loss"),
    enabled: !!activeCompanyId,
  });
  if (isLoading || !data) return <p className="muted">Loading…</p>;
  const rows = (title: string, lines: ReportLine[], total: string) => (
    <>
      <tr><td colSpan={2} style={{ fontWeight: 700, paddingTop: 14 }}>{title}</td></tr>
      {lines.map((l) => <tr key={l.account_id}><td style={{ paddingLeft: 24 }}>{l.code} {l.name}</td><td style={{ textAlign: "right" }}>{money(l.amount, ccy)}</td></tr>)}
      <tr><td style={{ fontWeight: 600 }}>Total {title}</td><td style={{ textAlign: "right", fontWeight: 600 }}>{money(total, ccy)}</td></tr>
    </>
  );
  return (
    <table>
      <tbody>
        {rows("Income", data.income, data.total_income)}
        {rows("Expenses", data.expenses, data.total_expenses)}
        <tr><td style={{ fontWeight: 700, fontSize: 16, paddingTop: 14 }}>Net Profit</td>
          <td style={{ textAlign: "right", fontWeight: 700, fontSize: 16 }}>{money(data.net_profit, ccy)}</td></tr>
      </tbody>
    </table>
  );
}

function BalanceSheetView({ ccy }: { ccy: string }) {
  const { activeCompanyId } = useCompany();
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "balance", activeCompanyId],
    queryFn: () => api.get<BalanceSheet>("/reports/balance-sheet"),
    enabled: !!activeCompanyId,
  });
  if (isLoading || !data) return <p className="muted">Loading…</p>;
  const section = (title: string, lines: ReportLine[]) => (
    <>
      <tr><td colSpan={2} style={{ fontWeight: 700, paddingTop: 14 }}>{title}</td></tr>
      {lines.map((l) => <tr key={l.account_id}><td style={{ paddingLeft: 24 }}>{l.code} {l.name}</td><td style={{ textAlign: "right" }}>{money(l.amount, ccy)}</td></tr>)}
    </>
  );
  return (
    <table>
      <tbody>
        {section("Assets", data.assets)}
        <tr><td style={{ fontWeight: 600 }}>Total Assets</td><td style={{ textAlign: "right", fontWeight: 600 }}>{money(data.total_assets, ccy)}</td></tr>
        {section("Liabilities", data.liabilities)}
        <tr><td style={{ fontWeight: 600 }}>Total Liabilities</td><td style={{ textAlign: "right", fontWeight: 600 }}>{money(data.total_liabilities, ccy)}</td></tr>
        {section("Equity", data.equity)}
        <tr><td style={{ paddingLeft: 24 }}>Retained earnings (net profit)</td><td style={{ textAlign: "right" }}>{money(data.retained_earnings, ccy)}</td></tr>
        <tr><td style={{ fontWeight: 600 }}>Total Equity</td><td style={{ textAlign: "right", fontWeight: 600 }}>{money(data.total_equity, ccy)}</td></tr>
        <tr><td style={{ fontWeight: 700, paddingTop: 14 }}>Liabilities + Equity</td>
          <td style={{ textAlign: "right", fontWeight: 700, paddingTop: 14 }}>
            {money(Number(data.total_liabilities) + Number(data.total_equity), ccy)}</td></tr>
      </tbody>
    </table>
  );
}

function TrialBalance({ ccy }: { ccy: string }) {
  const { activeCompanyId } = useCompany();
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "trial", activeCompanyId],
    queryFn: () => api.get<TrialBalanceRow[]>("/reports/trial-balance"),
    enabled: !!activeCompanyId,
  });
  if (isLoading || !data) return <p className="muted">Loading…</p>;
  const totDebit = data.reduce((a, r) => a + Number(r.debit), 0);
  const totCredit = data.reduce((a, r) => a + Number(r.credit), 0);
  return (
    <table>
      <thead><tr><th>Code</th><th>Account</th><th style={{ textAlign: "right" }}>Debit</th><th style={{ textAlign: "right" }}>Credit</th></tr></thead>
      <tbody>
        {data.map((r) => (
          <tr key={r.account_id}>
            <td>{r.code}</td><td>{r.name}</td>
            <td style={{ textAlign: "right" }}>{Number(r.debit) ? money(r.debit, ccy) : ""}</td>
            <td style={{ textAlign: "right" }}>{Number(r.credit) ? money(r.credit, ccy) : ""}</td>
          </tr>
        ))}
        <tr><td /><td style={{ fontWeight: 700 }}>Totals</td>
          <td style={{ textAlign: "right", fontWeight: 700 }}>{money(totDebit, ccy)}</td>
          <td style={{ textAlign: "right", fontWeight: 700 }}>{money(totCredit, ccy)}</td></tr>
      </tbody>
    </table>
  );
}

function Valuation({ ccy }: { ccy: string }) {
  const { activeCompanyId } = useCompany();
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "valuation", activeCompanyId],
    queryFn: () => api.get<InventoryValuationRow[]>("/reports/inventory-valuation"),
    enabled: !!activeCompanyId,
  });
  if (isLoading || !data) return <p className="muted">Loading…</p>;
  const total = data.reduce((a, r) => a + Number(r.value), 0);
  return (
    <table>
      <thead><tr><th>SKU</th><th>Item</th><th style={{ textAlign: "right" }}>On hand</th><th style={{ textAlign: "right" }}>Avg cost</th><th style={{ textAlign: "right" }}>Value</th></tr></thead>
      <tbody>
        {data.map((r) => (
          <tr key={r.item_id}><td>{r.sku}</td><td>{r.name}</td>
            <td style={{ textAlign: "right" }}>{Number(r.quantity)}</td>
            <td style={{ textAlign: "right" }}>{money(r.average_cost, ccy)}</td>
            <td style={{ textAlign: "right" }}>{money(r.value, ccy)}</td></tr>
        ))}
        <tr><td /><td /><td /><td style={{ fontWeight: 700, textAlign: "right" }}>Total</td>
          <td style={{ fontWeight: 700, textAlign: "right" }}>{money(total, ccy)}</td></tr>
      </tbody>
    </table>
  );
}

function LowStock() {
  const { activeCompanyId } = useCompany();
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "lowstock", activeCompanyId],
    queryFn: () => api.get<LowStockRow[]>("/reports/low-stock"),
    enabled: !!activeCompanyId,
  });
  if (isLoading || !data) return <p className="muted">Loading…</p>;
  return (
    <table>
      <thead><tr><th>SKU</th><th>Item</th><th style={{ textAlign: "right" }}>On hand</th><th style={{ textAlign: "right" }}>Reorder point</th></tr></thead>
      <tbody>
        {data.map((r) => (
          <tr key={r.item_id}><td>{r.sku}</td><td>{r.name}</td>
            <td style={{ textAlign: "right", color: "var(--danger)" }}>{Number(r.on_hand)}</td>
            <td style={{ textAlign: "right" }}>{Number(r.reorder_point)}</td></tr>
        ))}
        {data.length === 0 && <tr><td colSpan={4} className="muted">All items above their reorder points. 🎉</td></tr>}
      </tbody>
    </table>
  );
}

function Aging({ kind, ccy }: { kind: "ar" | "ap"; ccy: string }) {
  const { activeCompanyId } = useCompany();
  const { data, isLoading } = useQuery({
    queryKey: ["reports", kind, activeCompanyId],
    queryFn: () => api.get<AgingRow[]>(`/reports/${kind}-aging`),
    enabled: !!activeCompanyId,
  });
  if (isLoading || !data) return <p className="muted">Loading…</p>;
  return (
    <table>
      <thead><tr><th>{kind === "ar" ? "Customer" : "Supplier"}</th><th>Current</th><th>1–30</th><th>31–60</th><th>61–90</th><th>90+</th><th>Total</th></tr></thead>
      <tbody>
        {data.map((r) => (
          <tr key={r.party_id}>
            <td>{r.party_name}</td>
            <td>{money(r.current, ccy)}</td><td>{money(r.d1_30, ccy)}</td><td>{money(r.d31_60, ccy)}</td>
            <td>{money(r.d61_90, ccy)}</td><td>{money(r.d90_plus, ccy)}</td>
            <td style={{ fontWeight: 600 }}>{money(r.total, ccy)}</td>
          </tr>
        ))}
        {data.length === 0 && <tr><td colSpan={7} className="muted">Nothing outstanding.</td></tr>}
      </tbody>
    </table>
  );
}

interface TaxRow { label: string; amount: string }
function TaxSummary({ ccy }: { ccy: string }) {
  const { activeCompanyId } = useCompany();
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "tax-summary", activeCompanyId],
    queryFn: () => api.get<TaxRow[]>("/reports/tax-summary"),
    enabled: !!activeCompanyId,
  });
  if (isLoading || !data) return <p className="muted">Loading…</p>;
  return (
    <>
      <div style={{ textAlign: "right", marginBottom: 8 }}>
        <ExportButtons rows={data} filename="tax-summary" title="Tax Summary"
          columns={[{ header: "Item", value: (r) => r.label }, { header: `Amount (${ccy})`, value: (r) => Number(r.amount) }]} />
      </div>
      <table>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} style={i === data.length - 1 ? { fontWeight: 700, borderTop: "2px solid var(--border)" } : undefined}>
              <td>{r.label}</td>
              <td style={{ textAlign: "right" }}>{money(r.amount, ccy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

interface DayBookRow { entry_date: string; entry_id: string; memo: string | null; source_type: string | null; reference: string | null; debit_total: string; credit_total: string }
function DayBook({ ccy }: { ccy: string }) {
  const { activeCompanyId } = useCompany();
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "day-book", activeCompanyId],
    queryFn: () => api.get<DayBookRow[]>("/reports/day-book"),
    enabled: !!activeCompanyId,
  });
  if (isLoading || !data) return <p className="muted">Loading…</p>;
  return (
    <>
      <div style={{ textAlign: "right", marginBottom: 8 }}>
        <ExportButtons rows={data} filename="day-book" title="Day Book"
          columns={[
            { header: "Date", value: (r) => r.entry_date },
            { header: "Memo", value: (r) => r.memo ?? "" },
            { header: "Source", value: (r) => r.source_type ?? "" },
            { header: "Reference", value: (r) => r.reference ?? "" },
            { header: "Debit", value: (r) => Number(r.debit_total) },
            { header: "Credit", value: (r) => Number(r.credit_total) },
          ]} />
      </div>
    <table>
      <thead><tr><th>Date</th><th>Memo</th><th>Source</th><th>Reference</th><th style={{ textAlign: "right" }}>Debit</th><th style={{ textAlign: "right" }}>Credit</th></tr></thead>
      <tbody>
        {data.map((r) => (
          <tr key={r.entry_id}>
            <td>{r.entry_date}</td>
            <td>{r.memo ?? "—"}</td>
            <td className="muted">{r.source_type ?? "—"}</td>
            <td className="muted">{r.reference ?? "—"}</td>
            <td style={{ textAlign: "right" }}>{money(r.debit_total, ccy)}</td>
            <td style={{ textAlign: "right" }}>{money(r.credit_total, ccy)}</td>
          </tr>
        ))}
        {data.length === 0 && <tr><td colSpan={6} className="muted">No posted entries.</td></tr>}
      </tbody>
    </table>
    </>
  );
}

interface RegisterRow { id: string; number: string; doc_date: string; party: string | null; currency: string; net: string; tax: string; total: string; status: string }
function Register({ kind, ccy }: { kind: "sales" | "purchase"; ccy: string }) {
  const { activeCompanyId } = useCompany();
  const { data, isLoading } = useQuery({
    queryKey: ["reports", `${kind}-register`, activeCompanyId],
    queryFn: () => api.get<RegisterRow[]>(`/reports/${kind}-register`),
    enabled: !!activeCompanyId,
  });
  if (isLoading || !data) return <p className="muted">Loading…</p>;
  const totals = data.reduce((a, r) => ({ net: a.net + Number(r.net), tax: a.tax + Number(r.tax), total: a.total + Number(r.total) }), { net: 0, tax: 0, total: 0 });
  return (
    <>
    <div style={{ textAlign: "right", marginBottom: 8 }}>
      <ExportButtons rows={data} filename={`${kind}-register`} title={kind === "sales" ? "Sales Register" : "Purchase Register"}
        columns={[
          { header: kind === "sales" ? "Invoice" : "Bill", value: (r) => r.number },
          { header: "Date", value: (r) => r.doc_date },
          { header: kind === "sales" ? "Customer" : "Supplier", value: (r) => r.party ?? "" },
          { header: "Status", value: (r) => r.status },
          { header: "Currency", value: (r) => r.currency },
          { header: "Net", value: (r) => Number(r.net) },
          { header: "Tax", value: (r) => Number(r.tax) },
          { header: "Total", value: (r) => Number(r.total) },
        ]} />
    </div>
    <table>
      <thead><tr><th>{kind === "sales" ? "Invoice" : "Bill"}</th><th>Date</th><th>{kind === "sales" ? "Customer" : "Supplier"}</th><th>Status</th><th style={{ textAlign: "right" }}>Net</th><th style={{ textAlign: "right" }}>Tax</th><th style={{ textAlign: "right" }}>Total</th></tr></thead>
      <tbody>
        {data.map((r) => (
          <tr key={r.id}>
            <td>{r.number}</td><td>{r.doc_date}</td><td>{r.party ?? "—"}</td>
            <td><span className="badge off">{r.status}</span></td>
            <td style={{ textAlign: "right" }}>{money(r.net, r.currency)}</td>
            <td style={{ textAlign: "right" }}>{money(r.tax, r.currency)}</td>
            <td style={{ textAlign: "right" }}>{money(r.total, r.currency)}</td>
          </tr>
        ))}
        {data.length === 0 && <tr><td colSpan={7} className="muted">No documents in range.</td></tr>}
        {data.length > 0 && (
          <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border)" }}>
            <td colSpan={4}>Totals ({ccy})</td>
            <td style={{ textAlign: "right" }}>{money(totals.net, ccy)}</td>
            <td style={{ textAlign: "right" }}>{money(totals.tax, ccy)}</td>
            <td style={{ textAlign: "right" }}>{money(totals.total, ccy)}</td>
          </tr>
        )}
      </tbody>
    </table>
    </>
  );
}

interface LedgerRow { entry_date: string; entry_id: string; memo: string | null; party: string | null; debit: string; credit: string }
function AccountLedger({ ccy }: { ccy: string }) {
  const { activeCompanyId } = useCompany();
  const [accountId, setAccountId] = useState("");
  const { data: accounts } = useQuery({
    queryKey: ["accounts", activeCompanyId],
    queryFn: () => api.get<Account[]>("/accounts"),
    enabled: !!activeCompanyId,
  });
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "ledger", activeCompanyId, accountId],
    queryFn: () => api.get<LedgerRow[]>(`/reports/general-ledger?account=${accountId}`),
    enabled: !!activeCompanyId && !!accountId,
  });
  let running = 0;
  return (
    <div>
      <div className="field" style={{ maxWidth: 380 }}>
        <label>Account <span className="muted" style={{ fontWeight: 400 }}>(pick a cash/bank account for a Cash Book)</span></label>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Select an account…</option>
          {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </select>
      </div>
      {!accountId ? <p className="muted">Choose an account to see its ledger.</p>
        : isLoading || !data ? <p className="muted">Loading…</p>
        : (
          <table>
            <thead><tr><th>Date</th><th>Memo</th><th>Party</th><th style={{ textAlign: "right" }}>Debit</th><th style={{ textAlign: "right" }}>Credit</th><th style={{ textAlign: "right" }}>Balance</th></tr></thead>
            <tbody>
              {data.map((r) => {
                running += Number(r.debit) - Number(r.credit);
                return (
                  <tr key={r.entry_id + r.entry_date}>
                    <td>{r.entry_date}</td><td>{r.memo ?? "—"}</td><td className="muted">{r.party ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{Number(r.debit) ? money(r.debit, ccy) : ""}</td>
                    <td style={{ textAlign: "right" }}>{Number(r.credit) ? money(r.credit, ccy) : ""}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{money(running, ccy)}</td>
                  </tr>
                );
              })}
              {data.length === 0 && <tr><td colSpan={6} className="muted">No transactions for this account.</td></tr>}
            </tbody>
          </table>
        )}
    </div>
  );
}
