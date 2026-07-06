import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Account, Expense, Supplier, Paginated } from "@ebizz/shared";
import { api, ApiError } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { Modal } from "../components/Modal";
import { CurrencyRate, fxRateInvalid } from "../components/CurrencyRate";
import { money } from "../lib/format";
import { EmptyCell } from "../components/Empty";

export function ExpensesPage() {
  const { activeCompanyId, activeCompany } = useCompany();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ccy = activeCompany?.base_currency ?? "USD";

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", activeCompanyId],
    queryFn: () => api.get<Expense[]>("/expenses"),
    enabled: !!activeCompanyId,
  });
  const { data: accounts } = useQuery({
    queryKey: ["accounts", activeCompanyId],
    queryFn: () => api.get<Account[]>("/accounts"),
    enabled: !!activeCompanyId,
  });
  const acctName = (id: string) => {
    const a = accounts?.find((x) => x.id === id);
    return a ? `${a.code} ${a.name}` : "—";
  };

  return (
    <div>
      <div className="page-head">
        <h1>Expenses</h1>
        <button className="primary" onClick={() => setOpen(true)}>+ Record expense</button>
      </div>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Record operating costs (rent, utilities, salaries, fees…). Each expense
          posts to the ledger and is deducted in your Profit &amp; Loss.
        </p>
        {isLoading ? <p className="muted">Loading…</p> : (
          <table>
            <thead><tr><th>Date</th><th>Category</th><th>Memo</th><th>Amount</th><th>Tax</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>
              {(data ?? []).map((e) => (
                <tr key={e.id}>
                  <td>{e.expense_date}</td>
                  <td>{acctName(e.category_account_id)}</td>
                  <td className="muted">{e.memo ?? "—"}</td>
                  <td>{money(e.amount, e.currency)}</td>
                  <td>{money(e.tax_amount, e.currency)}</td>
                  <td>{money(e.total, e.currency)}</td>
                  <td><span className={`badge ${e.payment_status === "paid" ? "" : "off"}`}>{e.payment_status}</span></td>
                </tr>
              ))}
              {data?.length === 0 && <tr><td colSpan={7}><EmptyCell>No expenses recorded yet.</EmptyCell></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {open && <ExpenseForm companyId={activeCompanyId!} ccy={ccy} accounts={accounts ?? []}
        onClose={() => setOpen(false)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["expenses"] });
          qc.invalidateQueries({ queryKey: ["reports"] });
          setOpen(false);
        }} />}
    </div>
  );
}

function ExpenseForm({ companyId, ccy, accounts, onClose, onSaved }: {
  companyId: string; ccy: string; accounts: Account[]; onClose: () => void; onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [tax, setTax] = useState("");
  const [paidAccount, setPaidAccount] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [unpaid, setUnpaid] = useState(false);
  const [docCurrency, setDocCurrency] = useState(ccy);
  const [fxRate, setFxRate] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const foreign = docCurrency !== ccy;
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatCode, setNewCatCode] = useState("");

  const { data: suppliers } = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => api.get<Paginated<Supplier>>("/suppliers?page=1&page_size=200") });
  const { data: currencies } = useQuery({ queryKey: ["currencies"], queryFn: () => api.get<{ code: string }[]>("/currencies") });
  const expenseAccounts = accounts.filter((a) => a.type === "expense");
  const cashAccounts = accounts.filter((a) => a.type === "asset");

  // Suggest the next free code in the expense range (5000+) so the user rarely has to think about it.
  const suggestCode = () => {
    const codes = expenseAccounts.map((a) => Number(a.code)).filter((n) => Number.isFinite(n) && n >= 5000);
    return String((codes.length ? Math.max(...codes) : 5000) + 10);
  };
  const openNewCategory = () => { setNewCatCode(suggestCode()); setNewCatName(""); setAddingCat(true); };

  const createCat = useMutation({
    mutationFn: () => api.post<Account>("/accounts", { company_id: companyId, code: newCatCode.trim(), name: newCatName.trim(), type: "expense" }),
    onSuccess: async (acct) => {
      await qc.invalidateQueries({ queryKey: ["accounts"] });
      setCategory(acct.id);
      setAddingCat(false);
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not add category"),
  });

  const save = useMutation({
    mutationFn: () => api.post("/expenses", {
      company_id: companyId, category_account_id: category, amount,
      tax_amount: tax || undefined, expense_date: date, memo: memo || undefined,
      paid_account_id: unpaid ? undefined : paidAccount,
      supplier_id: unpaid ? (supplierId || undefined) : undefined,
      currency: docCurrency, fx_rate: foreign ? String(Number(fxRate) || 1) : "1",
    }),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Failed"),
  });

  return (
    <Modal title="Record expense" onClose={onClose} width={560}>
      <div className="grid-2">
        <div className="field"><label>Category (expense account) *</label>
          <select value={category} onChange={(e) => {
            if (e.target.value === "__new__") openNewCategory();
            else setCategory(e.target.value);
          }}>
            <option value="">Select…</option>
            {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            <option value="__new__">➕ New category…</option>
          </select>
        </div>
        <div className="field"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      {addingCat && (
        <div className="fx-note" style={{ padding: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>New expense category</div>
          <div className="grid-2">
            <div className="field"><label>Name *</label>
              <input value={newCatName} autoFocus placeholder="e.g. Travel, Marketing, Bank Charges"
                onChange={(e) => setNewCatName(e.target.value)} /></div>
            <div className="field"><label>Code *</label>
              <input value={newCatCode} onChange={(e) => setNewCatCode(e.target.value)} /></div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => setAddingCat(false)}>Cancel</button>
            <button type="button" className="primary" disabled={!newCatName.trim() || !newCatCode.trim() || createCat.isPending}
              onClick={() => createCat.mutate()}>{createCat.isPending ? "Adding…" : "Add category"}</button>
          </div>
        </div>
      )}
      <CurrencyRate base={ccy} currencies={(currencies ?? []).map((c) => c.code)}
        currency={docCurrency} setCurrency={setDocCurrency} fxRate={fxRate} setFxRate={setFxRate}
        docTotal={(Number(amount) || 0) + (Number(tax) || 0)} amountLabel="Expense" />
      <div className="grid-2">
        <div className="field"><label>Amount ({docCurrency}) *</label><input value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="field"><label>Tax amount ({docCurrency})</label><input value={tax} onChange={(e) => setTax(e.target.value)} /></div>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={unpaid} onChange={(e) => setUnpaid(e.target.checked)} />
        Record as unpaid (payable) instead of paying now
      </label>
      {unpaid ? (
        <div className="field"><label>Supplier / payee (optional)</label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Generic Accounts Payable</option>
            {(suppliers?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      ) : (
        <div className="field"><label>Paid from (cash/bank) *</label>
          <select value={paidAccount} onChange={(e) => setPaidAccount(e.target.value)}>
            <option value="">Select…</option>
            {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </div>
      )}
      <div className="field"><label>Memo</label><input value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!category || !amount || (!unpaid && !paidAccount) || save.isPending || fxRateInvalid(ccy, docCurrency, fxRate)}
          onClick={() => save.mutate()}>Save expense</button>
      </div>
    </Modal>
  );
}
