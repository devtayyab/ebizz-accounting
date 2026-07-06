-- ===========================================================================
-- 0018_gl_party — General Ledger rows now carry the related customer/supplier
-- name. A journal entry's source_id (when set) points at exactly one source
-- document (UUIDs are unique across tables), so we LEFT JOIN each document type
-- on source_id and coalesce the party name.
-- ===========================================================================

drop function if exists public.report_general_ledger(uuid, uuid, date, date);
create function public.report_general_ledger(
  p_company uuid, p_account uuid default null, p_from date default null, p_to date default null
) returns table (
  entry_date date, entry_id uuid, memo text, source_type text,
  account_id uuid, code text, name text, party text, debit numeric, credit numeric
) language sql stable security definer set search_path = public as $$
  select e.entry_date, e.id, e.memo, e.source_type, a.id, a.code, a.name,
         coalesce(ci.name, ccn.name, cpay.name, spay.name, sb.name, sdn.name, sexp.name) as party,
         l.base_debit, l.base_credit
  from public.journal_lines l
  join public.journal_entries e on e.id = l.journal_entry_id
  join public.accounts a on a.id = l.account_id
  left join public.sales_invoices inv on inv.id = e.source_id
  left join public.customers ci on ci.id = inv.customer_id
  left join public.credit_notes cnt on cnt.id = e.source_id
  left join public.customers ccn on ccn.id = cnt.customer_id
  left join public.payments pay on pay.id = e.source_id
  left join public.customers cpay on cpay.id = pay.customer_id
  left join public.suppliers spay on spay.id = pay.supplier_id
  left join public.purchase_bills bl on bl.id = e.source_id
  left join public.suppliers sb on sb.id = bl.supplier_id
  left join public.debit_notes dnt on dnt.id = e.source_id
  left join public.suppliers sdn on sdn.id = dnt.supplier_id
  left join public.expenses exp on exp.id = e.source_id
  left join public.suppliers sexp on sexp.id = exp.supplier_id
  where e.company_id = p_company and e.status = 'posted'
    and (p_account is null or a.id = p_account)
    and (p_from is null or e.entry_date >= p_from)
    and (p_to is null or e.entry_date <= p_to)
    and e.organization_id in (select public.user_org_ids())
  order by a.code, e.entry_date, e.id;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;
