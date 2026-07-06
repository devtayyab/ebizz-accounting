-- ===========================================================================
-- 0021_secure_record_payment — close cross-tenant holes in record_payment.
-- The function is SECURITY DEFINER (bypasses RLS), so it must itself verify
-- that every id the caller passes (deposit account, party, and each allocated
-- invoice/bill) belongs to the caller's organization. Previously a crafted
-- request could allocate against — and mutate — another tenant's document.
-- ===========================================================================

create or replace function public.record_payment(
  p_company uuid, p_party_type text, p_party_id uuid, p_date date,
  p_amount numeric, p_currency text, p_method text, p_deposit_account uuid,
  p_reference text, p_allocations jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_ctrl uuid;
  v_entry uuid;
  v_payment uuid;
  a jsonb;
  v_doc uuid;
  v_alloc numeric;
  v_doc_org uuid;
begin
  select organization_id into v_org from public.companies where id = p_company;
  if v_org is null then raise exception 'Company % not found', p_company; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;

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
     amount, currency, method, deposit_account_id, reference, created_by)
    values (v_org, p_company, p_party_type,
            case when p_party_type = 'customer' then p_party_id end,
            case when p_party_type = 'supplier' then p_party_id end,
            p_date, p_amount, p_currency, p_method, p_deposit_account, p_reference, auth.uid())
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
      values (v_org, v_entry, p_deposit_account, 'Payment received', p_currency, p_amount, p_amount);
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (v_org, v_entry, v_ctrl, 'Accounts receivable', p_currency, p_amount, p_amount);
  else
    v_ctrl := coalesce((select payable_account_id from public.suppliers where id = p_party_id),
                       public._acct(p_company, '2000'));
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, v_ctrl, 'Accounts payable', p_currency, p_amount, p_amount);
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (v_org, v_entry, p_deposit_account, 'Payment made', p_currency, p_amount, p_amount);
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

grant execute on all routines in schema public to anon, authenticated, service_role;
