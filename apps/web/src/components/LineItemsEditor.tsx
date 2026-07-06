import type { Item, TaxRate } from "@ebizz/shared";
import { money } from "../lib/format";

export interface EditableLine {
  item_id: string;
  description: string;
  quantity: string;
  rate: string; // unit_price (sales) or unit_cost (purchase)
  tax_rate: string; // fraction, e.g. "0.15"
}

export function emptyLine(): EditableLine {
  return { item_id: "", description: "", quantity: "1", rate: "0", tax_rate: "0" };
}

export function lineTotals(lines: EditableLine[]) {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const s = Number(l.quantity || 0) * Number(l.rate || 0);
    subtotal += s;
    tax += s * Number(l.tax_rate || 0);
  }
  const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return { subtotal: round(subtotal), tax: round(tax), total: round(subtotal + tax) };
}

/**
 * Shared editable line grid for invoices (rateLabel "Price", priceField from
 * item.sale_price) and bills (rateLabel "Cost", from item.purchase_price).
 */
export function LineItemsEditor({
  lines,
  onChange,
  items,
  taxRates,
  currency,
  rateLabel,
  priceFrom,
  isSelectable,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  items: Item[];
  taxRates: TaxRate[];
  currency: string;
  rateLabel: string;
  priceFrom: "sale_price" | "purchase_price";
  /** Optional gate — when provided, items that fail it are hidden from the
   *  dropdown (e.g. out-of-stock on a sales invoice). The item already picked
   *  on a line is always kept so editing an existing document never breaks. */
  isSelectable?: (item: Item) => boolean;
}) {
  const update = (i: number, patch: Partial<EditableLine>) =>
    onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => onChange(lines.filter((_, idx) => idx !== i));

  const onPickItem = (i: number, itemId: string) => {
    const item = items.find((it) => it.id === itemId);
    update(i, {
      item_id: itemId,
      description: item?.name ?? lines[i].description,
      rate: item?.[priceFrom] ?? lines[i].rate,
    });
  };

  const totals = lineTotals(lines);

  return (
    <div>
      <table>
        <thead>
          <tr>
            <th style={{ width: "26%" }}>Item</th>
            <th>Description</th>
            <th style={{ width: 70 }}>Qty</th>
            <th style={{ width: 90 }}>{rateLabel}</th>
            <th style={{ width: 110 }}>Tax</th>
            <th style={{ width: 90 }}>Amount</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const amount = Number(l.quantity || 0) * Number(l.rate || 0);
            return (
              <tr key={i}>
                <td>
                  <select value={l.item_id} onChange={(e) => onPickItem(i, e.target.value)}>
                    <option value="">— none —</option>
                    {items
                      .filter((it) => it.id === l.item_id || !isSelectable || isSelectable(it))
                      .map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.sku} · {it.name}
                        </option>
                      ))}
                  </select>
                </td>
                <td>
                  <input value={l.description} onChange={(e) => update(i, { description: e.target.value })} />
                </td>
                <td>
                  <input value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
                </td>
                <td>
                  <input value={l.rate} onChange={(e) => update(i, { rate: e.target.value })} />
                </td>
                <td>
                  <select value={l.tax_rate} onChange={(e) => update(i, { tax_rate: e.target.value })}>
                    <option value="0">None</option>
                    {taxRates.map((t) => (
                      <option key={t.id} value={t.rate}>
                        {t.name} ({(Number(t.rate) * 100).toFixed(0)}%)
                      </option>
                    ))}
                  </select>
                </td>
                <td>{money(amount, currency)}</td>
                <td>
                  <button className="link danger" onClick={() => remove(i)} type="button">
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="link" type="button" onClick={() => onChange([...lines, emptyLine()])}>
        + Add line
      </button>
      <div style={{ textAlign: "right", marginTop: 12, lineHeight: 1.8 }}>
        <div>Subtotal: <strong>{money(totals.subtotal, currency)}</strong></div>
        <div>Tax: <strong>{money(totals.tax, currency)}</strong></div>
        <div style={{ fontSize: 18 }}>Total: <strong>{money(totals.total, currency)}</strong></div>
      </div>
    </div>
  );
}
