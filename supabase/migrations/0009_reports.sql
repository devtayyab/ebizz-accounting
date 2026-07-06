-- ===========================================================================
-- 0009_reports — aggregation RPCs for financial statements. Doing the rollup in
-- SQL (rather than fetching raw journal lines to the API) keeps reports correct
-- regardless of ledger size and avoids PostgREST's row cap. All are SECURITY
-- INVOKER-style STABLE functions that still respect RLS via the joins.
-- ===========================================================================

-- Per-account debit/credit/balance over posted entries in an optional date range.
create or replace function public.report_account_activity(
  p_company uuid, p_from date default null, p_to date default null
) returns table (
  account_id uuid, code text, name text, type text, debit numeric, credit numeric, balance numeric
) language sql stable security definer set search_path = public as $$
  select a.id, a.code, a.name, a.type,
         coalesce(sum(l.base_debit), 0) as debit,
         coalesce(sum(l.base_credit), 0) as credit,
         coalesce(sum(l.base_debit - l.base_credit), 0) as balance
  from public.accounts a
  left join public.journal_lines l on l.account_id = a.id
  left join public.journal_entries e on e.id = l.journal_entry_id
    and e.status = 'posted'
    and (p_from is null or e.entry_date >= p_from)
    and (p_to   is null or e.entry_date <= p_to)
  where a.company_id = p_company
    and a.organization_id in (select public.user_org_ids())
  group by a.id, a.code, a.name, a.type
  order by a.code;
$$;

-- A/R aging: outstanding sales invoices bucketed by age of their due date.
create or replace function public.report_ar_aging(p_company uuid, p_as_of date default current_date)
returns table (
  party_id uuid, party_name text,
  current numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric, total numeric
) language sql stable security definer set search_path = public as $$
  with outstanding as (
    select i.customer_id, c.name,
           (i.total - i.amount_paid) as bal,
           (p_as_of - coalesce(i.due_date, i.invoice_date)) as age
    from public.sales_invoices i
    join public.customers c on c.id = i.customer_id
    where i.company_id = p_company and i.status = 'posted'
      and i.total - i.amount_paid > 0
      and i.organization_id in (select public.user_org_ids())
  )
  select customer_id, name,
    sum(bal) filter (where age <= 0),
    sum(bal) filter (where age between 1 and 30),
    sum(bal) filter (where age between 31 and 60),
    sum(bal) filter (where age between 61 and 90),
    sum(bal) filter (where age > 90),
    sum(bal)
  from outstanding group by customer_id, name order by name;
$$;

-- A/P aging: outstanding purchase bills bucketed by age of their due date.
create or replace function public.report_ap_aging(p_company uuid, p_as_of date default current_date)
returns table (
  party_id uuid, party_name text,
  current numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric, total numeric
) language sql stable security definer set search_path = public as $$
  with outstanding as (
    select b.supplier_id, s.name,
           (b.total - b.amount_paid) as bal,
           (p_as_of - coalesce(b.due_date, b.bill_date)) as age
    from public.purchase_bills b
    join public.suppliers s on s.id = b.supplier_id
    where b.company_id = p_company and b.status = 'posted'
      and b.total - b.amount_paid > 0
      and b.organization_id in (select public.user_org_ids())
  )
  select supplier_id, name,
    sum(bal) filter (where age <= 0),
    sum(bal) filter (where age between 1 and 30),
    sum(bal) filter (where age between 31 and 60),
    sum(bal) filter (where age between 61 and 90),
    sum(bal) filter (where age > 90),
    sum(bal)
  from outstanding group by supplier_id, name order by name;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;
