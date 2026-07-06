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
import { Modal } from "../components/Modal";

interface Location {
  id: string;
  name: string;
}

export function ItemsPage() {
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<Item | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["items", activeCompanyId],
    queryFn: () => api.get<Paginated<Item>>("/items?page=1&page_size=100"),
    enabled: !!activeCompanyId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["items"] });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/items/${id}`),
    onSuccess: invalidate,
  });

  return (
    <div>
      <div className="page-head">
        <h1>Items &amp; Inventory</h1>
        <button className="primary" onClick={() => setCreating(true)}>
          + New item
        </button>
      </div>

      <div className="card">
        {isLoading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Type</th>
                <th>Sale price</th>
                <th>Tracked</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data?.data ?? []).map((it) => (
                <tr key={it.id}>
                  <td>{it.sku}</td>
                  <td>{it.name}</td>
                  <td>{it.type}</td>
                  <td>{it.sale_price ?? "—"}</td>
                  <td>
                    <span className={`badge ${it.track_inventory ? "" : "off"}`}>
                      {it.track_inventory ? "Yes" : "No"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {it.track_inventory && (
                      <button className="link" onClick={() => setMoving(it)}>
                        Stock
                      </button>
                    )}
                    <button className="link" onClick={() => setEditing(it)}>
                      Edit
                    </button>
                    <button className="link danger" onClick={() => remove.mutate(it.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {data?.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No items yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
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
  const [form, setForm] = useState<Partial<Item> & { sku: string; name: string }>(
    item ?? { sku: "", name: "", type: "inventory", unit: "unit", track_inventory: true, is_active: true },
  );
  const [error, setError] = useState<string | null>(null);

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
        purchase_price: form.purchase_price || undefined,
        sale_price: form.sale_price || undefined,
        currency: form.currency || undefined,
        track_inventory: form.track_inventory ?? true,
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
      <div className="grid-2">
        <div className="field">
          <label>Purchase price</label>
          <input
            value={form.purchase_price ?? ""}
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
            onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
          />
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
          disabled={!form.sku || !form.name || save.isPending}
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
        </>
      )}
    </Modal>
  );
}
