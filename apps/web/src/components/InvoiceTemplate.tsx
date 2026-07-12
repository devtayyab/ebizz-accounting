import { money } from "../lib/format";

export type TemplateStyle = "teal" | "indigo" | "emerald" | "plum" | "slate" | "classic";

export const TEMPLATE_OPTIONS: { value: TemplateStyle; label: string }[] = [
  { value: "teal", label: "Teal" },
  { value: "indigo", label: "Indigo" },
  { value: "emerald", label: "Emerald" },
  { value: "plum", label: "Plum" },
  { value: "slate", label: "Slate" },
  { value: "classic", label: "Classic (serif)" },
];

export interface TemplateLine {
  name: string;
  description?: string | null;
  qty: number;
  price: string;
  tax: string;
  amount: string;
}

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
  /** Product lines (line_kind = 'item'). */
  items: TemplateLine[];
  /** Service lines (line_kind = 'service'). */
  services: TemplateLine[];
  subtotal: string;
  discount?: string;
  /** One entry per tax rate, e.g. { label: "GST 10%", amount: 12.5 }. */
  taxLines: { label: string; amount: string | number }[];
  shipping?: string;
  total: string;
  paid?: string;
  currency: string;
  notes?: string | null;
  terms?: string | null;
  footer?: string | null;
}

const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(", ");

/**
 * The single Ebizz invoice format — company header, "Invoice issued to" +
 * "Shipping address" + a teal meta box, an Items table then a Services table,
 * and a Net / Subtotal / Discount / per-rate tax / Total / Paid / Outstanding
 * block. Reused for bills via docLabel / partyLabel.
 */
