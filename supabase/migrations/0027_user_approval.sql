-- ===========================================================================
-- 0027_user_approval — gate app access behind admin approval.
-- Anyone can sign up / sign in via Supabase Auth, but a new account is
-- 'pending' until an admin approves it. The very first account ever created
-- becomes the admin (approved). Existing accounts are backfilled as approved,
-- and the earliest one is made admin so the owner can approve others.
-- ===========================================================================

create table if not exists public.app_profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references auth.users(id)
);
alter table public.app_profiles enable row level security;

-- SECURITY DEFINER so these bypass RLS (no recursive policy evaluation).
create or replace function public.is_app_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_profiles
    where user_id = auth.uid() and is_admin and status = 'approved'
  );
$$;

create or replace function public.is_app_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_profiles
    where user_id = auth.uid() and status = 'approved'
  );
$$;

-- A user sees their own profile; an admin sees and edits everyone's.
drop policy if exists app_profiles_select on public.app_profiles;
create policy app_profiles_select on public.app_profiles
  for select using (user_id = auth.uid() or public.is_app_admin());
drop policy if exists app_profiles_update on public.app_profiles;
create policy app_profiles_update on public.app_profiles
  for update using (public.is_app_admin()) with check (public.is_app_admin());

grant select, update on public.app_profiles to authenticated;

-- Auto-provision a profile row for every new auth user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_first boolean;
begin
  select count(*) = 0 into v_first from public.app_profiles;
  insert into public.app_profiles (user_id, email, status, is_admin, decided_at)
    values (new.id, new.email,
            case when v_first then 'approved' else 'pending' end,
            v_first,
            case when v_first then now() else null end)
    on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Admin decision (approve / reject / reset to pending).
create or replace function public.set_user_access(p_user uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'Not authorized'; end if;
  if p_status not in ('approved', 'rejected', 'pending') then raise exception 'Invalid status'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own access'; end if;
  update public.app_profiles
    set status = p_status, decided_at = now(), decided_by = auth.uid()
    where user_id = p_user;
end;
$$;

-- Backfill existing users so nobody is locked out; earliest account = admin.
insert into public.app_profiles (user_id, email, status, is_admin, decided_at)
  select u.id, u.email, 'approved', false, now()
  from auth.users u
  on conflict (user_id) do nothing;

update public.app_profiles set is_admin = true, status = 'approved'
  where user_id = (select id from auth.users order by created_at asc limit 1);

-- Only approved users may create an organization (the main "use the app" action).
create or replace function public.create_organization(
  p_name text, p_slug text, p_company_name text, p_base_currency text default 'USD'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_org uuid; v_company uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_app_approved() then raise exception 'Your account is pending approval'; end if;
  insert into public.organizations (name, slug) values (p_name, p_slug) returning id into v_org;
  insert into public.memberships (organization_id, user_id, role) values (v_org, v_uid, 'owner');
  insert into public.companies (organization_id, name, base_currency)
    values (v_org, p_company_name, p_base_currency) returning id into v_company;
  perform public.seed_default_accounts(v_org, v_company);
  insert into public.locations (organization_id, company_id, name)
    values (v_org, v_company, 'Main Warehouse');
  return jsonb_build_object('organization_id', v_org, 'company_id', v_company);
end;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;
