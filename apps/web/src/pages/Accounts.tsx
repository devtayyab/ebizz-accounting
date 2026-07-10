import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Account, AppProfile, TaxRate } from "@ebizz/shared";
import { ACCOUNT_TYPES } from "@ebizz/shared";
import { api, ApiError } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { useConfirm } from "../state/ConfirmContext";
import { Modal } from "../components/Modal";
import { Pagination } from "../components/Pagination";
import { EmptyCell } from "../components/Empty";
import { ExportButtons } from "../components/ExportButtons";

export function AccountsPage() {
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();
  const ask = useConfirm();
  const [addAcct, setAddAcct] = useState(false);
  const [editAcct, setEditAcct] = useState<Account | null>(null);
  const [addTax, setAddTax] = useState(false);
  const [editTax, setEditTax] = useState<TaxRate | null>(null);
  const [companySettings, setCompanySettings] = useState(false);
  const [acctPage, setAcctPage] = useState(1);
  const [acctPageSize, setAcctPageSize] = useState(20);
  const [tab, setTab] = useState<"accounts" | "access" | "tax">("accounts");
  const { data: me } = useQuery({ queryKey: ["access", "me"], queryFn: () => api.get<AppProfile>("/access/me") });

  const { data: accounts } = useQuery({
    queryKey: ["accounts", activeCompanyId],
    queryFn: () => api.get<Account[]>("/accounts"),
    enabled: !!activeCompanyId,
  });
  const { data: taxRates } = useQuery({
    queryKey: ["tax-rates"],
    queryFn: () => api.get<TaxRate[]>("/tax-rates"),
    enabled: !!activeCompanyId,
  });

  const delAcct = useMutation({
    mutationFn: (id: string) => api.delete(`/accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
    meta: { successMessage: "Account deleted" },
  });
  const delTax = useMutation({
    mutationFn: (id: string) => api.delete(`/tax-rates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tax-rates"] }),
    meta: { successMessage: "Tax rate deleted" },
  });

  return (
    <div>
      <div className="page-head"><h1>Accounting Setup</h1></div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="page-head">
          <h3 style={{ margin: 0 }}>Company &amp; Invoice Settings</h3>
          <button onClick={() => setCompanySettings(true)}>Edit</button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Company name, address and tax number appear on your invoices. Default Terms &amp;
          Conditions and footer are prefilled on every new invoice.
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button className={tab === "accounts" ? "primary" : ""} onClick={() => setTab("accounts")}>Chart of Accounts</button>
        {me?.is_admin && (
          <button className={tab === "access" ? "primary" : ""} onClick={() => setTab("access")}>User Access</button>
        )}
        <button className={tab === "tax" ? "primary" : ""} onClick={() => setTab("tax")}>Tax Rates</button>
      </div>

      {tab === "accounts" && (
        <div className="card">
          <div className="page-head">
            <h3 style={{ margin: 0 }}>Chart of Accounts</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <ExportButtons
                rows={accounts ?? []}
                filename="chart-of-accounts"
                title="Chart of Accounts"
                columns={[
                  { header: "Code", value: (a) => a.code },
                  { header: "Name", value: (a) => a.name },
                  { header: "Type", value: (a) => a.type },
                  { header: "Status", value: (a) => (a.is_active ? "Active" : "Inactive") },
                ]}
              />
              <button onClick={() => setAddAcct(true)}>+ Add account</button>
            </div>
          </div>
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(accounts ?? []).slice((acctPage - 1) * acctPageSize, acctPage * acctPageSize).map((a) => (
                <tr key={a.id}>
                  <td>{a.code}</td><td>{a.name}</td>
                  <td><span className="badge off">{a.type}</span></td>
                  <td><span className={`badge ${a.is_active ? "ok" : "off"}`}>{a.is_active ? "Active" : "Inactive"}</span></td>
                  <td style={{ textAlign: "right" }}>
                    <button className="link" onClick={() => setEditAcct(a)}>Edit</button>
                    <button className="link danger" onClick={() => ask({ title: "Delete account", message: `Delete account ${a.code} — ${a.name}? Only works if it has no transactions.`, confirmLabel: "Delete", danger: true }).then((ok) => ok && delAcct.mutate(a.id))}>Delete</button>
                  </td>
                </tr>
              ))}
              {accounts?.length === 0 && <tr><td colSpan={5}><EmptyCell>No accounts yet.</EmptyCell></td></tr>}
            </tbody>
          </table>
          <Pagination page={acctPage} pageSize={acctPageSize} total={accounts?.length ?? 0} onPage={setAcctPage} onPageSize={(n) => { setAcctPageSize(n); setAcctPage(1); }} />
        </div>
      )}

      {tab === "access" && me?.is_admin && <UserAccessSection />}

      {tab === "tax" && (
        <div className="card">
          <div className="page-head">
            <h3 style={{ margin: 0 }}>Tax Rates</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <ExportButtons
                rows={taxRates ?? []}
                filename="tax-rates"
                title="Tax Rates"
                columns={[
                  { header: "Name", value: (t) => t.name },
                  { header: "Rate", value: (t) => `${(Number(t.rate) * 100).toFixed(2)}%` },
                  { header: "Status", value: (t) => (t.is_active ? "Active" : "Inactive") },
                ]}
              />
              <button onClick={() => setAddTax(true)}>+ Add tax rate</button>
            </div>
          </div>
          <table>
            <thead><tr><th>Name</th><th>Rate</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(taxRates ?? []).map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td><td>{(Number(t.rate) * 100).toFixed(2)}%</td>
                  <td><span className={`badge ${t.is_active ? "ok" : "off"}`}>{t.is_active ? "Active" : "Inactive"}</span></td>
                  <td style={{ textAlign: "right" }}>
                    <button className="link" onClick={() => setEditTax(t)}>Edit</button>
                    <button className="link danger" onClick={() => ask({ title: "Delete tax rate", message: `Delete “${t.name}”? Only works if it isn't used on any documents.`, confirmLabel: "Delete", danger: true }).then((ok) => ok && delTax.mutate(t.id))}>Delete</button>
                  </td>
                </tr>
              ))}
              {taxRates?.length === 0 && <tr><td colSpan={4}><EmptyCell>No tax rates. Add one to charge tax on invoices/bills.</EmptyCell></td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {(addAcct || editAcct) && <AccountForm companyId={activeCompanyId!} account={editAcct}
        onClose={() => { setAddAcct(false); setEditAcct(null); }}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["accounts"] }); setAddAcct(false); setEditAcct(null); }} />}
      {(addTax || editTax) && <TaxForm companyId={activeCompanyId!} taxRate={editTax}
        onClose={() => { setAddTax(false); setEditTax(null); }}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["tax-rates"] }); setAddTax(false); setEditTax(null); }} />}
      {companySettings && <CompanyForm onClose={() => setCompanySettings(false)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["companies"] }); setCompanySettings(false); }} />}
    </div>
  );
}

function CompanyForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { activeCompany } = useCompany();
  const { data: currencies } = useQuery({ queryKey: ["currencies"], queryFn: () => api.get<{ code: string }[]>("/currencies") });
  const [f, setF] = useState({
    name: activeCompany?.name ?? "",
    base_currency: activeCompany?.base_currency ?? "USD",
    legal_name: activeCompany?.legal_name ?? "",
    address_line1: activeCompany?.address_line1 ?? "",
    city: activeCompany?.city ?? "",
    country: activeCompany?.country ?? "",
    phone: activeCompany?.phone ?? "",
    email: activeCompany?.email ?? "",
    tax_number: activeCompany?.tax_number ?? "",
    invoice_terms: activeCompany?.invoice_terms ?? "",
    invoice_footer: activeCompany?.invoice_footer ?? "",
    logo_url: activeCompany?.logo_url ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const save = useMutation({
    mutationFn: () => {
      if (!activeCompany) throw new Error("No active company selected");
      // country has a 2-char rule on the API — send undefined rather than "".
      const payload = { ...f, country: f.country.trim() || undefined };
      return api.patch(`/companies/${activeCompany.id}`, payload);
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Failed"),
    meta: { successMessage: "Company settings saved" },
  });
  return (
    <Modal title="Company & Invoice Settings" onClose={onClose} width={620}>
      <div className="grid-2">
        <div className="field"><label>Company name (shown in the app)</label><input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Ebizz FZ LLC" /></div>
        <div className="field"><label>Legal name (on invoices)</label><input value={f.legal_name} onChange={(e) => set({ legal_name: e.target.value })} /></div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Base currency</label>
          <select value={f.base_currency} onChange={(e) => set({ base_currency: e.target.value })}>
            {(currencies ?? [{ code: f.base_currency }]).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
          <span className="muted" style={{ fontSize: 12 }}>Can only be changed before you have posted any transactions.</span>
        </div>
        <div className="field"><label>Tax number</label><input value={f.tax_number} onChange={(e) => set({ tax_number: e.target.value })} /></div>
      </div>
      <div className="field"><label>Address</label><input value={f.address_line1} onChange={(e) => set({ address_line1: e.target.value })} /></div>
      <div className="grid-2">
        <div className="field"><label>City</label><input value={f.city} onChange={(e) => set({ city: e.target.value })} /></div>
        <div className="field"><label>Country (ISO2)</label><input value={f.country} maxLength={2} onChange={(e) => set({ country: e.target.value.toUpperCase() })} /></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Phone</label><input value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></div>
        <div className="field"><label>Email</label><input value={f.email} onChange={(e) => set({ email: e.target.value })} /></div>
      </div>
      <div className="field"><label>Default Terms &amp; Conditions</label>
        <textarea rows={3} value={f.invoice_terms} onChange={(e) => set({ invoice_terms: e.target.value })} /></div>
      <div className="field"><label>Invoice footer</label>
        <input value={f.invoice_footer} onChange={(e) => set({ invoice_footer: e.target.value })} placeholder="Thank you for your business." /></div>
      <div className="field">
        <label>Company logo (appears on invoices — PNG/JPG, max 300&nbsp;KB)</label>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {f.logo_url && <img src={f.logo_url} alt="logo" style={{ width: 48, height: 48, objectFit: "contain", border: "1px solid var(--border)", borderRadius: 8 }} />}
          <input type="file" accept="image/png,image/jpeg,image/svg+xml" style={{ width: "auto" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 300 * 1024) { setError("Logo too large — please use an image under 300 KB."); return; }
              const reader = new FileReader();
              reader.onload = () => set({ logo_url: String(reader.result) });
              reader.readAsDataURL(file);
            }} />
          {f.logo_url && <button className="link danger" type="button" onClick={() => set({ logo_url: "" })}>Remove</button>}
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
      </div>
    </Modal>
  );
}

function AccountForm({ companyId, account, onClose, onSaved }: { companyId: string; account: Account | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(account?.code ?? "");
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<(typeof ACCOUNT_TYPES)[number]>(account?.type ?? "expense");
  const [isActive, setIsActive] = useState(account?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      account
        ? api.patch(`/accounts/${account.id}`, { code, name, type, is_active: isActive })
        : api.post("/accounts", { company_id: companyId, code, name, type }),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Failed"),
    meta: { successMessage: account ? "Account updated" : "Account added" },
  });
  return (
    <Modal title={account ? "Edit account" : "Add account"} onClose={onClose}>
      <div className="grid-2">
        <div className="field"><label>Code *</label><input value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <div className="field"><label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label>Name *</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
      {account && (
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
      )}
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!code || !name || save.isPending} onClick={() => save.mutate()}>Save</button>
      </div>
    </Modal>
  );
}

function TaxForm({ companyId, taxRate, onClose, onSaved }: { companyId: string; taxRate: TaxRate | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(taxRate?.name ?? "");
  const [percent, setPercent] = useState(taxRate ? String(Number(taxRate.rate) * 100) : "");
  const [isActive, setIsActive] = useState(taxRate?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      taxRate
        ? api.patch(`/tax-rates/${taxRate.id}`, { name, rate: String(Number(percent) / 100), is_active: isActive })
        : api.post("/tax-rates", { company_id: companyId, name, rate: String(Number(percent) / 100) }),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Failed"),
    meta: { successMessage: taxRate ? "Tax rate updated" : "Tax rate added" },
  });
  return (
    <Modal title={taxRate ? "Edit tax rate" : "Add tax rate"} onClose={onClose}>
      <div className="field"><label>Name *</label><input value={name} placeholder="e.g. VAT" onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label>Rate % *</label><input value={percent} placeholder="15" onChange={(e) => setPercent(e.target.value)} /></div>
      {taxRate && (
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
      )}
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!name || !percent || save.isPending} onClick={() => save.mutate()}>Save</button>
      </div>
    </Modal>
  );
}

