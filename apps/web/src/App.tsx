import { Navigate, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { AppProfile } from "@ebizz/shared";
import { api } from "./lib/api";
import { useAuth } from "./state/AuthContext";
import { useCompany } from "./state/CompanyContext";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
import { Dashboard } from "./pages/Dashboard";
import { ItemsPage } from "./pages/Items";
import { SuppliersPage } from "./pages/Suppliers";
import { CustomersPage } from "./pages/Customers";
import { InvoicesPage } from "./pages/Invoices";
import { BillsPage } from "./pages/Bills";
import { PaymentsPage } from "./pages/Payments";
import { ReportsPage } from "./pages/Reports";
import { AccountsPage } from "./pages/Accounts";
import { WarehousesPage } from "./pages/Warehouses";
import { SalesOrdersPage, PurchaseOrdersPage } from "./pages/Orders";
import { CreditNotesPage, DebitNotesPage } from "./pages/Notes";
import { JournalsPage } from "./pages/Journals";
import { GeneralLedgerPage } from "./pages/GeneralLedger";
import { StatementsPage } from "./pages/Statements";
import { ExpensesPage } from "./pages/Expenses";
import { FundsPage } from "./pages/Funds";
import { RecycleBinPage } from "./pages/RecycleBin";
import { InvoiceView } from "./pages/InvoiceView";
import { BillView } from "./pages/BillView";

export function App() {
  const { session, loading, signOut } = useAuth();
  const { companies, loading: companiesLoading } = useCompany();

  const access = useQuery({
    queryKey: ["access", "me", session?.user.id],
    queryFn: () => api.get<AppProfile>("/access/me"),
    enabled: !!session,
  });

  if (loading) return <FullScreen>Loading…</FullScreen>;
  if (!session) return <Login />;
  if (access.isLoading) return <FullScreen>Checking access…</FullScreen>;
  if (access.data && access.data.status !== "approved") {
    return <ApprovalGate email={session.user.email ?? ""} status={access.data.status} onSignOut={() => signOut()} />;
  }
  if (companiesLoading) return <FullScreen>Loading workspace…</FullScreen>;
  if (companies.length === 0) return <Onboarding />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sales-orders" element={<SalesOrdersPage />} />
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/invoices/:id/print" element={<InvoiceView />} />
        <Route path="/credit-notes" element={<CreditNotesPage />} />
        <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="/bills" element={<BillsPage />} />
        <Route path="/bills/:id/print" element={<BillView />} />
        <Route path="/debit-notes" element={<DebitNotesPage />} />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/funds" element={<FundsPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/warehouses" element={<WarehousesPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/journals" element={<JournalsPage />} />
        <Route path="/general-ledger" element={<GeneralLedgerPage />} />
        <Route path="/statements" element={<StatementsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/recycle-bin" element={<RecycleBinPage />} />
        <Route path="/accounting" element={<AccountsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="auth-wrap">{children}</div>;
}

function ApprovalGate({ email, status, onSignOut }: { email: string; status: string; onSignOut: () => void }) {
  const rejected = status === "rejected";
  return (
    <div className="auth-wrap">
      <div className="card" style={{ maxWidth: 440, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>{rejected ? "⛔" : "⏳"}</div>
        <h2 style={{ margin: "0 0 8px" }}>{rejected ? "Access denied" : "Waiting for approval"}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          You’re signed in as the account below, but it {rejected
            ? "has been declined by an administrator, so you can’t use the app."
            : "hasn’t been approved yet. An administrator needs to approve it before you can use the app."}
        </p>
        <div style={{ background: "var(--hover)", borderRadius: 8, padding: "10px 12px", margin: "14px 0", fontWeight: 600 }}>
          {email}
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
          Once approved, just reload this page. To use a different account, sign out below.
        </p>
        <button onClick={onSignOut}>Sign out &amp; back to login</button>
      </div>
    </div>
  );
}
