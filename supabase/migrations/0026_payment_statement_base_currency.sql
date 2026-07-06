-- ===========================================================================
-- 0026_payment_statement_base_currency — make payments and statements honour
-- foreign currency the same way every other document already does.
--   • payments        — add fx_rate; record_payment posts base_debit/base_credit
--                        = amount × fx_rate, so a EUR payment shows its converted
--                        base-currency (e.g. AED) value in the General Ledger,
--                        Trial Balance, P&L and Balance Sheet (all read base_*).
--   • statements       — customer/supplier statements now report every line in
--                        base currency (× the document's fx_rate) instead of raw
--                        mixed document amounts, matching the ledger.
-- General Ledger (0018) and account-activity reports (0009) already read the
-- base_debit/base_credit columns, so once payments store the right base amount
-- they display correctly with no further change.
-- ===========================================================================

-- --- A) payments -------------------------------------------------------------
alter table public.payments
  add column if not exists fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0);

-- Drop the old signature so the added p_fx_rate param doesn't leave an overload.
drop function if exists public.record_payment(uuid, text, uuid, date, numeric, text, text, uuid, text, jsonb);

create or replace function public.record_payment(
  p_company uuid, p_party_type text, p_party_id uuid, p_date date,
  p_amount numeric, p_currency text, p_method text, p_deposit_account uuid,
  p_reference text, p_allocations jsonb default '[]'::jsonb, p_fx_rate numeric default 1
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_base text;
  v_fx numeric;
  v_base_amount numeric;
  v_ctrl uuid;
  v_entry uuid;
  v_payment uuid;
  a jsonb;
  v_doc uuid;
  v_alloc numeric;
  v_doc_org uuid;
begin
  select organization_id, base_currency into v_org, v_base from public.companies where id = p_company;
  if v_org is null then raise exception 'Company % not found', p_company; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;

  v_fx := coalesce(p_fx_rate, 1);
  if v_fx <= 0 then v_fx := 1; end if;
  if p_currency = v_base then v_fx := 1; end if;
  v_base_amount := round(p_amount * v_fx, 4);

  -- the cash/bank account must belong to this org
  if not exists (select 1 from public.accounts where id = p_deposit_account and organization_id = v_org) then
    raise exception 'Invalid deposit account for this organization';
  end if;

  -- the party must belong to this org
  if p_party_type = 'customer' then
    if not exists (select 1 from public.customers where id = p_party_id and organization_id = v_org) then
      raise exception 'Invalid customer for this organization';
    end if;
  elsif p_party_type = 'supplier' then
    if not exists (select 1 from public.suppliers where id = p_party_id and organization_id = v_org) then
      raise exception 'Invalid supplier for this organization';
    end if;
  else
    raise exception 'party_type must be customer or supplier';
  end if;

  insert into public.payments
    (organization_id, company_id, party_type, customer_id, supplier_id, payment_date,
     amount, currency, fx_rate, method, deposit_account_id, reference, created_by)
    values (v_org, p_company, p_party_type,
            case when p_party_type = 'customer' then p_party_id end,
            case when p_party_type = 'supplier' then p_party_id end,
            p_date, p_amount, p_currency, v_fx, p_method, p_deposit_account, p_reference, auth.uid())
    returning id into v_payment;

  insert into public.journal_entries
    (organization_id, company_id, entry_date, memo, status, source_type, source_id, created_by)
    values (v_org, p_company, p_date,
            initcap(p_party_type) || ' payment', 'draft', 'payment', v_payment, auth.uid())
    returning id into v_entry;

  if p_party_type = 'customer' then
    v_ctrl := coalesce((select receivable_account_id from public.customers where id = p_party_id),
                       public._acct(p_company, '1200'));
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, p_deposit_account, 'Payment received', p_currency, p_amount, v_base_amount);
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (v_org, v_entry, v_ctrl, 'Accounts receivable', p_currency, p_amount, v_base_amount);
  else
    v_ctrl := coalesce((select payable_account_id from public.suppliers where id = p_party_id),
                       public._acct(p_company, '2000'));
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, v_ctrl, 'Accounts payable', p_currency, p_amount, v_base_amount);
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (v_org, v_entry, p_deposit_account, 'Payment made', p_currency, p_amount, v_base_amount);
  end if;

  update public.journal_entries set status = 'posted' where id = v_entry;
  update public.payments set journal_entry_id = v_entry where id = v_payment;

  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_alloc := (a->>'amount')::numeric;
    if v_alloc is null or v_alloc <= 0 then
      raise exception 'Allocation amount must be positive';
    end if;
    if p_party_type = 'customer' then
      v_doc := (a->>'invoice_id')::uuid;
      select organization_id into v_doc_org from public.sales_invoices where id = v_doc;
      if v_doc_org is distinct from v_org then
        raise exception 'Invalid allocation: invoice does not belong to this organization';
      end if;
      insert into public.payment_allocations (organization_id, payment_id, invoice_id, amount)
        values (v_org, v_payment, v_doc, v_alloc);
      update public.sales_invoices set amount_paid = amount_paid + v_alloc where id = v_doc;
    else
      v_doc := (a->>'bill_id')::uuid;
      select organization_id into v_doc_org from public.purchase_bills where id = v_doc;
      if v_doc_org is distinct from v_org then
        raise exception 'Invalid allocation: bill does not belong to this organization';
      end if;
      insert into public.payment_allocations (organization_id, payment_id, bill_id, amount)
        values (v_org, v_payment, v_doc, v_alloc);
      update public.purchase_bills set amount_paid = amount_paid + v_alloc where id = v_doc;
    end if;
  end loop;

  return v_payment;
