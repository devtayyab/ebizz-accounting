import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Account, JournalEntry } from "@ebizz/shared";
import { api, ApiError } from "../lib/api";
import { useCompany } from "../state/CompanyContext";
import { useConfirm } from "../state/ConfirmContext";
import { Modal } from "../components/Modal";
import { money, statusBadge } from "../lib/format";
import { EmptyCell } from "../components/Empty";
import { Pagination } from "../components/Pagination";

interface JLine { account_id: string; description: string; debit: string; credit: string }
const emptyJLine = (): JLine => ({ account_id: "", description: "", debit: "", credit: "" });

export function JournalsPage() {
  const { activeCompanyId, activeCompany } = useCompany();
  const qc = useQueryClient();
  const ask = useConfirm();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const ccy = activeCompany?.base_currency ?? "USD";

  const { data, isLoading } = useQuery({
    queryKey: ["journals", activeCompanyId], queryFn: () => api.get<JournalEntry[]>("/journal-entries"), enabled: !!activeCompanyId,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["journals"] });
    qc.invalidateQueries({ queryKey: ["reports"] });
    qc.invalidateQueries({ queryKey: ["gl"] });
  };
  const reverse = useMutation({ mutationFn: (id: string) => api.post(`/journal-entries/${id}/reverse`), onSuccess: invalidate, meta: { successMessage: "Reversing entry posted" } });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/journal-entries/${id}`), onSuccess: invalidate, meta: { successMessage: "Journal entry deleted" } });
  const rows = data ?? [];
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <div className="page-head">
        <h1>Manual Journal Entries</h1>
        <button className="primary" onClick={() => setOpen(true)}>+ New journal</button>
      </div>
      <div className="card">
        {isLoading ? <p className="muted">Loading…</p> : (
          <table>
            <thead><tr><th>Date</th><th>Memo</th><th>Source</th><th>Status</th><th /></tr></thead>
            <tbody>
              {pageRows.map((e) => {
                const b = statusBadge(e.status);
                const isManual = (e.source_type ?? "manual") === "manual";
                return <tr key={e.id}><td>{e.entry_date}</td><td>{e.memo ?? "—"}</td>
                  <td className="muted">{e.source_type ?? "—"}</td>
                  <td><span className={`badge ${b.cls}`}>{b.label}</span></td>
                  <td style={{ textAlign: "right" }}>
                    {e.status === "draft" && (
                      <button className="link danger" onClick={() => ask({ title: "Delete entry", message: "Delete this draft journal entry?", confirmLabel: "Delete", danger: true }).then((ok) => ok && remove.mutate(e.id))}>Delete</button>
                    )}
                    {e.status === "posted" && isManual && (
                      <button className="link" onClick={() => ask({ title: "Reverse entry", message: "Post a reversing entry that cancels this one?", confirmLabel: "Reverse" }).then((ok) => ok && reverse.mutate(e.id))}>Reverse</button>
                    )}
                  </td></tr>;
              })}
              {rows.length === 0 && <tr><td colSpan={5}><EmptyCell>No journal entries yet.</EmptyCell></td></tr>}
            </tbody>
          </table>
        )}
        <Pagination page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
      </div>
      {open && <JournalEditor companyId={activeCompanyId!} ccy={ccy}
        onClose={() => setOpen(false)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["journals"] }); qc.invalidateQueries({ queryKey: ["reports"] }); setOpen(false); }} />}
    </div>
  );
}

function JournalEditor({ companyId, ccy, onClose, onSaved }: { companyId: string; ccy: string; onClose: () => void; onSaved: () => void }) {
  const [memo, setMemo] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<JLine[]>([emptyJLine(), emptyJLine()]);
  const [error, setError] = useState<string | null>(null);
  const { data: accounts } = useQuery({ queryKey: ["accounts", companyId], queryFn: () => api.get<Account[]>("/accounts") });

  const totDr = lines.reduce((a, l) => a + Number(l.debit || 0), 0);
  const totCr = lines.reduce((a, l) => a + Number(l.credit || 0), 0);
  const balanced = Math.abs(totDr - totCr) < 0.005 && totDr > 0;
  const set = (i: number, patch: Partial<JLine>) => setLines(lines.map((l, idx) => idx === i ? { ...l, ...patch } : l));

  const save = useMutation({
    mutationFn: () => api.post("/journal-entries?post=true", {
      company_id: companyId, entry_date: date, memo: memo || undefined,
      lines: lines.filter((l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0))
        .map((l) => ({ account_id: l.account_id, description: l.description || undefined, debit: l.debit || "0", credit: l.credit || "0" })),
    }),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Post failed"),
  });

  return (
    <Modal title="New journal entry" onClose={onClose} width={760}>
      <div className="grid-2">
        <div className="field"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>Memo</label><input value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
      </div>
      <table>
        <thead><tr><th style={{ width: "40%" }}>Account</th><th>Description</th><th style={{ width: 110 }}>Debit</th><th style={{ width: 110 }}>Credit</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                <select value={l.account_id} onChange={(e) => set(i, { account_id: e.target.value })}>
                  <option value="">Select…</option>
                  {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              </td>
              <td><input value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
              <td><input value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: "" })} /></td>
              <td><input value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: "" })} /></td>
              <td><button className="link danger" type="button" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="link" type="button" onClick={() => setLines([...lines, emptyJLine()])}>+ Add line</button>
      <div style={{ textAlign: "right", marginTop: 8 }}>
        Debits {money(totDr, ccy)} · Credits {money(totCr, ccy)}{" "}
        <strong style={{ color: balanced ? "green" : "var(--danger)" }}>{balanced ? "balanced" : "unbalanced"}</strong>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!balanced || save.isPending} onClick={() => save.mutate()}>Post entry</button>
      </div>
    </Modal>
  );
}
