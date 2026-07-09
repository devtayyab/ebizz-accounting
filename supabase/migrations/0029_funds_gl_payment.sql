-- ===========================================================================
-- 0029_funds_gl_payment — connect the Funds module to the ledger.
--   • fund_accounts gain gl_account_id → the cash/bank account the fund maps to.
--   • fund_transactions gain a 'withdrawal' entry type (money leaving the fund,
--     same sign effect as 'payment').
--   • receive_invoice_payment(invoice, fund, amount?) posts a real GL payment
--     (Dr fund's cash/bank / Cr A/R, settling the invoice via record_payment)
--     AND records a fund receipt so the fund balance grows. This backs both the
--     invoice "Payment type = fund" flow and customer deposits (partial amounts).
-- ===========================================================================

alter table public.fund_accounts
  add column if not exists gl_account_id uuid references public.accounts(id);

-- Allow a 'withdrawal' transaction type (behaves like 'payment' for balances).
alter table public.fund_transactions
  drop constraint if exists fund_transactions_entry_type_check;
alter table public.fund_transactions
  add constraint fund_transactions_entry_type_check
  check (entry_type in ('deposit', 'payment', 'receipt', 'adjustment', 'withdrawal'));

-- Receive a payment/deposit for an invoice through a fund. Amount defaults to
-- the full outstanding balance; a smaller amount records a partial deposit.
create or replace function public.receive_invoice_payment(
  p_invoice uuid, p_fund uuid, p_amount numeric default null, p_date date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_company uuid; v_customer uuid; v_ccy text; v_fx numeric;
  v_total numeric; v_paid numeric; v_status text; v_number text;
  v_out numeric; v_amt numeric; v_gl uuid; v_fund_org uuid; v_payment uuid;
  v_when date := coalesce(p_date, current_date);
begin
  select organization_id, company_id, customer_id, currency, fx_rate, total, amount_paid, status, invoice_number
    into v_org, v_company, v_customer, v_ccy, v_fx, v_total, v_paid, v_status, v_number
    from public.sales_invoices where id = p_invoice for update;
  if v_org is null then raise exception 'Invoice not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if v_status <> 'posted' then raise exception 'Only a posted invoice can receive a payment'; end if;

  v_out := round(v_total - coalesce(v_paid, 0), 4);
  if v_out <= 0 then raise exception 'Invoice is already fully paid'; end if;

  v_amt := coalesce(p_amount, v_out);
  if v_amt <= 0 then raise exception 'Amount must be positive'; end if;
  if v_amt > v_out + 0.0049 then raise exception 'Amount exceeds the outstanding balance'; end if;
  if v_amt > v_out then v_amt := v_out; end if;

  select gl_account_id, organization_id into v_gl, v_fund_org from public.fund_accounts where id = p_fund;
  if v_fund_org is null then raise exception 'Fund not found'; end if;
  if v_fund_org <> v_org then raise exception 'Fund belongs to another organization'; end if;
  if v_gl is null then raise exception 'This fund is not linked to a cash/bank account — set one on the fund first'; end if;

  -- Ledger: settle A/R against the fund's cash/bank account.
  v_payment := public.record_payment(
    v_company, 'customer', v_customer, v_when,
    v_amt, v_ccy, 'fund', v_gl, v_number,
    jsonb_build_array(jsonb_build_object('invoice_id', p_invoice, 'amount', v_amt)),
    coalesce(v_fx, 1));

  -- Fund: money received into the fund (consolidated to base via fx_rate).
  insert into public.fund_transactions
    (organization_id, company_id, fund_account_id, txn_date, entry_type, amount,
     customer_id, currency, fx_rate, reference, memo, created_by)
    values (v_org, v_company, p_fund, v_when, 'receipt', v_amt,
            v_customer, v_ccy, coalesce(v_fx, 1), v_number,
            'Invoice ' || v_number || ' payment', auth.uid());

  return v_payment;
end;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;
