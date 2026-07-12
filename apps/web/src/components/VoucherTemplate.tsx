import { amountInWords, money } from "../lib/format";

export interface VoucherData {
  /** receipt = money received (from a customer); payment = money paid (to a supplier). */
  kind: "receipt" | "payment";
  company: {
    name: string; legal?: string | null; address?: string | null; city?: string | null;
    country?: string | null; phone?: string | null; email?: string | null;
    taxNumber?: string | null; logo?: string | null;
  };
  voucherNo: string;
  date: string;
  partyName: string;
  amount: string | number;
  currency: string;
  method?: string | null;
  reference?: string | null;
  /** Cash/bank/logistics account the money was received into / paid from. */
  accountName?: string | null;
  allocations: { amount: string; document: string | null }[];
  reversed?: boolean;
  footer?: string | null;
}

const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(", ");

/** A printable Payment Voucher (money out) or Receipt Voucher (money in). */
export function VoucherTemplate({ data }: { data: VoucherData }) {
  const c = data.company;
  const ccy = data.currency;
  const isReceipt = data.kind === "receipt";
  const title = isReceipt ? "RECEIPT VOUCHER" : "PAYMENT VOUCHER";
  const partyLabel = isReceipt ? "Received From" : "Paid To";
  const accountLabel = isReceipt ? "Received Into" : "Paid From";
  const docs = data.allocations.map((a) => a.document).filter(Boolean) as string[];
  const being = docs.length
    ? `Being amount ${isReceipt ? "received" : "paid"} against ${docs.join(", ")}.`
    : `Being amount ${isReceipt ? "received from" : "paid to"} ${data.partyName}.`;

  return (
    <div className="invoice-doc voucher-doc tpl-teal" style={{ position: "relative" }}>
      {data.reversed && <div className="inv-paid-stamp" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>VOID</div>}

      <header className="inv-top">
        <div className="inv-brand">
          <div className="inv-company">{c.name}</div>
          {c.legal && <div className="inv-sub">{c.legal}</div>}
          <div className="inv-company-contact">
            {c.address && <div className="inv-sub">{c.address}</div>}
            {join([c.city, c.country]) && <div className="inv-sub">{join([c.city, c.country])}</div>}
            {c.phone && <div className="inv-sub">{c.phone}</div>}
            {c.email && <div className="inv-sub">{c.email}</div>}
            {c.taxNumber && <div className="inv-sub">Tax ID: {c.taxNumber}</div>}
          </div>
        </div>
        <div className="inv-logo-wrap">
          {c.logo
            ? <img className="inv-logo-img" src={c.logo} alt="logo" />
            : <div className="inv-logo">{c.name.slice(0, 1).toUpperCase()}</div>}
        </div>
      </header>

      <div className="vou-titlebar">
        <h2 className="vou-title">{title}</h2>
        <div className="vou-meta">
          <div><span>No.</span><strong>{data.voucherNo}</strong></div>
          <div><span>Date</span><strong>{data.date}</strong></div>
        </div>
      </div>

      <div className="vou-grid">
        <div className="vou-field"><div className="inv-label">{partyLabel}</div><div className="vou-value">{data.partyName}</div></div>
        <div className="vou-field"><div className="inv-label">{accountLabel}</div><div className="vou-value">{data.accountName || "—"}</div></div>
        <div className="vou-field"><div className="inv-label">Payment method</div><div className="vou-value">{data.method || "—"}</div></div>
        <div className="vou-field"><div className="inv-label">Reference</div><div className="vou-value">{data.reference || "—"}</div></div>
      </div>

      <div className="vou-amount">
        <div>
          <div className="inv-label">Amount</div>
          <div className="vou-amount-words">{amountInWords(data.amount)} {ccy}</div>
        </div>
        <div className="vou-amount-big">{money(data.amount, ccy)}</div>
      </div>

      {data.allocations.length > 0 && (
        <table className="inv-table" style={{ marginTop: 18 }}>
          <colgroup><col /><col style={{ width: "30%" }} /></colgroup>
          <thead><tr><th>Applied to</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
          <tbody>
            {data.allocations.map((a, i) => (
              <tr key={i}>
                <td>{a.document || "—"}</td>
                <td style={{ textAlign: "right" }}>{money(a.amount, ccy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="vou-being"><span className="inv-label">Being</span> {being}</div>

      <div className="vou-signs">
        <div><div className="vou-signline" />{isReceipt ? "Received by" : "Paid by"}</div>
        <div><div className="vou-signline" />Authorised signatory</div>
      </div>

      <footer className="inv-footer">{data.footer || "This is a computer-generated voucher."}</footer>
    </div>
  );
}
