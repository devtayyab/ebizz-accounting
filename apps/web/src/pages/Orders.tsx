import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Customer, Item, Paginated, Supplier, TaxRate } from "@ebizz/shared";

interface WarehouseOption { id: string; name: string }
import { api, ApiError } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { useConfirm } from "../state/ConfirmContext";
import { Modal } from "../components/Modal";
import { EditableLine, LineItemsEditor, emptyLine, lineTotals } from "../components/LineItemsEditor";
import { CurrencyRate, fxRateInvalid } from "../components/CurrencyRate";
import { money } from "../lib/format";
import { EmptyCell } from "../components/Empty";

interface OrderRow {
  id: string;
  order_number: string;
  order_date: string;
  customer_id?: string;
  supplier_id?: string;
  total: string;
  currency: string;
  status: string;
}

export function SalesOrdersPage() { return <OrdersPage kind="sales" />; }
export function PurchaseOrdersPage() { return <OrdersPage kind="purchase" />; }

function OrdersPage({ kind }: { kind: "sales" | "purchase" }) {
  const { activeCompanyId, activeCompany } = useCompany();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const ccy = activeCompany?.base_currency ?? "USD";
  const base = kind === "sales" ? "/sales-orders" : "/purchase-orders";
  const title = kind === "sales" ? "Sales Orders" : "Purchase Orders";

  const { data, isLoading } = useQuery({
    queryKey: [base, activeCompanyId],
    queryFn: () => api.get<OrderRow[]>(base),
    enabled: !!activeCompanyId,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [base] });
    qc.invalidateQueries({ queryKey: [kind === "sales" ? "/invoices" : "/bills"] });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["bills"] });
  };
  const convert = useMutation({ mutationFn: (id: string) => api.post(`${base}/${id}/convert`), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`${base}/${id}`), onSuccess: invalidate });

  return (
    <div>
      <div className="page-head">
        <h1>{title}</h1>
        <button className="primary" onClick={() => setOpen(true)}>+ New {kind === "sales" ? "order" : "PO"}</button>
      </div>
      <div className="card">
        {isLoading ? <p className="muted">Loading…</p> : (
          <table>
            <thead><tr><th>Number</th><th>Date</th><th>Total</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(data ?? []).map((o) => (
                <tr key={o.id}>
                  <td>{o.order_number}</td><td>{o.order_date}</td>
                  <td>{money(o.total, o.currency)}</td>
                  <td><span className={`badge ${o.status === "open" ? "" : "off"}`}>{o.status}</span></td>
                  <td style={{ textAlign: "right" }}>
                    {(o.status === "open" || o.status === "draft") && (
                      <>
                        <button className="link" onClick={() => convert.mutate(o.id)}>
                          Convert to {kind === "sales" ? "invoice" : "bill"}
                        </button>
                        <button className="link danger" onClick={() => confirm({ title: "Delete order", message: `Delete ${o.order_number}?`, confirmLabel: "Delete", danger: true }).then((ok) => ok && remove.mutate(o.id))}>Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {data?.length === 0 && <tr><td colSpan={5}><EmptyCell>Nothing here yet.</EmptyCell></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {open && <OrderEditor kind={kind} companyId={activeCompanyId!} currency={ccy}
        onClose={() => setOpen(false)} onSaved={() => { invalidate(); setOpen(false); }} />}
    </div>
  );
}

function OrderEditor({ kind, companyId, currency, onClose, onSaved }: {
  kind: "sales" | "purchase"; companyId: string; currency: string; onClose: () => void; onSaved: () => void;
}) {
  const [partyId, setPartyId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([emptyLine()]);
  const [docCurrency, setDocCurrency] = useState(currency);
  const [fxRate, setFxRate] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const base = kind === "sales" ? "/sales-orders" : "/purchase-orders";
  const foreign = docCurrency !== currency;

  const { data: customers } = useQuery({ queryKey: ["customers", "all"], queryFn: () => api.get<Paginated<Customer>>("/customers?page=1&page_size=200"), enabled: kind === "sales" });
  const { data: suppliers } = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => api.get<Paginated<Supplier>>("/suppliers?page=1&page_size=200"), enabled: kind === "purchase" });
  const { data: items } = useQuery({ queryKey: ["items", "all"], queryFn: () => api.get<Paginated<Item>>("/items?page=1&page_size=200") });
  const { data: taxRates } = useQuery({ queryKey: ["tax-rates"], queryFn: () => api.get<TaxRate[]>("/tax-rates") });
  const { data: warehouses } = useQuery({ queryKey: ["locations"], queryFn: () => api.get<WarehouseOption[]>("/locations") });
  const { data: currencies } = useQuery({ queryKey: ["currencies"], queryFn: () => api.get<{ code: string }[]>("/currencies") });
  useEffect(() => { if (!locationId && warehouses?.length) setLocationId(warehouses[0].id); }, [warehouses, locationId]);
  const parties = kind === "sales" ? (customers?.data ?? []) : (suppliers?.data ?? []);

  const save = useMutation({
    mutationFn: () => {
      const partyKey = kind === "sales" ? "customer_id" : "supplier_id";
      const rateKey = kind === "sales" ? "unit_price" : "unit_cost";
      const body: Record<string, unknown> = {
        company_id: companyId, [partyKey]: partyId, location_id: locationId || undefined,
        currency: docCurrency, fx_rate: foreign ? String(Number(fxRate) || 1) : "1",
        lines: lines.filter((l) => Number(l.quantity) > 0).map((l) => ({
          item_id: l.item_id || undefined, description: l.description || undefined,
          quantity: String(Number(l.quantity) || 0), [rateKey]: String(Number(l.rate) || 0),
          tax_rate: String(Number(l.tax_rate) || 0),
        })),
      };
      return api.post(base, body);
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Save failed"),
  });

  return (
    <Modal title={kind === "sales" ? "New sales order" : "New purchase order"} onClose={onClose} width={820}>
      <div className="grid-2">
        <div className="field">
          <label>{kind === "sales" ? "Customer" : "Supplier"} *</label>
          <select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            <option value="">Select…</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Warehouse</label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {(warehouses ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      </div>
      <CurrencyRate base={currency} currencies={(currencies ?? []).map((c) => c.code)}
        currency={docCurrency} setCurrency={setDocCurrency} fxRate={fxRate} setFxRate={setFxRate}
        docTotal={lineTotals(lines).total} />
      <LineItemsEditor lines={lines} onChange={setLines} items={items?.data ?? []} taxRates={taxRates ?? []}
        currency={docCurrency} rateLabel={kind === "sales" ? "Price" : "Cost"}
        priceFrom={kind === "sales" ? "sale_price" : "purchase_price"} />
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!partyId || save.isPending || fxRateInvalid(currency, docCurrency, fxRate)} onClick={() => save.mutate()}>Save order</button>
      </div>
    </Modal>
  );
}
