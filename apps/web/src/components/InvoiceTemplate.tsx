import { money } from "../lib/format";

export type TemplateStyle = "classic" | "modern";

export interface InvoiceTemplateData {
  company: {
    name: string;
    legal?: string | null;
    address?: string | null;
    city?: string | null;
    country?: string | null;
    phone?: string | null;
    email?: string | null;
    taxNumber?: string | null;
    logo?: string | null;
  };
  number: string;
  date: string;
  dueDate?: string | null;
  billTo: { name: string; email?: string | null; taxNumber?: string | null; address?: string | null; city?: string | null; country?: string | null };
  shipTo?: { name?: string | null; address?: string | null; city?: string | null; country?: string | null } | null;
  lines: { name: string; qty: number; price: string; tax: string; amount: string }[];
  subtotal: string;
  taxTotal: string;
  discount?: string;
  shipping?: string;
  total: string;
  paid?: string;
  currency: string;
  notes?: string | null;
  terms?: string | null;
  footer?: string | null;
}

const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(", ");

/** Renders a printable, professional invoice in one of two visual styles. */
export function InvoiceTemplate({
  data,
  template,
  docLabel = "INVOICE",
  partyLabel = "Bill To",
}: {
  data: InvoiceTemplateData;
  template: TemplateStyle;
  docLabel?: string;
  partyLabel?: string;
}) {
  const ccy = data.currency;
  const c = data.company;
  const balance = data.paid !== undefined ? Number(data.total) - Number(data.paid) : undefined;
  const shipName = data.shipTo?.name || data.billTo.name;
  const hasShip = !!(data.shipTo && (data.shipTo.name || data.shipTo.address || data.shipTo.city));

  const isPaid = data.paid !== undefined && Number(data.paid) >= Number(data.total) - 0.005 && Number(data.total) > 0;

  return (
    <div className={`invoice-doc tpl-${template}`} style={{ position: "relative" }}>
      {isPaid && <div className="inv-paid-stamp">PAID</div>}
      <header className="inv-top">
        <div className="inv-brand">
          {c.logo ? (
            <img className="inv-logo-img" src={c.logo} alt="logo" />
          ) : (
            <div className="inv-logo">{c.name.slice(0, 1).toUpperCase()}</div>
          )}
          <div>
            <div className="inv-company">{c.name}</div>
            {c.legal && <div className="inv-sub">{c.legal}</div>}
            <div className="inv-sub">{join([c.address, c.city, c.country])}</div>
            <div className="inv-sub">{join([c.phone, c.email])}</div>
            {c.taxNumber && <div className="inv-sub">Tax ID: {c.taxNumber}</div>}
          </div>
        </div>
        <div className="inv-meta">
          <div className="inv-title">{docLabel}</div>
          <table className="inv-meta-tbl">
            <tbody>
              <tr><td>{docLabel === "INVOICE" ? "Invoice #" : "Number"}</td><td><strong>{data.number}</strong></td></tr>
              <tr><td>Date</td><td>{data.date}</td></tr>
              {data.dueDate && <tr><td>Due</td><td>{data.dueDate}</td></tr>}
            </tbody>
          </table>
        </div>
      </header>

      <section className="inv-parties">
        <div className="inv-party">
          <div className="inv-label">{partyLabel}</div>
          <div className="inv-party-name">{data.billTo.name}</div>
          {data.billTo.address && <div className="inv-sub">{data.billTo.address}</div>}
          {join([data.billTo.city, data.billTo.country]) && <div className="inv-sub">{join([data.billTo.city, data.billTo.country])}</div>}
          {data.billTo.email && <div className="inv-sub">{data.billTo.email}</div>}
          {data.billTo.taxNumber && <div className="inv-sub">Tax ID: {data.billTo.taxNumber}</div>}
        </div>
        {hasShip && (
          <div className="inv-party">
            <div className="inv-label">Ship To</div>
            <div className="inv-party-name">{shipName}</div>
            {data.shipTo?.address && <div className="inv-sub">{data.shipTo.address}</div>}
            {join([data.shipTo?.city, data.shipTo?.country]) && <div className="inv-sub">{join([data.shipTo?.city, data.shipTo?.country])}</div>}
          </div>
        )}
      </section>

      <table className="inv-table">
        <thead>
          <tr><th style={{ width: 34 }}>#</th><th>Item / Description</th><th style={{ textAlign: "right" }}>Qty</th>
            <th style={{ textAlign: "right" }}>Unit Price</th><th style={{ textAlign: "right" }}>Tax</th>
            <th style={{ textAlign: "right" }}>Amount</th></tr>
        </thead>
        <tbody>
          {data.lines.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td><td>{l.name}</td>
              <td style={{ textAlign: "right" }}>{l.qty}</td>
              <td style={{ textAlign: "right" }}>{money(l.price, ccy)}</td>
              <td style={{ textAlign: "right" }}>{money(l.tax, ccy)}</td>
              <td style={{ textAlign: "right" }}>{money(l.amount, ccy)}</td>
            </tr>
          ))}
          {data.lines.length === 0 && <tr><td colSpan={6} className="muted">No line items.</td></tr>}
        </tbody>
      </table>

      <div className="inv-summary">
        <div className="inv-totals">
          <div><span>Subtotal</span><span>{money(data.subtotal, ccy)}</span></div>
          {Number(data.discount ?? 0) > 0 && <div><span>Discount</span><span>−{money(data.discount, ccy)}</span></div>}
          <div><span>Tax</span><span>{money(data.taxTotal, ccy)}</span></div>
          {Number(data.shipping ?? 0) > 0 && <div><span>Shipping</span><span>{money(data.shipping, ccy)}</span></div>}
          <div className="inv-grand"><span>Total</span><span>{money(data.total, ccy)}</span></div>
          {data.paid !== undefined && <div><span>Paid</span><span>{money(data.paid, ccy)}</span></div>}
          {balance !== undefined && <div className="inv-balance"><span>Balance Due</span><span>{money(balance, ccy)}</span></div>}
        </div>
      </div>

      {data.notes && <section className="inv-block"><div className="inv-label">Notes</div><div className="inv-text">{data.notes}</div></section>}
      {data.terms && <section className="inv-block"><div className="inv-label">Terms &amp; Conditions</div><div className="inv-text">{data.terms}</div></section>}

      <footer className="inv-footer">{data.footer || "Thank you for your business."}</footer>
    </div>
  );
}
