import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { AgingRow, ProfitAndLoss } from "@ebizz/shared";
import { api } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { money } from "../lib/format";
import { Icon, type IconName } from "../components/Icon";
import { ExportButtons } from "../components/ExportButtons";

interface FundBalance { id: string; name: string; balance: number; gl_account_id: string | null }
interface Activity { type: string; label: string; sub: string; amount: string; currency: string; created_at: string; link?: string }

export function Dashboard() {
  const { activeCompanyId, activeCompany } = useCompany();
  const ccy = activeCompany?.base_currency ?? "USD";
  const on = { enabled: !!activeCompanyId };

  const pnl = useQuery({ queryKey: ["reports", "pnl", activeCompanyId], queryFn: () => api.get<ProfitAndLoss>("/reports/profit-loss"), ...on });
  const ar = useQuery({ queryKey: ["reports", "ar", activeCompanyId], queryFn: () => api.get<AgingRow[]>("/reports/ar-aging"), ...on });
  const ap = useQuery({ queryKey: ["reports", "ap", activeCompanyId], queryFn: () => api.get<AgingRow[]>("/reports/ap-aging"), ...on });
  const valuation = useQuery({ queryKey: ["reports", "valuation", activeCompanyId], queryFn: () => api.get<{ value: string }[]>("/reports/inventory-valuation"), ...on });
  const funds = useQuery({ queryKey: ["funds", activeCompanyId], queryFn: () => api.get<FundBalance[]>("/funds"), ...on });
  const activity = useQuery({ queryKey: ["dashboard", "activity", activeCompanyId], queryFn: () => api.get<Activity[]>("/reports/recent-activity"), ...on });

  const revenue = Number(pnl.data?.total_income ?? 0);
  const expenses = Number(pnl.data?.total_expenses ?? 0);
  const net = Number(pnl.data?.net_profit ?? 0);
  const arTotal = (ar.data ?? []).reduce((a, r) => a + Number(r.total), 0);
  const apTotal = (ap.data ?? []).reduce((a, r) => a + Number(r.total), 0);
  const stockValue = (valuation.data ?? []).reduce((a, r) => a + Number(r.value), 0);

  const stats: { label: string; value: string; icon: IconName; accent: string }[] = [
    { label: "Revenue", value: money(revenue, ccy), icon: "revenue", accent: "#3557f6" },
    { label: "Net Profit", value: money(net, ccy), icon: "profit", accent: net >= 0 ? "#15925f" : "#dc2626" },
    { label: "Stock Value (at cost)", value: money(stockValue, ccy), icon: "inventory", accent: "#0d9488" },
    { label: "Accounts Receivable", value: money(arTotal, ccy), icon: "arrowIn", accent: "#6d5efc" },
    { label: "Accounts Payable", value: money(apTotal, ccy), icon: "arrowOut", accent: "#0ea5e9" },
  ];

  const bars = [
    { label: "Revenue", value: revenue, color: "#3557f6" },
    { label: "Expenses", value: expenses, color: "#f59e0b" },
    { label: "Net Profit", value: net, color: net >= 0 ? "#15925f" : "#dc2626" },
    { label: "Stock", value: stockValue, color: "#0d9488" },
    { label: "Receivable", value: arTotal, color: "#6d5efc" },
    { label: "Payable", value: apTotal, color: "#0ea5e9" },
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="page-sub">Overview of {activeCompany?.name ?? "your company"} · all figures in {ccy}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ExportButtons
            rows={stats}
            filename="dashboard-summary"
            title="Dashboard Summary"
            columns={[
              { header: "Metric", value: (s) => s.label },
              { header: "Value", value: (s) => s.value },
            ]}
          />
        </div>
      </div>

      <div className="stat-row">
        {stats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      <div className="dash-2col">
        <div className="card">
          <h3 className="card-title">Financial overview <span className="muted" style={{ fontWeight: 500 }}>({ccy})</span></h3>
          <BarChart bars={bars} />
        </div>
        <div className="card qa-card">
          <h3 className="card-title">Quick actions</h3>
          <div className="quick-actions">
            <QuickAction to="/invoices" label="New sales invoice" icon="sales" primary />
            <QuickAction to="/bills" label="New purchase bill" icon="purchases" />
            <QuickAction to="/payments" label="Record payment" icon="money" />
            <QuickAction to="/reports" label="View reports" icon="accounting" />
          </div>
        </div>
      </div>

      <div className="dash-2col">
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="card-title">Recent activity</h3>
            <ExportButtons
              rows={activity.data ?? []}
              filename="recent-activity"
              title="Recent Activity"
              columns={[
                { header: "Date", value: (a) => a.created_at },
                { header: "Type", value: (a) => a.sub },
                { header: "Description", value: (a) => a.label },
                { header: "Currency", value: (a) => a.currency },
                { header: "Amount", value: (a) => Number(a.amount) },
              ]}
            />
          </div>
          {activity.isLoading ? <p className="muted">Loading…</p>
            : (activity.data ?? []).length === 0 ? <p className="muted">No activity yet.</p>
            : (
              <ul className="activity-feed">
                {(activity.data ?? []).map((a, i) => {
                  const row = (
                    <>
                      <span className={`badge ${badgeCls(a.type)}`} style={{ minWidth: 74, textAlign: "center" }}>{a.sub}</span>
                      <span className="activity-label">{a.label}</span>
                      <span className="activity-amount">{money(a.amount, a.currency)}</span>
                    </>
                  );
                  return (
                    <li key={i}>
                      {a.link ? <Link to={a.link} className="activity-row">{row}</Link> : <div className="activity-row">{row}</div>}
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="card-title">Logistics funds &amp; balances</h3>
            <ExportButtons
              rows={funds.data ?? []}
              filename="fund-balances"
              title="Fund Balances"
              columns={[
                { header: "Fund", value: (f) => f.name },
                { header: "Balance", value: (f) => Number(f.balance) },
              ]}
            />
          </div>
          {funds.isLoading ? <p className="muted">Loading…</p>
            : (funds.data ?? []).length === 0 ? <p className="muted">No fund accounts. <Link className="link" to="/funds">Create one →</Link></p>
            : (
              <table>
                <thead><tr><th>Fund</th><th style={{ textAlign: "right" }}>Balance</th></tr></thead>
                <tbody>
                  {(funds.data ?? []).map((f) => (
                    <tr key={f.id}>
                      <td>{f.name}</td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: f.balance < 0 ? "var(--danger)" : "inherit" }}>{money(f.balance, ccy)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>
    </div>
  );
}

function badgeCls(type: string): string {
  return type === "invoice" ? "ok" : type === "bill" ? "info" : type === "payment" ? "" : "warn";
}

function StatCard({ label, value, icon, accent }: { label: string; value: string; icon: IconName; accent: string }) {
  return (
    <div className="stat" style={{ "--accent": accent } as CSSProperties}>
      <div className="stat-icon"><Icon name={icon} /></div>
      <div className="stat-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
      </div>
    </div>
  );
}

function QuickAction({ to, label, icon, primary }: { to: string; label: string; icon: IconName; primary?: boolean }) {
  return (
    <Link to={to} className={`quick-action ${primary ? "primary" : ""}`}>
      <span className="qa-icon"><Icon name={icon} size={18} /></span>
      <span className="qa-label">{label}</span>
      <span className="qa-arrow"><Icon name="arrow" size={16} /></span>
    </Link>
  );
}

function BarChart({ bars }: { bars: { label: string; value: number; color: string }[] }) {
  const max = Math.max(1, ...bars.map((b) => Math.abs(b.value)));
  const W = 560, H = 260, padX = 8, padTop = 24, padBottom = 42;
  const plotH = H - padTop - padBottom;
  const slot = (W - padX * 2) / bars.length;
  const bw = Math.min(64, slot * 0.5);
  const gridY = [0, 0.25, 0.5, 0.75, 1];

  // Short numeric labels (currency shown in the card title) so adjacent bar
  // labels never overlap.
  const compact = (n: number) => {
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(abs % 1e3 === 0 ? 0 : 1)}k`;
    return `${sign}${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 440 }} role="img" aria-label="Financial overview">
        {/* gridlines */}
        {gridY.map((g) => {
          const y = padTop + plotH - g * plotH;
          return <line key={g} x1={padX} y1={y} x2={W - padX} y2={y} stroke="var(--border)" strokeDasharray={g === 0 ? "" : "3 4"} />;
        })}
        {bars.map((b, i) => {
          const h = (Math.abs(b.value) / max) * plotH;
          const x = padX + slot * i + (slot - bw) / 2;
          const y = padTop + plotH - h;
          return (
            <g key={b.label}>
              <rect x={x} y={y} width={bw} height={Math.max(h, 2)} rx={6} fill={b.color} opacity={0.92} />
              <text x={x + bw / 2} y={y - 8} textAnchor="middle" fontSize="11" fill="var(--text)" fontWeight="700">
                {compact(b.value)}
              </text>
              <text x={x + bw / 2} y={padTop + plotH + 20} textAnchor="middle" fontSize="11.5" fill="var(--muted)">
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
