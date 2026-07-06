import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Customer, Paginated, Supplier } from "@ebizz/shared";
import { api, ApiError } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { useConfirm } from "../state/ConfirmContext";
import { Modal } from "../components/Modal";
import { CurrencyRate, fxRateInvalid } from "../components/CurrencyRate";
import { EmptyCell } from "../components/Empty";
import { money } from "../lib/format";

interface FundAccount { id: string; name: string; description: string | null; is_active: boolean; balance: number }
interface FundTx {
  id: string; txn_date: string; entry_type: "deposit" | "payment" | "receipt" | "adjustment";
  amount: string; currency: string | null; fx_rate: string | null;
  supplier_id: string | null; customer_id: string | null;
  counterparty: string | null; reference: string | null; memo: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  deposit: "Deposit (add funds)", payment: "Payment out (to supplier)",
  receipt: "Receipt (from customer)", adjustment: "Adjustment (+/−)",
};

export function FundsPage() {
  const { activeCompanyId, activeCompany } = useCompany();
  const qc = useQueryClient();
  const ask = useConfirm();
  const ccy = activeCompany?.base_currency ?? "USD";
  const [selected, setSelected] = useState<FundAccount | null>(null);
  const [addAccount, setAddAccount] = useState(false);
  const [txModal, setTxModal] = useState<{ fund: FundAccount; tx: FundTx | null } | null>(null);

  const { data: funds, isLoading } = useQuery({
    queryKey: ["funds", activeCompanyId],
    queryFn: () => api.get<FundAccount[]>("/funds"),
    enabled: !!activeCompanyId,
  });
  const { data: txs } = useQuery({
    queryKey: ["fund-txs", selected?.id],
    queryFn: () => api.get<FundTx[]>(`/funds/${selected!.id}/transactions`),
    enabled: !!selected,
  });
  const { data: suppliers } = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => api.get<Paginated<Supplier>>("/suppliers?page=1&page_size=200"), enabled: !!activeCompanyId });
  const { data: customers } = useQuery({ queryKey: ["customers", "all"], queryFn: () => api.get<Paginated<Customer>>("/customers?page=1&page_size=200"), enabled: !!activeCompanyId });
  const partyName = (t: FundTx) =>
    suppliers?.data.find((s) => s.id === t.supplier_id)?.name ??
    customers?.data.find((c) => c.id === t.customer_id)?.name ?? t.counterparty ?? "—";

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["funds"] }); qc.invalidateQueries({ queryKey: ["fund-txs"] }); };
  const removeAccount = useMutation({
    mutationFn: (id: string) => api.delete(`/funds/${id}`),
    onSuccess: () => { invalidate(); setSelected(null); }, meta: { successMessage: "Fund account deleted" },
  });
  const removeTx = useMutation({
    mutationFn: (id: string) => api.delete(`/funds/transactions/${id}`),
    onSuccess: invalidate, meta: { successMessage: "Transaction deleted" },
  });

  // Effect is shown in the company base currency (amount × fx_rate), matching the balance.
  const effect = (t: FundTx) => {
    const base = Number(t.amount) * (Number(t.fx_rate) || 1);
    return t.entry_type === "payment" ? -Math.abs(base)
      : t.entry_type === "adjustment" ? base : Math.abs(base);
  };

  return (
    <div>
      <div className="page-head">
        <h1>Funds &amp; Advances</h1>
        <button className="primary" onClick={() => setAddAccount(true)}>+ New fund account</button>
      </div>
      <div className="card" style={{ marginBottom: 20 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Track money you park with a warehouse / logistics partner: deposits add to the
          balance, payments to suppliers reduce it, receipts from customers add to it.
        </p>
        {isLoading ? <p className="muted">Loading…</p> : (
          <table>
            <thead><tr><th>Name</th><th>Description</th><th style={{ textAlign: "right" }}>Balance</th><th /></tr></thead>
            <tbody>
              {(funds ?? []).map((f) => (
                <tr key={f.id} style={{ cursor: "pointer" }} onClick={() => setSelected(f)}>
                  <td style={{ fontWeight: selected?.id === f.id ? 700 : 400 }}>{f.name}</td>
                  <td className="muted">{f.description ?? "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 600, color: f.balance < 0 ? "var(--danger)" : "inherit" }}>{money(f.balance, ccy)}</td>
                  <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                    <button className="link" onClick={() => setSelected(f)}>Transactions</button>
                    <button className="link danger" onClick={() => ask({ title: "Delete fund account", message: `Delete “${f.name}” and all its transactions?`, confirmLabel: "Delete", danger: true }).then((ok) => ok && removeAccount.mutate(f.id))}>Delete</button>
                  </td>
                </tr>
              ))}
              {funds?.length === 0 && <tr><td colSpan={4}><EmptyCell>No fund accounts yet. Create one for your warehouse/logistics partner.</EmptyCell></td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="card">
          <div className="page-head">
            <h3 style={{ margin: 0 }}>{selected.name} — transactions</h3>
            <button className="primary" onClick={() => setTxModal({ fund: selected, tx: null })}>+ Add transaction</button>
          </div>
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Party</th><th>Reference</th><th>Memo</th><th style={{ textAlign: "right" }}>Effect</th><th /></tr></thead>
            <tbody>
              {(txs ?? []).map((t) => (
                <tr key={t.id}>
                  <td>{t.txn_date}</td>
                  <td><span className={`badge ${t.entry_type === "payment" ? "warn" : t.entry_type === "adjustment" ? "off" : "ok"}`}>{t.entry_type}</span></td>
                  <td>{partyName(t)}</td>
                  <td className="muted">{t.reference ?? "—"}</td>
                  <td className="muted">{t.memo ?? "—"}</td>
                  <td style={{ textAlign: "right", color: effect(t) < 0 ? "var(--danger)" : "var(--success)" }}>
                    {effect(t) >= 0 ? "+" : ""}{money(effect(t), ccy)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="link" onClick={() => setTxModal({ fund: selected, tx: t })}>Edit</button>
                    <button className="link danger" onClick={() => ask({ title: "Delete transaction", message: "Delete this fund transaction?", confirmLabel: "Delete", danger: true }).then((ok) => ok && removeTx.mutate(t.id))}>Delete</button>
                  </td>
                </tr>
              ))}
              {txs?.length === 0 && <tr><td colSpan={7}><EmptyCell>No transactions yet.</EmptyCell></td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {addAccount && <FundForm companyId={activeCompanyId!} onClose={() => setAddAccount(false)}
        onSaved={() => { invalidate(); setAddAccount(false); }} />}
      {txModal && <TxForm fund={txModal.fund} tx={txModal.tx} base={ccy}
        suppliers={suppliers?.data ?? []} customers={customers?.data ?? []}
        onClose={() => setTxModal(null)} onSaved={() => { invalidate(); setTxModal(null); }} />}
    </div>
  );
}

function FundForm({ companyId, onClose, onSaved }: { companyId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.post("/funds", { company_id: companyId, name, description: description || undefined }),
    onSuccess: onSaved, onError: (e) => setError(e instanceof ApiError ? e.message : "Failed"),
    meta: { successMessage: "Fund account created" },
  });
  return (
    <Modal title="New fund account" onClose={onClose}>
      <div className="field"><label>Name *</label><input value={name} placeholder="e.g. DHL Logistics wallet" onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label>Description</label><input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!name || save.isPending} onClick={() => save.mutate()}>Save</button>
      </div>
    </Modal>
  );
}

function TxForm({ fund, tx, base, suppliers, customers, onClose, onSaved }: {
  fund: FundAccount; tx: FundTx | null; base: string; suppliers: Supplier[]; customers: Customer[];
  onClose: () => void; onSaved: () => void;
}) {
  const [type, setType] = useState<FundTx["entry_type"]>(tx?.entry_type ?? "deposit");
  const [amount, setAmount] = useState(tx?.amount ? String(tx.amount) : "");
  const [date, setDate] = useState(tx?.txn_date ?? new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState(tx?.supplier_id ?? "");
  const [customerId, setCustomerId] = useState(tx?.customer_id ?? "");
  const [counterparty, setCounterparty] = useState(tx?.counterparty ?? "");
  const [reference, setReference] = useState(tx?.reference ?? "");
  const [memo, setMemo] = useState(tx?.memo ?? "");
  const [docCurrency, setDocCurrency] = useState(tx?.currency ?? base);
  const [fxRate, setFxRate] = useState(String(tx?.fx_rate ?? "1"));
  const [error, setError] = useState<string | null>(null);
  const foreign = docCurrency !== base;

  const { data: currencies } = useQuery({ queryKey: ["currencies"], queryFn: () => api.get<{ code: string }[]>("/currencies") });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        entry_type: type, amount: String(Number(amount) || 0), txn_date: date,
        currency: docCurrency, fx_rate: foreign ? String(Number(fxRate) || 1) : "1",
        supplier_id: type === "payment" && supplierId ? supplierId : undefined,
        customer_id: type === "receipt" && customerId ? customerId : undefined,
        counterparty: counterparty || undefined, reference: reference || undefined, memo: memo || undefined,
      };
      return tx ? api.patch(`/funds/transactions/${tx.id}`, body) : api.post(`/funds/${fund.id}/transactions`, body);
    },
    onSuccess: onSaved, onError: (e) => setError(e instanceof ApiError ? e.message : "Failed"),
    meta: { successMessage: tx ? "Transaction updated" : "Transaction added" },
  });

  return (
    <Modal title={`${tx ? "Edit" : "New"} transaction — ${fund.name}`} onClose={onClose} width={560}>
      <div className="grid-2">
        <div className="field">
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as FundTx["entry_type"])}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <div className="field"><label>Amount ({docCurrency}) * {type === "adjustment" ? "(use − to reduce)" : ""}</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <CurrencyRate base={base} currencies={(currencies ?? []).map((c) => c.code)}
        currency={docCurrency} setCurrency={setDocCurrency} fxRate={fxRate} setFxRate={setFxRate}
        docTotal={Number(amount) || 0} amountLabel="Amount" />
      {type === "payment" && (
        <div className="field"><label>Paid to supplier</label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— none / other —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
      )}
      {type === "receipt" && (
        <div className="field"><label>Received from customer</label>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— none / other —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
      )}
      <div className="field"><label>Counterparty (free text, e.g. logistics company)</label>
        <input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} /></div>
      <div className="grid-2">
        <div className="field"><label>Reference</label><input value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        <div className="field"><label>Memo</label><input value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!Number(amount) || save.isPending || fxRateInvalid(base, docCurrency, fxRate)} onClick={() => save.mutate()}>Save</button>
      </div>
    </Modal>
  );
}