export function InvoiceTemplate({
  data,
  template = "teal",
  docLabel = "INVOICE",
  partyLabel = "Invoice issued to",
}: {
  data: InvoiceTemplateData;
  template?: TemplateStyle;
  docLabel?: string;
  partyLabel?: string;
}) {
  const ccy = data.currency;
  const c = data.company;
  const paid = data.paid !== undefined ? Number(data.paid) : undefined;
  const outstanding = paid !== undefined ? Number(data.total) - paid : undefined;
  const shipName = data.shipTo?.name || data.billTo.name;
  const hasShip = !!(data.shipTo && (data.shipTo.name || data.shipTo.address || data.shipTo.city));
  const isPaid = paid !== undefined && paid >= Number(data.total) - 0.005 && Number(data.total) > 0;
  const discount = Number(data.discount ?? 0);
  const shipping = Number(data.shipping ?? 0);
  // Only surface the Tax column when at least one line actually carries tax.
  const itemsHaveTax = data.items.some((l) => Number(l.tax) > 0);
  const servicesHaveTax = data.services.some((l) => Number(l.tax) > 0);

  return (
    <div className={`invoice-doc tpl-${template}`} style={{ position: "relative" }}>
      {isPaid && <div className="inv-paid-stamp">PAID</div>}

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

      <section className="inv-parties">
        <div className="inv-party">
          <div className="inv-label">{partyLabel}</div>
          <div className="inv-party-name">{data.billTo.name}</div>
          {data.billTo.address && <div className="inv-sub">{data.billTo.address}</div>}
          {join([data.billTo.city, data.billTo.country]) && <div className="inv-sub">{join([data.billTo.city, data.billTo.country])}</div>}
          {data.billTo.email && <div className="inv-sub">{data.billTo.email}</div>}
          {data.billTo.taxNumber && <div className="inv-sub">Tax ID: {data.billTo.taxNumber}</div>}
        </div>
        <div className="inv-party">
          <div className="inv-label">Shipping address</div>
          {hasShip ? (
            <>
              <div className="inv-party-name">{shipName}</div>
              {data.shipTo?.address && <div className="inv-sub">{data.shipTo.address}</div>}
              {join([data.shipTo?.city, data.shipTo?.country]) && <div className="inv-sub">{join([data.shipTo?.city, data.shipTo?.country])}</div>}
            </>
          ) : <div className="inv-sub">Same as {partyLabel.toLowerCase()}</div>}
        </div>
        <div className="inv-metabox">
          <div className="inv-metabox-title">{docLabel}</div>
          <div className="inv-metabox-row"><span>Number</span><strong>{data.number}</strong></div>
          <div className="inv-metabox-row"><span>{docLabel === "INVOICE" ? "Invoice Date" : "Date"}</span><span>{data.date}</span></div>
          {data.dueDate && <div className="inv-metabox-row"><span>Due Date</span><span>{data.dueDate}</span></div>}
          <div className="inv-metabox-row total"><span>{docLabel === "INVOICE" ? "Invoice Total" : "Total"}</span><strong>{money(data.total, ccy)}</strong></div>
        </div>
      </section>

      {data.items.length > 0 && (
        <table className="inv-table">
          <colgroup>
            <col style={{ width: "24%" }} /><col />
            <col style={{ width: "13%" }} /><col style={{ width: "9%" }} />
            {itemsHaveTax && <col style={{ width: "12%" }} />}
            <col style={{ width: "15%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Item</th><th>Description</th>
              <th style={{ textAlign: "right" }}>Unit Price</th>
              <th style={{ textAlign: "right" }}>Quantity</th>
              {itemsHaveTax && <th style={{ textAlign: "right" }}>Tax</th>}
              <th style={{ textAlign: "right" }}>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((l, i) => (
              <tr key={i}>
                <td>{l.name}</td>
                <td className="inv-sub">{l.description || "—"}</td>
                <td style={{ textAlign: "right" }}>{money(l.price, ccy)}</td>
                <td style={{ textAlign: "right" }}>{l.qty}</td>
                {itemsHaveTax && <td style={{ textAlign: "right" }}>{money(l.tax, ccy)}</td>}
                <td style={{ textAlign: "right" }}>{money(l.amount, ccy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.services.length > 0 && (
        <table className="inv-table inv-table-services">
          <colgroup>
            <col style={{ width: "24%" }} /><col />
            <col style={{ width: "15%" }} />
            {servicesHaveTax && <col style={{ width: "12%" }} />}
            <col style={{ width: "15%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Service</th><th>Description</th>
              <th style={{ textAlign: "right" }}>Cost</th>
              {servicesHaveTax && <th style={{ textAlign: "right" }}>Tax</th>}
              <th style={{ textAlign: "right" }}>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {data.services.map((l, i) => (
              <tr key={i}>
                <td>{l.name}</td>
                <td className="inv-sub">{l.description || "—"}</td>
                <td style={{ textAlign: "right" }}>{money(l.price, ccy)}</td>
                {servicesHaveTax && <td style={{ textAlign: "right" }}>{money(l.tax, ccy)}</td>}
                <td style={{ textAlign: "right" }}>{money(l.amount, ccy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.items.length === 0 && data.services.length === 0 && (
        <p className="muted" style={{ marginTop: 12 }}>No line items.</p>
      )}

      <div className="inv-summary">
        {data.notes && (
          <div className="inv-notes">
            <div className="inv-label">Notes</div>
            <div className="inv-text">{data.notes}</div>
          </div>
        )}
        <div className="inv-totals">
          <div><span>Net</span><span>{money(data.subtotal, ccy)}</span></div>
          {discount > 0 && <div><span>Discount</span><span>−{money(discount, ccy)}</span></div>}
          <div><span>Subtotal</span><span>{money(Number(data.subtotal) - discount, ccy)}</span></div>
          {data.taxLines.map((t, i) => (
            <div key={i}><span>{t.label}</span><span>{money(t.amount, ccy)}</span></div>
          ))}
          {shipping > 0 && <div><span>Shipping</span><span>{money(shipping, ccy)}</span></div>}
          <div className="inv-grand"><span>Total</span><span>{money(data.total, ccy)}</span></div>
          {paid !== undefined && <div><span>Paid to Date</span><span>{money(paid, ccy)}</span></div>}
          {outstanding !== undefined && <div className="inv-balance"><span>Outstanding</span><span>{money(outstanding, ccy)}</span></div>}
        </div>
      </div>

      {data.terms && <section className="inv-block"><div className="inv-label">Terms &amp; Conditions</div><div className="inv-text">{data.terms}</div></section>}
      <footer className="inv-footer">{data.footer || "Thank you for your business."}</footer>
    </div>
  );
}
