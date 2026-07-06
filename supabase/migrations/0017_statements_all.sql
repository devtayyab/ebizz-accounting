-- ===========================================================================
-- 0017_statements_all — statements now default to ALL parties (party optional),
-- include the party name, add the missing tenant guard, and exclude reversed
-- payments. Filtering by a specific party narrows the result.
-- ===========================================================================

drop function if exists public.report_customer_statement(uuid, uuid);
create function public.report_customer_statement(p_company uuid, p_customer uuid default null)
returns table (txn_date date, party_id uuid, party_name text, doc_type text, reference text, charge numeric, credit numeric)
language sql stable security definer set search_path = public as $$
  select i.invoice_date, c.id, c.name, 'invoice', i.invoice_number, i.total, 0
    from public.sales_invoices i join public.customers c on c.id = i.customer_id
    where i.company_id = p_company and i.status = 'posted'
      and (p_customer is null or i.customer_id = p_customer)
      and i.organization_id in (select public.user_org_ids())
  union all
  select n.note_date, c.id, c.name, 'credit_note', n.note_number, 0, n.total
    from public.credit_notes n join public.customers c on c.id = n.customer_id
    where n.company_id = p_company and n.status = 'posted'
      and (p_customer is null or n.customer_id = p_customer)
      and n.organization_id in (select public.user_org_ids())
  union all
  select p.payment_date, c.id, c.name, 'payment', p.reference, 0, p.amount
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
  select b.bill_date, s.id, s.name, 'bill', b.bill_number, b.total, 0
    from public.purchase_bills b join public.suppliers s on s.id = b.supplier_id
    where b.company_id = p_company and b.status = 'posted'
      and (p_supplier is null or b.supplier_id = p_supplier)
      and b.organization_id in (select public.user_org_ids())
  union all
  select n.note_date, s.id, s.name, 'debit_note', n.note_number, 0, n.total
    from public.debit_notes n join public.suppliers s on s.id = n.supplier_id
    where n.company_id = p_company and n.status = 'posted'
      and (p_supplier is null or n.supplier_id = p_supplier)
      and n.organization_id in (select public.user_org_ids())
  union all
  select p.payment_date, s.id, s.name, 'payment', p.reference, 0, p.amount
    from public.payments p join public.suppliers s on s.id = p.supplier_id
    where p.company_id = p_company and p.party_type = 'supplier' and not p.reversed
      and (p_supplier is null or p.supplier_id = p_supplier)
      and p.organization_id in (select public.user_org_ids())
  order by 3, 1;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;
