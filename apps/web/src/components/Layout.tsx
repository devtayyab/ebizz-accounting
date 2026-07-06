import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/items", label: "Items & Inventory" },
  { to: "/suppliers", label: "Suppliers" },
  { to: "/customers", label: "Customers" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const { companies, activeCompany, activeCompanyId, setActiveCompanyId } = useCompany();

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="brand">Ebizz</div>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>
            {item.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <div style={{ padding: "0 12px", fontSize: 12, color: "#94a3b8" }}>
          {user?.email}
        </div>
        <button className="link" style={{ color: "#cbd5e1" }} onClick={() => signOut()}>
          Sign out
        </button>
      </nav>

      <div>
        <header className="topbar">
          <div>
            <strong>{activeCompany?.name ?? "—"}</strong>{" "}
            <span className="muted">({activeCompany?.base_currency})</span>
          </div>
          {companies.length > 1 && (
            <select
              value={activeCompanyId ?? ""}
              onChange={(e) => setActiveCompanyId(e.target.value)}
              style={{ width: 220 }}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
