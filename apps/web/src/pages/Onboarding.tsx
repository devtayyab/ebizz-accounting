import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { useCompany } from "../state/CompanyContext";

const CURRENCIES = ["USD", "EUR", "GBP", "PKR", "AED", "INR", "JPY", "CHF", "CAD", "AUD"];

export function Onboarding() {
  const { refetch, setActiveCompanyId } = useCompany();
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<{ company_id: string }>("/organizations", {
        name,
        slug,
        company_name: companyName || name,
        base_currency: currency,
      });
      setActiveCompanyId(res.company_id);
      refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create workspace");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>Set up your workspace</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          This creates your organization and its first company with a default
          chart of accounts.
        </p>
        <form onSubmit={submit}>
          <div className="field">
            <label>Organization name</label>
            <input value={name} required onChange={(e) => setName(e.target.value)} />
            {slug && <span className="muted" style={{ fontSize: 12 }}>slug: {slug}</span>}
          </div>
          <div className="field">
            <label>Company name (legal entity)</label>
            <input
              value={companyName}
              placeholder="Defaults to organization name"
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Base currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {error && <div className="error">{error}</div>}
          <button className="primary" type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Creating…" : "Create workspace"}
          </button>
        </form>
      </div>
    </div>
  );
}
