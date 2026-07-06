-- ===========================================================================
-- 0016_revise — make a POSTED invoice/bill editable again by un-posting it back
-- to 'draft'. Posted documents are immutable (they hit the ledger), so we can't
-- edit in place; instead we reverse the ledger + stock effect (via _mirror_entry)
-- and drop the document to draft with its journal link cleared. The user edits
-- and re-posts, which creates a fresh posting. Blocked if payments exist.
-- ===========================================================================

create or replace function public.revise_document(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_company uuid; v_orig uuid; v_status text; v_paid numeric;
begin
  if p_type = 'invoice' then
    select organization_id, company_id, journal_entry_id, status, amount_paid
      into v_org, v_company, v_orig, v_status, v_paid from public.sales_invoices where id = p_id for update;
  elsif p_type = 'bill' then
    select organization_id, company_id, journal_entry_id, status, amount_paid
      into v_org, v_company, v_orig, v_status, v_paid from public.purchase_bills where id = p_id for update;
  else
    raise exception 'Unsupported document type %', p_type;
  end if;

  if v_org is null then raise exception 'Document not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if v_status <> 'posted' then raise exception 'Only a posted % can be edited', p_type; end if;
  if coalesce(v_paid, 0) > 0 then raise exception 'Reverse the payments before editing this %', p_type; end if;

  -- reverse the current posting (ledger + stock) and return to draft
  perform public._mirror_entry(v_org, v_company, v_orig, p_type || '_revision', p_id, 'Un-post for edit');

  if p_type = 'invoice' then
    update public.sales_invoices set status = 'draft', journal_entry_id = null, posted_at = null where id = p_id;
  else
    update public.purchase_bills set status = 'draft', journal_entry_id = null, posted_at = null where id = p_id;
  end if;
end;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;
