import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Customer, Paginated } from "@ebizz/shared";
import { api, ApiError } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { Modal } from "../components/Modal";

type FormState = Partial<Customer> & { name: string };

export function CustomersPage() {
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Customer | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["customers", activeCompanyId],
    queryFn: () => api.get<Paginated<Customer>>("/customers?page=1&page_size=100"),
    enabled: !!activeCompanyId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["customers"] });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${id}`),
    onSuccess: invalidate,
  });

  return (
    <div>
      <div className="page-head">
        <h1>Customers</h1>
        <button className="primary" onClick={() => setCreating(true)}>
          + New customer
        </button>
      </div>

      <div className="card">
        {isLoading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Currency</th>
                <th>Credit limit</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data?.data ?? []).map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="muted">{c.email ?? "—"}</td>
                  <td>{c.currency ?? "—"}</td>
                  <td>{c.credit_limit ?? "—"}</td>
                  <td>
                    <span className={`badge ${c.is_active ? "" : "off"}`}>
                      {c.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="link" onClick={() => setEditing(c)}>
                      Edit
                    </button>
                    <button className="link danger" onClick={() => remove.mutate(c.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {data?.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No customers yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {(creating || editing) && (
        <CustomerForm
          companyId={activeCompanyId!}
          customer={editing}
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
    </div>
  );
}

function CustomerForm({
  companyId,
  customer,
  onClose,
  onSaved,
}: {
  companyId: string;
  customer: Customer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(
    customer ?? { name: "", payment_terms_days: 30, is_active: true },
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        email: form.email || undefined,
        phone: form.phone || undefined,
        tax_number: form.tax_number || undefined,
        currency: form.currency || undefined,
        payment_terms_days: form.payment_terms_days ?? 30,
        credit_limit: form.credit_limit || undefined,
        city: form.city || undefined,
        country: form.country || undefined,
        is_active: form.is_active ?? true,
      };
      return customer
        ? api.patch(`/customers/${customer.id}`, body)
        : api.post("/customers", { ...body, company_id: companyId });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Save failed"),
  });

  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });

  return (
    <Modal title={customer ? "Edit customer" : "New customer"} onClose={onClose}>
      <div className="field">
        <label>Name *</label>
        <input value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Email</label>
          <input value={form.email ?? ""} onChange={(e) => set({ email: e.target.value })} />
        </div>
        <div className="field">
          <label>Phone</label>
          <input value={form.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Currency (ISO)</label>
          <input
            value={form.currency ?? ""}
            maxLength={3}
            onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
          />
        </div>
        <div className="field">
          <label>Credit limit</label>
          <input
            value={form.credit_limit ?? ""}
            onChange={(e) => set({ credit_limit: e.target.value })}
          />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Payment terms (days)</label>
          <input
            type="number"
            value={form.payment_terms_days ?? 30}
            onChange={(e) => set({ payment_terms_days: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>Country (ISO2)</label>
          <input
            value={form.country ?? ""}
            maxLength={2}
            onChange={(e) => set({ country: e.target.value.toUpperCase() })}
          />
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={!form.name || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
