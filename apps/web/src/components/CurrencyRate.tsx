import { money } from "../lib/format";

/**
 * True when a document currency is foreign but its exchange rate is missing or
 * a suspicious 1:1 (which would book the foreign amount as if it were base
 * currency). Editors use this to block saving until a real rate is entered.
 */
export function fxRateInvalid(base: string, currency: string, rate: string | number): boolean {
  if (currency === base) return false;
  const n = Number(rate);
  return !(n > 0) || n === 1;
}

/**
 * Shared currency + exchange-rate picker used by every document editor
 * (invoices, bills, orders, credit/debit notes, expenses, funds).
 *
 * The rate means "1 {document currency} = fxRate {base currency}", so the
 * base-currency amount is always documentAmount × fxRate — matching how the
 * posting RPCs store base_debit / base_credit. When `docTotal` (in document
 * currency) is passed and the currency is foreign, a live conversion line is
 * shown so the user can confirm the converted base amount before saving.
 */
export function CurrencyRate({
  base,
  currencies,
  currency,
  setCurrency,
  fxRate,
  setFxRate,
  docTotal,
  amountLabel = "Total",
}: {
  base: string;
  currencies: string[];
  currency: string;
  setCurrency: (c: string) => void;
  fxRate: string;
  setFxRate: (r: string) => void;
  docTotal?: number;
  amountLabel?: string;
}) {
  const foreign = currency !== base;
  const list = currencies.includes(base) ? currencies : [base, ...currencies];
  const invalid = fxRateInvalid(base, currency, fxRate);

  // Switching currency: base resets the rate to 1; a foreign currency clears it
  // so the user must type the real rate (instead of silently keeping 1).
  const onPickCurrency = (c: string) => {
    setCurrency(c);
    if (c === base) setFxRate("1");
    else if (!(Number(fxRate) > 0) || Number(fxRate) === 1) setFxRate("");
  };

  return (
    <>
      <div className="grid-2">
        <div className="field">
          <label>Currency</label>
          <select value={currency} onChange={(e) => onPickCurrency(e.target.value)}>
            {list.map((c) => (
              <option key={c} value={c}>{c}{c === base ? " (base)" : ""}</option>
            ))}
          </select>
        </div>
        {foreign && (
          <div className="field">
            <label>Exchange rate (1 {currency} = ? {base}) *</label>
            <input value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder={`e.g. 3.67`} />
          </div>
        )}
      </div>
      {foreign && invalid && (
        <div className="error" style={{ marginBottom: 12 }}>
          Enter the {currency} → {base} exchange rate (a 1:1 rate would record {currency} amounts as {base}).
        </div>
      )}
      {foreign && !invalid && docTotal != null && (
        <div className="fx-note">
          {amountLabel} <strong>{money(docTotal, currency)}</strong>{" ≈ "}
          <strong>{money(Math.round(docTotal * (Number(fxRate) || 1) * 100) / 100, base)}</strong>
          <span className="muted"> (at 1 {currency} = {Number(fxRate) || 1} {base})</span>
        </div>
      )}
    </>
  );
}
