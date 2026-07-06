-- ===========================================================================
-- 0020_reverse_journal — reverse a MANUAL journal entry by posting a mirror
-- entry (debits<->credits). Document-generated entries must be reversed via
-- their source document (invoice/bill/payment), so this refuses those.
-- ===========================================================================

create or replace function public.reverse_journal_entry(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_company uuid; v_status text; v_source text; v_entry uuid;
begin
  select organization_id, company_id, status, source_type
    into v_org, v_company, v_status, v_source
    from public.journal_entries where id = p_id;
  if v_org is null then raise exception 'Journal entry not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if v_status <> 'posted' then raise exception 'Only a posted entry can be reversed'; end if;
  if coalesce(v_source, 'manual') <> 'manual' then
    raise exception 'This entry comes from a % — reverse that document instead of the journal entry.', v_source;
  end if;

  v_entry := public._mirror_entry(v_org, v_company, p_id, 'manual', p_id, 'Reversal of journal entry');
  return v_entry;
end;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;
