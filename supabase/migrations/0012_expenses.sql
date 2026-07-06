-- ===========================================================================
-- 0012_expenses — general expense tracking (rent, utilities, salaries, fees…).
-- These are operating costs NOT tied to inventory purchases. Recording one
-- posts Dr Expense (+ Dr input tax) / Cr Cash-Bank (paid) or Cr A/P (unpaid),
-- so it flows straight into the Profit & Loss and reduces net profit.
-- ===========================================================================

create table public.expenses (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  company_id          uuid not null references public.companies(id) on delete cascade,
  expense_date        date not null default current_date,
  category_account_id uuid not null references public.accounts(id),   -- an expense account
  supplier_id         uuid references public.suppliers(id),
  paid_account_id     uuid references public.accounts(id),            -- cash/bank if paid now
  payment_status      text not null default 'paid' check (payment_status in ('paid', 'unpaid')),
  amount              numeric(18, 4) not null check (amount > 0),
  tax_amount          numeric(18, 4) not null default 0 check (tax_amount >= 0),
  total               numeric(18, 4) not null default 0,
  currency            text not null references public.currencies(code),
  reference           text,
  memo                text,
  journal_entry_id    uuid references public.journal_entries(id),
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now()
);
create index idx_expenses_company on public.expenses(company_id, expense_date desc);

select public._apply_org_policies('public.expenses');

-- Record and post an expense in one atomic call.
create or replace function public.record_expense(
  p_company uuid, p_date date, p_category_account uuid, p_amount numeric,
  p_tax_amount numeric default 0, p_paid_account uuid default null,
  p_supplier uuid default null, p_reference text default null, p_memo text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_ccy text; v_total numeric; v_entry uuid; v_expense uuid; v_credit uuid; v_status text;
begin
  select organization_id, base_currency into v_org, v_ccy from public.companies where id = p_company;
  if v_org is null then raise exception 'Company % not found', p_company; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  v_total := p_amount + coalesce(p_tax_amount, 0);

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
    values (v_org, v_entry, p_category_account, coalesce(p_memo, 'Expense'), v_ccy, p_amount, p_amount);
  if coalesce(p_tax_amount, 0) > 0 then
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, public._acct(p_company, '2100'), 'Input tax', v_ccy, p_tax_amount, p_tax_amount);
  end if;
  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
    values (v_org, v_entry, v_credit, 'Expense payment', v_ccy, v_total, v_total);

  update public.journal_entries set status = 'posted' where id = v_entry;

  insert into public.expenses (organization_id, company_id, expense_date, category_account_id, supplier_id,
    paid_account_id, payment_status, amount, tax_amount, total, currency, reference, memo, journal_entry_id, created_by)
    values (v_org, p_company, p_date, p_category_account, p_supplier, p_paid_account, v_status,
            p_amount, coalesce(p_tax_amount,0), v_total, v_ccy, p_reference, p_memo, v_entry, auth.uid())
    returning id into v_expense;

  return v_expense;
end;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;
