import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Account,
  InventoryLevel,
  Item,
  ItemType,
  Paginated,
} from "@ebizz/shared";
import { ITEM_TYPES, INVENTORY_MOVEMENT_TYPES } from "@ebizz/shared";
import { api, ApiError } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { useConfirm } from "../state/ConfirmContext";
import { Modal } from "../components/Modal";
import { money, stockStatus } from "../lib/format";
import { EmptyCell } from "../components/Empty";
import { Pagination } from "../components/Pagination";
import { useDebounced } from "../lib/useDebounced";
import { SortHeader } from "../components/SortHeader";
import { ExportButtons } from "../components/ExportButtons";

interface Location {
  id: string;
  name: string;
}

export function ItemsPage() {
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<Item | null>(null);
  const [tracing, setTracing] = useState<Item | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [sort, setSort] = useState("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (col: string) => {
    if (sort === col) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(col); setDir("asc"); }
    setPage(1);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["items", activeCompanyId, page, pageSize, q, sort, dir],
    queryFn: () =>
      api.get<Paginated<Item>>(
        `/items?page=${page}&page_size=${pageSize}&sort=${sort}&dir=${dir}` +
          (q ? `&q=${encodeURIComponent(q)}` : ""),
      ),
    enabled: !!activeCompanyId,
  });
  const { data: valuation } = useQuery({
    queryKey: ["reports", "valuation", activeCompanyId],
    queryFn: () => api.get<{ item_id: string; quantity: string; value: string }[]>("/reports/inventory-valuation"),
    enabled: !!activeCompanyId,
  });
  const onHand = (itemId: string) => valuation?.find((v) => v.item_id === itemId)?.quantity;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["items"] });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/items/${id}`),
    onSuccess: invalidate,
  });
  const askDelete = (it: Item) =>
    confirm({
      title: "Delete item",
      message: `Delete “${it.name}”? This cannot be undone from here (it moves to the Recycle Bin).`,
      confirmLabel: "Delete",
      danger: true,
    }).then((ok) => ok && remove.mutate(it.id));

  return (
    <div>
      <div className="page-head">
        <h1>Items &amp; Inventory</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ExportButtons
            rows={data?.data ?? []}
            filename="items"
            title="Items & Inventory"
            columns={[
              { header: "SKU", value: (i) => i.sku },
              { header: "Name", value: (i) => i.name },
              { header: "Type", value: (i) => i.type },
              { header: "Unit", value: (i) => i.unit },
              { header: "Purchase price", value: (i) => i.purchase_price ?? "" },
              { header: "Sale price", value: (i) => i.sale_price ?? "" },
              { header: "On hand", value: (i) => (i.track_inventory ? Number(onHand(i.id) ?? 0) : "") },
            ]}
          />
          <input
            type="search"
            placeholder="Search name or SKU…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{ width: 240 }}
          />
          <button className="primary" onClick={() => setCreating(true)}>
            + New item
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
                <SortHeader label="SKU" col="sku" sort={sort} dir={dir} onSort={toggleSort} />
                <SortHeader label="Name" col="name" sort={sort} dir={dir} onSort={toggleSort} />
                <th>Type</th>
                <th>Unit</th>
                <SortHeader label="Purchase price" col="purchase_price" sort={sort} dir={dir} onSort={toggleSort} align="right" />
                <SortHeader label="Sale price" col="sale_price" sort={sort} dir={dir} onSort={toggleSort} align="right" />
                <th style={{ textAlign: "right" }}>On hand</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data?.data ?? []).map((it) => (
                <tr key={it.id}>
                  <td>{it.sku}</td>
                  <td>{it.name}</td>
                  <td>{it.type}</td>
                  <td>{it.unit}</td>
                  <td style={{ textAlign: "right" }}>{it.purchase_price ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>{it.sale_price ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    {it.track_inventory ? (Number(onHand(it.id) ?? 0)) : "—"}
                  </td>
                  <td>
                    {(() => {
                      const s = stockStatus(Number(onHand(it.id) ?? 0), Number(it.reorder_point ?? 0), it.track_inventory);
                      return <span className={`badge ${s.cls}`}>{s.label}</span>;
                    })()}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {it.track_inventory && (
                      <>
                        <button className="link" onClick={() => setMoving(it)}>
                          Stock
                        </button>
                        <button className="link" onClick={() => setTracing(it)}>
                          History
                        </button>
                      </>
                    )}
                    <button className="link" onClick={() => setEditing(it)}>
                      Edit
                    </button>
                    <button className="link danger" onClick={() => askDelete(it)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {data?.data.length === 0 && (
                <tr>
                  <td colSpan={9}><EmptyCell>No items yet. Add your first product.</EmptyCell></td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
      </div>

      {(creating || editing) && (
        <ItemForm
          companyId={activeCompanyId!}
          item={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            invalidate();
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {moving && <StockModal item={moving} onClose={() => setMoving(null)} />}
      {tracing && <TraceModal item={tracing} onClose={() => setTracing(null)} />}
    </div>
  );
}

function ItemForm({
  companyId,
  item,
  onClose,
  onSaved,
}: {
  companyId: string;
  item: Item | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { activeCompany } = useCompany();
  const base = activeCompany?.base_currency ?? "USD";
  const [form, setForm] = useState<Partial<Item> & { sku: string; name: string }>(
    item ?? { sku: "", name: "", type: "inventory", unit: "unit", track_inventory: true, is_active: true },
  );
  const [fxRate, setFxRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const itemForeign = !!form.currency && form.currency !== base;
  const inBase = (v?: string | null) => Math.round((Number(v) || 0) * (Number(fxRate) || 0) * 100) / 100;

  const { data: accounts } = useQuery({
    queryKey: ["accounts", companyId],
    queryFn: () => api.get<Account[]>("/accounts"),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        sku: form.sku,
        name: form.name,
        description: form.description || undefined,
        type: form.type ?? "inventory",
        unit: form.unit || "unit",
        purchase_price: form.purchase_price,
        sale_price: form.sale_price || undefined,
        currency: form.currency || undefined,
        track_inventory: form.track_inventory ?? true,
        reorder_point: form.reorder_point || undefined,
        income_account_id: form.income_account_id || undefined,
        expense_account_id: form.expense_account_id || undefined,
        inventory_account_id: form.inventory_account_id || undefined,
        is_active: form.is_active ?? true,
      };
      return item
        ? api.patch(`/items/${item.id}`, body)
        : api.post("/items", { ...body, company_id: companyId });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Save failed"),
  });

  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const acctOptions = (accounts ?? []).map((a) => (
    <option key={a.id} value={a.id}>
      {a.code} — {a.name}
    </option>
  ));

  return (
    <Modal title={item ? "Edit item" : "New item"} onClose={onClose}>
      <div className="grid-2">
        <div className="field">
          <label>SKU *</label>
          <input value={form.sku} onChange={(e) => set({ sku: e.target.value })} />
        </div>
        <div className="field">
          <label>Type</label>
          <select
            value={form.type}
            onChange={(e) => {
              const type = e.target.value as ItemType;
              set({ type, track_inventory: type === "inventory" ? form.track_inventory : false });
            }}
          >
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Name *</label>
        <input value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div className="field">
        <label>Description</label>
        <input value={form.description ?? ""} onChange={(e) => set({ description: e.target.value })} />
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Purchase price *</label>
          <input
            value={form.purchase_price ?? ""}
            placeholder="cost per unit"
            onChange={(e) => set({ purchase_price: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Sale price</label>
          <input
            value={form.sale_price ?? ""}
            onChange={(e) => set({ sale_price: e.target.value })}
          />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Unit</label>
          <input value={form.unit ?? "unit"} onChange={(e) => set({ unit: e.target.value })} />
        </div>
        <div className="field">
          <label>Currency (ISO)</label>
          <input
            value={form.currency ?? ""}
            maxLength={3}
            placeholder={base}
            onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
          />
        </div>
      </div>
      {itemForeign && (
        <>
          <div className="field">
            <label>Exchange rate (1 {form.currency} = ? {base})</label>
            <input value={fxRate} placeholder="e.g. 3.67" onChange={(e) => setFxRate(e.target.value)} />
          </div>
          {Number(fxRate) > 0 && (
            <div className="fx-note">
              Purchase price <strong>{money(form.purchase_price ?? 0, form.currency!)}</strong> ≈ <strong>{money(inBase(form.purchase_price), base)}</strong>
              {form.sale_price ? <> · Sale price <strong>{money(form.sale_price, form.currency!)}</strong> ≈ <strong>{money(inBase(form.sale_price), base)}</strong></> : null}
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Stock value on the dashboard is booked in {base}. Buy this item via a Bill in {form.currency} with this rate so its stock value converts automatically.
              </div>
            </div>
          )}
        </>
      )}
      <div className="grid-2">
        <div className="field">
          <label>Reorder point (low-stock alert level)</label>
          <input value={form.reorder_point ?? ""} placeholder="e.g. 10" onChange={(e) => set({ reorder_point: e.target.value })} />
        </div>
        <div className="field" style={{ display: "flex", alignItems: "flex-end" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={form.is_active ?? true} onChange={(e) => set({ is_active: e.target.checked })} />
            Active (untick to retire this item)
          </label>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
        Ledger accounts (used when posting inventory movements)
      </p>
      <div className="field">
        <label>Inventory asset account</label>
        <select
          value={form.inventory_account_id ?? ""}
          onChange={(e) => set({ inventory_account_id: e.target.value })}
        >
          <option value="">—</option>
          {acctOptions}
        </select>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Income account</label>
          <select
            value={form.income_account_id ?? ""}
            onChange={(e) => set({ income_account_id: e.target.value })}
          >
            <option value="">—</option>
            {acctOptions}
          </select>
        </div>
        <div className="field">
          <label>COGS / expense account</label>
          <select
            value={form.expense_account_id ?? ""}
            onChange={(e) => set({ expense_account_id: e.target.value })}
          >
            <option value="">—</option>
            {acctOptions}
          </select>
        </div>
      </div>

      {form.type === "inventory" && (
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={form.track_inventory ?? true}
            onChange={(e) => set({ track_inventory: e.target.checked })}
          />
          Track inventory quantity
        </label>
      )}

      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={!form.sku || !form.name || !form.purchase_price || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function StockModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const qc = useQueryClient();
  const [locationId, setLocationId] = useState("");
  const [type, setType] = useState<(typeof INVENTORY_MOVEMENT_TYPES)[number]>("purchase");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  // transfer
  const [fromLoc, setFromLoc] = useState("");
  const [toLoc, setToLoc] = useState("");
  const [transferQty, setTransferQty] = useState("");
  // adjust
  const [adjLoc, setAdjLoc] = useState("");
  const [adjQty, setAdjQty] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const refetchLevels = () => qc.invalidateQueries({ queryKey: ["levels", item.id] });
  const transfer = useMutation({
    mutationFn: () => api.post(`/items/${item.id}/transfer`, { from_location_id: fromLoc, to_location_id: toLoc, quantity: transferQty }),
    onSuccess: () => { refetchLevels(); setTransferQty(""); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Transfer failed"),
  });
  const adjust = useMutation({
    mutationFn: () => api.post(`/items/${item.id}/adjust`, { location_id: adjLoc, quantity_delta: adjQty, reason: adjReason }),
    onSuccess: () => { refetchLevels(); setAdjQty(""); setAdjReason(""); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Adjustment failed"),
  });

  const { data: locations } = useQuery({
    queryKey: ["locations", item.company_id],
    queryFn: () => api.get<Location[]>("/locations"),
  });
  const { data: levels } = useQuery({
    queryKey: ["levels", item.id],
    queryFn: () => api.get<InventoryLevel[]>(`/items/${item.id}/levels`),
  });

  const isIssue = type === "sale" || type === "transfer_out";

  const submit = useMutation({
    mutationFn: () => {
      const signed = isIssue ? -Math.abs(Number(quantity)) : Math.abs(Number(quantity));
      return api.post(`/items/${item.id}/movements`, {
        location_id: locationId,
        movement_type: type,
        quantity: String(signed),
        unit_cost: unitCost || undefined,
        post_to_ledger: true,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["levels", item.id] });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Movement failed"),
  });

  return (
    <Modal title={`Stock — ${item.name}`} onClose={onClose}>
      <table style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>Location</th>
            <th>On hand</th>
            <th>Avg cost</th>
          </tr>
        </thead>
        <tbody>
          {(levels ?? []).map((l) => (
            <tr key={l.location_id}>
              <td>{locations?.find((x) => x.id === l.location_id)?.name ?? l.location_id}</td>
              <td>{l.quantity_on_hand}</td>
              <td>{l.average_cost}</td>
            </tr>
          ))}
          {levels?.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                No stock recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {locations?.length === 0 ? (
        <p className="error">
          Create a location/warehouse first (POST /locations). Stock movements need one.
        </p>
      ) : (
        <>
          <div className="field">
            <label>Location</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Select…</option>
              {(locations ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Movement</label>
              <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                {INVENTORY_MOVEMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Quantity</label>
              <input value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
          </div>
          {!isIssue && (
            <div className="field">
              <label>Unit cost</label>
              <input value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            </div>
          )}
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button onClick={onClose}>Close</button>
            <button
              className="primary"
              disabled={!locationId || !quantity || submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? "Posting…" : "Record movement"}
            </button>
          </div>

          <hr style={{ margin: "18px 0", border: 0, borderTop: "1px solid var(--border)" }} />
          <label style={{ fontWeight: 600 }}>Transfer between warehouses</label>
          <div className="grid-2">
            <div className="field"><label>From</label>
              <select value={fromLoc} onChange={(e) => setFromLoc(e.target.value)}>
                <option value="">Select…</option>
                {(locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="field"><label>To</label>
              <select value={toLoc} onChange={(e) => setToLoc(e.target.value)}>
                <option value="">Select…</option>
                {(locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 1 }}><label>Quantity</label><input value={transferQty} onChange={(e) => setTransferQty(e.target.value)} /></div>
            <button disabled={!fromLoc || !toLoc || !transferQty || transfer.isPending} onClick={() => transfer.mutate()}>Transfer</button>
          </div>

          <hr style={{ margin: "18px 0", border: 0, borderTop: "1px solid var(--border)" }} />
          <label style={{ fontWeight: 600 }}>Adjust stock (count / write-off)</label>
          <div className="grid-2">
            <div className="field"><label>Warehouse</label>
              <select value={adjLoc} onChange={(e) => setAdjLoc(e.target.value)}>
                <option value="">Select…</option>
                {(locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Qty change (+/-)</label><input value={adjQty} placeholder="-2" onChange={(e) => setAdjQty(e.target.value)} /></div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 1 }}><label>Reason</label><input value={adjReason} placeholder="damaged / stock count" onChange={(e) => setAdjReason(e.target.value)} /></div>
            <button disabled={!adjLoc || !adjQty || adjust.isPending} onClick={() => adjust.mutate()}>Adjust</button>
          </div>
        </>
      )}
    </Modal>
  );
}


interface TraceRow {
  party_type: string; party_id: string | null; party_name: string;
  direction: "in" | "out"; total_qty: string; total_value: string; movements: number; last_date: string;
}

/** Where this item's stock came from (suppliers) and who bought it (customers). */
function TraceModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["trace", item.id],
    queryFn: () => api.get<TraceRow[]>(`/items/${item.id}/traceability`),
  });
  const rows = data ?? [];
  const inbound = rows.filter((r) => r.direction === "in");
  const outbound = rows.filter((r) => r.direction === "out");
  const section = (title: string, list: TraceRow[], qtyLabel: string) => (
    <>
      <label style={{ fontWeight: 600, marginTop: 10 }}>{title}</label>
      <table style={{ marginBottom: 14 }}>
        <thead><tr><th>Party</th><th style={{ textAlign: "right" }}>{qtyLabel}</th><th style={{ textAlign: "right" }}>Value</th><th style={{ textAlign: "right" }}>Txns</th><th>Last</th></tr></thead>
        <tbody>
          {list.map((r, i) => (
            <tr key={i}>
              <td>{r.party_name}{r.party_type !== "internal" ? "" : " (internal)"}</td>
              <td style={{ textAlign: "right" }}>{Number(r.total_qty)}</td>
              <td style={{ textAlign: "right" }}>{Number(r.total_value).toFixed(2)}</td>
              <td style={{ textAlign: "right" }}>{r.movements}</td>
              <td className="muted">{r.last_date}</td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={5} className="muted">No movements.</td></tr>}
        </tbody>
      </table>
    </>
  );
  return (
    <Modal title={`Stock history — ${item.name}`} onClose={onClose} width={680}>
      {isLoading ? <p className="muted">Loading…</p> : (
        <>
          {section("Received from (suppliers / stock in)", inbound, "Qty in")}
          {section("Sold / issued to (customers / stock out)", outbound, "Qty out")}
        </>
      )}
      <div className="modal-actions"><button onClick={onClose}>Close</button></div>
    </Modal>
  );
}
