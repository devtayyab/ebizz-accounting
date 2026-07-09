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
    { to: "/recycle-bin", label: "Recycle Bin" },
    { to: "/accounting", label: "Setup" },
  ] },
];


export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const { companies, activeCompany, activeCompanyId, setActiveCompanyId } = useCompany();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const email = user?.email ?? "";

  return (
    <div className="app-shell">
      {/* Single always-visible sidebar with labelled sections */}
      <nav className={`sidebar ${mobileOpen ? "open" : ""}`} aria-label="Main navigation">
        <div className="sidebar-brand">
          {activeCompany?.logo_url
            ? <img src={activeCompany.logo_url} alt="" className="sidebar-logo" />
            : <span className="sidebar-mark">{(activeCompany?.name ?? "E").charAt(0).toUpperCase()}</span>}
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-name">{activeCompany?.name ?? "Ebizz"}</div>
            <div className="sidebar-brand-sub">{activeCompany?.base_currency ?? ""}</div>
          </div>
        </div>
        {NAV_GROUPS.map((g) => (
          <div className="nav-section" key={g.key}>
            <div className="nav-section-title"><Icon name={g.icon} size={15} /> {g.label}</div>
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.end}>{it.label}</NavLink>
            ))}
          </div>
        ))}
      </nav>
      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}

      <div className="app-main">
        <button className="sidebar-toggle" onClick={() => setMobileOpen((v) => !v)} aria-label="Menu">
          <Icon name="dashboard" size={18} />
        </button>
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