/** Admin-only panel: approve / reject who can use the app. */
function UserAccessSection() {
  const qc = useQueryClient();
  const ask = useConfirm();
  const { data: me } = useQuery({ queryKey: ["access", "me"], queryFn: () => api.get<AppProfile>("/access/me") });
  const { data: users } = useQuery({
    queryKey: ["access", "list"],
    queryFn: () => api.get<AppProfile[]>("/access"),
    enabled: !!me?.is_admin,
  });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) => api.post(`/access/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["access"] }),
    meta: { successMessage: "Access updated" },
  });

  if (!me?.is_admin) return null;
  const rows = users ?? [];
  const pending = rows.filter((u) => u.status === "pending");

  const badge = (s: string) => s === "approved" ? "ok" : s === "rejected" ? "danger" : "warn";

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="page-head">
        <h3 style={{ margin: 0 }}>User access</h3>
        {pending.length > 0 && <span className="badge warn">{pending.length} awaiting approval</span>}
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Anyone can sign in, but only approved emails can use the app. Approve or decline requests below.
      </p>
      <table>
        <thead><tr><th>Email</th><th>Status</th><th>Role</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.user_id}>
              <td>{u.email ?? "—"}</td>
              <td><span className={`badge ${badge(u.status)}`}>{u.status}</span></td>
              <td>{u.is_admin ? <span className="badge info">admin</span> : "member"}</td>
              <td style={{ textAlign: "right" }}>
                {u.is_admin ? <span className="muted">—</span> : (
                  <>
                    {u.status !== "approved" && (
                      <button className="link" onClick={() => decide.mutate({ id: u.user_id, action: "approve" })}>Approve</button>
                    )}
                    {u.status !== "rejected" && (
                      <button className="link danger" onClick={() => ask({ title: "Decline access", message: `Decline access for ${u.email}? They won't be able to use the app.`, confirmLabel: "Decline", danger: true }).then((ok) => ok && decide.mutate({ id: u.user_id, action: "reject" }))}>Decline</button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4}><EmptyCell>No users yet.</EmptyCell></td></tr>}
        </tbody>
      </table>
    </div>
  );
}
