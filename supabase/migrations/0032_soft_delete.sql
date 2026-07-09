-- ===========================================================================
-- 0032_soft_delete — Recycle Bin. Deleting an invoice/bill/expense/item/
-- customer/supplier now sets deleted_at (hidden from lists) instead of a hard
-- delete, and reverses any ledger impact, so it can be viewed and restored.
--   • soft_delete_record(type,id) — reverse GL if needed, then set deleted_at.
--   • restore_record(type,id)      — re-apply GL if needed, clear deleted_at.
--   • purge_record(type,id)        — permanent hard delete.
--   • recycle_bin(company)         — union of all deleted rows for the bin UI.
-- ===========================================================================

alter table public.sales_invoices  add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid;
alter table public.purchase_bills   add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid;
alter table public.expenses         add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid;
alter table public.items            add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid;
alter table public.customers        add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid;
alter table public.suppliers        add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid;

create or replace function public._org_of(p_type text, p_id uuid) returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  case p_type
    when 'invoice'  then select organization_id into v from public.sales_invoices where id = p_id;
    when 'bill'     then select organization_id into v from public.purchase_bills where id = p_id;
    when 'expense'  then select organization_id into v from public.expenses where id = p_id;
    when 'item'     then select organization_id into v from public.items where id = p_id;
    when 'customer' then select organization_id into v from public.customers where id = p_id;
    when 'supplier' then select organization_id into v from public.suppliers where id = p_id;
    else raise exception 'Unsupported record type %', p_type;
  end case;
  return v;
end;
$$;

create or replace function public.soft_delete_record(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_status text; v_paid numeric;
begin
  v_org := public._org_of(p_type, p_id);
  if v_org is null then raise exception 'Record not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;

  if p_type = 'invoice' then
    select status, amount_paid into v_status, v_paid from public.sales_invoices where id = p_id;
    if coalesce(v_paid,0) > 0 then raise exception 'Reverse the payments before deleting this invoice'; end if;
    if v_status = 'posted' then perform public.reverse_document('invoice', p_id); end if;
    update public.sales_invoices set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  elsif p_type = 'bill' then
    select status, amount_paid into v_status, v_paid from public.purchase_bills where id = p_id;
    if coalesce(v_paid,0) > 0 then raise exception 'Reverse the payments before deleting this bill'; end if;
    if v_status = 'posted' then perform public.reverse_document('bill', p_id); end if;
    update public.purchase_bills set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  elsif p_type = 'expense' then
    perform public.reverse_expense(p_id);
    update public.expenses set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  elsif p_type = 'item' then
    update public.items set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  elsif p_type = 'customer' then
    update public.customers set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  elsif p_type = 'supplier' then
    update public.suppliers set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  else
    raise exception 'Unsupported record type %', p_type;
  end if;
end;
$$;

create or replace function public.restore_record(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_status text; v_rev uuid; v_orgc uuid; v_company uuid;
begin
  v_org := public._org_of(p_type, p_id);
  if v_org is null then raise exception 'Record not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;

  if p_type = 'invoice' then
    select status into v_status from public.sales_invoices where id = p_id;
    if v_status = 'void' then perform public.restore_document('invoice', p_id); end if;
    update public.sales_invoices set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_type = 'bill' then
    select status into v_status from public.purchase_bills where id = p_id;
    if v_status = 'void' then perform public.restore_document('bill', p_id); end if;
    update public.purchase_bills set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_type = 'expense' then
    -- re-apply the ledger by mirroring the reversal entry created at delete time
    select organization_id, company_id into v_orgc, v_company from public.expenses where id = p_id;
    select id into v_rev from public.journal_entries
      where source_type = 'expense_reversal' and source_id = p_id and status = 'posted'
      order by created_at desc limit 1;
    if v_rev is not null then
      perform public._mirror_entry(v_orgc, v_company, v_rev, 'expense_restore', p_id, 'Restore of expense');
    end if;
    update public.expenses set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_type = 'item' then
    update public.items set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_type = 'customer' then
    update public.customers set deleted_at = null, deleted_by = null where id = p_id;
  elsif p_type = 'supplier' then
    update public.suppliers set deleted_at = null, deleted_by = null where id = p_id;
  else
    raise exception 'Unsupported record type %', p_type;
  end if;
end;
$$;

create or replace function public.purge_record(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  v_org := public._org_of(p_type, p_id);
  if v_org is null then raise exception 'Record not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;

  case p_type
    when 'invoice'  then delete from public.sales_invoices where id = p_id;
    when 'bill'     then delete from public.purchase_bills where id = p_id;
    when 'expense'  then delete from public.expenses where id = p_id;
    when 'item'     then delete from public.items where id = p_id;
    when 'customer' then delete from public.customers where id = p_id;
    when 'supplier' then delete from public.suppliers where id = p_id;
    else raise exception 'Unsupported record type %', p_type;
  end case;
end;
$$;

-- Union of all soft-deleted rows for the Recycle Bin UI.
create or replace function public.recycle_bin(p_company uuid)
returns table (type text, id uuid, label text, sub text, deleted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select 'invoice', i.id, i.invoice_number, coalesce(c.name, ''), i.deleted_at
    from public.sales_invoices i left join public.customers c on c.id = i.customer_id
    where i.company_id = p_company and i.deleted_at is not null
  union all
  select 'bill', b.id, b.bill_number, coalesce(s.name, ''), b.deleted_at
    from public.purchase_bills b left join public.suppliers s on s.id = b.supplier_id
    where b.company_id = p_company and b.deleted_at is not null
  union all
  select 'expense', e.id, coalesce(e.memo, 'Expense'), to_char(e.total, 'FM999999990.00'), e.deleted_at
    from public.expenses e where e.company_id = p_company and e.deleted_at is not null
  union all
  select 'item', it.id, it.name, it.sku, it.deleted_at
    from public.items it where it.company_id = p_company and it.deleted_at is not null
  union all
  select 'customer', c.id, c.name, coalesce(c.email, ''), c.deleted_at
    from public.customers c where c.company_id = p_company and c.deleted_at is not null
  union all
  select 'supplier', s.id, s.name, coalesce(s.email, ''), s.deleted_at
    from public.suppliers s where s.company_id = p_company and s.deleted_at is not null
  order by deleted_at desc;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;
