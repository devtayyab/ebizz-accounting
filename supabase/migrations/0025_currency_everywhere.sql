-- ===========================================================================
-- 0025_currency_everywhere — bring foreign-currency + fx_rate support to the
-- two remaining document types that lacked it:
--   • expenses         — add fx_rate; record_expense now takes currency + rate
--                        and posts base amounts = amount × fx_rate (credit leg
--                        is the balancing figure so rounding never unbalances).
--   • fund_transactions— add currency + fx_rate so advances/funds can be held
--                        in any currency; the balance is consolidated to base.
-- Sales/purchase orders and credit/debit notes already carry currency+fx_rate
-- (migrations 0007/0010) and their posting RPCs already use it — only the API
-- create/update paths needed to stop hardcoding the base currency.
-- ===========================================================================

-- --- A) expenses -------------------------------------------------------------
alter table public.expenses
  add column if not exists fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0);

-- Drop the old 9-arg signature so adding currency+rate params doesn't leave an
-- ambiguous overload behind.
drop function if exists public.record_expense(uuid, date, uuid, numeric, numeric, uuid, uuid, text, text);

create or replace function public.record_expense(
  p_company uuid, p_date date, p_category_account uuid, p_amount numeric,
  p_tax_amount numeric default 0, p_paid_account uuid default null,
  p_supplier uuid default null, p_reference text default null, p_memo text default null,
  p_currency text default null, p_fx_rate numeric default 1
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_base text; v_ccy text; v_fx numeric; v_total numeric;
  v_entry uuid; v_expense uuid; v_credit uuid; v_status text;
  v_base_amount numeric; v_base_tax numeric;
begin
  select organization_id, base_currency into v_org, v_base from public.companies where id = p_company;
  if v_org is null then raise exception 'Company % not found', p_company; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  v_ccy := coalesce(nullif(p_currency, ''), v_base);
  v_fx  := coalesce(p_fx_rate, 1);
  if v_fx <= 0 then v_fx := 1; end if;
  if v_ccy = v_base then v_fx := 1; end if;

  v_total := p_amount + coalesce(p_tax_amount, 0);
  -- Base-currency legs: round each debit, then make the credit their exact sum
  -- so sum(base_debit) = sum(base_credit) regardless of fx rounding.
  v_base_amount := round(p_amount * v_fx, 4);
  v_base_tax := round(coalesce(p_tax_amount, 0) * v_fx, 4);

  if p_paid_account is not null then
    v_credit := p_paid_account; v_status := 'paid';
  else
    v_credit := coalesce((select payable_account_id from public.suppliers where id = p_supplier),
                         public._acct(p_company, '2000'));
    v_status := 'unpaid';
  end if;

  insert into public.journal_entries (organization_id, company_id, entry_date, memo, reference, status, source_type, created_by)
    values (v_org, p_company, p_date, coalesce(p_memo, 'Expense'), p_reference, 'draft', 'expense', auth.uid())
    returning id into v_entry;

  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
    values (v_org, v_entry, p_category_account, coalesce(p_memo, 'Expense'), v_ccy, p_amount, v_base_amount);
  if coalesce(p_tax_amount, 0) > 0 then
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, public._acct(p_company, '2100'), 'Input tax', v_ccy, p_tax_amount, v_base_tax);
  end if;
  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
    values (v_org, v_entry, v_credit, 'Expense payment', v_ccy, v_total, v_base_amount + v_base_tax);

  update public.journal_entries set status = 'posted' where id = v_entry;

  insert into public.expenses (organization_id, company_id, expense_date, category_account_id, supplier_id,
    paid_account_id, payment_status, amount, tax_amount, total, currency, fx_rate, reference, memo, journal_entry_id, created_by)
    values (v_org, p_company, p_date, p_category_account, p_supplier, p_paid_account, v_status,
            p_amount, coalesce(p_tax_amount,0), v_total, v_ccy, v_fx, p_reference, p_memo, v_entry, auth.uid())
    returning id into v_expense;

  return v_expense;
end;
$$;

-- --- B) fund transactions ----------------------------------------------------
alter table public.fund_transactions
  add column if not exists currency text references public.currencies(code),
  add column if not exists fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0);

grant execute on all routines in schema public to anon, authenticated, service_role;
