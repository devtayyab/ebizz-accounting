import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  AgingRow, BalanceSheet, InventoryValuationRow, LowStockRow, ProfitAndLoss, ReportLine, TrialBalanceRow,
} from "@ebizz/shared";
import { api } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { money } from "../lib/format";

const TABS = [
  { key: "pnl", label: "Profit & Loss" },
  { key: "balance", label: "Balance Sheet" },
  { key: "trial", label: "Trial Balance" },
  { key: "ar", label: "A/R Aging" },
  { key: "ap", label: "A/P Aging" },
  { key: "valuation", label: "Inventory Valuation" },
  { key: "lowstock", label: "Low Stock" },
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
