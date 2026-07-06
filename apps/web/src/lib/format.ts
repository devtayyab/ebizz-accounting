export function money(value: string | number | null | undefined, currency = "USD"): string {
  const n = Number(value ?? 0);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return n.toFixed(2);
  }
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
