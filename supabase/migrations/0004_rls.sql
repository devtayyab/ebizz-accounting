-- ===========================================================================
-- 0004_rls — Row Level Security. This is the tenant isolation boundary.
--
-- Strategy: every business row carries organization_id. A user may touch a row
-- only if they hold a membership in that org. Writes additionally require an
-- editor role (owner/admin/accountant); viewers are read-only.
--
-- The helper functions are SECURITY DEFINER so they read `memberships` without
-- triggering that table's own RLS (which would recurse). search_path is pinned
-- to defeat search-path hijacking.
-- ===========================================================================

-- Org ids the current user belongs to.
create or replace function public.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.memberships where user_id = auth.uid();
$$;

-- Whether the current user may write within a given org.
create or replace function public.user_can_write(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships
     where user_id = auth.uid()
       and organization_id = p_org
       and role in ('owner', 'admin', 'accountant')
  );
$$;

-- Convenience: apply the standard org-scoped policy set to a table that has an
-- organization_id column. Read for members, write for editors.
create or replace function public._apply_org_policies(p_table regclass)
returns void
language plpgsql
as $$
declare
  t text := p_table::text;
begin
  execute format('alter table %s enable row level security;', t);
  execute format($f$
    create policy "org members read %1$s" on %1$s
      for select using (organization_id in (select public.user_org_ids()));
  $f$, t);
  execute format($f$
    create policy "org editors insert %1$s" on %1$s
      for insert with check (public.user_can_write(organization_id));
  $f$, t);
  execute format($f$
    create policy "org editors update %1$s" on %1$s
      for update using (public.user_can_write(organization_id))
                 with check (public.user_can_write(organization_id));
  $f$, t);
  execute format($f$
    create policy "org editors delete %1$s" on %1$s
      for delete using (public.user_can_write(organization_id));
  $f$, t);
end;
$$;

-- --- reference data: readable by any authenticated user ---------------------
alter table public.currencies enable row level security;
create policy "authenticated read currencies" on public.currencies
  for select to authenticated using (true);

-- --- profiles: a user sees/edits only their own row -------------------------
alter table public.profiles enable row level security;
create policy "read own profile" on public.profiles
  for select using (id = auth.uid());
create policy "update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- --- organizations: members read; owners/admins update ----------------------
alter table public.organizations enable row level security;
create policy "members read org" on public.organizations
  for select using (id in (select public.user_org_ids()));
create policy "editors update org" on public.organizations
  for update using (public.user_can_write(id)) with check (public.user_can_write(id));
-- NOTE: creating an organization + first membership is done via a SECURITY
-- DEFINER RPC (see 0005) because a brand-new user has no membership yet.

-- --- memberships: a user sees rows for orgs they belong to ------------------
alter table public.memberships enable row level security;
create policy "read memberships in my orgs" on public.memberships
  for select using (organization_id in (select public.user_org_ids()));
create policy "editors manage memberships" on public.memberships
  for all using (public.user_can_write(organization_id))
          with check (public.user_can_write(organization_id));

-- --- everything else: standard org-scoped policy set ------------------------
select public._apply_org_policies('public.companies');
select public._apply_org_policies('public.exchange_rates');
select public._apply_org_policies('public.accounts');
select public._apply_org_policies('public.journal_entries');
select public._apply_org_policies('public.journal_lines');
select public._apply_org_policies('public.suppliers');
select public._apply_org_policies('public.customers');
select public._apply_org_policies('public.item_categories');
select public._apply_org_policies('public.items');
select public._apply_org_policies('public.item_suppliers');
select public._apply_org_policies('public.locations');
select public._apply_org_policies('public.inventory_levels');
select public._apply_org_policies('public.inventory_movements');
