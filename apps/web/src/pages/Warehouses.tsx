import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { useConfirm } from "../state/ConfirmContext";
import { Modal } from "../components/Modal";
import { EmptyCell } from "../components/Empty";

interface Location {
  id: string;
  name: string;
  address_line1: string | null;
  city: string | null;
  country: string | null;
  is_active: boolean;
}

export function WarehousesPage() {
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();
  const ask = useConfirm();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["locations", activeCompanyId],
    queryFn: () => api.get<Location[]>("/locations"),
    enabled: !!activeCompanyId,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["locations"] });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/locations/${id}`),
    onSuccess: invalidate,
    meta: { successMessage: "Warehouse deleted" },
  });

  return (
    <div>
      <div className="page-head">
        <h1>Warehouses</h1>
        <button className="primary" onClick={() => setCreating(true)}>+ New warehouse</button>
      </div>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Every company starts with a “Main Warehouse”. Stock lives in a warehouse —
          invoices, bills, transfers and adjustments all move stock in or out of one.
        </p>
        {isLoading ? <p className="muted">Loading…</p> : (
          <table>
            <thead><tr><th>Logistics Name</th><th>Address</th><th>City</th><th>Country</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(data ?? []).map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td className="muted">{l.address_line1 ?? "—"}</td>
                  <td className="muted">{l.city ?? "—"}</td>
                  <td>{l.country ?? "—"}</td>
                  <td><span className={`badge ${l.is_active ? "ok" : "off"}`}>{l.is_active ? "Active" : "Inactive"}</span></td>
                  <td style={{ textAlign: "right" }}>
                    <button className="link" onClick={() => setEditing(l)}>Edit</button>
                    <button className="link danger" onClick={() => ask({ title: "Delete warehouse", message: `Delete “${l.name}”? This only works if it has no stock or transactions.`, confirmLabel: "Delete", danger: true }).then((ok) => ok && remove.mutate(l.id))}>Delete</button>
                  </td>
                </tr>
              ))}
              {data?.length === 0 && <tr><td colSpan={6}><EmptyCell>No warehouses yet.</EmptyCell></td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {(creating || editing) && (
        <WarehouseForm companyId={activeCompanyId!} location={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { invalidate(); setCreating(false); setEditing(null); }} />
      )}
    </div>
  );
}

function WarehouseForm({ companyId, location, onClose, onSaved }: {
  companyId: string; location: Location | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(location?.name ?? "");
  const [address, setAddress] = useState(location?.address_line1 ?? "");
  const [city, setCity] = useState(location?.city ?? "");
  const [country, setCountry] = useState(location?.country ?? "");
  const [isActive, setIsActive] = useState(location?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name, address_line1: address || undefined, city: city || undefined,
        country: country || undefined, is_active: isActive,
      };
      return location
        ? api.patch(`/locations/${location.id}`, body)
        : api.post("/locations", { ...body, company_id: companyId });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Failed"),
    meta: { successMessage: location ? "Warehouse updated" : "Warehouse created" },
  });

  return (
    <Modal title={location ? "Edit warehouse" : "New warehouse"} onClose={onClose}>
      <div className="field"><label>Logistics Name *</label>
        <input value={name} placeholder="e.g. DHL Jebel Ali DC" onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label>Warehouse address</label>
        <input value={address} onChange={(e) => setAddress(e.target.value)} /></div>
      <div className="grid-2">
        <div className="field"><label>City</label><input value={city} onChange={(e) => setCity(e.target.value)} /></div>
        <div className="field"><label>Country (ISO2)</label><input value={country} maxLength={2} onChange={(e) => setCountry(e.target.value.toUpperCase())} /></div>
      </div>
      {location && (
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
      )}
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!name || save.isPending} onClick={() => save.mutate()}>Save</button>
      </div>
    </Modal>
  );
}
