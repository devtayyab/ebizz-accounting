-- ===========================================================================
-- 0024_aging_base_currency — A/R and A/P aging now report the outstanding
-- balance CONVERTED TO THE COMPANY BASE CURRENCY (× the document's fx_rate),
-- so the dashboard tiles and aging reports consolidate mixed-currency
-- documents into one comparable figure (matching the ledger, which is already
-- stored in base currency).
-- ===========================================================================

create or replace function public.report_ar_aging(p_company uuid, p_as_of date default current_date)
returns table (
  party_id uuid, party_name text,
  current numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric, total numeric
) language sql stable security definer set search_path = public as $$
  with outstanding as (
    select i.customer_id, c.name,
           (i.total - i.amount_paid) * coalesce(i.fx_rate, 1) as bal,
           (p_as_of - coalesce(i.due_date, i.invoice_date)) as age
    from public.sales_invoices i
    join public.customers c on c.id = i.customer_id
    where i.company_id = p_company and i.status = 'posted'
      and i.total - i.amount_paid > 0
      and i.organization_id in (select public.user_org_ids())
  )
  select customer_id, name,
    round(sum(bal) filter (where age <= 0), 2),
    round(sum(bal) filter (where age between 1 and 30), 2),
    round(sum(bal) filter (where age between 31 and 60), 2),
    round(sum(bal) filter (where age between 61 and 90), 2),
    round(sum(bal) filter (where age > 90), 2),
    round(sum(bal), 2)
  from outstanding group by customer_id, name order by name;
$$;

create or replace function public.report_ap_aging(p_company uuid, p_as_of date default current_date)
returns table (
  party_id uuid, party_name text,
  current numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric, total numeric
) language sql stable security definer set search_path = public as $$
  with outstanding as (
    select b.supplier_id, s.name,
           (b.total - b.amount_paid) * coalesce(b.fx_rate, 1) as bal,
           (p_as_of - coalesce(b.due_date, b.bill_date)) as age
    from public.purchase_bills b
    join public.suppliers s on s.id = b.supplier_id
    where b.company_id = p_company and b.status = 'posted'
      and b.total - b.amount_paid > 0
      and b.organization_id in (select public.user_org_ids())
  )
  select supplier_id, name,
    round(sum(bal) filter (where age <= 0), 2),
    round(sum(bal) filter (where age between 1 and 30), 2),
    round(sum(bal) filter (where age between 31 and 60), 2),
    round(sum(bal) filter (where age between 61 and 90), 2),
    round(sum(bal) filter (where age > 90), 2),
    round(sum(bal), 2)
  from outstanding group by supplier_id, name order by name;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;
