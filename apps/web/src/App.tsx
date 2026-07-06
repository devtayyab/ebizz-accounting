import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./state/AuthContext";
import { useCompany } from "./state/CompanyContext";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
import { Dashboard } from "./pages/Dashboard";
import { ItemsPage } from "./pages/Items";
import { SuppliersPage } from "./pages/Suppliers";
import { CustomersPage } from "./pages/Customers";

export function App() {
  const { session, loading } = useAuth();
  const { companies, loading: companiesLoading } = useCompany();

  if (loading) return <FullScreen>Loading…</FullScreen>;
  if (!session) return <Login />;
  if (companiesLoading) return <FullScreen>Loading workspace…</FullScreen>;
  if (companies.length === 0) return <Onboarding />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="auth-wrap">{children}</div>;
}
