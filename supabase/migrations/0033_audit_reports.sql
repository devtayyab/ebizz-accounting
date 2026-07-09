-- ===========================================================================
-- 0033_audit_reports — extra reports for auditing:
--   • report_tax_summary     — output vs input tax (account 2100) + net payable.
--   • report_day_book        — chronological posted journal entries (audit trail).
--   • report_sales_register  — one row per invoice (net / tax / total / status).
--   • report_purchase_register — one row per bill.
-- (The Account Ledger / Cash Book tab reuses report_general_ledger by account.)
-- ===========================================================================

create or replace function public.report_tax_summary(
  p_company uuid, p_from date default null, p_to date default null
) returns table (label text, amount numeric)
language sql stable security definer set search_path = public as $$
  with t as (
    select coalesce(sum(l.base_credit), 0) as output_tax,
           coalesce(sum(l.base_debit), 0)  as input_tax
    from public.journal_lines l
    join public.journal_entries e on e.id = l.journal_entry_id
    join public.accounts a on a.id = l.account_id
    where e.company_id = p_company and e.status = 'posted' and a.code = '2100'
      and (p_from is null or e.entry_date >= p_from)
      and (p_to is null or e.entry_date <= p_to)
      and e.organization_id in (select public.user_org_ids())
  )
  select 'Output tax (collected on sales)', output_tax from t
  union all select 'Input tax (paid on purchases/expenses)', input_tax from t
  union all select 'Net tax payable', output_tax - input_tax from t;
$$;

create or replace function public.report_day_book(
  p_company uuid, p_from date default null, p_to date default null
) returns table (
  entry_date date, entry_id uuid, memo text, source_type text, reference text,
  debit_total numeric, credit_total numeric
) language sql stable security definer set search_path = public as $$
  select e.entry_date, e.id, e.memo, e.source_type, e.reference,
         coalesce(sum(l.base_debit), 0), coalesce(sum(l.base_credit), 0)
  from public.journal_entries e
  join public.journal_lines l on l.journal_entry_id = e.id
  where e.company_id = p_company and e.status = 'posted'
    and (p_from is null or e.entry_date >= p_from)
    and (p_to is null or e.entry_date <= p_to)
    and e.organization_id in (select public.user_org_ids())
  group by e.id, e.entry_date, e.memo, e.source_type, e.reference, e.created_at
  order by e.entry_date desc, e.created_at desc;
$$;

create or replace function public.report_sales_register(
  p_company uuid, p_from date default null, p_to date default null
) returns table (
  id uuid, number text, doc_date date, party text, currency text,
  net numeric, tax numeric, total numeric, status text
) language sql stable security definer set search_path = public as $$
  select i.id, i.invoice_number, i.invoice_date, c.name, i.currency,
         (i.subtotal - i.discount_total), i.tax_total, i.total, i.status
  from public.sales_invoices i
  left join public.customers c on c.id = i.customer_id
  where i.company_id = p_company and i.deleted_at is null
    and (p_from is null or i.invoice_date >= p_from)
    and (p_to is null or i.invoice_date <= p_to)
    and i.organization_id in (select public.user_org_ids())
  order by i.invoice_date desc, i.invoice_number desc;
$$;

create or replace function public.report_purchase_register(
  p_company uuid, p_from date default null, p_to date default null
) returns table (
  id uuid, number text, doc_date date, party text, currency text,
  net numeric, tax numeric, total numeric, status text
) language sql stable security definer set search_path = public as $$
  select b.id, b.bill_number, b.bill_date, s.name, b.currency,
         (b.subtotal - b.discount_total), b.tax_total, b.total, b.status
  from public.purchase_bills b
  left join public.suppliers s on s.id = b.supplier_id
  where b.company_id = p_company and b.deleted_at is null
    and (p_from is null or b.bill_date >= p_from)
    and (p_to is null or b.bill_date <= p_to)
    and b.organization_id in (select public.user_org_ids())
  order by b.bill_date desc, b.bill_number desc;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;
