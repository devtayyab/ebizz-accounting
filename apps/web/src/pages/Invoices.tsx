import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Customer, InvoiceDocument, Item, Paginated, SalesInvoice, TaxRate } from "@ebizz/shared";
import { supabase } from "../lib/supabase";

interface WarehouseOption { id: string; name: string }
import { api, ApiError } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { useConfirm } from "../state/ConfirmContext";
import { Modal } from "../components/Modal";
import { EditableLine, LineItemsEditor, emptyLine, lineTotals } from "../components/LineItemsEditor";
import { fxRateInvalid } from "../components/CurrencyRate";
import { InvoiceTemplate, InvoiceTemplateData } from "../components/InvoiceTemplate";
import { money, paymentStatus, taxBreakdown } from "../lib/format";
import { EmptyCell } from "../components/Empty";
import { Pagination } from "../components/Pagination";
import { useDebounced } from "../lib/useDebounced";
import { ExportButtons } from "../components/ExportButtons";

export function InvoicesPage() {
  const { activeCompanyId, activeCompany } = useCompany();
  const qc = useQueryClient();
  const ask = useConfirm();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const ccy = activeCompany?.base_currency ?? "USD";

  const { data, isLoading } = useQuery({
    queryKey: ["invoices", activeCompanyId, page, pageSize, q],
    queryFn: () =>
      api.get<Paginated<SalesInvoice>>(
        `/invoices?page=${page}&page_size=${pageSize}` + (q ? `&q=${encodeURIComponent(q)}` : ""),
      ),
    enabled: !!activeCompanyId,
  });
  const { data: warehouses } = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get<{ id: string; name: string }[]>("/locations"),
    enabled: !!activeCompanyId,
  });
  const whName = (id: string | null) => warehouses?.find((w) => w.id === id)?.name ?? "—";
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["reports"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const post = useMutation({
    mutationFn: (id: string) => api.post(`/invoices/${id}/post`),
    onSuccess: invalidate, meta: { successMessage: "Invoice posted" },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/invoices/${id}`),
    onSuccess: invalidate, meta: { successMessage: "Invoice deleted" },
  });
  const reverse = useMutation({
    mutationFn: (id: string) => api.post(`/invoices/${id}/reverse`),
    onSuccess: invalidate, meta: { successMessage: "Invoice voided" },
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.post(`/invoices/${id}/restore`),
    onSuccess: invalidate, meta: { successMessage: "Invoice restored" },
  });
  const [payFor, setPayFor] = useState<SalesInvoice | null>(null);
  const [docsFor, setDocsFor] = useState<SalesInvoice | null>(null);
  const revise = useMutation({
    mutationFn: (id: string) => api.post(`/invoices/${id}/revise`),
    onSuccess: (_data, id) => { invalidate(); setEditId(id); setEditorOpen(true); },
    meta: { successMessage: "Un-posted — you can edit now" },
  });

  return (
    <div>
      <div className="page-head">
        <h1>Sales Invoices</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ExportButtons
            rows={data?.data ?? []}
            filename="invoices"
            title="Sales Invoices"
            columns={[
              { header: "Number", value: (i) => i.invoice_number },
              { header: "Date", value: (i) => i.invoice_date },
              { header: "Warehouse", value: (i) => whName(i.location_id) },
              { header: "Currency", value: (i) => i.currency },
              { header: "Total", value: (i) => Number(i.total) },
              { header: "Paid", value: (i) => Number(i.amount_paid) },
              { header: "Status", value: (i) => i.status },
            ]}
          />
          <input
            type="search"
            placeholder="Search invoice #…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{ width: 220 }}
          />
          <button className="primary" onClick={() => { setEditId(null); setEditorOpen(true); }}>
            + New invoice
          </button>
        </div>
      </div>
      <div className="card">
        {isLoading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Number</th><th>Date</th><th>Customer</th><th>Warehouse</th><th>Total</th>
                <th>Paid</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {(data?.data ?? []).map((inv) => {
                const b = paymentStatus(inv.status, inv.total, inv.amount_paid, inv.due_date);
                return (
                  <tr key={inv.id}>
                    <td>{inv.invoice_number}</td>
                    <td>{inv.invoice_date}</td>
                    <td><CustomerName id={inv.customer_id} /></td>
                    <td className="muted">{whName(inv.location_id)}</td>
                    <td>{money(inv.total, inv.currency)}</td>
                    <td>{money(inv.amount_paid, inv.currency)}</td>
                    <td><span className={`badge ${b.cls}`}>{b.label}</span></td>
                    <td style={{ textAlign: "right" }}>
                      {inv.status === "draft" && (
                        <>
                          <button className="link" onClick={() => { setEditId(inv.id); setEditorOpen(true); }}>Edit</button>
                          <button className="link" onClick={() => post.mutate(inv.id)}>Post</button>
                          <button className="link danger" onClick={() => ask({ title: "Delete invoice", message: `Delete draft ${inv.invoice_number}? This cannot be undone.`, confirmLabel: "Delete", danger: true }).then((ok) => ok && remove.mutate(inv.id))}>Delete</button>
                        </>
                      )}
                      <Link className="link" to={`/invoices/${inv.id}/print`} style={{ marginLeft: 6 }}>View</Link>
                      <button className="link" onClick={() => setDocsFor(inv)}>Files</button>
                      {inv.status === "posted" && Number(inv.amount_paid) === 0 && (
                        <button className="link" onClick={() => ask({ title: "Edit posted invoice", message: `Editing ${inv.invoice_number} will un-post it (reverse its ledger entry) so you can change it, then re-post.`, confirmLabel: "Un-post & edit" }).then((ok) => ok && revise.mutate(inv.id))}>Edit</button>
                      )}
                      {inv.status === "posted" && Number(inv.total) - Number(inv.amount_paid) > 0.005 && (
                        <button className="link" onClick={() => setPayFor(inv)}>Receive payment</button>
                      )}
                      {inv.status === "posted" && Number(inv.amount_paid) === 0 && (
                        <button className="link danger" onClick={() => ask({ title: "Void invoice", message: `Void ${inv.invoice_number}? A reversing journal entry will be posted and stock returned.`, confirmLabel: "Void", danger: true }).then((ok) => ok && reverse.mutate(inv.id))}>Void</button>
                      )}
                      {inv.status === "void" && (
                        <button className="link" onClick={() => ask({ title: "Undo void", message: `Restore ${inv.invoice_number} back to posted?`, confirmLabel: "Restore" }).then((ok) => ok && restore.mutate(inv.id))}>Undo void</button>
                      )}
                      {(inv.status === "void" || (inv.status === "posted" && Number(inv.amount_paid) === 0)) && (
                        <button className="link danger" onClick={() => ask({ title: "Delete invoice", message: inv.status === "posted" ? `Delete ${inv.invoice_number}? It will be voided (ledger reversed, stock returned) and removed.` : `Permanently delete ${inv.invoice_number}?`, confirmLabel: "Delete", danger: true }).then((ok) => ok && remove.mutate(inv.id))}>Delete</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {data?.data.length === 0 && (
                <tr><td colSpan={8}><EmptyCell>No invoices yet. Create your first sales invoice.</EmptyCell></td></tr>
              )}
            </tbody>
          </table>
        )}
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
      </div>
      {editorOpen && (
        <InvoiceEditor
          companyId={activeCompanyId!}
          currency={ccy}
          invoiceId={editId}
          onClose={() => setEditorOpen(false)}
          onSaved={() => { invalidate(); setEditorOpen(false); }}
        />
      )}
      {payFor && (
        <PaymentModal invoice={payFor} onClose={() => setPayFor(null)} onSaved={() => { invalidate(); setPayFor(null); }} />
      )}
      {docsFor && <DocumentsModal invoice={docsFor} onClose={() => setDocsFor(null)} />}
    </div>
  );
}

const BUCKET = "invoice-docs";
const safeName = (n: string) => n.replace(/[^a-zA-Z0-9._-]/g, "_");

/** Upload / view / download / delete files attached to an invoice. */
function DocumentsModal({ invoice, onClose }: { invoice: SalesInvoice; onClose: () => void }) {
  const qc = useQueryClient();
  const ask = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = ["documents", invoice.id];
  const { data: docs, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get<InvoiceDocument[]>(`/invoices/${invoice.id}/documents`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const onUpload = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const path = `${invoice.organization_id}/${invoice.id}/${crypto.randomUUID()}-${safeName(file.name)}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      await api.post(`/invoices/${invoice.id}/documents`, {
        name: file.name, storage_path: path, mime: file.type || undefined, size: file.size,
      });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const download = async (d: InvoiceDocument) => {
    const { data, error: sErr } = await supabase.storage.from(BUCKET).createSignedUrl(d.storage_path, 120);
    if (sErr || !data) { setError(sErr?.message ?? "Could not create download link"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const remove = async (d: InvoiceDocument) => {
    if (!(await ask({ title: "Delete file", message: `Delete “${d.name}”?`, confirmLabel: "Delete", danger: true }))) return;
    await supabase.storage.from(BUCKET).remove([d.storage_path]);
    await api.delete(`/documents/${d.id}`);
    refresh();
  };

  const fmtSize = (n: number | null) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

  return (
    <Modal title={`Documents — ${invoice.invoice_number}`} onClose={onClose} width={560}>
      <p className="muted" style={{ marginTop: 0 }}>Attach POs, delivery notes, receipts, or any file related to this invoice.</p>
      <label className="primary" style={{ display: "inline-block", cursor: busy ? "wait" : "pointer", padding: "8px 14px", borderRadius: 8 }}>
        {busy ? "Uploading…" : "+ Upload file"}
        <input type="file" style={{ display: "none" }} disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
      </label>
      {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      <table style={{ marginTop: 14 }}>
        <thead><tr><th>Name</th><th>Size</th><th /></tr></thead>
        <tbody>
          {isLoading ? <tr><td colSpan={3} className="muted">Loading…</td></tr>
            : (docs ?? []).map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td className="muted">{fmtSize(d.size)}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="link" onClick={() => download(d)}>Download</button>
                  <button className="link danger" onClick={() => remove(d)}>Delete</button>
                </td>
              </tr>
            ))}
          {!isLoading && docs?.length === 0 && <tr><td colSpan={3}><EmptyCell>No files attached yet.</EmptyCell></td></tr>}
        </tbody>
      </table>
    </Modal>
  );
}

interface FundOption { id: string; name: string; gl_account_id: string | null }

/**
 * Receive a payment or deposit for an invoice through a Fund (the "payment type").
 * Amount can be the full balance, a fixed amount, or a percentage of the total —
 * covering both "mark paid" and customer-deposit use cases.
 */
function PaymentModal({ invoice, onClose, onSaved }: { invoice: SalesInvoice; onClose: () => void; onSaved: () => void }) {
  const outstanding = Math.round((Number(invoice.total) - Number(invoice.amount_paid)) * 100) / 100;
  const [fundId, setFundId] = useState("");
  const [mode, setMode] = useState<"full" | "fixed" | "percent">("full");
  const [fixed, setFixed] = useState("");
  const [percent, setPercent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: funds } = useQuery({ queryKey: ["funds", "all"], queryFn: () => api.get<FundOption[]>("/funds") });
  const linked = (funds ?? []).filter((f) => f.gl_account_id);

  const amount = mode === "full" ? outstanding
    : mode === "fixed" ? Math.round((Number(fixed) || 0) * 100) / 100
    : Math.round(Number(invoice.total) * (Number(percent) || 0) / 100 * 100) / 100;
  const amountValid = amount > 0 && amount <= outstanding + 0.0049;

  const pay = useMutation({
    mutationFn: () => api.post(`/invoices/${invoice.id}/receive-payment`, {
      fund_id: fundId,
      amount: mode === "full" ? undefined : String(amount),
    }),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Payment failed"),
    meta: { successMessage: "Payment recorded" },
  });

  return (
    <Modal title={`Receive payment — ${invoice.invoice_number}`} onClose={onClose} width={480}>
      <p className="muted" style={{ marginTop: 0 }}>
        Outstanding balance: <strong>{money(outstanding, invoice.currency)}</strong>
      </p>
      <div className="field">
        <label>Payment type (fund) *</label>
        <select value={fundId} onChange={(e) => setFundId(e.target.value)}>
          <option value="">Select a fund…</option>
          {linked.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        {linked.length === 0 && (
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            No funds are linked to a cash/bank account yet. Open <strong>Funds &amp; Advances</strong> and link one first.
          </div>
        )}
      </div>
      <div className="field">
        <label>Amount</label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
          {(["full", "fixed", "percent"] as const).map((m) => (
            <label key={m} style={{ display: "flex", gap: 6, alignItems: "center", margin: 0, fontWeight: 400 }}>
              <input type="radio" style={{ width: "auto" }} checked={mode === m} onChange={() => setMode(m)} />
              {m === "full" ? "Full balance" : m === "fixed" ? "Fixed amount" : "Percentage of total"}
            </label>
          ))}
        </div>
        {mode === "fixed" && <input value={fixed} placeholder="0.00" onChange={(e) => setFixed(e.target.value)} />}
        {mode === "percent" && <input value={percent} placeholder="e.g. 25" onChange={(e) => setPercent(e.target.value)} />}
      </div>
      <div className="fx-note">
        Will record <strong>{money(amount, invoice.currency)}</strong> against the invoice
        {mode !== "full" && amount > 0 && amount < outstanding ? " (deposit / part payment)." : "."}
      </div>
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!fundId || !amountValid || pay.isPending} onClick={() => pay.mutate()}>
          {pay.isPending ? "…" : "Record payment"}
        </button>
      </div>
    </Modal>
  );
}

function CustomerName({ id }: { id: string }) {
  const { data } = useQuery({
    queryKey: ["customers", "all"],
    queryFn: () => api.get<Paginated<Customer>>("/customers?page=1&page_size=200"),
  });
  return <>{data?.data.find((c) => c.id === id)?.name ?? "—"}</>;
}

function InvoiceEditor({
  companyId, currency, invoiceId, onClose, onSaved,
}: {
  companyId: string; currency: string; invoiceId: string | null;
  onClose: () => void; onSaved: () => void;
}) {
  const { activeCompany } = useCompany();
  const [customerId, setCustomerId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [docCurrency, setDocCurrency] = useState(currency);
  const [fxRate, setFxRate] = useState("1");
  const [discount, setDiscount] = useState("");
  const [shipping, setShipping] = useState("");
  const [itemLines, setItemLines] = useState<EditableLine[]>([emptyLine()]);
  const [serviceLines, setServiceLines] = useState<EditableLine[]>([]);
  const [shipTo, setShipTo] = useState({ name: "", address: "", city: "", country: "" });
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [termsTouched, setTermsTouched] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: customers } = useQuery({ queryKey: ["customers", "all"], queryFn: () => api.get<Paginated<Customer>>("/customers?page=1&page_size=200") });
  const { data: items } = useQuery({ queryKey: ["items", "all"], queryFn: () => api.get<Paginated<Item>>("/items?page=1&page_size=200") });
  const { data: taxRates } = useQuery({ queryKey: ["tax-rates"], queryFn: () => api.get<TaxRate[]>("/tax-rates") });
  const { data: warehouses } = useQuery({ queryKey: ["locations"], queryFn: () => api.get<WarehouseOption[]>("/locations") });
  const { data: currencies } = useQuery({ queryKey: ["currencies"], queryFn: () => api.get<{ code: string }[]>("/currencies") });
  // On-hand quantities so we can hide out-of-stock inventory items from the picker.
  const { data: valuation } = useQuery({ queryKey: ["reports", "valuation", companyId], queryFn: () => api.get<{ item_id: string; quantity: string }[]>("/reports/inventory-valuation") });
  const onHand = (itemId: string) => Number(valuation?.find((v) => v.item_id === itemId)?.quantity ?? 0);
  const foreign = docCurrency !== currency;
  // Prefill T&C from the company default for new invoices (until the user edits it).
  useEffect(() => {
    if (!invoiceId && !termsTouched && !terms && activeCompany?.invoice_terms) setTerms(activeCompany.invoice_terms);
  }, [activeCompany, invoiceId, termsTouched, terms]);

  const customer = customers?.data.find((c) => c.id === customerId);
  // Auto-fill due date from the customer's payment terms (only when empty).
  useEffect(() => {
    if (customer && !dueDate && !invoiceId) {
      const d = new Date(invoiceDate);
      d.setDate(d.getDate() + (customer.payment_terms_days ?? 30));
      setDueDate(d.toISOString().slice(0, 10));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  useQuery({
    queryKey: ["invoice", invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const inv = await api.get<SalesInvoice>(`/invoices/${invoiceId}`);
      setCustomerId(inv.customer_id);
      if (inv.location_id) setLocationId(inv.location_id);
      setInvoiceDate(inv.invoice_date);
      setDueDate(inv.due_date ?? "");
      setDocCurrency(inv.currency); setFxRate(String(inv.fx_rate ?? "1"));
      setDiscount(Number(inv.discount_total) ? String(inv.discount_total) : "");
      setShipping(Number(inv.shipping_total) ? String(inv.shipping_total) : "");
      setNotes(inv.notes ?? "");
      setTerms(inv.terms ?? ""); setTermsTouched(true);
      setShipTo({ name: inv.ship_to_name ?? "", address: inv.ship_to_address ?? "", city: inv.ship_to_city ?? "", country: inv.ship_to_country ?? "" });
      const mapped = (inv.lines ?? []).map((l) => ({
        kind: l.line_kind ?? "item",
        line: { item_id: l.item_id ?? "", description: l.description ?? "",
          quantity: String(l.quantity), rate: String(l.unit_price), tax_rate: String(l.tax_rate) } as EditableLine,
      }));
      const items = mapped.filter((m) => m.kind !== "service").map((m) => m.line);
      const services = mapped.filter((m) => m.kind === "service").map((m) => m.line);
      setItemLines(items.length ? items : [emptyLine()]);
      setServiceLines(services);
      return inv;
    },
  });

  const save = useMutation({
    mutationFn: (thenPost: boolean) => {
      const body = {
        company_id: companyId, customer_id: customerId, location_id: locationId,
        invoice_date: invoiceDate, due_date: dueDate || undefined, notes: notes || undefined,
        currency: docCurrency, fx_rate: foreign ? String(Number(fxRate) || 1) : "1",
        discount_total: String(Number(discount) || 0), shipping_total: String(Number(shipping) || 0),
        terms: terms || undefined,
        ship_to_name: shipTo.name || undefined, ship_to_address: shipTo.address || undefined,
        ship_to_city: shipTo.city || undefined, ship_to_country: shipTo.country || undefined,
        lines: [
          ...itemLines.map((l) => ({ l, kind: "item" as const })),
          ...serviceLines.map((l) => ({ l, kind: "service" as const })),
        ]
          .filter(({ l }) => Number(l.quantity) > 0 && (l.item_id || l.description || Number(l.rate) > 0))
          .map(({ l, kind }) => ({
            item_id: l.item_id || undefined, description: l.description || undefined,
            line_kind: kind,
            quantity: String(Number(l.quantity) || 0),
            unit_price: String(Number(l.rate) || 0),
            tax_rate: String(Number(l.tax_rate) || 0),
          })),
      };
      const req = invoiceId
        ? api.patch<SalesInvoice>(`/invoices/${invoiceId}`, body)
        : api.post<SalesInvoice>("/invoices", body);
      return req.then((inv) => (thenPost ? api.post(`/invoices/${inv.id}/post`) : inv));
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Save failed"),
  });

  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const allLines = [...itemLines, ...serviceLines];
  const totals = lineTotals(allLines);
  const toTplLine = (l: EditableLine, isService: boolean) => {
    const sub = round2(Number(l.quantity || (isService ? 1 : 0)) * Number(l.rate || 0));
    const tax = round2(sub * Number(l.tax_rate || 0));
    return {
      name: isService
        ? (l.description || "Service")
        : (items?.data.find((i) => i.id === l.item_id)?.name ?? l.description ?? "—"),
      description: isService ? "" : l.description,
      qty: Number(l.quantity || 1), price: l.rate, tax: String(tax), amount: String(round2(sub + tax)),
    };
  };
  const taxLines = taxBreakdown(
    allLines.map((l) => {
      const sub = Number(l.quantity || 1) * Number(l.rate || 0);
      return { taxRate: Number(l.tax_rate || 0), taxAmount: round2(sub * Number(l.tax_rate || 0)) };
    }),
    taxRates ?? [],
  );
  const previewData: InvoiceTemplateData = {
    company: {
      name: activeCompany?.name ?? "", legal: activeCompany?.legal_name,
      address: activeCompany?.address_line1, city: activeCompany?.city, country: activeCompany?.country,
      phone: activeCompany?.phone, email: activeCompany?.email, taxNumber: activeCompany?.tax_number, logo: activeCompany?.logo_url,
    },
    number: invoiceId ? "(existing)" : "Draft (preview)", date: invoiceDate, dueDate: dueDate || null,
    billTo: { name: customer?.name ?? "—", email: customer?.email, taxNumber: customer?.tax_number, address: customer?.address_line1, city: customer?.city, country: customer?.country },
    shipTo,
    items: itemLines.filter((l) => Number(l.quantity) > 0 && (l.item_id || l.description)).map((l) => toTplLine(l, false)),
    services: serviceLines.filter((l) => l.description || Number(l.rate) > 0).map((l) => toTplLine(l, true)),
    subtotal: String(totals.subtotal),
    taxLines,
    discount: String(Number(discount) || 0), shipping: String(Number(shipping) || 0),
    total: String(round2(totals.total - (Number(discount) || 0) + (Number(shipping) || 0))),
    currency: docCurrency, notes, terms, footer: activeCompany?.invoice_footer,
  };

  return (
    <Modal title={invoiceId ? "Edit invoice" : "New invoice"} onClose={onClose} width={860}>
      {preview ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <button onClick={() => setPreview(false)}>← Back to edit</button>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 20 }}>
            <InvoiceTemplate data={previewData} />
          </div>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button disabled={!customerId || !locationId || save.isPending || fxRateInvalid(currency, docCurrency, fxRate)} onClick={() => save.mutate(false)}>Save draft</button>
            <button className="primary" disabled={!customerId || !locationId || save.isPending || fxRateInvalid(currency, docCurrency, fxRate)} onClick={() => save.mutate(true)}>
              {save.isPending ? "…" : "Save & Post"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="grid-2">
            <div className="field">
              <label>Customer *</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Select…</option>
                {(customers?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="grid-2">
              <div className="field"><label>Date</label><input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
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
            <label>Warehouse * <span className="muted" style={{ fontWeight: 400 }}>(issue stock from — internal, not shown on the invoice)</span></label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Select a warehouse…</option>
              {(warehouses ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>

          <label style={{ fontWeight: 600 }}>Ship To (delivery address)</label>
          <div className="grid-2">
            <div className="field"><label>Name</label><input value={shipTo.name} onChange={(e) => setShipTo({ ...shipTo, name: e.target.value })} /></div>
            <div className="field"><label>Address</label><input value={shipTo.address} onChange={(e) => setShipTo({ ...shipTo, address: e.target.value })} /></div>
          </div>
          <div className="grid-2">
            <div className="field"><label>City</label><input value={shipTo.city} onChange={(e) => setShipTo({ ...shipTo, city: e.target.value })} /></div>
            <div className="field"><label>Country</label><input value={shipTo.country} onChange={(e) => setShipTo({ ...shipTo, country: e.target.value })} /></div>
          </div>

          <label style={{ fontWeight: 600, display: "block", marginTop: 8 }}>Items</label>
          <LineItemsEditor
            lines={itemLines} onChange={setItemLines} items={items?.data ?? []} taxRates={taxRates ?? []}
            currency={docCurrency} rateLabel="Unit Price" priceFrom="sale_price" kind="item"
            isSelectable={(it) => !it.track_inventory || onHand(it.id) > 0}
          />
          <label style={{ fontWeight: 600, display: "block", marginTop: 18 }}>Services <span className="muted" style={{ fontWeight: 400 }}>(labour, fees — no stock)</span></label>
          <LineItemsEditor
            lines={serviceLines} onChange={setServiceLines} items={[]} taxRates={taxRates ?? []}
            currency={docCurrency} rateLabel="Cost" priceFrom="sale_price" kind="service"
          />
          <div className="grid-2">
            <div className="field"><label>Discount ({docCurrency})</label><input value={discount} placeholder="0.00" onChange={(e) => setDiscount(e.target.value)} /></div>
            <div className="field"><label>Shipping / freight ({docCurrency})</label><input value={shipping} placeholder="0.00" onChange={(e) => setShipping(e.target.value)} /></div>
          </div>
          {foreign && !fxRateInvalid(currency, docCurrency, fxRate) && (
            <div className="fx-note">
              Total <strong>{money(round2(totals.total - (Number(discount) || 0) + (Number(shipping) || 0)), docCurrency)}</strong>
              {" ≈ "}
              <strong>{money(round2((totals.total - (Number(discount) || 0) + (Number(shipping) || 0)) * (Number(fxRate) || 1)), currency)}</strong>
              <span className="muted"> (at 1 {docCurrency} = {Number(fxRate) || 1} {currency})</span>
            </div>
          )}
          <div className="field"><label>Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="field">
            <label>Terms &amp; Conditions {activeCompany?.invoice_terms ? "(prefilled from company default)" : ""}</label>
            <textarea rows={3} value={terms} onChange={(e) => { setTerms(e.target.value); setTermsTouched(true); }}
              placeholder="e.g. Payment due within 30 days. Goods remain our property until paid in full." />
          </div>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button onClick={onClose}>Cancel</button>
            <button disabled={!customerId || !locationId} onClick={() => setPreview(true)}>Preview →</button>
            <button disabled={!customerId || !locationId || save.isPending || fxRateInvalid(currency, docCurrency, fxRate)} onClick={() => save.mutate(false)}>Save draft</button>
            <button className="primary" disabled={!customerId || !locationId || save.isPending || fxRateInvalid(currency, docCurrency, fxRate)} onClick={() => save.mutate(true)}>
              {save.isPending ? "…" : "Save & Post"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
