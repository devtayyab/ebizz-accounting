-- ===========================================================================
-- 0015_reverse_restore — make void/reverse idempotent and reversible.
--   * A document can be reversed (voided) only once.
--   * A voided document can be RESTORED (undo the reversal) back to posted.
--   * Payments gain a `reversed` flag so they can't be double-reversed.
-- A shared _mirror_entry helper posts a debit<->credit mirror of a source entry
-- and reverses that entry's stock movements — used by both directions.
-- ===========================================================================

alter table public.payments
  add column if not exists reversed boolean not null default false;

-- Post a mirror (reversing) journal entry of p_source_entry and reverse its
-- stock movements. Returns the new entry id.
create or replace function public._mirror_entry(
  p_org uuid, p_company uuid, p_source_entry uuid, p_source_type text, p_source_id uuid, p_memo text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_entry uuid; jl record; mv record;
begin
  insert into public.journal_entries
    (organization_id, company_id, entry_date, memo, status, source_type, source_id, created_by)
    values (p_org, p_company, current_date, p_memo, 'draft', p_source_type, p_source_id, auth.uid())
    returning id into v_entry;

  for jl in select * from public.journal_lines where journal_entry_id = p_source_entry loop
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency,
      fx_rate, debit, credit, base_debit, base_credit)
      values (p_org, v_entry, jl.account_id, p_memo, jl.currency, jl.fx_rate,
              jl.credit, jl.debit, jl.base_credit, jl.base_debit);
  end loop;

  for mv in select * from public.inventory_movements where journal_entry_id = p_source_entry loop
    perform public._apply_stock(p_org, p_company, mv.item_id, mv.location_id, -mv.quantity, mv.unit_cost,
              'adjustment', p_memo, mv.supplier_id, mv.customer_id, v_entry);
  end loop;

  update public.journal_entries set status = 'posted' where id = v_entry;
  return v_entry;
end;
$$;

-- Reverse / void a posted document (idempotent: only from 'posted' / not-reversed).
create or replace function public.reverse_document(p_type text, p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_company uuid; v_orig uuid; v_status text; v_paid numeric; v_reversed boolean; v_entry uuid;
begin
  if p_type = 'invoice' then
    select organization_id, company_id, journal_entry_id, status, amount_paid
      into v_org, v_company, v_orig, v_status, v_paid from public.sales_invoices where id = p_id for update;
    if v_status is null then raise exception 'Invoice not found'; end if;
    if v_status <> 'posted' then raise exception 'Invoice is % — only a posted invoice can be voided', v_status; end if;
    if coalesce(v_paid,0) > 0 then raise exception 'Reverse the payments before voiding this invoice'; end if;
  elsif p_type = 'bill' then
    select organization_id, company_id, journal_entry_id, status, amount_paid
      into v_org, v_company, v_orig, v_status, v_paid from public.purchase_bills where id = p_id for update;
    if v_status is null then raise exception 'Bill not found'; end if;
    if v_status <> 'posted' then raise exception 'Bill is % — only a posted bill can be voided', v_status; end if;
    if coalesce(v_paid,0) > 0 then raise exception 'Reverse the payments before voiding this bill'; end if;
  elsif p_type = 'payment' then
    select organization_id, company_id, journal_entry_id, reversed
      into v_org, v_company, v_orig, v_reversed from public.payments where id = p_id for update;
    if v_org is null then raise exception 'Payment not found'; end if;
    if v_reversed then raise exception 'Payment is already reversed'; end if;
  else
    raise exception 'Unsupported document type %', p_type;
  end if;

  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if v_orig is null then raise exception 'Document is not posted'; end if;

  v_entry := public._mirror_entry(v_org, v_company, v_orig, p_type || '_reversal', p_id, 'Reversal of ' || p_type);

  if p_type = 'invoice' then
    update public.sales_invoices set status = 'void' where id = p_id;
  elsif p_type = 'bill' then
    update public.purchase_bills set status = 'void' where id = p_id;
  elsif p_type = 'payment' then
    update public.sales_invoices i set amount_paid = amount_paid - a.amount
      from public.payment_allocations a where a.payment_id = p_id and a.invoice_id = i.id;
    update public.purchase_bills b set amount_paid = amount_paid - a.amount
      from public.payment_allocations a where a.payment_id = p_id and a.bill_id = b.id;
    update public.payments set reversed = true where id = p_id;
  end if;
  return v_entry;
end;
$$;

-- Undo a reversal: re-apply the document by mirroring its reversal entry.
create or replace function public.restore_document(p_type text, p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_company uuid; v_status text; v_reversed boolean; v_rev uuid; v_entry uuid;
begin
  if p_type = 'invoice' then
    select organization_id, company_id, status into v_org, v_company, v_status
      from public.sales_invoices where id = p_id for update;
    if v_status is null then raise exception 'Invoice not found'; end if;
    if v_status <> 'void' then raise exception 'Only a voided invoice can be restored'; end if;
  elsif p_type = 'bill' then
    select organization_id, company_id, status into v_org, v_company, v_status
      from public.purchase_bills where id = p_id for update;
    if v_status is null then raise exception 'Bill not found'; end if;
    if v_status <> 'void' then raise exception 'Only a voided bill can be restored'; end if;
  elsif p_type = 'payment' then
    select organization_id, company_id, reversed into v_org, v_company, v_reversed
      from public.payments where id = p_id for update;
    if v_org is null then raise exception 'Payment not found'; end if;
    if not v_reversed then raise exception 'Payment is not reversed'; end if;
  else
    raise exception 'Unsupported document type %', p_type;
  end if;

  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;

  -- the most recent reversal entry for this document
  select id into v_rev from public.journal_entries
    where source_type = p_type || '_reversal' and source_id = p_id and status = 'posted'
    order by created_at desc limit 1;
  if v_rev is null then raise exception 'No reversal to undo'; end if;

  v_entry := public._mirror_entry(v_org, v_company, v_rev, p_type || '_restore', p_id, 'Restore of ' || p_type);

  if p_type = 'invoice' then
    update public.sales_invoices set status = 'posted' where id = p_id;
  elsif p_type = 'bill' then
    update public.purchase_bills set status = 'posted' where id = p_id;
  elsif p_type = 'payment' then
    update public.sales_invoices i set amount_paid = amount_paid + a.amount
      from public.payment_allocations a where a.payment_id = p_id and a.invoice_id = i.id;
    update public.purchase_bills b set amount_paid = amount_paid + a.amount
      from public.payment_allocations a where a.payment_id = p_id and a.bill_id = b.id;
    update public.payments set reversed = false where id = p_id;
  end if;
  return v_entry;
end;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;
