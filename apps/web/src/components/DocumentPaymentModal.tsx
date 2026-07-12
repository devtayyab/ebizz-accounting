import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Account } from "@ebizz/shared";
import { api, ApiError } from "../lib/api";
import { Modal } from "./Modal";
import { money } from "../lib/format";

/** Minimal shape a payable/receivable document needs to record a payment. */
export interface PaymentTarget {
  kind: "invoice" | "bill";
  id: string;
  number: string;
  companyId: string;
  partyId: string;
  total: string | number;
  amountPaid: string | number;
  currency: string;
  fxRate: string | number;
}

interface FundOption { id: string; name: string; gl_account_id: string | null; balance: number }

/**
 * Record a payment (or advance deposit) against a single invoice or bill.
 * Two routes cover the four ways money moves:
 *   • Direct — a cash or bank account (Cash/Bank → customer/supplier)
 *   • Logistics fund — a fund linked to a cash/bank account (Cash/Bank → logistics),
 *     which also auto-records the movement in that fund's transactions.
 * Amount can be the full balance, a fixed amount, or a % of the total (deposits).
 * Internal only — nothing here appears on the printed document.
 */
export function DocumentPaymentModal({ doc, onClose, onSaved }: {
  doc: PaymentTarget; onClose: () => void; onSaved: () => void;
}) {
  const isInvoice = doc.kind === "invoice";
  const outstanding = Math.round((Number(doc.total) - Number(doc.amountPaid)) * 100) / 100;
  const [route, setRoute] = useState<"direct" | "fund">("direct");
  const [accountId, setAccountId] = useState("");
  const [fundId, setFundId] = useState("");
  const [mode, setMode] = useState<"full" | "fixed" | "percent">("full");
  const [fixed, setFixed] = useState("");
  const [percent, setPercent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: accounts } = useQuery({ queryKey: ["accounts", "all"], queryFn: () => api.get<Account[]>("/accounts") });
  const { data: funds } = useQuery({ queryKey: ["funds", "all"], queryFn: () => api.get<FundOption[]>("/funds") });
  const cashAccounts = useMemo(() => (accounts ?? []).filter((a) => a.type === "asset"), [accounts]);
  const linkedFunds = useMemo(() => (funds ?? []).filter((f) => f.gl_account_id), [funds]);

  const amount = mode === "full" ? outstanding
    : mode === "fixed" ? Math.round((Number(fixed) || 0) * 100) / 100
    : Math.round((Number(doc.total) * (Number(percent) || 0) / 100) * 100) / 100;
  const amountValid = amount > 0 && amount <= outstanding + 0.0049;
  const routeReady = route === "direct" ? !!accountId : !!fundId;

  // Paying a bill OUT of a logistics fund can't exceed that fund's available balance.
  const selectedFund = linkedFunds.find((f) => f.id === fundId);
  const guardFund = route === "fund" && !isInvoice && !!selectedFund;
  const insufficient = guardFund && amount > (selectedFund!.balance ?? 0) + 0.0049;

  const pay = useMutation({
    mutationFn: () => {
      if (route === "fund") {
        const url = isInvoice ? `/invoices/${doc.id}/receive-payment` : `/bills/${doc.id}/pay-via-fund`;
        return api.post(url, { fund_id: fundId, amount: mode === "full" ? undefined : String(amount) });
      }
      // Direct: settle against a chosen cash/bank account via the generic payments endpoint.
      const alloc = isInvoice ? { invoice_id: doc.id, amount: String(amount) } : { bill_id: doc.id, amount: String(amount) };
      return api.post("/payments", {
        company_id: doc.companyId,
        party_type: isInvoice ? "customer" : "supplier",
        party_id: doc.partyId,
        payment_date: new Date().toISOString().slice(0, 10),
        amount: String(amount), currency: doc.currency, fx_rate: String(Number(doc.fxRate) || 1),
        method: "direct", deposit_account_id: accountId, reference: doc.number,
        allocations: [alloc],
      });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Payment failed"),
    meta: { successMessage: isInvoice ? "Payment received" : "Payment recorded" },
  });

  const verb = isInvoice ? "Receive payment" : "Pay bill";
  return (
    <Modal title={`${verb} — ${doc.number}`} onClose={onClose} width={480}>
      <p className="muted" style={{ marginTop: 0 }}>
        Outstanding balance: <strong>{money(outstanding, doc.currency)}</strong>
      </p>

      <div className="field">
        <label>{isInvoice ? "Receive into" : "Pay from"} *</label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
          {(["direct", "fund"] as const).map((r) => (
            <label key={r} style={{ display: "flex", gap: 6, alignItems: "center", margin: 0, fontWeight: 400 }}>
              <input type="radio" style={{ width: "auto" }} checked={route === r} onChange={() => setRoute(r)} />
              {r === "direct" ? "Cash / Bank (direct)" : "Logistics partner (fund)"}
            </label>
          ))}
        </div>
        {route === "direct" ? (
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Select a cash/bank account…</option>
            {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        ) : (
          <>
            <select value={fundId} onChange={(e) => setFundId(e.target.value)}>
              <option value="">Select a logistics fund…</option>
              {linkedFunds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            {linkedFunds.length === 0 && (
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                No funds are linked to a cash/bank account yet. Open <strong>Funds &amp; Advances</strong> and link one first.
              </div>
            )}
            {selectedFund && (
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                Available balance: <strong>{money(selectedFund.balance ?? 0, doc.currency)}</strong>
              </div>
            )}
          </>
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
        Will record <strong>{money(amount, doc.currency)}</strong> against the {doc.kind}
        {mode !== "full" && amount > 0 && amount < outstanding ? " (deposit / part payment)." : "."}
      </div>
      {insufficient && (
        <div className="error">
          Not enough money in “{selectedFund!.name}”. Available {money(selectedFund!.balance ?? 0, doc.currency)},
          but this payment needs {money(amount, doc.currency)}.
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!routeReady || !amountValid || insufficient || pay.isPending} onClick={() => pay.mutate()}>
          {pay.isPending ? "…" : "Record payment"}
        </button>
      </div>
    </Modal>
  );
}
