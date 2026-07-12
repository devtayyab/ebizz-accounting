import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Account, Customer, Paginated, Payment, PurchaseBill, SalesInvoice, Supplier,
} from "@ebizz/shared";
import { api, ApiError } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { useConfirm } from "../state/ConfirmContext";
import { Modal } from "../components/Modal";
import { CurrencyRate, fxRateInvalid } from "../components/CurrencyRate";
import { EmptyCell } from "../components/Empty";
import { money } from "../lib/format";
import { ExportButtons } from "../components/ExportButtons";

export function PaymentsPage() {
  const { activeCompanyId, activeCompany } = useCompany();
  const qc = useQueryClient();
  const ask = useConfirm();
  const [open, setOpen] = useState(false);
  const ccy = activeCompany?.base_currency ?? "USD";

  const { data: payments, isLoading } = useQuery({
    queryKey: ["payments", activeCompanyId],
    queryFn: () => api.get<Payment[]>("/payments"),
    enabled: !!activeCompanyId,
  });
  const reverse = useMutation({
    mutationFn: (id: string) => api.post(`/payments/${id}/reverse`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
    meta: { successMessage: "Payment reversed" },
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.post(`/payments/${id}/restore`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
    meta: { successMessage: "Payment restored" },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/payments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
    meta: { successMessage: "Payment deleted" },
  });

  return (
    <div>
      <div className="page-head">
        <h1>Payments</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ExportButtons
            rows={payments ?? []}
            filename="payments"
            title="Payments"
            columns={[
              { header: "Date", value: (p) => p.payment_date },
              { header: "Type", value: (p) => (p.party_type === "customer" ? "Received" : "Paid") },
              { header: "Amount", value: (p) => Number(p.amount) },
              { header: "Currency", value: (p) => p.currency },
              { header: "Method", value: (p) => p.method ?? "" },
              { header: "Reference", value: (p) => p.reference ?? "" },
              { header: "Status", value: (p) => (p.reversed ? "Reversed" : "Posted") },
            ]}
          />
          <button className="primary" onClick={() => setOpen(true)}>+ Record payment</button>
        </div>
      </div>
      <div className="card">
        {isLoading ? <p className="muted">Loading…</p> : (
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Method</th><th>Reference</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(payments ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{p.payment_date}</td>
                  <td><span className="badge info">{p.party_type === "customer" ? "Received" : "Paid"}</span></td>
                  <td>{money(p.amount, p.currency)}</td>
                  <td>{p.method ?? "—"}</td>
                  <td className="muted">{p.reference ?? "—"}</td>
                  <td><span className={`badge ${p.reversed ? "off" : "ok"}`}>{p.reversed ? "Reversed" : "Posted"}</span></td>
                  <td style={{ textAlign: "right" }}>
                    <Link className="link" to={`/payments/${p.id}/voucher`}>{p.party_type === "customer" ? "Receipt" : "Payment"} voucher</Link>
                    {p.reversed ? (
                      <button className="link" onClick={() => ask({ title: "Undo reversal", message: "Restore this payment? It will be re-applied to its invoice/bill.", confirmLabel: "Restore" }).then((ok) => ok && restore.mutate(p.id))}>Undo</button>
                    ) : (
                      <button className="link danger" onClick={() => ask({ title: "Reverse payment", message: "Reverse this payment? A reversing entry will be posted and the invoice/bill allocations undone.", confirmLabel: "Reverse", danger: true }).then((ok) => ok && reverse.mutate(p.id))}>Reverse</button>
                    )}
                    <button className="link danger" onClick={() => ask({ title: "Delete payment", message: "Delete this payment? Its ledger effect is reversed and the allocations undone.", confirmLabel: "Delete", danger: true }).then((ok) => ok && remove.mutate(p.id))}>Delete</button>
                  </td>
                </tr>
              ))}
              {payments?.length === 0 && <tr><td colSpan={7}><EmptyCell>No payments yet.</EmptyCell></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {open && (
        <PaymentModal companyId={activeCompanyId!} currency={ccy}
          onClose={() => setOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["payments"] });
            qc.invalidateQueries({ queryKey: ["invoices"] });
            qc.invalidateQueries({ queryKey: ["bills"] });
            qc.invalidateQueries({ queryKey: ["reports"] });
            qc.invalidateQueries({ queryKey: ["dashboard"] });
            setOpen(false);
          }} />
      )}
    </div>
  );
}

