/**
 * Money helpers. We keep amounts as strings at the boundary and do arithmetic
 * in JS numbers rounded to 2 decimals — adequate for line math; the database
 * stores NUMERIC(18,4) as the source of truth.
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface ComputedLine {
  line_subtotal: number;
  tax_amount: number;
  line_total: number;
}

/** subtotal = qty * price; tax = subtotal * rate; total = subtotal + tax. */
export function computeLine(qty: number, price: number, taxRate: number): ComputedLine {
  const line_subtotal = round2(qty * price);
  const tax_amount = round2(line_subtotal * taxRate);
  return { line_subtotal, tax_amount, line_total: round2(line_subtotal + tax_amount) };
}

export function sum(values: number[]): number {
  return round2(values.reduce((a, b) => a + b, 0));
}
