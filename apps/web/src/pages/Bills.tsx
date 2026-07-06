import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Item, Paginated, PurchaseBill, Supplier, TaxRate } from "@ebizz/shared";

interface WarehouseOption { id: string; name: string }
import { api, ApiError } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { useConfirm } from "../state/ConfirmContext";
import { Modal } from "../components/Modal";
import { EditableLine, LineItemsEditor, emptyLine, lineTotals } from "../components/LineItemsEditor";
import { fxRateInvalid } from "../components/CurrencyRate";
import { money, paymentStatus } from "../lib/format";
import { EmptyCell } from "../components/Empty";
import { Pagination } from "../components/Pagination";

export function BillsPage() {
  const { activeCompanyId, activeCompany } = useCompany();
  const qc = useQueryClient();
  const ask = useConfirm();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const ccy = activeCompany?.base_currency ?? "USD";

  const { data, isLoading } = useQuery({
    queryKey: ["bills", activeCompanyId, page, pageSize],
    queryFn: () => api.get<Paginated<PurchaseBill>>(`/bills?page=${page}&page_size=${pageSize}`),
    enabled: !!activeCompanyId,
  });
  const { data: warehouses } = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get<{ id: string; name: string }[]>("/locations"),
    enabled: !!activeCompanyId,
  });
  const whName = (id: string | null) => warehouses?.find((w) => w.id === id)?.name ?? "—";
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["bills"] });
    qc.invalidateQueries({ queryKey: ["reports"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["items"] });
  };
  const post = useMutation({ mutationFn: (id: string) => api.post(`/bills/${id}/post`), onSuccess: invalidate, meta: { successMessage: "Bill posted" } });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/bills/${id}`), onSuccess: invalidate, meta: { successMessage: "Bill deleted" } });
  const reverse = useMutation({ mutationFn: (id: string) => api.post(`/bills/${id}/reverse`), onSuccess: invalidate, meta: { successMessage: "Bill voided" } });
  const restore = useMutation({ mutationFn: (id: string) => api.post(`/bills/${id}/restore`), onSuccess: invalidate, meta: { successMessage: "Bill restored" } });
  const markPaid = useMutation({ mutationFn: (id: string) => api.post(`/bills/${id}/mark-paid`), onSuccess: invalidate, meta: { successMessage: "Bill marked as paid" } });
  const revise = useMutation({
    mutationFn: (id: string) => api.post(`/bills/${id}/revise`),
    onSuccess: (_data, id) => { invalidate(); setEditId(id); setEditorOpen(true); },
    meta: { successMessage: "Un-posted — you can edit now" },
  });

  return (
    <div>
      <div className="page-head">
        <h1>Purchase Bills</h1>
        <button className="primary" onClick={() => { setEditId(null); setEditorOpen(true); }}>+ New bill</button>
      </div>
      <div className="card">
        {isLoading ? <p className="muted">Loading…</p> : (
          <table>
            <thead><tr><th>Number</th><th>Date</th><th>Supplier</th><th>Warehouse</th><th>Total</th><th>Paid</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(data?.data ?? []).map((b) => {
                const bd = paymentStatus(b.status, b.total, b.amount_paid, b.due_date);
                return (
                  <tr key={b.id}>
                    <td>{b.bill_number}</td>
                    <td>{b.bill_date}</td>
                    <td><SupplierName id={b.supplier_id} /></td>
                    <td className="muted">{whName(b.location_id)}</td>
                    <td>{money(b.total, b.currency)}</td>
                    <td>{money(b.amount_paid, b.currency)}</td>
                    <td><span className={`badge ${bd.cls}`}>{bd.label}</span></td>
                    <td style={{ textAlign: "right" }}>
                      {b.status === "draft" && (
                        <>
                          <button className="link" onClick={() => { setEditId(b.id); setEditorOpen(true); }}>Edit</button>
                          <button className="link" onClick={() => post.mutate(b.id)}>Post</button>
                          <button className="link danger" onClick={() => ask({ title: "Delete bill", message: `Delete draft ${b.bill_number}? This cannot be undone.`, confirmLabel: "Delete", danger: true }).then((ok) => ok && remove.mutate(b.id))}>Delete</button>
                        </>
                      )}
                      {b.status === "posted" && Number(b.amount_paid) === 0 && (
                        <button className="link" onClick={() => ask({ title: "Edit posted bill", message: `Editing ${b.bill_number} will un-post it (reverse its ledger entry) so you can change it, then re-post.`, confirmLabel: "Un-post & edit" }).then((ok) => ok && revise.mutate(b.id))}>Edit</button>
                      )}
                      {b.status === "posted" && Number(b.total) - Number(b.amount_paid) > 0.005 && (
                        <button className="link" onClick={() => ask({ title: "Mark as paid", message: `Record a payment for the full balance of ${b.bill_number} from your default cash/bank account?`, confirmLabel: "Mark paid" }).then((ok) => ok && markPaid.mutate(b.id))}>Mark paid</button>
                      )}
                      {b.status === "posted" && Number(b.amount_paid) === 0 && (
                        <button className="link danger" onClick={() => ask({ title: "Void bill", message: `Void ${b.bill_number}? A reversing journal entry will be posted and stock returned.`, confirmLabel: "Void", danger: true }).then((ok) => ok && reverse.mutate(b.id))}>Void</button>
                      )}
                      <Link className="link" to={`/bills/${b.id}/print`} style={{ marginLeft: 6 }}>View</Link>
                      {b.status === "void" && (
                        <button className="link" onClick={() => ask({ title: "Undo void", message: `Restore ${b.bill_number} back to posted?`, confirmLabel: "Restore" }).then((ok) => ok && restore.mutate(b.id))}>Undo void</button>
                      )}
                      {(b.status === "void" || (b.status === "posted" && Number(b.amount_paid) === 0)) && (
                        <button className="link danger" onClick={() => ask({ title: "Delete bill", message: b.status === "posted" ? `Delete ${b.bill_number}? It will be voided (ledger reversed, stock returned) and removed.` : `Permanently delete ${b.bill_number}?`, confirmLabel: "Delete", danger: true }).then((ok) => ok && remove.mutate(b.id))}>Delete</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {data?.data.length === 0 && <tr><td colSpan={8}><EmptyCell>No bills yet. Record your first purchase bill.</EmptyCell></td></tr>}
            </tbody>
          </table>
        )}
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
      </div>
      {editorOpen && (
        <BillEditor companyId={activeCompanyId!} currency={ccy} billId={editId}
          onClose={() => setEditorOpen(false)} onSaved={() => { invalidate(); setEditorOpen(false); }} />
      )}
    </div>
  );
}

function SupplierName({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => api.get<Paginated<Supplier>>("/suppliers?page=1&page_size=200") });
  return <>{data?.data.find((s) => s.id === id)?.name ?? "—"}</>;
}

function BillEditor({
  companyId, currency, billId, onClose, onSaved,
}: {
  companyId: string; currency: string; billId: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [docCurrency, setDocCurrency] = useState(currency);
  const [fxRate, setFxRate] = useState("1");
  const [discount, setDiscount] = useState("");
  const [shipping, setShipping] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);

  const { data: suppliers } = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => api.get<Paginated<Supplier>>("/suppliers?page=1&page_size=200") });
  const { data: items } = useQuery({ queryKey: ["items", "all"], queryFn: () => api.get<Paginated<Item>>("/items?page=1&page_size=200") });
  const { data: taxRates } = useQuery({ queryKey: ["tax-rates"], queryFn: () => api.get<TaxRate[]>("/tax-rates") });
  const { data: warehouses } = useQuery({ queryKey: ["locations"], queryFn: () => api.get<WarehouseOption[]>("/locations") });
  const { data: currencies } = useQuery({ queryKey: ["currencies"], queryFn: () => api.get<{ code: string }[]>("/currencies") });
  const foreign = docCurrency !== currency;
  useEffect(() => { if (!locationId && warehouses?.length) setLocationId(warehouses[0].id); }, [warehouses, locationId]);
  // Auto-fill due date from the supplier's payment terms (only when empty).
  useEffect(() => {
    const sup = suppliers?.data.find((x) => x.id === supplierId);
    if (sup && !dueDate && !billId) {
      const d = new Date(billDate);
      d.setDate(d.getDate() + (sup.payment_terms_days ?? 30));
      setDueDate(d.toISOString().slice(0, 10));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  useQuery({
    queryKey: ["bill", billId], enabled: !!billId,
    queryFn: async () => {
      const b = await api.get<PurchaseBill>(`/bills/${billId}`);
      setSupplierId(b.supplier_id); if (b.location_id) setLocationId(b.location_id);
      setBillDate(b.bill_date); setDueDate(b.due_date ?? "");
      setDocCurrency(b.currency); setFxRate(String(b.fx_rate ?? "1"));
      setDiscount(Number(b.discount_total) ? String(b.discount_total) : "");
      setShipping(Number(b.shipping_total) ? String(b.shipping_total) : "");
      setLines((b.lines ?? []).map((l) => ({
        item_id: l.item_id ?? "", description: l.description ?? "",
        quantity: String(l.quantity), rate: String(l.unit_cost), tax_rate: String(l.tax_rate),
      })));
      return b;
    },
  });

  const save = useMutation({
    mutationFn: (thenPost: boolean) => {
      const body = {
        company_id: companyId, supplier_id: supplierId, location_id: locationId || undefined,
        bill_date: billDate, due_date: dueDate || undefined,
        currency: docCurrency, fx_rate: foreign ? String(Number(fxRate) || 1) : "1",
        discount_total: String(Number(discount) || 0), shipping_total: String(Number(shipping) || 0),
        lines: lines.filter((l) => Number(l.quantity) > 0).map((l) => ({
          item_id: l.item_id || undefined, description: l.description || undefined,
          quantity: String(Number(l.quantity) || 0),
          unit_cost: String(Number(l.rate) || 0),
          tax_rate: String(Number(l.tax_rate) || 0),
        })),
      };
      const req = billId ? api.patch<PurchaseBill>(`/bills/${billId}`, body) : api.post<PurchaseBill>("/bills", body);
      return req.then((b) => (thenPost ? api.post(`/bills/${b.id}/post`) : b));
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Save failed"),
  });

  return (
    <Modal title={billId ? "Edit bill" : "New bill"} onClose={onClose} width={820}>
      <div className="grid-2">
        <div className="field">
          <label>Supplier *</label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Select…</option>
            {(suppliers?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="grid-2">
          <div className="field"><label>Date</label><input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} /></div>
          <div className="field"><label>Due date</label><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Currency</label>
          <select value={docCurrency} onChange={(e) => { const v = e.target.value; setDocCurrency(v); setFxRate(v === currency ? "1" : (!(Number(fxRate) > 0) || Number(fxRate) === 1 ? "" : fxRate)); }}>
            {(currencies ?? [{ code: currency }]).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
        </div>
        {foreign ? (
          <div className="field">
            <label>Exchange rate (1 {docCurrency} = ? {currency}) *</label>
            <input value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="e.g. 3.67" />
          </div>
        ) : <div className="field" />}
      </div>
      {fxRateInvalid(currency, docCurrency, fxRate) && (
        <div className="error" style={{ marginBottom: 12 }}>
          Enter the {docCurrency} → {currency} exchange rate (a 1:1 rate would record {docCurrency} amounts as {currency}).
        </div>
      )}
      <div className="field">
        <label>Receive into warehouse</label>
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          {(warehouses ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      <LineItemsEditor lines={lines} onChange={setLines} items={items?.data ?? []} taxRates={taxRates ?? []}
        currency={docCurrency} rateLabel="Cost" priceFrom="purchase_price" />
      <div className="grid-2">
        <div className="field"><label>Discount ({docCurrency})</label><input value={discount} placeholder="0.00" onChange={(e) => setDiscount(e.target.value)} /></div>
        <div className="field"><label>Shipping / freight ({docCurrency})</label><input value={shipping} placeholder="0.00" onChange={(e) => setShipping(e.target.value)} /></div>
      </div>
      {foreign && !fxRateInvalid(currency, docCurrency, fxRate) && (() => {
        const t = lineTotals(lines);
        const docTotal = Math.round((t.total - (Number(discount) || 0) + (Number(shipping) || 0)) * 100) / 100;
        const baseTotal = Math.round(docTotal * (Number(fxRate) || 1) * 100) / 100;
        return (
          <div className="fx-note">
            Total <strong>{money(docTotal, docCurrency)}</strong>{" ≈ "}
            <strong>{money(baseTotal, currency)}</strong>
            <span className="muted"> (at 1 {docCurrency} = {Number(fxRate) || 1} {currency})</span>
          </div>
        );
      })()}
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button disabled={!supplierId || save.isPending || fxRateInvalid(currency, docCurrency, fxRate)} onClick={() => save.mutate(false)}>Save draft</button>
        <button className="primary" disabled={!supplierId || save.isPending || fxRateInvalid(currency, docCurrency, fxRate)} onClick={() => save.mutate(true)}>
          {save.isPending ? "…" : "Save & Post"}
        </button>
      </div>
    </Modal>
  );
}