function PaymentModal({
  companyId, currency, onClose, onSaved,
}: { companyId: string; currency: string; onClose: () => void; onSaved: () => void }) {
  const [partyType, setPartyType] = useState<"customer" | "supplier">("customer");
  const [partyId, setPartyId] = useState("");
  const [depositAccount, setDepositAccount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [docCurrency, setDocCurrency] = useState(currency);
  const [fxRate, setFxRate] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const foreign = docCurrency !== currency;

  const { data: customers } = useQuery({ queryKey: ["customers", "all"], queryFn: () => api.get<Paginated<Customer>>("/customers?page=1&page_size=200") });
  const { data: suppliers } = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => api.get<Paginated<Supplier>>("/suppliers?page=1&page_size=200") });
  const { data: accounts } = useQuery({ queryKey: ["accounts", companyId], queryFn: () => api.get<Account[]>("/accounts") });
  const { data: currencies } = useQuery({ queryKey: ["currencies"], queryFn: () => api.get<{ code: string }[]>("/currencies") });
  const { data: invoices } = useQuery({ queryKey: ["invoices", "open"], queryFn: () => api.get<Paginated<SalesInvoice>>("/invoices?page=1&page_size=200") });
  const { data: bills } = useQuery({ queryKey: ["bills", "open"], queryFn: () => api.get<Paginated<PurchaseBill>>("/bills?page=1&page_size=200") });

  const parties = partyType === "customer" ? (customers?.data ?? []) : (suppliers?.data ?? []);
  const cashAccounts = (accounts ?? []).filter((a) => a.type === "asset");

  const openDocs = useMemo(() => {
    if (!partyId) return [] as { id: string; number: string; outstanding: number }[];
    if (partyType === "customer") {
      return (invoices?.data ?? [])
        .filter((i) => i.customer_id === partyId && i.status === "posted" && Number(i.total) - Number(i.amount_paid) > 0.005)
        .map((i) => ({ id: i.id, number: i.invoice_number, outstanding: Number(i.total) - Number(i.amount_paid) }));
    }
    return (bills?.data ?? [])
      .filter((b) => b.supplier_id === partyId && b.status === "posted" && Number(b.total) - Number(b.amount_paid) > 0.005)
      .map((b) => ({ id: b.id, number: b.bill_number, outstanding: Number(b.total) - Number(b.amount_paid) }));
  }, [partyId, partyType, invoices, bills]);

  const totalAmount = Object.values(alloc).reduce((a, v) => a + Number(v || 0), 0);

  const save = useMutation({
    mutationFn: () => {
      const allocations = Object.entries(alloc)
        .filter(([, v]) => Number(v) > 0)
        .map(([docId, v]) =>
          partyType === "customer" ? { invoice_id: docId, amount: v } : { bill_id: docId, amount: v });
      return api.post("/payments", {
        company_id: companyId, party_type: partyType, party_id: partyId,
        payment_date: date, amount: String(totalAmount), currency: docCurrency,
        fx_rate: foreign ? String(Number(fxRate) || 1) : "1", method,
        deposit_account_id: depositAccount, reference: reference || undefined, allocations,
      });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Payment failed"),
  });

  return (
    <Modal title="Record payment" onClose={onClose} width={640}>
      <div className="grid-2">
        <div className="field">
          <label>Type</label>
          <select value={partyType} onChange={(e) => { setPartyType(e.target.value as "customer" | "supplier"); setPartyId(""); setAlloc({}); }}>
            <option value="customer">Received from customer</option>
            <option value="supplier">Paid to supplier</option>
          </select>
        </div>
        <div className="field">
          <label>{partyType === "customer" ? "Customer" : "Supplier"} *</label>
          <select value={partyId} onChange={(e) => { setPartyId(e.target.value); setAlloc({}); }}>
            <option value="">Select…</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>{partyType === "customer" ? "Deposit to" : "Pay from"} account *</label>
          <select value={depositAccount} onChange={(e) => setDepositAccount(e.target.value)}>
            <option value="">Select…</option>
            {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Method</label><input value={method} onChange={(e) => setMethod(e.target.value)} /></div>
        <div className="field"><label>Reference</label><input value={reference} onChange={(e) => setReference(e.target.value)} /></div>
      </div>
      <CurrencyRate base={currency} currencies={(currencies ?? []).map((c) => c.code)}
        currency={docCurrency} setCurrency={setDocCurrency} fxRate={fxRate} setFxRate={setFxRate}
        docTotal={totalAmount} amountLabel="Payment" />

      <label>Apply to open {partyType === "customer" ? "invoices" : "bills"}</label>
      <table style={{ marginBottom: 8 }}>
        <thead><tr><th>Document</th><th>Outstanding</th><th style={{ width: 130 }}>Payment</th></tr></thead>
        <tbody>
          {openDocs.map((d) => (
            <tr key={d.id}>
              <td>{d.number}</td>
              <td>{money(d.outstanding, docCurrency)}</td>
              <td>
                <input value={alloc[d.id] ?? ""} placeholder="0.00"
                  onChange={(e) => setAlloc({ ...alloc, [d.id]: e.target.value })}
                  onBlur={(e) => { if (!e.target.value) setAlloc({ ...alloc, [d.id]: String(d.outstanding) }); }} />
              </td>
            </tr>
          ))}
          {partyId && openDocs.length === 0 && <tr><td colSpan={3} className="muted">Nothing outstanding.</td></tr>}
        </tbody>
      </table>
      <div style={{ textAlign: "right", fontSize: 18 }}>Total: <strong>{money(totalAmount, docCurrency)}</strong></div>

      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!partyId || !depositAccount || totalAmount <= 0 || save.isPending || fxRateInvalid(currency, docCurrency, fxRate)}
          onClick={() => save.mutate()}>
          {save.isPending ? "…" : "Record payment"}
        </button>
      </div>
    </Modal>
  );
}
