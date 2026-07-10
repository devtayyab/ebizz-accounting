-- ===========================================================================
-- 0034_fund_bill_payment — pay a supplier bill THROUGH a logistics/cargo fund.
--   The mirror image of receive_invoice_payment (0029): when we pay a supplier
--   deposit via a logistics partner, settle the bill's A/P against the fund's
--   linked cash/bank account AND record a fund 'payment' so the logistics
--   wallet balance drops. Amount defaults to the full outstanding balance; a
--   smaller amount records a partial/advance deposit. For internal records only
--   — nothing here appears on the printed bill.
-- ===========================================================================

create or replace function public.pay_bill_via_fund(
  p_bill uuid, p_fund uuid, p_amount numeric default null, p_date date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_company uuid; v_supplier uuid; v_ccy text; v_fx numeric;
  v_total numeric; v_paid numeric; v_status text; v_number text;
  v_out numeric; v_amt numeric; v_gl uuid; v_fund_org uuid; v_payment uuid;
  v_when date := coalesce(p_date, current_date);
begin
  select organization_id, company_id, supplier_id, currency, fx_rate, total, amount_paid, status, bill_number
    into v_org, v_company, v_supplier, v_ccy, v_fx, v_total, v_paid, v_status, v_number
    from public.purchase_bills where id = p_bill for update;
  if v_org is null then raise exception 'Bill not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if v_status <> 'posted' then raise exception 'Only a posted bill can receive a payment'; end if;

  v_out := round(v_total - coalesce(v_paid, 0), 4);
  if v_out <= 0 then raise exception 'Bill is already fully paid'; end if;

  v_amt := coalesce(p_amount, v_out);
  if v_amt <= 0 then raise exception 'Amount must be positive'; end if;
  if v_amt > v_out + 0.0049 then raise exception 'Amount exceeds the outstanding balance'; end if;
  if v_amt > v_out then v_amt := v_out; end if;

  select gl_account_id, organization_id into v_gl, v_fund_org from public.fund_accounts where id = p_fund;
  if v_fund_org is null then raise exception 'Fund not found'; end if;
  if v_fund_org <> v_org then raise exception 'Fund belongs to another organization'; end if;
  if v_gl is null then raise exception 'This fund is not linked to a cash/bank account — set one on the fund first'; end if;

  -- Ledger: settle A/P against the fund's cash/bank account.
  v_payment := public.record_payment(
    v_company, 'supplier', v_supplier, v_when,
    v_amt, v_ccy, 'fund', v_gl, v_number,
    jsonb_build_array(jsonb_build_object('bill_id', p_bill, 'amount', v_amt)),
    coalesce(v_fx, 1));

  -- Fund: money leaving the logistics wallet to pay the supplier (consolidated
  -- to base via fx_rate).
  insert into public.fund_transactions
    (organization_id, company_id, fund_account_id, txn_date, entry_type, amount,
     supplier_id, currency, fx_rate, reference, memo, created_by)
    values (v_org, v_company, p_fund, v_when, 'payment', v_amt,
            v_supplier, v_ccy, coalesce(v_fx, 1), v_number,
            'Bill ' || v_number || ' payment', auth.uid());

  return v_payment;
end;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;
