import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../state/AuthContext";
import { useCompany } from "../state/CompanyContext";
import { useTheme } from "../state/ThemeContext";
import { Icon, type IconName } from "./Icon";

interface NavItem { to: string; label: string; end?: boolean }
interface NavGroup { key: string; label: string; tip?: string; icon: IconName; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  { key: "dashboard", label: "Dashboard", tip: "Home", icon: "dashboard", items: [{ to: "/", label: "Dashboard", end: true }] },
  { key: "sales", label: "Sales", icon: "sales", items: [
    { to: "/sales-orders", label: "Sales Orders" },
    { to: "/invoices", label: "Invoices" },
    { to: "/credit-notes", label: "Credit Notes" },
  ] },
  { key: "purchases", label: "Purchases", icon: "purchases", items: [
    { to: "/purchase-orders", label: "Purchase Orders" },
    { to: "/bills", label: "Bills" },
    { to: "/debit-notes", label: "Debit Notes" },
  ] },
  { key: "money", label: "Money", icon: "money", items: [
    { to: "/payments", label: "Payments" },
    { to: "/expenses", label: "Expenses" },
    { to: "/funds", label: "Funds & Advances" },
  ] },
  { key: "inventory", label: "Inventory", icon: "inventory", items: [
    { to: "/items", label: "Items" },
    { to: "/warehouses", label: "Warehouses" },
  ] },
  { key: "contacts", label: "Contacts", icon: "contacts", items: [
    { to: "/customers", label: "Customers" },
    { to: "/suppliers", label: "Suppliers" },
  ] },
  { key: "accounting", label: "Accounting", icon: "accounting", items: [
    { to: "/journals", label: "Journal Entries" },
    { to: "/general-ledger", label: "General Ledger" },
    { to: "/statements", label: "Statements" },
    { to: "/reports", label: "Reports" },
    { to: "/accounting", label: "Setup" },
  ] },
];

/** Which group owns the current path (longest matching item wins). */
function groupForPath(pathname: string): string {
  let best = NAV_GROUPS[0].key;
  let bestLen = -1;
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      const match = it.to === "/" ? pathname === "/" : pathname.startsWith(it.to);
      if (match && it.to.length > bestLen) { best = g.key; bestLen = it.to.length; }
    }
  }
  return best;
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const { companies, activeCompany, activeCompanyId, setActiveCompanyId } = useCompany();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const [activeGroup, setActiveGroup] = useState(() => groupForPath(location.pathname));
  const [userMenu, setUserMenu] = useState(false);

  // Keep the rails in sync with the current route (e.g. after navigating).
  useEffect(() => { setActiveGroup(groupForPath(location.pathname)); }, [location.pathname]);

  const group = NAV_GROUPS.find((g) => g.key === activeGroup) ?? NAV_GROUPS[0];
  const email = user?.email ?? "";

  return (
    <div className="app-shell">
      {/* Rail 1 — icons */}
      <nav className="rail-icons" aria-label="Sections">
        <div className="rail-brand" title={activeCompany?.name ?? "Ebizz"}>
          {activeCompany?.logo_url
            ? <img src={activeCompany.logo_url} alt="" className="rail-brand-logo" />
            : <span className="rail-brand-mark">E</span>}
        </div>
        {NAV_GROUPS.map((g) => (
          <button
            key={g.key}
            className={`rail-icon ${activeGroup === g.key ? "active" : ""}`}
            onClick={() => setActiveGroup(g.key)}
            data-tip={g.tip ?? g.label}
            title={g.tip ?? g.label}
            aria-label={g.tip ?? g.label}
          >
            <Icon name={g.icon} />
          </button>
        ))}
      </nav>

      {/* Rail 2 — items of the selected section */}
      <nav className="rail-menu" aria-label={group.label}>
        <div className="rail-menu-title">{group.label}</div>
        {group.items.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end}>{it.label}</NavLink>
        ))}
      </nav>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-co">
            <strong>{activeCompany?.name ?? "—"}</strong>
            <span className="muted"> ({activeCompany?.base_currency})</span>
          </div>
          <div className="topbar-actions">
            {companies.length > 1 && (
              <select value={activeCompanyId ?? ""} onChange={(e) => setActiveCompanyId(e.target.value)} style={{ width: 200 }}>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <button className="icon-btn" onClick={toggle} aria-label="Toggle theme" data-tip={theme === "dark" ? "Light mode" : "Dark mode"}>
              <Icon name={theme === "dark" ? "sun" : "moon"} />
            </button>
            <div className="user-wrap">
              <button className="user-avatar" onClick={() => setUserMenu((v) => !v)} aria-label="Account">
                {(email || "?").charAt(0).toUpperCase()}
              </button>
              {userMenu && (
                <>
                  <div className="user-backdrop" onClick={() => setUserMenu(false)} />
                  <div className="user-menu">
                    <div className="user-menu-label">Signed in as</div>
                    <div className="user-menu-email" title={email}>{email}</div>
                    <button className="user-menu-signout" onClick={() => { setUserMenu(false); signOut(); }}>
                      <Icon name="signout" /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