end;
$$;

-- --- B) statements in base currency -----------------------------------------
drop function if exists public.report_customer_statement(uuid, uuid);
create function public.report_customer_statement(p_company uuid, p_customer uuid default null)
returns table (txn_date date, party_id uuid, party_name text, doc_type text, reference text, charge numeric, credit numeric)
language sql stable security definer set search_path = public as $$
  select i.invoice_date, c.id, c.name, 'invoice', i.invoice_number, round(i.total * coalesce(i.fx_rate, 1), 2), 0
    from public.sales_invoices i join public.customers c on c.id = i.customer_id
    where i.company_id = p_company and i.status = 'posted'
      and (p_customer is null or i.customer_id = p_customer)
      and i.organization_id in (select public.user_org_ids())
  union all
  select n.note_date, c.id, c.name, 'credit_note', n.note_number, 0, round(n.total * coalesce(n.fx_rate, 1), 2)
    from public.credit_notes n join public.customers c on c.id = n.customer_id
    where n.company_id = p_company and n.status = 'posted'
      and (p_customer is null or n.customer_id = p_customer)
      and n.organization_id in (select public.user_org_ids())
  union all
  select p.payment_date, c.id, c.name, 'payment', p.reference, 0, round(p.amount * coalesce(p.fx_rate, 1), 2)
    from public.payments p join public.customers c on c.id = p.customer_id
    where p.company_id = p_company and p.party_type = 'customer' and not p.reversed
      and (p_customer is null or p.customer_id = p_customer)
      and p.organization_id in (select public.user_org_ids())
  order by 3, 1;
$$;

drop function if exists public.report_supplier_statement(uuid, uuid);
create function public.report_supplier_statement(p_company uuid, p_supplier uuid default null)
returns table (txn_date date, party_id uuid, party_name text, doc_type text, reference text, charge numeric, credit numeric)
language sql stable security definer set search_path = public as $$
  select b.bill_date, s.id, s.name, 'bill', b.bill_number, round(b.total * coalesce(b.fx_rate, 1), 2), 0
    from public.purchase_bills b join public.suppliers s on s.id = b.supplier_id
    where b.company_id = p_company and b.status = 'posted'
      and (p_supplier is null or b.supplier_id = p_supplier)
      and b.organization_id in (select public.user_org_ids())
  union all
  select n.note_date, s.id, s.name, 'debit_note', n.note_number, 0, round(n.total * coalesce(n.fx_rate, 1), 2)
    from public.debit_notes n join public.suppliers s on s.id = n.supplier_id
    where n.company_id = p_company and n.status = 'posted'
      and (p_supplier is null or n.supplier_id = p_supplier)
      and n.organization_id in (select public.user_org_ids())
  union all
  select p.payment_date, s.id, s.name, 'payment', p.reference, 0, round(p.amount * coalesce(p.fx_rate, 1), 2)
    from public.payments p join public.suppliers s on s.id = p.supplier_id
    where p.company_id = p_company and p.party_type = 'supplier' and not p.reversed
      and (p_supplier is null or p.supplier_id = p_supplier)
      and p.organization_id in (select public.user_org_ids())
  order by 3, 1;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;
