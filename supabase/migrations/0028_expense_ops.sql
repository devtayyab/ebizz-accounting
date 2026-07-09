-- ===========================================================================
-- 0028_expense_ops — full lifecycle for expenses (edit / delete / reverse-pay).
-- record_expense (0025) posts an expense immediately. These helpers let the
-- API edit, delete, or un-pay an already-posted expense while keeping the GL
-- balanced by mirroring the original journal entry (via _mirror_entry, 0015).
--   • reverse_expense(id)          — post a mirror of the expense's JE
--                                    (used by DELETE: neutralise then drop row).
--   • revise_expense(id, …)        — mirror the old JE, post a fresh one from the
--                                    new values, update the row in place (edit).
--   • reverse_expense_payment(id)  — a paid expense becomes payable: Dr cash /
--                                    Cr A/P, flip payment_status to 'unpaid'.
-- ===========================================================================

-- Neutralise an expense's posting by mirroring its journal entry.
create or replace function public.reverse_expense(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_company uuid; v_entry uuid;
begin
  select organization_id, company_id, journal_entry_id
    into v_org, v_company, v_entry
    from public.expenses where id = p_id for update;
  if v_org is null then raise exception 'Expense not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if v_entry is null then return null; end if;
  return public._mirror_entry(v_org, v_company, v_entry, 'expense_reversal', p_id, 'Reversal of expense');
end;
$$;

-- Edit a posted expense: reverse the old journal entry, post a new one, and
-- update the expenses row in place (same id, new journal_entry_id).
create or replace function public.revise_expense(
  p_id uuid, p_date date, p_category_account uuid, p_amount numeric,
  p_tax_amount numeric default 0, p_paid_account uuid default null,
  p_supplier uuid default null, p_reference text default null, p_memo text default null,
  p_currency text default null, p_fx_rate numeric default 1
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_company uuid; v_base text; v_old uuid; v_ccy text; v_fx numeric;
  v_total numeric; v_entry uuid; v_credit uuid; v_status text;
  v_base_amount numeric; v_base_tax numeric;
begin
  select e.organization_id, e.company_id, e.journal_entry_id, c.base_currency
    into v_org, v_company, v_old, v_base
    from public.expenses e join public.companies c on c.id = e.company_id
    where e.id = p_id for update;
  if v_org is null then raise exception 'Expense not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  -- neutralise the previous posting
  if v_old is not null then
    perform public._mirror_entry(v_org, v_company, v_old, 'expense_reversal', p_id, 'Revision of expense');
  end if;

  v_ccy := coalesce(nullif(p_currency, ''), v_base);
  v_fx  := coalesce(p_fx_rate, 1);
  if v_fx <= 0 then v_fx := 1; end if;
  if v_ccy = v_base then v_fx := 1; end if;

  v_total := p_amount + coalesce(p_tax_amount, 0);
  v_base_amount := round(p_amount * v_fx, 4);
  v_base_tax := round(coalesce(p_tax_amount, 0) * v_fx, 4);

  if p_paid_account is not null then
    v_credit := p_paid_account; v_status := 'paid';
  else
    v_credit := coalesce((select payable_account_id from public.suppliers where id = p_supplier),
                         public._acct(v_company, '2000'));
    v_status := 'unpaid';
  end if;

  insert into public.journal_entries (organization_id, company_id, entry_date, memo, reference, status, source_type, source_id, created_by)
    values (v_org, v_company, p_date, coalesce(p_memo, 'Expense'), p_reference, 'draft', 'expense', p_id, auth.uid())
    returning id into v_entry;

  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
    values (v_org, v_entry, p_category_account, coalesce(p_memo, 'Expense'), v_ccy, p_amount, v_base_amount);
  if coalesce(p_tax_amount, 0) > 0 then
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, public._acct(v_company, '2100'), 'Input tax', v_ccy, p_tax_amount, v_base_tax);
  end if;
  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
    values (v_org, v_entry, v_credit, 'Expense payment', v_ccy, v_total, v_base_amount + v_base_tax);

  update public.journal_entries set status = 'posted' where id = v_entry;

  update public.expenses set
    expense_date = p_date, category_account_id = p_category_account, supplier_id = p_supplier,
    paid_account_id = p_paid_account, payment_status = v_status, amount = p_amount,
    tax_amount = coalesce(p_tax_amount, 0), total = v_total, currency = v_ccy, fx_rate = v_fx,
    reference = p_reference, memo = p_memo, journal_entry_id = v_entry
    where id = p_id;
  return p_id;
end;
$$;

-- Reverse the *payment* of a paid expense (keep the expense recognised, but make
-- it payable again): Dr cash/bank (restore) / Cr A/P.
create or replace function public.reverse_expense_payment(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_company uuid; v_paid uuid; v_status text;
  v_total numeric; v_ccy text; v_fx numeric; v_ap uuid; v_entry uuid; v_base_total numeric;
begin
  select organization_id, company_id, paid_account_id, payment_status, total, currency, fx_rate
    into v_org, v_company, v_paid, v_status, v_total, v_ccy, v_fx
    from public.expenses where id = p_id for update;
  if v_org is null then raise exception 'Expense not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if v_status <> 'paid' then raise exception 'Only a paid expense can have its payment reversed'; end if;
  if v_paid is null then raise exception 'This expense has no paid-from account'; end if;

  v_ap := public._acct(v_company, '2000');
  v_base_total := round(v_total * coalesce(v_fx, 1), 4);

  insert into public.journal_entries (organization_id, company_id, entry_date, memo, status, source_type, source_id, created_by)
    values (v_org, v_company, current_date, 'Reverse expense payment', 'draft', 'expense_payment_reversal', p_id, auth.uid())
    returning id into v_entry;
  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
    values (v_org, v_entry, v_paid, 'Reverse expense payment', v_ccy, v_total, v_base_total);
  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
    values (v_org, v_entry, v_ap, 'Now payable', v_ccy, v_total, v_base_total);
  update public.journal_entries set status = 'posted' where id = v_entry;

  update public.expenses set payment_status = 'unpaid', paid_account_id = null where id = p_id;
  return v_entry;
end;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;
