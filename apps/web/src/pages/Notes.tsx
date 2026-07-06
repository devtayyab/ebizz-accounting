import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Customer, Item, Paginated, Supplier, TaxRate } from "@ebizz/shared";

interface WarehouseOption { id: string; name: string }
import { api, ApiError } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { Modal } from "../components/Modal";
import { EditableLine, LineItemsEditor, emptyLine, lineTotals } from "../components/LineItemsEditor";
import { CurrencyRate, fxRateInvalid } from "../components/CurrencyRate";
import { money, statusBadge } from "../lib/format";
import { EmptyCell } from "../components/Empty";

interface NoteRow {
  id: string;
  note_number: string;
  note_date: string;
  total: string;
  currency: string;
  status: string;
}

export function CreditNotesPage() { return <NotesPage kind="credit" />; }
export function DebitNotesPage() { return <NotesPage kind="debit" />; }

function NotesPage({ kind }: { kind: "credit" | "debit" }) {
  const { activeCompanyId, activeCompany } = useCompany();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const ccy = activeCompany?.base_currency ?? "USD";
  const base = kind === "credit" ? "/credit-notes" : "/debit-notes";
  const title = kind === "credit" ? "Credit Notes (sales returns)" : "Debit Notes (purchase returns)";

  const { data, isLoading } = useQuery({
    queryKey: [base, activeCompanyId], queryFn: () => api.get<NoteRow[]>(base), enabled: !!activeCompanyId,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [base] });
    qc.invalidateQueries({ queryKey: ["reports"] });
    qc.invalidateQueries({ queryKey: ["items"] });
  };
  const post = useMutation({ mutationFn: (id: string) => api.post(`${base}/${id}/post`), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`${base}/${id}`), onSuccess: invalidate });

  return (
    <div>
      <div className="page-head">
        <h1>{title}</h1>
        <button className="primary" onClick={() => { setEditId(null); setOpen(true); }}>+ New {kind} note</button>
      </div>
      <div className="card">
        {isLoading ? <p className="muted">Loading…</p> : (
          <table>
            <thead><tr><th>Number</th><th>Date</th><th>Total</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(data ?? []).map((n) => {
                const b = statusBadge(n.status);
                return (
                  <tr key={n.id}>
                    <td>{n.note_number}</td><td>{n.note_date}</td><td>{money(n.total, n.currency)}</td>
                    <td><span className={`badge ${b.cls}`}>{b.label}</span></td>
                    <td style={{ textAlign: "right" }}>
                      {n.status === "draft" && (
                        <>
                          <button className="link" onClick={() => { setEditId(n.id); setOpen(true); }}>Edit</button>
                          <button className="link" onClick={() => post.mutate(n.id)}>Post</button>
                          <button className="link danger" onClick={() => remove.mutate(n.id)}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {data?.length === 0 && <tr><td colSpan={5}><EmptyCell>Nothing here yet.</EmptyCell></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {open && <NoteEditor kind={kind} companyId={activeCompanyId!} currency={ccy} noteId={editId}
        onClose={() => { setOpen(false); setEditId(null); }} onSaved={() => { invalidate(); setOpen(false); setEditId(null); }} />}
    </div>
  );
}

interface NoteDoc {
  customer_id?: string; supplier_id?: string; location_id: string | null; restock: boolean;
  currency?: string; fx_rate?: string;
  lines?: { item_id: string | null; description: string | null; quantity: string; unit_price?: string; unit_cost?: string; tax_rate: string }[];
}

function NoteEditor({ kind, companyId, currency, noteId, onClose, onSaved }: {
  kind: "credit" | "debit"; companyId: string; currency: string; noteId: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [partyId, setPartyId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([emptyLine()]);
  const [restock, setRestock] = useState(true);
  const [docCurrency, setDocCurrency] = useState(currency);
  const [fxRate, setFxRate] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const base = kind === "credit" ? "/credit-notes" : "/debit-notes";
  const foreign = docCurrency !== currency;

  useQuery({
    queryKey: [base, "edit", noteId],
    enabled: !!noteId,
    queryFn: async () => {
      const n = await api.get<NoteDoc>(`${base}/${noteId}`);
      setPartyId((kind === "credit" ? n.customer_id : n.supplier_id) ?? "");
      if (n.location_id) setLocationId(n.location_id);
      setRestock(n.restock);
      if (n.currency) setDocCurrency(n.currency);
      setFxRate(String(n.fx_rate ?? "1"));
      setLines((n.lines ?? []).map((l) => ({
        item_id: l.item_id ?? "", description: l.description ?? "",
        quantity: String(l.quantity), rate: String(kind === "credit" ? l.unit_price : l.unit_cost), tax_rate: String(l.tax_rate),
      })));
      return n;
    },
  });

  const { data: customers } = useQuery({ queryKey: ["customers", "all"], queryFn: () => api.get<Paginated<Customer>>("/customers?page=1&page_size=200"), enabled: kind === "credit" });
  const { data: suppliers } = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => api.get<Paginated<Supplier>>("/suppliers?page=1&page_size=200"), enabled: kind === "debit" });
  const { data: items } = useQuery({ queryKey: ["items", "all"], queryFn: () => api.get<Paginated<Item>>("/items?page=1&page_size=200") });
  const { data: taxRates } = useQuery({ queryKey: ["tax-rates"], queryFn: () => api.get<TaxRate[]>("/tax-rates") });
  const { data: warehouses } = useQuery({ queryKey: ["locations"], queryFn: () => api.get<WarehouseOption[]>("/locations") });
  const { data: currencies } = useQuery({ queryKey: ["currencies"], queryFn: () => api.get<{ code: string }[]>("/currencies") });
  useEffect(() => { if (!locationId && warehouses?.length) setLocationId(warehouses[0].id); }, [warehouses, locationId]);
  const parties = kind === "credit" ? (customers?.data ?? []) : (suppliers?.data ?? []);

  const save = useMutation({
    mutationFn: () => {
      const partyKey = kind === "credit" ? "customer_id" : "supplier_id";
      const rateKey = kind === "credit" ? "unit_price" : "unit_cost";
      const body: Record<string, unknown> = {
        company_id: companyId, [partyKey]: partyId, location_id: locationId || undefined, restock,
        currency: docCurrency, fx_rate: foreign ? String(Number(fxRate) || 1) : "1",
        lines: lines.filter((l) => Number(l.quantity) > 0).map((l) => ({
          item_id: l.item_id || undefined, description: l.description || undefined,
          quantity: String(Number(l.quantity) || 0), [rateKey]: String(Number(l.rate) || 0),
          tax_rate: String(Number(l.tax_rate) || 0),
        })),
      };
      return noteId ? api.patch(`${base}/${noteId}`, body) : api.post(base, body);
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Save failed"),
    meta: { successMessage: noteId ? "Note updated" : "Note saved" },
  });

  return (
    <Modal title={`${noteId ? "Edit" : "New"} ${kind === "credit" ? "credit" : "debit"} note`} onClose={onClose} width={820}>
      <div className="grid-2">
        <div className="field">
          <label>{kind === "credit" ? "Customer" : "Supplier"} *</label>
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
        currency={docCurrency} rateLabel={kind === "credit" ? "Price" : "Cost"}
        priceFrom={kind === "credit" ? "sale_price" : "purchase_price"} />
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={restock} onChange={(e) => setRestock(e.target.checked)} />
        Restock returned items (adjust inventory)
      </label>
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!partyId || save.isPending || fxRateInvalid(currency, docCurrency, fxRate)} onClick={() => save.mutate()}>Save draft</button>
      </div>
    </Modal>
  );
}
