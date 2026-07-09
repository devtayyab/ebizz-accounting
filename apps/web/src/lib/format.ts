export function money(value: string | number | null | undefined, currency = "USD"): string {
  const n = Number(value ?? 0);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

/**
 * Groups line tax into one entry per rate, labelled with the tax-rate name when
 * one matches (e.g. "GST 10%", "VAT 17.5%") — powers the invoice totals block.
 */
export function taxBreakdown(
  rows: { taxRate: number; taxAmount: number }[],
  taxRates: { name: string; rate: string | number }[],
): { label: string; amount: number }[] {
  const groups = new Map<number, number>();
  for (const r of rows) {
    if (!r.taxRate || !r.taxAmount) continue;
    groups.set(r.taxRate, (groups.get(r.taxRate) ?? 0) + r.taxAmount);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, amt]) => {
      const named = taxRates.find((t) => Math.abs(Number(t.rate) - rate) < 1e-6);
      const pctNum = rate * 100;
      const pct = Number.isInteger(pctNum) ? String(pctNum) : pctNum.toFixed(2);
      return {
        label: named ? `${named.name} ${pct}%` : `Tax ${pct}%`,
        amount: Math.round((amt + Number.EPSILON) * 100) / 100,
      };
    });
}

export interface Badge {
  label: string;
  cls: string;
}

/** Raw document lifecycle badge (draft / posted / void). */
export function statusBadge(status: string): Badge {
  switch (status) {
    case "posted":
      return { label: "Posted", cls: "ok" };
    case "draft":
      return { label: "Draft", cls: "off" };
    case "void":
      return { label: "Void", cls: "off" };
    default:
      return { label: status, cls: "off" };
  }
}

/**
 * QuickBooks-style payment status for an invoice/bill:
 * Draft, Void, Paid, Partial, Overdue, Open.
 */
export function paymentStatus(
  status: string,
  total: string | number,
  amountPaid: string | number,
  dueDate: string | null,
): Badge {
  if (status === "draft") return { label: "Draft", cls: "off" };
  if (status === "void") return { label: "Void", cls: "off" };
  const t = Number(total);
  const paid = Number(amountPaid);
  if (paid >= t - 0.005) return { label: "Paid", cls: "ok" };
  if (paid > 0.005) return { label: "Partial", cls: "warn" };
  if (dueDate && dueDate < new Date().toISOString().slice(0, 10)) return { label: "Overdue", cls: "danger" };
  return { label: "Open", cls: "info" };
}

/** Stock status from on-hand vs reorder point. */
export function stockStatus(onHand: number, reorderPoint: number, tracked: boolean): Badge {
  if (!tracked) return { label: "Not tracked", cls: "off" };
  if (onHand <= 0) return { label: "Out of stock", cls: "danger" };
  if (reorderPoint > 0 && onHand <= reorderPoint) return { label: "Low stock", cls: "warn" };
  return { label: "In stock", cls: "ok" };
}
