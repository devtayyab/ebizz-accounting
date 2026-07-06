-- ===========================================================================
-- 0001_core_tenancy — extensions, shared helpers, and the multi-tenant core.
--
-- Tenancy model: SHARED DATABASE + ROW LEVEL SECURITY.
--   organization = the tenant (a SaaS account / billing boundary)
--   company      = a legal entity ("origin") inside an org, with its own base
--                  currency; an org may hold many companies (multi-country group)
--   membership   = links a Supabase auth user to an org with a role
-- Every business table carries organization_id so RLS policies are simple and
-- index-friendly. See 0004_rls.sql for the policies themselves.
-- ===========================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "citext";         -- case-insensitive text (emails)

-- --- shared: keep updated_at fresh on any table that has the column ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- --- currencies (global reference data, ISO 4217) ---------------------------
create table public.currencies (
  code        text primary key check (char_length(code) = 3),
  name        text not null,
  symbol      text,
  minor_units smallint not null default 2 check (minor_units between 0 and 4)
);

insert into public.currencies (code, name, symbol, minor_units) values
  ('USD', 'US Dollar', '$', 2),
  ('EUR', 'Euro', '€', 2),
  ('GBP', 'Pound Sterling', '£', 2),
  ('PKR', 'Pakistani Rupee', 'Rs', 2),
  ('AED', 'UAE Dirham', 'د.إ', 2),
  ('INR', 'Indian Rupee', '₹', 2),
  ('JPY', 'Japanese Yen', '¥', 0),
  ('CHF', 'Swiss Franc', 'CHF', 2),
  ('CAD', 'Canadian Dollar', '$', 2),
  ('AUD', 'Australian Dollar', '$', 2)
on conflict (code) do nothing;

-- --- organizations (tenants) ------------------------------------------------
create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 200),
  slug       citext not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- --- profiles (one row per auth user) ---------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  email      citext,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --- memberships (user <-> organization, with role) -------------------------
create table public.memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null default 'viewer'
                    check (role in ('owner', 'admin', 'accountant', 'viewer')),
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index idx_memberships_user on public.memberships(user_id);
create index idx_memberships_org on public.memberships(organization_id);

-- --- companies (legal entities / "origins" within an org) -------------------
create table public.companies (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 200),
  legal_name      text,
  base_currency   text not null references public.currencies(code),
  country         text check (country is null or char_length(country) = 2),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_companies_org on public.companies(organization_id);
create trigger trg_companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- --- exchange_rates (per-org stored FX rates) -------------------------------
-- rate expresses: 1 unit of from_currency = <rate> units of to_currency.
create table public.exchange_rates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  from_currency   text not null references public.currencies(code),
  to_currency     text not null references public.currencies(code),
  rate            numeric(18, 8) not null check (rate > 0),
  rate_date       date not null,
  created_at      timestamptz not null default now(),
  unique (organization_id, from_currency, to_currency, rate_date),
  check (from_currency <> to_currency)
);
create index idx_fx_org_date on public.exchange_rates(organization_id, rate_date desc);
