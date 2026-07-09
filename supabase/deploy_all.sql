-- Ebizz — clean full deploy for the Supabase SQL Editor (fresh install).
-- WARNING: this DROPS the public schema (all app tables + data) and rebuilds it.
-- Safe for a fresh/failed deploy. Do NOT run on a DB with real data you need.
begin;

-- ==== reset app schema (Supabase-standard) ====
drop schema if exists public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;


-- ==== 0001_core_tenancy.sql ====
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

-- ==== 0002_ledger.sql ====
-- ===========================================================================
-- 0002_ledger — double-entry general ledger.
--
--   accounts        = chart of accounts, per company, typed by the accounting
--                     equation (asset/liability/equity/income/expense)
--   journal_entries = a balanced transaction (header); only `posted` entries
--                     count toward balances
--   journal_lines   = the individual debit/credit legs; each leg is one-sided
--                     (debit XOR credit) and carries both transaction-currency
--                     and base-currency amounts for multi-currency reporting
--
-- Balance is enforced at POST time by a trigger: sum(base_debit) must equal
-- sum(base_credit) across a posted entry. Draft entries may be unbalanced while
-- being edited.
-- ===========================================================================

-- --- chart of accounts ------------------------------------------------------
create table public.accounts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  code            text not null,
  name            text not null,
  type            text not null
                    check (type in ('asset', 'liability', 'equity', 'income', 'expense')),
  parent_id       uuid references public.accounts(id) on delete set null,
  currency        text references public.currencies(code),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, code)
);
create index idx_accounts_company on public.accounts(company_id);
create trigger trg_accounts_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

-- --- journal entries (transaction header) -----------------------------------
create table public.journal_entries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  entry_date      date not null,
  memo            text,
  reference       text,
  status          text not null default 'draft'
                    check (status in ('draft', 'posted', 'void')),
  -- Provenance: which subsystem created this entry (e.g. 'inventory', 'invoice').
  source_type     text,
  source_id       uuid,
  posted_at       timestamptz,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_journal_company_date on public.journal_entries(company_id, entry_date desc);
create index idx_journal_source on public.journal_entries(source_type, source_id);
create trigger trg_journal_updated_at
  before update on public.journal_entries
  for each row execute function public.set_updated_at();

-- --- journal lines (the legs) -----------------------------------------------
create table public.journal_lines (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  journal_entry_id  uuid not null references public.journal_entries(id) on delete cascade,
  account_id        uuid not null references public.accounts(id),
  description       text,
  -- amounts in the line's transaction currency
  currency          text not null references public.currencies(code),
  fx_rate           numeric(18, 8) not null default 1 check (fx_rate > 0),
  debit             numeric(18, 4) not null default 0 check (debit >= 0),
  credit            numeric(18, 4) not null default 0 check (credit >= 0),
  -- amounts converted into the company's base currency (debit * fx_rate, etc.)
  base_debit        numeric(18, 4) not null default 0 check (base_debit >= 0),
  base_credit       numeric(18, 4) not null default 0 check (base_credit >= 0),
  created_at        timestamptz not null default now(),
  -- a leg is exactly one side
  constraint chk_one_sided check (
    (debit > 0 and credit = 0) or (credit > 0 and debit = 0)
  )
);
create index idx_lines_entry on public.journal_lines(journal_entry_id);
create index idx_lines_account on public.journal_lines(account_id);

-- --- balance enforcement on POST --------------------------------------------
-- When an entry transitions to (or is updated while) 'posted', its base-currency
-- debits and credits must balance and it must have at least two legs.
create or replace function public.assert_entry_balanced()
returns trigger
language plpgsql
as $$
declare
  v_debit  numeric(18, 4);
  v_credit numeric(18, 4);
  v_count  integer;
begin
  if new.status <> 'posted' then
    return new;
  end if;

  select coalesce(sum(base_debit), 0), coalesce(sum(base_credit), 0), count(*)
    into v_debit, v_credit, v_count
    from public.journal_lines
   where journal_entry_id = new.id;

  if v_count < 2 then
    raise exception 'Journal entry % must have at least two lines to post', new.id;
  end if;

  if v_debit <> v_credit then
    raise exception 'Journal entry % is unbalanced: base debits % <> base credits %',
      new.id, v_debit, v_credit;
  end if;

  if new.posted_at is null then
    new.posted_at = now();
  end if;

  return new;
end;
$$;

create trigger trg_journal_balanced
  before insert or update of status on public.journal_entries
  for each row execute function public.assert_entry_balanced();

-- Once an entry is posted its lines are immutable (adjust via a reversing entry).
create or replace function public.guard_posted_lines()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_entry  uuid;
begin
  v_entry := coalesce(new.journal_entry_id, old.journal_entry_id);
  select status into v_status from public.journal_entries where id = v_entry;
  if v_status = 'posted' then
    raise exception 'Cannot modify lines of a posted journal entry %', v_entry;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_guard_posted_lines
  before insert or update or delete on public.journal_lines
  for each row execute function public.guard_posted_lines();

-- ==== 0003_inventory_partners.sql ====
-- ===========================================================================
-- 0003_inventory_partners — items, stock, and the trading partners
-- (suppliers & customers) that inventory links to.
--
--   suppliers / customers link to their control accounts (A/P, A/R) so that
--   posting to a partner flows into the ledger.
--   items link to income / expense (COGS) / inventory asset accounts.
--   item_suppliers is the many-to-many join that ties an item to the suppliers
--   who provide it (with per-supplier SKU, cost and lead time).
--   locations + inventory_levels track quantity-on-hand and moving-average cost
--   per warehouse; inventory_movements is the immutable audit trail and links
--   each movement to the journal entry it posted.
-- ===========================================================================

-- --- suppliers --------------------------------------------------------------
create table public.suppliers (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  company_id          uuid not null references public.companies(id) on delete cascade,
  name                text not null check (char_length(name) between 1 and 200),
  email               citext,
  phone               text,
  tax_number          text,
  currency            text references public.currencies(code),
  payment_terms_days  integer not null default 30 check (payment_terms_days >= 0),
  payable_account_id  uuid references public.accounts(id),
  address_line1       text,
  address_line2       text,
  city                text,
  country             text check (country is null or char_length(country) = 2),
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_suppliers_company on public.suppliers(company_id);
create trigger trg_suppliers_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

-- --- customers --------------------------------------------------------------
create table public.customers (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  company_id            uuid not null references public.companies(id) on delete cascade,
  name                  text not null check (char_length(name) between 1 and 200),
  email                 citext,
  phone                 text,
  tax_number            text,
  currency              text references public.currencies(code),
  payment_terms_days    integer not null default 30 check (payment_terms_days >= 0),
  credit_limit          numeric(18, 4) check (credit_limit is null or credit_limit >= 0),
  receivable_account_id uuid references public.accounts(id),
  address_line1         text,
  address_line2         text,
  city                  text,
  country               text check (country is null or char_length(country) = 2),
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index idx_customers_company on public.customers(company_id);
create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- --- item categories --------------------------------------------------------
create table public.item_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  name            text not null,
  parent_id       uuid references public.item_categories(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (company_id, name)
);
create index idx_item_categories_company on public.item_categories(company_id);

-- --- items ------------------------------------------------------------------
create table public.items (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  company_id           uuid not null references public.companies(id) on delete cascade,
  sku                  text not null,
  name                 text not null,
  description          text,
  type                 text not null default 'inventory'
                         check (type in ('inventory', 'service', 'non_inventory')),
  unit                 text not null default 'unit',
  category_id          uuid references public.item_categories(id) on delete set null,
  purchase_price       numeric(18, 4) check (purchase_price is null or purchase_price >= 0),
  sale_price           numeric(18, 4) check (sale_price is null or sale_price >= 0),
  currency             text references public.currencies(code),
  track_inventory      boolean not null default true,
  reorder_point        numeric(18, 4) check (reorder_point is null or reorder_point >= 0),
  income_account_id    uuid references public.accounts(id),
  expense_account_id   uuid references public.accounts(id),
  inventory_account_id uuid references public.accounts(id),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (company_id, sku),
  -- only inventory-type items may track stock
  check (not track_inventory or type = 'inventory')
);
create index idx_items_company on public.items(company_id);
create index idx_items_category on public.items(category_id);
create trigger trg_items_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

-- --- item <-> supplier (sourcing) -------------------------------------------
create table public.item_suppliers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id         uuid not null references public.items(id) on delete cascade,
  supplier_id     uuid not null references public.suppliers(id) on delete cascade,
  supplier_sku    text,
  cost            numeric(18, 4) check (cost is null or cost >= 0),
  lead_time_days  integer check (lead_time_days is null or lead_time_days >= 0),
  is_preferred    boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (item_id, supplier_id)
);
create index idx_item_suppliers_item on public.item_suppliers(item_id);
create index idx_item_suppliers_supplier on public.item_suppliers(supplier_id);

-- Guarantee at most one preferred supplier per item.
create unique index uq_item_preferred_supplier
  on public.item_suppliers(item_id)
  where is_preferred;

-- --- locations / warehouses -------------------------------------------------
create table public.locations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  name            text not null,
  address_line1   text,
  city            text,
  country         text check (country is null or char_length(country) = 2),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (company_id, name)
);
create index idx_locations_company on public.locations(company_id);

-- --- inventory levels (current stock, moving-average cost) ------------------
create table public.inventory_levels (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  item_id           uuid not null references public.items(id) on delete cascade,
  location_id       uuid not null references public.locations(id) on delete cascade,
  quantity_on_hand  numeric(18, 4) not null default 0,
  average_cost      numeric(18, 4) not null default 0 check (average_cost >= 0),
  updated_at        timestamptz not null default now(),
  unique (item_id, location_id)
);
create index idx_inventory_levels_item on public.inventory_levels(item_id);
create trigger trg_inventory_levels_updated_at
  before update on public.inventory_levels
  for each row execute function public.set_updated_at();

-- --- inventory movements (immutable audit trail) ----------------------------
create table public.inventory_movements (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete cascade,
  item_id          uuid not null references public.items(id),
  location_id      uuid not null references public.locations(id),
  movement_type    text not null
                     check (movement_type in ('purchase','sale','adjustment',
                             'transfer_in','transfer_out','opening_balance')),
  quantity         numeric(18, 4) not null,   -- signed: + increases stock, - decreases
  unit_cost        numeric(18, 4) not null default 0 check (unit_cost >= 0),
  reference        text,
  supplier_id      uuid references public.suppliers(id),
  customer_id      uuid references public.customers(id),
  journal_entry_id uuid references public.journal_entries(id),
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now()
);
create index idx_movements_item on public.inventory_movements(item_id, created_at desc);
create index idx_movements_company on public.inventory_movements(company_id, created_at desc);

-- ==== 0004_rls.sql ====
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

-- ==== 0005_rpc.sql ====
-- ===========================================================================
-- 0005_rpc — server-side transactional operations exposed as RPCs.
--
--   create_organization        bootstraps a tenant: org + owner membership +
--                              first company + a default chart of accounts, all
--                              in one transaction. SECURITY DEFINER because a
--                              brand-new user has no membership to satisfy RLS.
--   record_inventory_movement  the single write path for stock: it updates
--                              moving-average cost & quantity-on-hand AND posts
--                              the matching double-entry journal entry, so the
--                              ledger and the warehouse can never drift apart.
-- ===========================================================================

-- --- default chart of accounts for a new company ----------------------------
create or replace function public.seed_default_accounts(p_org uuid, p_company uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.accounts (organization_id, company_id, code, name, type) values
    (p_org, p_company, '1000', 'Cash', 'asset'),
    (p_org, p_company, '1010', 'Bank', 'asset'),
    (p_org, p_company, '1200', 'Accounts Receivable', 'asset'),
    (p_org, p_company, '1300', 'Inventory', 'asset'),
    (p_org, p_company, '2000', 'Accounts Payable', 'liability'),
    (p_org, p_company, '2100', 'Sales Tax Payable', 'liability'),
    (p_org, p_company, '3000', 'Owner Equity', 'equity'),
    (p_org, p_company, '3900', 'Retained Earnings', 'equity'),
    (p_org, p_company, '4000', 'Sales Revenue', 'income'),
    (p_org, p_company, '5000', 'Cost of Goods Sold', 'expense'),
    (p_org, p_company, '5100', 'Inventory Adjustments', 'expense'),
    (p_org, p_company, '6000', 'Operating Expenses', 'expense');
end;
$$;

-- --- bootstrap a new tenant -------------------------------------------------
create or replace function public.create_organization(
  p_name          text,
  p_slug          text,
  p_company_name  text,
  p_base_currency text default 'USD'
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_org     uuid;
  v_company uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.organizations (name, slug)
    values (p_name, p_slug)
    returning id into v_org;

  insert into public.memberships (organization_id, user_id, role)
    values (v_org, v_uid, 'owner');

  insert into public.companies (organization_id, name, base_currency)
    values (v_org, p_company_name, p_base_currency)
    returning id into v_company;

  perform public.seed_default_accounts(v_org, v_company);

  return jsonb_build_object('organization_id', v_org, 'company_id', v_company);
end;
$$;

-- --- record a stock movement and its ledger posting -------------------------
-- p_quantity is SIGNED: positive increases stock (receipt), negative decreases
-- it (issue). Moving-average cost is recomputed on receipts; issues post at the
-- current average cost. When p_post_to_ledger is true a balanced journal entry
-- is created and linked to the movement.
create or replace function public.record_inventory_movement(
  p_item_id        uuid,
  p_location_id    uuid,
  p_movement_type  text,
  p_quantity       numeric,
  p_unit_cost      numeric default 0,
  p_reference      text default null,
  p_supplier_id    uuid default null,
  p_customer_id    uuid default null,
  p_post_to_ledger boolean default true,
  p_entry_date     date default current_date
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_org       uuid;
  v_company   uuid;
  v_currency  text;
  v_inv_acct  uuid;
  v_cogs_acct uuid;
  v_ap_acct   uuid;
  v_level     public.inventory_levels%rowtype;
  v_new_qty   numeric;
  v_new_avg   numeric;
  v_amount    numeric;
  v_entry     uuid;
  v_movement  uuid;
begin
  select organization_id, company_id, coalesce(currency, (select base_currency from companies c where c.id = i.company_id)),
         inventory_account_id, expense_account_id
    into v_org, v_company, v_currency, v_inv_acct, v_cogs_acct
    from public.items i
   where id = p_item_id;

  if v_org is null then
    raise exception 'Item % not found', p_item_id;
  end if;
  if not public.user_can_write(v_org) then
    raise exception 'Not authorized to write in this organization';
  end if;
  if p_quantity = 0 then
    raise exception 'Movement quantity must be non-zero';
  end if;

  -- upsert / lock the level row
  select * into v_level from public.inventory_levels
    where item_id = p_item_id and location_id = p_location_id
    for update;

  if not found then
    insert into public.inventory_levels (organization_id, item_id, location_id, quantity_on_hand, average_cost)
      values (v_org, p_item_id, p_location_id, 0, 0)
      returning * into v_level;
  end if;

  v_new_qty := v_level.quantity_on_hand + p_quantity;
  if v_new_qty < 0 then
    raise exception 'Insufficient stock: on hand % , requested %', v_level.quantity_on_hand, p_quantity;
  end if;

  if p_quantity > 0 then
    -- receipt: recompute moving average
    v_new_avg := case when v_new_qty > 0
                   then (v_level.quantity_on_hand * v_level.average_cost + p_quantity * p_unit_cost) / v_new_qty
                   else 0 end;
    v_amount := p_quantity * p_unit_cost;
  else
    -- issue: value at current average cost
    v_new_avg := v_level.average_cost;
    v_amount := abs(p_quantity) * v_level.average_cost;
  end if;

  update public.inventory_levels
     set quantity_on_hand = v_new_qty, average_cost = v_new_avg, updated_at = now()
   where id = v_level.id;

  -- optional ledger posting
  if p_post_to_ledger and v_amount > 0 then
    if v_inv_acct is null then
      raise exception 'Item % has no inventory_account_id configured; cannot post to ledger', p_item_id;
    end if;

    insert into public.journal_entries
      (organization_id, company_id, entry_date, memo, reference, status, source_type, created_by)
      values (v_org, v_company, p_entry_date,
              format('Inventory %s', p_movement_type), p_reference, 'draft',
              'inventory', auth.uid())
      returning id into v_entry;

    if p_quantity > 0 then
      -- receipt: Dr Inventory, Cr Accounts Payable (supplier) or Owner Equity
      select coalesce(s.payable_account_id,
                      (select id from accounts where company_id = v_company and code = '2000'))
        into v_ap_acct from public.suppliers s where s.id = p_supplier_id;
      if v_ap_acct is null then
        select id into v_ap_acct from public.accounts where company_id = v_company and code = '2000';
      end if;

      insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
        values (v_org, v_entry, v_inv_acct, 'Inventory received', v_currency, v_amount, v_amount);
      insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
        values (v_org, v_entry, v_ap_acct, 'Payable / funding', v_currency, v_amount, v_amount);
    else
      -- issue (sale/consumption): Dr COGS, Cr Inventory
      if v_cogs_acct is null then
        select id into v_cogs_acct from public.accounts where company_id = v_company and code = '5000';
      end if;
      insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
        values (v_org, v_entry, v_cogs_acct, 'Cost of goods sold', v_currency, v_amount, v_amount);
      insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
        values (v_org, v_entry, v_inv_acct, 'Inventory issued', v_currency, v_amount, v_amount);
    end if;

    update public.journal_entries set status = 'posted' where id = v_entry;
  end if;

  insert into public.inventory_movements
    (organization_id, company_id, item_id, location_id, movement_type, quantity,
     unit_cost, reference, supplier_id, customer_id, journal_entry_id, created_by)
    values (v_org, v_company, p_item_id, p_location_id, p_movement_type, p_quantity,
            case when p_quantity > 0 then p_unit_cost else v_level.average_cost end,
            p_reference, p_supplier_id, p_customer_id, v_entry, auth.uid())
    returning id into v_movement;

  return jsonb_build_object(
    'movement_id', v_movement,
    'journal_entry_id', v_entry,
    'quantity_on_hand', v_new_qty,
    'average_cost', v_new_avg
  );
end;
$$;

-- ==== 0006_grants.sql ====
-- ===========================================================================
-- 0006_grants — table/function privileges for the Supabase API roles.
--
-- RLS decides WHICH ROWS a caller sees; GRANTs decide whether the role may
-- touch the table at all. PostgREST connects as `anon` (no session) or
-- `authenticated` (logged in), so both need privileges — row visibility is then
-- governed entirely by the RLS policies in 0004. `service_role` bypasses RLS.
--
-- We grant broadly here and lean on RLS as the security boundary, which is the
-- standard Supabase pattern. The default-privileges statements ensure any
-- tables added by FUTURE migrations inherit the same grants automatically.
-- ===========================================================================

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all routines in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on routines to anon, authenticated, service_role;

-- ==== 0007_sales_purchases.sql ====
-- ===========================================================================
-- 0007_sales_purchases — the transaction layer that turns a catalogue into an
-- accounting system: tax rates, sales invoices (A/R), purchase bills (A/P) and
-- payments. Documents are created as `draft`, then POSTED (0008) which is what
-- moves inventory and writes the general ledger.
--
-- Line/header money totals are computed and stored by the API on save; the
-- posting RPCs read them and build the balanced journal entry.
-- ===========================================================================

-- --- tax rates --------------------------------------------------------------
create table public.tax_rates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  name            text not null,
  rate            numeric(9, 6) not null check (rate >= 0),   -- 0.15 = 15%
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (company_id, name)
);
create index idx_tax_rates_company on public.tax_rates(company_id);

-- --- sales invoices (Accounts Receivable) -----------------------------------
create table public.sales_invoices (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete cascade,
  customer_id      uuid not null references public.customers(id),
  location_id      uuid references public.locations(id),
  invoice_number   text not null,
  invoice_date     date not null default current_date,
  due_date         date,
  status           text not null default 'draft'
                     check (status in ('draft', 'posted', 'void')),
  currency         text not null references public.currencies(code),
  fx_rate          numeric(18, 8) not null default 1 check (fx_rate > 0),
  subtotal         numeric(18, 4) not null default 0,
  tax_total        numeric(18, 4) not null default 0,
  total            numeric(18, 4) not null default 0,
  amount_paid      numeric(18, 4) not null default 0,
  notes            text,
  journal_entry_id uuid references public.journal_entries(id),
  posted_at        timestamptz,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, invoice_number)
);
create index idx_invoices_company on public.sales_invoices(company_id, invoice_date desc);
create index idx_invoices_customer on public.sales_invoices(customer_id);
create trigger trg_invoices_updated_at
  before update on public.sales_invoices
  for each row execute function public.set_updated_at();

create table public.sales_invoice_lines (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  invoice_id        uuid not null references public.sales_invoices(id) on delete cascade,
  line_no           integer not null default 1,
  item_id           uuid references public.items(id),
  description       text,
  quantity          numeric(18, 4) not null default 1,
  unit_price        numeric(18, 4) not null default 0,
  tax_rate_id       uuid references public.tax_rates(id),
  tax_rate          numeric(9, 6) not null default 0,
  line_subtotal     numeric(18, 4) not null default 0,
  tax_amount        numeric(18, 4) not null default 0,
  line_total        numeric(18, 4) not null default 0,
  income_account_id uuid references public.accounts(id)
);
create index idx_invoice_lines_invoice on public.sales_invoice_lines(invoice_id);

-- --- purchase bills (Accounts Payable) --------------------------------------
create table public.purchase_bills (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete cascade,
  supplier_id      uuid not null references public.suppliers(id),
  location_id      uuid references public.locations(id),
  bill_number      text not null,
  bill_date        date not null default current_date,
  due_date         date,
  status           text not null default 'draft'
                     check (status in ('draft', 'posted', 'void')),
  currency         text not null references public.currencies(code),
  fx_rate          numeric(18, 8) not null default 1 check (fx_rate > 0),
  subtotal         numeric(18, 4) not null default 0,
  tax_total        numeric(18, 4) not null default 0,
  total            numeric(18, 4) not null default 0,
  amount_paid      numeric(18, 4) not null default 0,
  notes            text,
  journal_entry_id uuid references public.journal_entries(id),
  posted_at        timestamptz,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, bill_number)
);
create index idx_bills_company on public.purchase_bills(company_id, bill_date desc);
create index idx_bills_supplier on public.purchase_bills(supplier_id);
create trigger trg_bills_updated_at
  before update on public.purchase_bills
  for each row execute function public.set_updated_at();

create table public.purchase_bill_lines (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  bill_id            uuid not null references public.purchase_bills(id) on delete cascade,
  line_no            integer not null default 1,
  item_id            uuid references public.items(id),
  description        text,
  quantity           numeric(18, 4) not null default 1,
  unit_cost          numeric(18, 4) not null default 0,
  tax_rate_id        uuid references public.tax_rates(id),
  tax_rate           numeric(9, 6) not null default 0,
  line_subtotal      numeric(18, 4) not null default 0,
  tax_amount         numeric(18, 4) not null default 0,
  line_total         numeric(18, 4) not null default 0,
  expense_account_id uuid references public.accounts(id)
);
create index idx_bill_lines_bill on public.purchase_bill_lines(bill_id);

-- --- payments (settle invoices / bills) -------------------------------------
create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  company_id         uuid not null references public.companies(id) on delete cascade,
  party_type         text not null check (party_type in ('customer', 'supplier')),
  customer_id        uuid references public.customers(id),
  supplier_id        uuid references public.suppliers(id),
  payment_date       date not null default current_date,
  amount             numeric(18, 4) not null check (amount > 0),
  currency           text not null references public.currencies(code),
  method             text,
  deposit_account_id uuid not null references public.accounts(id),  -- cash/bank
  reference          text,
  journal_entry_id   uuid references public.journal_entries(id),
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  check ((party_type = 'customer' and customer_id is not null)
      or (party_type = 'supplier' and supplier_id is not null))
);
create index idx_payments_company on public.payments(company_id, payment_date desc);

create table public.payment_allocations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id      uuid not null references public.payments(id) on delete cascade,
  invoice_id      uuid references public.sales_invoices(id),
  bill_id         uuid references public.purchase_bills(id),
  amount          numeric(18, 4) not null check (amount > 0),
  check (num_nonnulls(invoice_id, bill_id) = 1)
);
create index idx_alloc_payment on public.payment_allocations(payment_id);

-- --- RLS: standard org-scoped policy set on every new table -----------------
select public._apply_org_policies('public.tax_rates');
select public._apply_org_policies('public.sales_invoices');
select public._apply_org_policies('public.sales_invoice_lines');
select public._apply_org_policies('public.purchase_bills');
select public._apply_org_policies('public.purchase_bill_lines');
select public._apply_org_policies('public.payments');
select public._apply_org_policies('public.payment_allocations');

-- ==== 0008_posting_rpc.sql ====
-- ===========================================================================
-- 0008_posting_rpc — the posting engine. Posting a document is a single atomic
-- transaction that (a) moves inventory and (b) writes a balanced journal entry.
--
--   post_purchase_bill  → Dr Inventory/Expense + Dr Input Tax, Cr A/P; stock in
--   post_sales_invoice  → Dr A/R, Cr Revenue + Cr Tax; and Dr COGS, Cr Inventory
--                          for stocked items (issued at moving-average cost)
--   record_payment      → customer: Dr Bank, Cr A/R;  supplier: Dr A/P, Cr Bank
--                          plus allocations that mark invoices/bills paid
--
-- All are SECURITY DEFINER (they write the ledger, which is otherwise guarded)
-- and re-check user_can_write() so the API's auth still gates them.
-- ===========================================================================

-- default-account lookup by code
create or replace function public._acct(p_company uuid, p_code text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.accounts where company_id = p_company and code = p_code;
$$;

-- Apply a signed stock change at one location and record the movement, WITHOUT
-- posting its own journal (the caller owns the journal). Returns the monetary
-- value of the movement: qty*unit_cost for receipts, qty*avg_cost for issues.
create or replace function public._apply_stock(
  p_org uuid, p_company uuid, p_item uuid, p_loc uuid,
  p_qty numeric, p_unit_cost numeric, p_type text,
  p_ref text, p_supplier uuid, p_customer uuid, p_journal uuid
) returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_level  public.inventory_levels%rowtype;
  v_newqty numeric;
  v_newavg numeric;
  v_amount numeric;
begin
  if p_loc is null then
    raise exception 'A stock location is required to move inventory for item %', p_item;
  end if;

  select * into v_level from public.inventory_levels
    where item_id = p_item and location_id = p_loc for update;
  if not found then
    insert into public.inventory_levels (organization_id, item_id, location_id)
      values (p_org, p_item, p_loc) returning * into v_level;
  end if;

  v_newqty := v_level.quantity_on_hand + p_qty;
  if v_newqty < 0 then
    raise exception 'Insufficient stock for item %: on hand %, requested %',
      p_item, v_level.quantity_on_hand, p_qty;
  end if;

  if p_qty > 0 then
    v_newavg := case when v_newqty > 0
      then (v_level.quantity_on_hand * v_level.average_cost + p_qty * p_unit_cost) / v_newqty
      else 0 end;
    v_amount := p_qty * p_unit_cost;
  else
    v_newavg := v_level.average_cost;
    v_amount := abs(p_qty) * v_level.average_cost;
  end if;

  update public.inventory_levels
    set quantity_on_hand = v_newqty, average_cost = v_newavg, updated_at = now()
    where id = v_level.id;

  insert into public.inventory_movements
    (organization_id, company_id, item_id, location_id, movement_type, quantity,
     unit_cost, reference, supplier_id, customer_id, journal_entry_id, created_by)
    values (p_org, p_company, p_item, p_loc, p_type, p_qty,
            case when p_qty > 0 then p_unit_cost else v_level.average_cost end,
            p_ref, p_supplier, p_customer, p_journal, auth.uid());

  return v_amount;
end;
$$;

-- --- POST a purchase bill ---------------------------------------------------
create or replace function public.post_purchase_bill(p_bill_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  b public.purchase_bills%rowtype;
  l public.purchase_bill_lines%rowtype;
  v_loc uuid;
  v_ap uuid;
  v_dr_acct uuid;
  v_entry uuid;
begin
  select * into b from public.purchase_bills where id = p_bill_id for update;
  if not found then raise exception 'Bill % not found', p_bill_id; end if;
  if not public.user_can_write(b.organization_id) then
    raise exception 'Not authorized'; end if;
  if b.status <> 'draft' then
    raise exception 'Bill % is already %', b.bill_number, b.status; end if;

  v_loc := coalesce(b.location_id,
    (select id from public.locations where company_id = b.company_id and is_active order by created_at limit 1));
  v_ap := coalesce((select payable_account_id from public.suppliers where id = b.supplier_id),
                   public._acct(b.company_id, '2000'));

  insert into public.journal_entries
    (organization_id, company_id, entry_date, memo, reference, status, source_type, source_id, created_by)
    values (b.organization_id, b.company_id, b.bill_date,
            'Bill ' || b.bill_number, b.bill_number, 'draft', 'purchase_bill', b.id, auth.uid())
    returning id into v_entry;

  for l in select * from public.purchase_bill_lines where bill_id = b.id order by line_no loop
    if l.item_id is not null and (select track_inventory from public.items where id = l.item_id) then
      -- stocked item: value goes to the inventory asset account, quantity in
      perform public._apply_stock(b.organization_id, b.company_id, l.item_id, v_loc,
                l.quantity, l.unit_cost, 'purchase', b.bill_number, b.supplier_id, null, v_entry);
      v_dr_acct := coalesce((select inventory_account_id from public.items where id = l.item_id),
                            public._acct(b.company_id, '1300'));
    else
      -- service / expense line
      v_dr_acct := coalesce(l.expense_account_id,
                            (select expense_account_id from public.items where id = l.item_id),
                            public._acct(b.company_id, '6000'));
    end if;
    insert into public.journal_lines
      (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (b.organization_id, v_entry, v_dr_acct, coalesce(l.description, 'Bill line'),
              b.currency, l.line_subtotal, l.line_subtotal * b.fx_rate);
  end loop;

  if b.tax_total > 0 then
    insert into public.journal_lines
      (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (b.organization_id, v_entry, public._acct(b.company_id, '2100'),
              'Input tax', b.currency, b.tax_total, b.tax_total * b.fx_rate);
  end if;

  insert into public.journal_lines
    (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
    values (b.organization_id, v_entry, v_ap, 'Accounts payable',
            b.currency, b.total, b.total * b.fx_rate);

  update public.journal_entries set status = 'posted' where id = v_entry;
  update public.purchase_bills
    set status = 'posted', journal_entry_id = v_entry, posted_at = now() where id = b.id;
  return v_entry;
end;
$$;

-- --- POST a sales invoice ---------------------------------------------------
create or replace function public.post_sales_invoice(p_invoice_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv public.sales_invoices%rowtype;
  l public.sales_invoice_lines%rowtype;
  v_loc uuid;
  v_ar uuid;
  v_rev uuid;
  v_cogs_acct uuid;
  v_inv_acct uuid;
  v_cost numeric;
  v_entry uuid;
begin
  select * into inv from public.sales_invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice % not found', p_invoice_id; end if;
  if not public.user_can_write(inv.organization_id) then
    raise exception 'Not authorized'; end if;
  if inv.status <> 'draft' then
    raise exception 'Invoice % is already %', inv.invoice_number, inv.status; end if;

  v_loc := coalesce(inv.location_id,
    (select id from public.locations where company_id = inv.company_id and is_active order by created_at limit 1));
  v_ar := coalesce((select receivable_account_id from public.customers where id = inv.customer_id),
                   public._acct(inv.company_id, '1200'));

  insert into public.journal_entries
    (organization_id, company_id, entry_date, memo, reference, status, source_type, source_id, created_by)
    values (inv.organization_id, inv.company_id, inv.invoice_date,
            'Invoice ' || inv.invoice_number, inv.invoice_number, 'draft', 'sales_invoice', inv.id, auth.uid())
    returning id into v_entry;

  -- Dr Accounts Receivable for the gross total
  insert into public.journal_lines
    (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
    values (inv.organization_id, v_entry, v_ar, 'Accounts receivable',
            inv.currency, inv.total, inv.total * inv.fx_rate);

  -- Cr Revenue per line; Dr COGS / Cr Inventory for stocked items
  for l in select * from public.sales_invoice_lines where invoice_id = inv.id order by line_no loop
    v_rev := coalesce(l.income_account_id,
                      (select income_account_id from public.items where id = l.item_id),
                      public._acct(inv.company_id, '4000'));
    insert into public.journal_lines
      (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (inv.organization_id, v_entry, v_rev, coalesce(l.description, 'Sales'),
              inv.currency, l.line_subtotal, l.line_subtotal * inv.fx_rate);

    if l.item_id is not null and (select track_inventory from public.items where id = l.item_id) then
      v_cost := public._apply_stock(inv.organization_id, inv.company_id, l.item_id, v_loc,
                  -l.quantity, 0, 'sale', inv.invoice_number, null, inv.customer_id, v_entry);
      if v_cost > 0 then
        v_cogs_acct := coalesce((select expense_account_id from public.items where id = l.item_id),
                                public._acct(inv.company_id, '5000'));
        v_inv_acct := coalesce((select inventory_account_id from public.items where id = l.item_id),
                               public._acct(inv.company_id, '1300'));
        insert into public.journal_lines
          (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
          values (inv.organization_id, v_entry, v_cogs_acct, 'Cost of goods sold',
                  inv.currency, v_cost, v_cost * inv.fx_rate);
        insert into public.journal_lines
          (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
          values (inv.organization_id, v_entry, v_inv_acct, 'Inventory issued',
                  inv.currency, v_cost, v_cost * inv.fx_rate);
      end if;
    end if;
  end loop;

  if inv.tax_total > 0 then
    insert into public.journal_lines
      (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (inv.organization_id, v_entry, public._acct(inv.company_id, '2100'),
              'Sales tax payable', inv.currency, inv.tax_total, inv.tax_total * inv.fx_rate);
  end if;

  update public.journal_entries set status = 'posted' where id = v_entry;
  update public.sales_invoices
    set status = 'posted', journal_entry_id = v_entry, posted_at = now() where id = inv.id;
  return v_entry;
end;
$$;

-- --- record a payment and allocate it to documents -------------------------
create or replace function public.record_payment(
  p_company uuid, p_party_type text, p_party_id uuid, p_date date,
  p_amount numeric, p_currency text, p_method text, p_deposit_account uuid,
  p_reference text, p_allocations jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_ctrl uuid;   -- AR (customer) or AP (supplier) control account
  v_entry uuid;
  v_payment uuid;
  a jsonb;
  v_doc uuid;
  v_alloc numeric;
begin
  select organization_id into v_org from public.companies where id = p_company;
  if v_org is null then raise exception 'Company % not found', p_company; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;

  insert into public.payments
    (organization_id, company_id, party_type, customer_id, supplier_id, payment_date,
     amount, currency, method, deposit_account_id, reference, created_by)
    values (v_org, p_company, p_party_type,
            case when p_party_type = 'customer' then p_party_id end,
            case when p_party_type = 'supplier' then p_party_id end,
            p_date, p_amount, p_currency, p_method, p_deposit_account, p_reference, auth.uid())
    returning id into v_payment;

  insert into public.journal_entries
    (organization_id, company_id, entry_date, memo, status, source_type, source_id, created_by)
    values (v_org, p_company, p_date,
            initcap(p_party_type) || ' payment', 'draft', 'payment', v_payment, auth.uid())
    returning id into v_entry;

  if p_party_type = 'customer' then
    v_ctrl := coalesce((select receivable_account_id from public.customers where id = p_party_id),
                       public._acct(p_company, '1200'));
    -- Dr Bank/Cash, Cr Accounts Receivable
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, p_deposit_account, 'Payment received', p_currency, p_amount, p_amount);
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (v_org, v_entry, v_ctrl, 'Accounts receivable', p_currency, p_amount, p_amount);
  else
    v_ctrl := coalesce((select payable_account_id from public.suppliers where id = p_party_id),
                       public._acct(p_company, '2000'));
    -- Dr Accounts Payable, Cr Bank/Cash
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, v_ctrl, 'Accounts payable', p_currency, p_amount, p_amount);
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (v_org, v_entry, p_deposit_account, 'Payment made', p_currency, p_amount, p_amount);
  end if;

  update public.journal_entries set status = 'posted' where id = v_entry;
  update public.payments set journal_entry_id = v_entry where id = v_payment;

  -- allocate against invoices / bills
  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_alloc := (a->>'amount')::numeric;
    if p_party_type = 'customer' then
      v_doc := (a->>'invoice_id')::uuid;
      insert into public.payment_allocations (organization_id, payment_id, invoice_id, amount)
        values (v_org, v_payment, v_doc, v_alloc);
      update public.sales_invoices set amount_paid = amount_paid + v_alloc where id = v_doc;
    else
      v_doc := (a->>'bill_id')::uuid;
      insert into public.payment_allocations (organization_id, payment_id, bill_id, amount)
        values (v_org, v_payment, v_doc, v_alloc);
      update public.purchase_bills set amount_paid = amount_paid + v_alloc where id = v_doc;
    end if;
  end loop;

  return v_payment;
end;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;

-- ==== 0009_reports.sql ====
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

-- ==== 0010_orders_returns.sql ====
-- ===========================================================================
-- 0010_orders_returns — orders workflow (quotes/POs that don't touch the ledger
-- until converted) and returns (credit/debit notes that reverse stock + ledger).
--
--   sales_orders  → convert to a sales_invoice
--   purchase_orders → convert to a purchase_bill
--   credit_notes  → sales returns: money back to customer, stock back in
--   debit_notes   → purchase returns: money back from supplier, stock back out
-- ===========================================================================

-- --- sales orders -----------------------------------------------------------
create table public.sales_orders (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete cascade,
  customer_id      uuid not null references public.customers(id),
  location_id      uuid references public.locations(id),
  order_number     text not null,
  order_date       date not null default current_date,
  expected_date    date,
  status           text not null default 'open'
                     check (status in ('draft', 'open', 'invoiced', 'cancelled')),
  currency         text not null references public.currencies(code),
  fx_rate          numeric(18, 8) not null default 1,
  subtotal         numeric(18, 4) not null default 0,
  tax_total        numeric(18, 4) not null default 0,
  total            numeric(18, 4) not null default 0,
  notes            text,
  invoice_id       uuid references public.sales_invoices(id),
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, order_number)
);
create index idx_so_company on public.sales_orders(company_id, order_date desc);
create trigger trg_so_updated before update on public.sales_orders
  for each row execute function public.set_updated_at();

create table public.sales_order_lines (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  order_id          uuid not null references public.sales_orders(id) on delete cascade,
  line_no           integer not null default 1,
  item_id           uuid references public.items(id),
  description       text,
  quantity          numeric(18, 4) not null default 1,
  unit_price        numeric(18, 4) not null default 0,
  tax_rate_id       uuid references public.tax_rates(id),
  tax_rate          numeric(9, 6) not null default 0,
  line_subtotal     numeric(18, 4) not null default 0,
  tax_amount        numeric(18, 4) not null default 0,
  line_total        numeric(18, 4) not null default 0,
  income_account_id uuid references public.accounts(id)
);
create index idx_so_lines on public.sales_order_lines(order_id);

-- --- purchase orders --------------------------------------------------------
create table public.purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete cascade,
  supplier_id      uuid not null references public.suppliers(id),
  location_id      uuid references public.locations(id),
  order_number     text not null,
  order_date       date not null default current_date,
  expected_date    date,
  status           text not null default 'open'
                     check (status in ('draft', 'open', 'billed', 'cancelled')),
  currency         text not null references public.currencies(code),
  fx_rate          numeric(18, 8) not null default 1,
  subtotal         numeric(18, 4) not null default 0,
  tax_total        numeric(18, 4) not null default 0,
  total            numeric(18, 4) not null default 0,
  notes            text,
  bill_id          uuid references public.purchase_bills(id),
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, order_number)
);
create index idx_po_company on public.purchase_orders(company_id, order_date desc);
create trigger trg_po_updated before update on public.purchase_orders
  for each row execute function public.set_updated_at();

create table public.purchase_order_lines (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  order_id           uuid not null references public.purchase_orders(id) on delete cascade,
  line_no            integer not null default 1,
  item_id            uuid references public.items(id),
  description        text,
  quantity           numeric(18, 4) not null default 1,
  unit_cost          numeric(18, 4) not null default 0,
  tax_rate_id        uuid references public.tax_rates(id),
  tax_rate           numeric(9, 6) not null default 0,
  line_subtotal      numeric(18, 4) not null default 0,
  tax_amount         numeric(18, 4) not null default 0,
  line_total         numeric(18, 4) not null default 0,
  expense_account_id uuid references public.accounts(id)
);
create index idx_po_lines on public.purchase_order_lines(order_id);

-- --- credit notes (sales returns) -------------------------------------------
create table public.credit_notes (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  company_id        uuid not null references public.companies(id) on delete cascade,
  customer_id       uuid not null references public.customers(id),
  location_id       uuid references public.locations(id),
  invoice_id        uuid references public.sales_invoices(id),
  note_number       text not null,
  note_date         date not null default current_date,
  status            text not null default 'draft' check (status in ('draft', 'posted', 'void')),
  restock           boolean not null default true,
  currency          text not null references public.currencies(code),
  fx_rate           numeric(18, 8) not null default 1,
  subtotal          numeric(18, 4) not null default 0,
  tax_total         numeric(18, 4) not null default 0,
  total             numeric(18, 4) not null default 0,
  notes             text,
  journal_entry_id  uuid references public.journal_entries(id),
  posted_at         timestamptz,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  unique (company_id, note_number)
);
create index idx_cn_company on public.credit_notes(company_id, note_date desc);

create table public.credit_note_lines (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  note_id           uuid not null references public.credit_notes(id) on delete cascade,
  line_no           integer not null default 1,
  item_id           uuid references public.items(id),
  description       text,
  quantity          numeric(18, 4) not null default 1,
  unit_price        numeric(18, 4) not null default 0,
  tax_rate          numeric(9, 6) not null default 0,
  line_subtotal     numeric(18, 4) not null default 0,
  tax_amount        numeric(18, 4) not null default 0,
  line_total        numeric(18, 4) not null default 0,
  income_account_id uuid references public.accounts(id)
);
create index idx_cn_lines on public.credit_note_lines(note_id);

-- --- debit notes (purchase returns) -----------------------------------------
create table public.debit_notes (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  company_id        uuid not null references public.companies(id) on delete cascade,
  supplier_id       uuid not null references public.suppliers(id),
  location_id       uuid references public.locations(id),
  bill_id           uuid references public.purchase_bills(id),
  note_number       text not null,
  note_date         date not null default current_date,
  status            text not null default 'draft' check (status in ('draft', 'posted', 'void')),
  restock           boolean not null default true,
  currency          text not null references public.currencies(code),
  fx_rate           numeric(18, 8) not null default 1,
  subtotal          numeric(18, 4) not null default 0,
  tax_total         numeric(18, 4) not null default 0,
  total             numeric(18, 4) not null default 0,
  notes             text,
  journal_entry_id  uuid references public.journal_entries(id),
  posted_at         timestamptz,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  unique (company_id, note_number)
);
create index idx_dn_company on public.debit_notes(company_id, note_date desc);

create table public.debit_note_lines (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  note_id            uuid not null references public.debit_notes(id) on delete cascade,
  line_no            integer not null default 1,
  item_id            uuid references public.items(id),
  description        text,
  quantity           numeric(18, 4) not null default 1,
  unit_cost          numeric(18, 4) not null default 0,
  tax_rate           numeric(9, 6) not null default 0,
  line_subtotal      numeric(18, 4) not null default 0,
  tax_amount         numeric(18, 4) not null default 0,
  line_total         numeric(18, 4) not null default 0,
  expense_account_id uuid references public.accounts(id)
);
create index idx_dn_lines on public.debit_note_lines(note_id);

-- --- RLS --------------------------------------------------------------------
select public._apply_org_policies('public.sales_orders');
select public._apply_org_policies('public.sales_order_lines');
select public._apply_org_policies('public.purchase_orders');
select public._apply_org_policies('public.purchase_order_lines');
select public._apply_org_policies('public.credit_notes');
select public._apply_org_policies('public.credit_note_lines');
select public._apply_org_policies('public.debit_notes');
select public._apply_org_policies('public.debit_note_lines');

-- ==== 0011_advanced_rpc.sql ====
-- ===========================================================================
-- 0011_advanced_rpc — inventory ops, returns posting, document reversal and the
-- reporting functions behind the accountant/trader features.
-- ===========================================================================

-- Re-create the tenant bootstrap so new companies get a default warehouse.
create or replace function public.create_organization(
  p_name text, p_slug text, p_company_name text, p_base_currency text default 'USD'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_org uuid; v_company uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
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

create or replace function public._avg(p_item uuid, p_loc uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select average_cost from public.inventory_levels
                   where item_id = p_item and location_id = p_loc), 0);
$$;

-- --- stock transfer between two locations (no ledger impact) -----------------
create or replace function public.transfer_stock(
  p_item uuid, p_from uuid, p_to uuid, p_qty numeric, p_ref text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_company uuid; v_cost numeric;
begin
  select organization_id, company_id into v_org, v_company from public.items where id = p_item;
  if v_org is null then raise exception 'Item not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if p_qty <= 0 then raise exception 'Transfer quantity must be positive'; end if;
  if p_from = p_to then raise exception 'Source and destination must differ'; end if;

  v_cost := public._avg(p_item, p_from);
  perform public._apply_stock(v_org, v_company, p_item, p_from, -p_qty, v_cost, 'transfer_out', p_ref, null, null, null);
  perform public._apply_stock(v_org, v_company, p_item, p_to, p_qty, v_cost, 'transfer_in', p_ref, null, null, null);
  return jsonb_build_object('ok', true);
end;
$$;

-- --- stock adjustment / write-off (posts to Inventory Adjustments) ----------
create or replace function public.adjust_stock(
  p_item uuid, p_loc uuid, p_qty_delta numeric, p_reason text default null, p_unit_cost numeric default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_company uuid; v_inv uuid; v_adj uuid; v_cost numeric; v_amount numeric; v_entry uuid;
begin
  select organization_id, company_id, coalesce(inventory_account_id, public._acct(company_id, '1300'))
    into v_org, v_company, v_inv from public.items where id = p_item;
  if v_org is null then raise exception 'Item not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if p_qty_delta = 0 then raise exception 'Adjustment must be non-zero'; end if;

  v_adj := public._acct(v_company, '5100');
  v_cost := coalesce(p_unit_cost, public._avg(p_item, p_loc));

  insert into public.journal_entries (organization_id, company_id, entry_date, memo, status, source_type, created_by)
    values (v_org, v_company, current_date, coalesce('Stock adjustment: ' || p_reason, 'Stock adjustment'),
            'draft', 'adjustment', auth.uid()) returning id into v_entry;

  v_amount := public._apply_stock(v_org, v_company, p_item, p_loc, p_qty_delta, v_cost, 'adjustment', p_reason, null, null, v_entry);

  if p_qty_delta > 0 then  -- stock found: Dr Inventory, Cr Adjustments
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, v_inv, 'Stock increase', (select base_currency from companies where id=v_company), v_amount, v_amount);
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (v_org, v_entry, v_adj, 'Adjustment', (select base_currency from companies where id=v_company), v_amount, v_amount);
  else  -- write-off: Dr Adjustments (expense), Cr Inventory
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, v_adj, 'Write-off', (select base_currency from companies where id=v_company), v_amount, v_amount);
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (v_org, v_entry, v_inv, 'Stock decrease', (select base_currency from companies where id=v_company), v_amount, v_amount);
  end if;
  update public.journal_entries set status = 'posted' where id = v_entry;
  return jsonb_build_object('journal_entry_id', v_entry, 'amount', v_amount);
end;
$$;

-- --- post a credit note (sales return) --------------------------------------
create or replace function public.post_credit_note(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  n public.credit_notes%rowtype; l public.credit_note_lines%rowtype;
  v_loc uuid; v_ar uuid; v_rev uuid; v_cogs uuid; v_inv uuid; v_cost numeric; v_avg numeric; v_entry uuid;
begin
  select * into n from public.credit_notes where id = p_id for update;
  if not found then raise exception 'Credit note not found'; end if;
  if not public.user_can_write(n.organization_id) then raise exception 'Not authorized'; end if;
  if n.status <> 'draft' then raise exception 'Credit note already %', n.status; end if;

  v_loc := coalesce(n.location_id, (select id from public.locations where company_id=n.company_id and is_active order by created_at limit 1));
  v_ar := coalesce((select receivable_account_id from public.customers where id=n.customer_id), public._acct(n.company_id,'1200'));

  insert into public.journal_entries (organization_id, company_id, entry_date, memo, reference, status, source_type, source_id, created_by)
    values (n.organization_id, n.company_id, n.note_date, 'Credit note '||n.note_number, n.note_number, 'draft', 'credit_note', n.id, auth.uid())
    returning id into v_entry;

  -- reverse revenue: Dr Revenue subtotal per line; Cr A/R total
  for l in select * from public.credit_note_lines where note_id = n.id order by line_no loop
    v_rev := coalesce(l.income_account_id, (select income_account_id from public.items where id=l.item_id), public._acct(n.company_id,'4000'));
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (n.organization_id, v_entry, v_rev, 'Sales return', n.currency, l.line_subtotal, l.line_subtotal*n.fx_rate);
    if n.restock and l.item_id is not null and (select track_inventory from public.items where id=l.item_id) then
      v_avg := public._avg(l.item_id, v_loc);
      v_cost := public._apply_stock(n.organization_id, n.company_id, l.item_id, v_loc, l.quantity, v_avg, 'adjustment', 'return '||n.note_number, null, n.customer_id, v_entry);
      if v_cost > 0 then
        v_inv := coalesce((select inventory_account_id from public.items where id=l.item_id), public._acct(n.company_id,'1300'));
        v_cogs := coalesce((select expense_account_id from public.items where id=l.item_id), public._acct(n.company_id,'5000'));
        insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
          values (n.organization_id, v_entry, v_inv, 'Inventory returned', n.currency, v_cost, v_cost*n.fx_rate);
        insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
          values (n.organization_id, v_entry, v_cogs, 'COGS reversed', n.currency, v_cost, v_cost*n.fx_rate);
      end if;
    end if;
  end loop;

  if n.tax_total > 0 then
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (n.organization_id, v_entry, public._acct(n.company_id,'2100'), 'Tax reversed', n.currency, n.tax_total, n.tax_total*n.fx_rate);
  end if;
  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
    values (n.organization_id, v_entry, v_ar, 'Accounts receivable', n.currency, n.total, n.total*n.fx_rate);

  update public.journal_entries set status='posted' where id=v_entry;
  update public.credit_notes set status='posted', journal_entry_id=v_entry, posted_at=now() where id=n.id;
  return v_entry;
end;
$$;

-- --- post a debit note (purchase return) ------------------------------------
create or replace function public.post_debit_note(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  n public.debit_notes%rowtype; l public.debit_note_lines%rowtype;
  v_loc uuid; v_ap uuid; v_inv uuid; v_exp uuid; v_avg numeric; v_amt numeric; v_entry uuid;
  v_inv_credit numeric := 0; v_variance numeric;
begin
  select * into n from public.debit_notes where id = p_id for update;
  if not found then raise exception 'Debit note not found'; end if;
  if not public.user_can_write(n.organization_id) then raise exception 'Not authorized'; end if;
  if n.status <> 'draft' then raise exception 'Debit note already %', n.status; end if;

  v_loc := coalesce(n.location_id, (select id from public.locations where company_id=n.company_id and is_active order by created_at limit 1));
  v_ap := coalesce((select payable_account_id from public.suppliers where id=n.supplier_id), public._acct(n.company_id,'2000'));

  insert into public.journal_entries (organization_id, company_id, entry_date, memo, reference, status, source_type, source_id, created_by)
    values (n.organization_id, n.company_id, n.note_date, 'Debit note '||n.note_number, n.note_number, 'draft', 'debit_note', n.id, auth.uid())
    returning id into v_entry;

  -- Dr Accounts Payable for the gross total
  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
    values (n.organization_id, v_entry, v_ap, 'Accounts payable', n.currency, n.total, n.total*n.fx_rate);

  for l in select * from public.debit_note_lines where note_id = n.id order by line_no loop
    if n.restock and l.item_id is not null and (select track_inventory from public.items where id=l.item_id) then
      v_avg := public._avg(l.item_id, v_loc);
      v_amt := public._apply_stock(n.organization_id, n.company_id, l.item_id, v_loc, -l.quantity, v_avg, 'adjustment', 'return '||n.note_number, n.supplier_id, null, v_entry);
      v_inv := coalesce((select inventory_account_id from public.items where id=l.item_id), public._acct(n.company_id,'1300'));
      insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
        values (n.organization_id, v_entry, v_inv, 'Inventory returned', n.currency, v_amt, v_amt*n.fx_rate);
      v_inv_credit := v_inv_credit + l.line_subtotal - v_amt;  -- price variance vs avg cost
    else
      v_exp := coalesce(l.expense_account_id, (select expense_account_id from public.items where id=l.item_id), public._acct(n.company_id,'6000'));
      insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
        values (n.organization_id, v_entry, v_exp, 'Expense returned', n.currency, l.line_subtotal, l.line_subtotal*n.fx_rate);
    end if;
  end loop;

  if n.tax_total > 0 then
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (n.organization_id, v_entry, public._acct(n.company_id,'2100'), 'Tax reversed', n.currency, n.tax_total, n.tax_total*n.fx_rate);
  end if;
  -- purchase price variance (subtotal vs avg cost) balances the entry
  v_variance := round(v_inv_credit, 4);
  if v_variance <> 0 then
    if v_variance > 0 then
      insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
        values (n.organization_id, v_entry, public._acct(n.company_id,'5100'), 'Purchase price variance', n.currency, v_variance, v_variance*n.fx_rate);
    else
      insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
        values (n.organization_id, v_entry, public._acct(n.company_id,'5100'), 'Purchase price variance', n.currency, -v_variance, -v_variance*n.fx_rate);
    end if;
  end if;

  update public.journal_entries set status='posted' where id=v_entry;
  update public.debit_notes set status='posted', journal_entry_id=v_entry, posted_at=now() where id=n.id;
  return v_entry;
end;
$$;

-- --- reverse / void a posted document ---------------------------------------
-- Creates a mirror journal entry (debits<->credits) and opposite stock moves,
-- then marks the source document void. p_type: 'invoice' | 'bill' | 'payment'.
create or replace function public.reverse_document(p_type text, p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_company uuid; v_orig uuid; v_entry uuid; jl record; mv record; v_paid numeric;
begin
  if p_type = 'invoice' then
    select organization_id, company_id, journal_entry_id, amount_paid into v_org, v_company, v_orig, v_paid
      from public.sales_invoices where id = p_id for update;
    if coalesce(v_paid,0) > 0 then raise exception 'Reverse the payments before voiding this invoice'; end if;
  elsif p_type = 'bill' then
    select organization_id, company_id, journal_entry_id, amount_paid into v_org, v_company, v_orig, v_paid
      from public.purchase_bills where id = p_id for update;
    if coalesce(v_paid,0) > 0 then raise exception 'Reverse the payments before voiding this bill'; end if;
  elsif p_type = 'payment' then
    select organization_id, company_id, journal_entry_id into v_org, v_company, v_orig
      from public.payments where id = p_id for update;
  else
    raise exception 'Unsupported document type %', p_type;
  end if;

  if v_org is null then raise exception 'Document not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if v_orig is null then raise exception 'Document is not posted'; end if;

  insert into public.journal_entries (organization_id, company_id, entry_date, memo, status, source_type, source_id, created_by)
    values (v_org, v_company, current_date, 'Reversal of '||p_type, 'draft', p_type||'_reversal', p_id, auth.uid())
    returning id into v_entry;

  -- mirror each line with debit/credit swapped
  for jl in select * from public.journal_lines where journal_entry_id = v_orig loop
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, fx_rate,
      debit, credit, base_debit, base_credit)
      values (v_org, v_entry, jl.account_id, 'Reversal', jl.currency, jl.fx_rate,
              jl.credit, jl.debit, jl.base_credit, jl.base_debit);
  end loop;

  -- reverse any stock movements from the original entry
  for mv in select * from public.inventory_movements where journal_entry_id = v_orig loop
    perform public._apply_stock(v_org, v_company, mv.item_id, mv.location_id, -mv.quantity, mv.unit_cost,
              'adjustment', 'reversal', mv.supplier_id, mv.customer_id, v_entry);
  end loop;

  update public.journal_entries set status='posted' where id=v_entry;

  if p_type = 'invoice' then update public.sales_invoices set status='void' where id=p_id;
  elsif p_type = 'bill' then update public.purchase_bills set status='void' where id=p_id;
  elsif p_type = 'payment' then
    -- unwind allocations
    update public.sales_invoices i set amount_paid = amount_paid - a.amount
      from public.payment_allocations a where a.payment_id = p_id and a.invoice_id = i.id;
    update public.purchase_bills b set amount_paid = amount_paid - a.amount
      from public.payment_allocations a where a.payment_id = p_id and a.bill_id = b.id;
  end if;
  return v_entry;
end;
$$;

-- =============================== REPORTS ===================================

create or replace function public.report_inventory_valuation(p_company uuid)
returns table (item_id uuid, sku text, name text, quantity numeric, average_cost numeric, value numeric)
language sql stable security definer set search_path = public as $$
  select i.id, i.sku, i.name,
         coalesce(sum(lv.quantity_on_hand), 0),
         case when coalesce(sum(lv.quantity_on_hand),0) > 0
              then round(sum(lv.quantity_on_hand*lv.average_cost)/sum(lv.quantity_on_hand), 4) else 0 end,
         coalesce(round(sum(lv.quantity_on_hand*lv.average_cost), 2), 0)
  from public.items i
  left join public.inventory_levels lv on lv.item_id = i.id
  where i.company_id = p_company and i.track_inventory
    and i.organization_id in (select public.user_org_ids())
  group by i.id, i.sku, i.name order by i.name;
$$;

create or replace function public.report_low_stock(p_company uuid)
returns table (item_id uuid, sku text, name text, on_hand numeric, reorder_point numeric)
language sql stable security definer set search_path = public as $$
  select i.id, i.sku, i.name, coalesce(sum(lv.quantity_on_hand),0), i.reorder_point
  from public.items i
  left join public.inventory_levels lv on lv.item_id = i.id
  where i.company_id = p_company and i.track_inventory and coalesce(i.reorder_point,0) > 0
    and i.organization_id in (select public.user_org_ids())
  group by i.id, i.sku, i.name, i.reorder_point
  having coalesce(sum(lv.quantity_on_hand),0) <= i.reorder_point
  order by i.name;
$$;

create or replace function public.report_general_ledger(
  p_company uuid, p_account uuid default null, p_from date default null, p_to date default null
) returns table (
  entry_date date, entry_id uuid, memo text, source_type text,
  account_id uuid, code text, name text, debit numeric, credit numeric
) language sql stable security definer set search_path = public as $$
  select e.entry_date, e.id, e.memo, e.source_type, a.id, a.code, a.name, l.base_debit, l.base_credit
  from public.journal_lines l
  join public.journal_entries e on e.id = l.journal_entry_id
  join public.accounts a on a.id = l.account_id
  where e.company_id = p_company and e.status = 'posted'
    and (p_account is null or a.id = p_account)
    and (p_from is null or e.entry_date >= p_from)
    and (p_to is null or e.entry_date <= p_to)
    and e.organization_id in (select public.user_org_ids())
  order by a.code, e.entry_date, e.id;
$$;

create or replace function public.report_customer_statement(p_company uuid, p_customer uuid)
returns table (txn_date date, doc_type text, reference text, charge numeric, credit numeric)
language sql stable security definer set search_path = public as $$
  select invoice_date, 'invoice', invoice_number, total, 0 from public.sales_invoices
    where company_id=p_company and customer_id=p_customer and status='posted'
  union all
  select note_date, 'credit_note', note_number, 0, total from public.credit_notes
    where company_id=p_company and customer_id=p_customer and status='posted'
  union all
  select payment_date, 'payment', reference, 0, amount from public.payments
    where company_id=p_company and customer_id=p_customer
  order by 1;
$$;

create or replace function public.report_supplier_statement(p_company uuid, p_supplier uuid)
returns table (txn_date date, doc_type text, reference text, charge numeric, credit numeric)
language sql stable security definer set search_path = public as $$
  select bill_date, 'bill', bill_number, total, 0 from public.purchase_bills
    where company_id=p_company and supplier_id=p_supplier and status='posted'
  union all
  select note_date, 'debit_note', note_number, 0, total from public.debit_notes
    where company_id=p_company and supplier_id=p_supplier and status='posted'
  union all
  select payment_date, 'payment', reference, 0, amount from public.payments
    where company_id=p_company and supplier_id=p_supplier
  order by 1;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;

-- ==== 0012_expenses.sql ====
-- ===========================================================================
-- 0012_expenses — general expense tracking (rent, utilities, salaries, fees…).
-- These are operating costs NOT tied to inventory purchases. Recording one
-- posts Dr Expense (+ Dr input tax) / Cr Cash-Bank (paid) or Cr A/P (unpaid),
-- so it flows straight into the Profit & Loss and reduces net profit.
-- ===========================================================================

create table public.expenses (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  company_id          uuid not null references public.companies(id) on delete cascade,
  expense_date        date not null default current_date,
  category_account_id uuid not null references public.accounts(id),   -- an expense account
  supplier_id         uuid references public.suppliers(id),
  paid_account_id     uuid references public.accounts(id),            -- cash/bank if paid now
  payment_status      text not null default 'paid' check (payment_status in ('paid', 'unpaid')),
  amount              numeric(18, 4) not null check (amount > 0),
  tax_amount          numeric(18, 4) not null default 0 check (tax_amount >= 0),
  total               numeric(18, 4) not null default 0,
  currency            text not null references public.currencies(code),
  reference           text,
  memo                text,
  journal_entry_id    uuid references public.journal_entries(id),
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now()
);
create index idx_expenses_company on public.expenses(company_id, expense_date desc);

select public._apply_org_policies('public.expenses');

-- Record and post an expense in one atomic call.
create or replace function public.record_expense(
  p_company uuid, p_date date, p_category_account uuid, p_amount numeric,
  p_tax_amount numeric default 0, p_paid_account uuid default null,
  p_supplier uuid default null, p_reference text default null, p_memo text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_ccy text; v_total numeric; v_entry uuid; v_expense uuid; v_credit uuid; v_status text;
begin
  select organization_id, base_currency into v_org, v_ccy from public.companies where id = p_company;
  if v_org is null then raise exception 'Company % not found', p_company; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  v_total := p_amount + coalesce(p_tax_amount, 0);

  if p_paid_account is not null then
    v_credit := p_paid_account; v_status := 'paid';
  else
    v_credit := coalesce((select payable_account_id from public.suppliers where id = p_supplier),
                         public._acct(p_company, '2000'));
    v_status := 'unpaid';
  end if;

  insert into public.journal_entries (organization_id, company_id, entry_date, memo, reference, status, source_type, created_by)
    values (v_org, p_company, p_date, coalesce(p_memo, 'Expense'), p_reference, 'draft', 'expense', auth.uid())
    returning id into v_entry;

  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
    values (v_org, v_entry, p_category_account, coalesce(p_memo, 'Expense'), v_ccy, p_amount, p_amount);
  if coalesce(p_tax_amount, 0) > 0 then
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, public._acct(p_company, '2100'), 'Input tax', v_ccy, p_tax_amount, p_tax_amount);
  end if;
  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
    values (v_org, v_entry, v_credit, 'Expense payment', v_ccy, v_total, v_total);

  update public.journal_entries set status = 'posted' where id = v_entry;

  insert into public.expenses (organization_id, company_id, expense_date, category_account_id, supplier_id,
    paid_account_id, payment_status, amount, tax_amount, total, currency, reference, memo, journal_entry_id, created_by)
    values (v_org, p_company, p_date, p_category_account, p_supplier, p_paid_account, v_status,
            p_amount, coalesce(p_tax_amount,0), v_total, v_ccy, p_reference, p_memo, v_entry, auth.uid())
    returning id into v_expense;

  return v_expense;
end;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;

-- ==== 0013_ship_to.sql ====
-- ===========================================================================
-- 0013_ship_to — a per-invoice delivery ("Ship To") address, distinct from the
-- customer's billing details and from the dispatch warehouse (location_id).
-- Traders using logistics warehouses ship the same customer's orders to
-- different destinations, so this lives on the invoice, not the customer.
-- ===========================================================================

alter table public.sales_invoices
  add column if not exists ship_to_name    text,
  add column if not exists ship_to_address text,
  add column if not exists ship_to_city    text,
  add column if not exists ship_to_country text;

-- ==== 0014_company_profile_terms.sql ====
-- ===========================================================================
-- 0014_company_profile_terms — richer company profile for professional invoice
-- headers, plus reusable default Terms & Conditions / footer, and a per-invoice
-- terms override.
-- ===========================================================================

alter table public.companies
  add column if not exists address_line1  text,
  add column if not exists city           text,
  add column if not exists phone          text,
  add column if not exists email          text,
  add column if not exists tax_number     text,
  add column if not exists invoice_terms  text,
  add column if not exists invoice_footer text;

alter table public.sales_invoices
  add column if not exists terms text;

-- ==== 0015_reverse_restore.sql ====
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

-- ==== 0016_revise.sql ====
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

-- ==== 0017_statements_all.sql ====
-- ===========================================================================
-- 0017_statements_all — statements now default to ALL parties (party optional),
-- include the party name, add the missing tenant guard, and exclude reversed
-- payments. Filtering by a specific party narrows the result.
-- ===========================================================================

drop function if exists public.report_customer_statement(uuid, uuid);
create function public.report_customer_statement(p_company uuid, p_customer uuid default null)
returns table (txn_date date, party_id uuid, party_name text, doc_type text, reference text, charge numeric, credit numeric)
language sql stable security definer set search_path = public as $$
  select i.invoice_date, c.id, c.name, 'invoice', i.invoice_number, i.total, 0
    from public.sales_invoices i join public.customers c on c.id = i.customer_id
    where i.company_id = p_company and i.status = 'posted'
      and (p_customer is null or i.customer_id = p_customer)
      and i.organization_id in (select public.user_org_ids())
  union all
  select n.note_date, c.id, c.name, 'credit_note', n.note_number, 0, n.total
    from public.credit_notes n join public.customers c on c.id = n.customer_id
    where n.company_id = p_company and n.status = 'posted'
      and (p_customer is null or n.customer_id = p_customer)
      and n.organization_id in (select public.user_org_ids())
  union all
  select p.payment_date, c.id, c.name, 'payment', p.reference, 0, p.amount
    from public.payments p join public.customers c on c.id = p.customer_id
    where p.company_id = p_company and p.party_type = 'customer' and not p.reversed
      and (p_customer is null or p.customer_id = p_customer)
      and p.organization_id in (select public.user_org_ids())
  order by 3, 1;
$$;

drop function if exists public.report_supplier_statement(uuid, uuid);
create function public.report_supplier_statement(p_company uuid, p_supplier uuid default null)
returns table (txn_date date, party_id uuid, party_name text, doc_type text, reference text, charge numeric, credit numeric)
language sql stable security definer set search_path = public as $$
  select b.bill_date, s.id, s.name, 'bill', b.bill_number, b.total, 0
    from public.purchase_bills b join public.suppliers s on s.id = b.supplier_id
    where b.company_id = p_company and b.status = 'posted'
      and (p_supplier is null or b.supplier_id = p_supplier)
      and b.organization_id in (select public.user_org_ids())
  union all
  select n.note_date, s.id, s.name, 'debit_note', n.note_number, 0, n.total
    from public.debit_notes n join public.suppliers s on s.id = n.supplier_id
    where n.company_id = p_company and n.status = 'posted'
      and (p_supplier is null or n.supplier_id = p_supplier)
      and n.organization_id in (select public.user_org_ids())
  union all
  select p.payment_date, s.id, s.name, 'payment', p.reference, 0, p.amount
    from public.payments p join public.suppliers s on s.id = p.supplier_id
    where p.company_id = p_company and p.party_type = 'supplier' and not p.reversed
      and (p_supplier is null or p.supplier_id = p_supplier)
      and p.organization_id in (select public.user_org_ids())
  order by 3, 1;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;

-- ==== 0018_gl_party.sql ====
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

-- ==== 0019_posting_fixes.sql ====
-- ===========================================================================
-- 0019_posting_fixes — friendlier errors and zero-amount guards.
--   * _apply_stock: clearer "not enough stock" message (with SKU + guidance).
--   * post_credit_note / post_debit_note: skip zero-amount legs and require a
--     positive total, so a blank/zero line can't produce a one-sided journal
--     line (chk_one_sided violation).
-- ===========================================================================

create or replace function public._apply_stock(
  p_org uuid, p_company uuid, p_item uuid, p_loc uuid,
  p_qty numeric, p_unit_cost numeric, p_type text,
  p_ref text, p_supplier uuid, p_customer uuid, p_journal uuid
) returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_level  public.inventory_levels%rowtype;
  v_newqty numeric;
  v_newavg numeric;
  v_amount numeric;
  v_sku    text;
begin
  if p_loc is null then
    raise exception 'Choose a warehouse before moving stock for this item.';
  end if;

  select * into v_level from public.inventory_levels
    where item_id = p_item and location_id = p_loc for update;
  if not found then
    insert into public.inventory_levels (organization_id, item_id, location_id)
      values (p_org, p_item, p_loc) returning * into v_level;
  end if;

  v_newqty := v_level.quantity_on_hand + p_qty;
  if v_newqty < 0 then
    select sku into v_sku from public.items where id = p_item;
    raise exception 'Not enough stock for %: % on hand but % needed. Add stock (record a purchase/bill or a stock adjustment) or reduce the quantity.',
      coalesce(v_sku, 'item'), v_level.quantity_on_hand, abs(p_qty);
  end if;

  if p_qty > 0 then
    v_newavg := case when v_newqty > 0
      then (v_level.quantity_on_hand * v_level.average_cost + p_qty * p_unit_cost) / v_newqty
      else 0 end;
    v_amount := p_qty * p_unit_cost;
  else
    v_newavg := v_level.average_cost;
    v_amount := abs(p_qty) * v_level.average_cost;
  end if;

  update public.inventory_levels
    set quantity_on_hand = v_newqty, average_cost = v_newavg, updated_at = now()
    where id = v_level.id;

  insert into public.inventory_movements
    (organization_id, company_id, item_id, location_id, movement_type, quantity,
     unit_cost, reference, supplier_id, customer_id, journal_entry_id, created_by)
    values (p_org, p_company, p_item, p_loc, p_type, p_qty,
            case when p_qty > 0 then p_unit_cost else v_level.average_cost end,
            p_ref, p_supplier, p_customer, p_journal, auth.uid());

  return v_amount;
end;
$$;

-- --- credit note (sales return) with zero-amount guards ---------------------
create or replace function public.post_credit_note(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  n public.credit_notes%rowtype; l public.credit_note_lines%rowtype;
  v_loc uuid; v_ar uuid; v_rev uuid; v_cogs uuid; v_inv uuid; v_cost numeric; v_avg numeric; v_entry uuid;
begin
  select * into n from public.credit_notes where id = p_id for update;
  if not found then raise exception 'Credit note not found'; end if;
  if not public.user_can_write(n.organization_id) then raise exception 'Not authorized'; end if;
  if n.status <> 'draft' then raise exception 'Credit note is already %', n.status; end if;
  if coalesce(n.total, 0) <= 0 then
    raise exception 'This credit note has no amount. Add at least one line with a quantity and price before posting.';
  end if;

  v_loc := coalesce(n.location_id, (select id from public.locations where company_id=n.company_id and is_active order by created_at limit 1));
  v_ar := coalesce((select receivable_account_id from public.customers where id=n.customer_id), public._acct(n.company_id,'1200'));

  insert into public.journal_entries (organization_id, company_id, entry_date, memo, reference, status, source_type, source_id, created_by)
    values (n.organization_id, n.company_id, n.note_date, 'Credit note '||n.note_number, n.note_number, 'draft', 'credit_note', n.id, auth.uid())
    returning id into v_entry;

  for l in select * from public.credit_note_lines where note_id = n.id order by line_no loop
    if l.line_subtotal > 0 then
      v_rev := coalesce(l.income_account_id, (select income_account_id from public.items where id=l.item_id), public._acct(n.company_id,'4000'));
      insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
        values (n.organization_id, v_entry, v_rev, 'Sales return', n.currency, l.line_subtotal, l.line_subtotal*n.fx_rate);
    end if;
    if n.restock and l.item_id is not null and (select track_inventory from public.items where id=l.item_id) then
      v_avg := public._avg(l.item_id, v_loc);
      v_cost := public._apply_stock(n.organization_id, n.company_id, l.item_id, v_loc, l.quantity, v_avg, 'adjustment', 'return '||n.note_number, null, n.customer_id, v_entry);
      if v_cost > 0 then
        v_inv := coalesce((select inventory_account_id from public.items where id=l.item_id), public._acct(n.company_id,'1300'));
        v_cogs := coalesce((select expense_account_id from public.items where id=l.item_id), public._acct(n.company_id,'5000'));
        insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
          values (n.organization_id, v_entry, v_inv, 'Inventory returned', n.currency, v_cost, v_cost*n.fx_rate);
        insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
          values (n.organization_id, v_entry, v_cogs, 'COGS reversed', n.currency, v_cost, v_cost*n.fx_rate);
      end if;
    end if;
  end loop;

  if n.tax_total > 0 then
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (n.organization_id, v_entry, public._acct(n.company_id,'2100'), 'Tax reversed', n.currency, n.tax_total, n.tax_total*n.fx_rate);
  end if;
  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
    values (n.organization_id, v_entry, v_ar, 'Accounts receivable', n.currency, n.total, n.total*n.fx_rate);

  update public.journal_entries set status='posted' where id=v_entry;
  update public.credit_notes set status='posted', journal_entry_id=v_entry, posted_at=now() where id=n.id;
  return v_entry;
end;
$$;

-- --- debit note (purchase return) with zero-amount guards -------------------
create or replace function public.post_debit_note(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  n public.debit_notes%rowtype; l public.debit_note_lines%rowtype;
  v_loc uuid; v_ap uuid; v_inv uuid; v_exp uuid; v_avg numeric; v_amt numeric; v_entry uuid;
  v_inv_credit numeric := 0; v_variance numeric;
begin
  select * into n from public.debit_notes where id = p_id for update;
  if not found then raise exception 'Debit note not found'; end if;
  if not public.user_can_write(n.organization_id) then raise exception 'Not authorized'; end if;
  if n.status <> 'draft' then raise exception 'Debit note is already %', n.status; end if;
  if coalesce(n.total, 0) <= 0 then
    raise exception 'This debit note has no amount. Add at least one line with a quantity and cost before posting.';
  end if;

  v_loc := coalesce(n.location_id, (select id from public.locations where company_id=n.company_id and is_active order by created_at limit 1));
  v_ap := coalesce((select payable_account_id from public.suppliers where id=n.supplier_id), public._acct(n.company_id,'2000'));

  insert into public.journal_entries (organization_id, company_id, entry_date, memo, reference, status, source_type, source_id, created_by)
    values (n.organization_id, n.company_id, n.note_date, 'Debit note '||n.note_number, n.note_number, 'draft', 'debit_note', n.id, auth.uid())
    returning id into v_entry;

  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
    values (n.organization_id, v_entry, v_ap, 'Accounts payable', n.currency, n.total, n.total*n.fx_rate);

  for l in select * from public.debit_note_lines where note_id = n.id order by line_no loop
    if n.restock and l.item_id is not null and (select track_inventory from public.items where id=l.item_id) then
      v_avg := public._avg(l.item_id, v_loc);
      v_amt := public._apply_stock(n.organization_id, n.company_id, l.item_id, v_loc, -l.quantity, v_avg, 'adjustment', 'return '||n.note_number, n.supplier_id, null, v_entry);
      if v_amt > 0 then
        v_inv := coalesce((select inventory_account_id from public.items where id=l.item_id), public._acct(n.company_id,'1300'));
        insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
          values (n.organization_id, v_entry, v_inv, 'Inventory returned', n.currency, v_amt, v_amt*n.fx_rate);
      end if;
      v_inv_credit := v_inv_credit + l.line_subtotal - v_amt;
    elsif l.line_subtotal > 0 then
      v_exp := coalesce(l.expense_account_id, (select expense_account_id from public.items where id=l.item_id), public._acct(n.company_id,'6000'));
      insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
        values (n.organization_id, v_entry, v_exp, 'Expense returned', n.currency, l.line_subtotal, l.line_subtotal*n.fx_rate);
    end if;
  end loop;

  if n.tax_total > 0 then
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (n.organization_id, v_entry, public._acct(n.company_id,'2100'), 'Tax reversed', n.currency, n.tax_total, n.tax_total*n.fx_rate);
  end if;

  v_variance := round(v_inv_credit, 4);
  if v_variance > 0 then
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (n.organization_id, v_entry, public._acct(n.company_id,'5100'), 'Purchase price variance', n.currency, v_variance, v_variance*n.fx_rate);
  elsif v_variance < 0 then
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (n.organization_id, v_entry, public._acct(n.company_id,'5100'), 'Purchase price variance', n.currency, -v_variance, -v_variance*n.fx_rate);
  end if;

  update public.journal_entries set status='posted' where id=v_entry;
  update public.debit_notes set status='posted', journal_entry_id=v_entry, posted_at=now() where id=n.id;
  return v_entry;
end;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;

-- ==== 0020_reverse_journal.sql ====
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

-- ==== 0021_secure_record_payment.sql ====
-- ===========================================================================
-- 0021_secure_record_payment — close cross-tenant holes in record_payment.
-- The function is SECURITY DEFINER (bypasses RLS), so it must itself verify
-- that every id the caller passes (deposit account, party, and each allocated
-- invoice/bill) belongs to the caller's organization. Previously a crafted
-- request could allocate against — and mutate — another tenant's document.
-- ===========================================================================

create or replace function public.record_payment(
  p_company uuid, p_party_type text, p_party_id uuid, p_date date,
  p_amount numeric, p_currency text, p_method text, p_deposit_account uuid,
  p_reference text, p_allocations jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_ctrl uuid;
  v_entry uuid;
  v_payment uuid;
  a jsonb;
  v_doc uuid;
  v_alloc numeric;
  v_doc_org uuid;
begin
  select organization_id into v_org from public.companies where id = p_company;
  if v_org is null then raise exception 'Company % not found', p_company; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;

  -- the cash/bank account must belong to this org
  if not exists (select 1 from public.accounts where id = p_deposit_account and organization_id = v_org) then
    raise exception 'Invalid deposit account for this organization';
  end if;

  -- the party must belong to this org
  if p_party_type = 'customer' then
    if not exists (select 1 from public.customers where id = p_party_id and organization_id = v_org) then
      raise exception 'Invalid customer for this organization';
    end if;
  elsif p_party_type = 'supplier' then
    if not exists (select 1 from public.suppliers where id = p_party_id and organization_id = v_org) then
      raise exception 'Invalid supplier for this organization';
    end if;
  else
    raise exception 'party_type must be customer or supplier';
  end if;

  insert into public.payments
    (organization_id, company_id, party_type, customer_id, supplier_id, payment_date,
     amount, currency, method, deposit_account_id, reference, created_by)
    values (v_org, p_company, p_party_type,
            case when p_party_type = 'customer' then p_party_id end,
            case when p_party_type = 'supplier' then p_party_id end,
            p_date, p_amount, p_currency, p_method, p_deposit_account, p_reference, auth.uid())
    returning id into v_payment;

  insert into public.journal_entries
    (organization_id, company_id, entry_date, memo, status, source_type, source_id, created_by)
    values (v_org, p_company, p_date,
            initcap(p_party_type) || ' payment', 'draft', 'payment', v_payment, auth.uid())
    returning id into v_entry;

  if p_party_type = 'customer' then
    v_ctrl := coalesce((select receivable_account_id from public.customers where id = p_party_id),
                       public._acct(p_company, '1200'));
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, p_deposit_account, 'Payment received', p_currency, p_amount, p_amount);
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (v_org, v_entry, v_ctrl, 'Accounts receivable', p_currency, p_amount, p_amount);
  else
    v_ctrl := coalesce((select payable_account_id from public.suppliers where id = p_party_id),
                       public._acct(p_company, '2000'));
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, v_ctrl, 'Accounts payable', p_currency, p_amount, p_amount);
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (v_org, v_entry, p_deposit_account, 'Payment made', p_currency, p_amount, p_amount);
  end if;

  update public.journal_entries set status = 'posted' where id = v_entry;
  update public.payments set journal_entry_id = v_entry where id = v_payment;

  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_alloc := (a->>'amount')::numeric;
    if v_alloc is null or v_alloc <= 0 then
      raise exception 'Allocation amount must be positive';
    end if;
    if p_party_type = 'customer' then
      v_doc := (a->>'invoice_id')::uuid;
      select organization_id into v_doc_org from public.sales_invoices where id = v_doc;
      if v_doc_org is distinct from v_org then
        raise exception 'Invalid allocation: invoice does not belong to this organization';
      end if;
      insert into public.payment_allocations (organization_id, payment_id, invoice_id, amount)
        values (v_org, v_payment, v_doc, v_alloc);
      update public.sales_invoices set amount_paid = amount_paid + v_alloc where id = v_doc;
    else
      v_doc := (a->>'bill_id')::uuid;
      select organization_id into v_doc_org from public.purchase_bills where id = v_doc;
      if v_doc_org is distinct from v_org then
        raise exception 'Invalid allocation: bill does not belong to this organization';
      end if;
      insert into public.payment_allocations (organization_id, payment_id, bill_id, amount)
        values (v_org, v_payment, v_doc, v_alloc);
      update public.purchase_bills set amount_paid = amount_paid + v_alloc where id = v_doc;
    end if;
  end loop;

  return v_payment;
end;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;

-- ==== 0022_traceability_funds_docextras.sql ====
-- ===========================================================================
-- 0022 — three features:
--  A) Invoice/bill extras: document-level discount + shipping, included in
--     totals and posted to the ledger.
--  B) Item traceability: which suppliers stock came from / which customers
--     bought it (summary RPC over inventory_movements).
--  C) Funds/Advances: money parked with a warehouse/logistics partner, paid to
--     suppliers or received from customers against it. Manual record-keeping
--     module (not GL-posted) with running balances.
-- ===========================================================================

-- --- A) discount + shipping -------------------------------------------------
alter table public.sales_invoices
  add column if not exists discount_total numeric(18,4) not null default 0,
  add column if not exists shipping_total numeric(18,4) not null default 0;
alter table public.purchase_bills
  add column if not exists discount_total numeric(18,4) not null default 0,
  add column if not exists shipping_total numeric(18,4) not null default 0;

-- extra default accounts for new companies
create or replace function public.seed_default_accounts(p_org uuid, p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.accounts (organization_id, company_id, code, name, type) values
    (p_org, p_company, '1000', 'Cash', 'asset'),
    (p_org, p_company, '1010', 'Bank', 'asset'),
    (p_org, p_company, '1200', 'Accounts Receivable', 'asset'),
    (p_org, p_company, '1300', 'Inventory', 'asset'),
    (p_org, p_company, '2000', 'Accounts Payable', 'liability'),
    (p_org, p_company, '2100', 'Sales Tax Payable', 'liability'),
    (p_org, p_company, '3000', 'Owner Equity', 'equity'),
    (p_org, p_company, '3900', 'Retained Earnings', 'equity'),
    (p_org, p_company, '4000', 'Sales Revenue', 'income'),
    (p_org, p_company, '4400', 'Shipping Income', 'income'),
    (p_org, p_company, '4900', 'Discounts Given', 'expense'),
    (p_org, p_company, '5000', 'Cost of Goods Sold', 'expense'),
    (p_org, p_company, '5100', 'Inventory Adjustments', 'expense'),
    (p_org, p_company, '5150', 'Purchase Discounts', 'income'),
    (p_org, p_company, '6000', 'Operating Expenses', 'expense'),
    (p_org, p_company, '6100', 'Freight & Shipping', 'expense');
end;
$$;

-- posting: invoice — Dr A/R total; Cr revenue per line; COGS legs; Cr tax;
-- Dr discount (contra revenue); Cr shipping income.
create or replace function public.post_sales_invoice(p_invoice_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv public.sales_invoices%rowtype; l public.sales_invoice_lines%rowtype;
  v_loc uuid; v_ar uuid; v_rev uuid; v_cogs_acct uuid; v_inv_acct uuid;
  v_cost numeric; v_entry uuid; v_acct uuid;
begin
  select * into inv from public.sales_invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice % not found', p_invoice_id; end if;
  if not public.user_can_write(inv.organization_id) then raise exception 'Not authorized'; end if;
  if inv.status <> 'draft' then raise exception 'Invoice % is already %', inv.invoice_number, inv.status; end if;

  v_loc := coalesce(inv.location_id,
    (select id from public.locations where company_id = inv.company_id and is_active order by created_at limit 1));
  v_ar := coalesce((select receivable_account_id from public.customers where id = inv.customer_id),
                   public._acct(inv.company_id, '1200'));

  insert into public.journal_entries
    (organization_id, company_id, entry_date, memo, reference, status, source_type, source_id, created_by)
    values (inv.organization_id, inv.company_id, inv.invoice_date,
            'Invoice ' || inv.invoice_number, inv.invoice_number, 'draft', 'sales_invoice', inv.id, auth.uid())
    returning id into v_entry;

  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
    values (inv.organization_id, v_entry, v_ar, 'Accounts receivable', inv.currency, inv.total, inv.total * inv.fx_rate);

  for l in select * from public.sales_invoice_lines where invoice_id = inv.id order by line_no loop
    if l.line_subtotal > 0 then
      v_rev := coalesce(l.income_account_id,
                        (select income_account_id from public.items where id = l.item_id),
                        public._acct(inv.company_id, '4000'));
      insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
        values (inv.organization_id, v_entry, v_rev, coalesce(l.description, 'Sales'), inv.currency, l.line_subtotal, l.line_subtotal * inv.fx_rate);
    end if;
    if l.item_id is not null and (select track_inventory from public.items where id = l.item_id) then
      v_cost := public._apply_stock(inv.organization_id, inv.company_id, l.item_id, v_loc,
                  -l.quantity, 0, 'sale', inv.invoice_number, null, inv.customer_id, v_entry);
      if v_cost > 0 then
        v_cogs_acct := coalesce((select expense_account_id from public.items where id = l.item_id), public._acct(inv.company_id, '5000'));
        v_inv_acct := coalesce((select inventory_account_id from public.items where id = l.item_id), public._acct(inv.company_id, '1300'));
        insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
          values (inv.organization_id, v_entry, v_cogs_acct, 'Cost of goods sold', inv.currency, v_cost, v_cost * inv.fx_rate);
        insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
          values (inv.organization_id, v_entry, v_inv_acct, 'Inventory issued', inv.currency, v_cost, v_cost * inv.fx_rate);
      end if;
    end if;
  end loop;

  if inv.tax_total > 0 then
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (inv.organization_id, v_entry, public._acct(inv.company_id, '2100'), 'Sales tax payable', inv.currency, inv.tax_total, inv.tax_total * inv.fx_rate);
  end if;

  if coalesce(inv.discount_total, 0) > 0 then
    v_acct := coalesce(public._acct(inv.company_id, '4900'), public._acct(inv.company_id, '4000'));
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (inv.organization_id, v_entry, v_acct, 'Discount given', inv.currency, inv.discount_total, inv.discount_total * inv.fx_rate);
  end if;

  if coalesce(inv.shipping_total, 0) > 0 then
    v_acct := coalesce(public._acct(inv.company_id, '4400'), public._acct(inv.company_id, '4000'));
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (inv.organization_id, v_entry, v_acct, 'Shipping charged', inv.currency, inv.shipping_total, inv.shipping_total * inv.fx_rate);
  end if;

  update public.journal_entries set status = 'posted' where id = v_entry;
  update public.sales_invoices set status = 'posted', journal_entry_id = v_entry, posted_at = now() where id = inv.id;
  return v_entry;
end;
$$;

-- posting: bill — Dr line legs; Dr tax; Dr shipping (freight expense);
-- Cr purchase discount; Cr A/P total.
create or replace function public.post_purchase_bill(p_bill_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  b public.purchase_bills%rowtype; l public.purchase_bill_lines%rowtype;
  v_loc uuid; v_ap uuid; v_dr_acct uuid; v_entry uuid; v_acct uuid;
begin
  select * into b from public.purchase_bills where id = p_bill_id for update;
  if not found then raise exception 'Bill % not found', p_bill_id; end if;
  if not public.user_can_write(b.organization_id) then raise exception 'Not authorized'; end if;
  if b.status <> 'draft' then raise exception 'Bill % is already %', b.bill_number, b.status; end if;

  v_loc := coalesce(b.location_id,
    (select id from public.locations where company_id = b.company_id and is_active order by created_at limit 1));
  v_ap := coalesce((select payable_account_id from public.suppliers where id = b.supplier_id),
                   public._acct(b.company_id, '2000'));

  insert into public.journal_entries
    (organization_id, company_id, entry_date, memo, reference, status, source_type, source_id, created_by)
    values (b.organization_id, b.company_id, b.bill_date,
            'Bill ' || b.bill_number, b.bill_number, 'draft', 'purchase_bill', b.id, auth.uid())
    returning id into v_entry;

  for l in select * from public.purchase_bill_lines where bill_id = b.id order by line_no loop
    if l.item_id is not null and (select track_inventory from public.items where id = l.item_id) then
      perform public._apply_stock(b.organization_id, b.company_id, l.item_id, v_loc,
                l.quantity, l.unit_cost, 'purchase', b.bill_number, b.supplier_id, null, v_entry);
      v_dr_acct := coalesce((select inventory_account_id from public.items where id = l.item_id), public._acct(b.company_id, '1300'));
    else
      v_dr_acct := coalesce(l.expense_account_id,
                            (select expense_account_id from public.items where id = l.item_id),
                            public._acct(b.company_id, '6000'));
    end if;
    if l.line_subtotal > 0 then
      insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
        values (b.organization_id, v_entry, v_dr_acct, coalesce(l.description, 'Bill line'), b.currency, l.line_subtotal, l.line_subtotal * b.fx_rate);
    end if;
  end loop;

  if b.tax_total > 0 then
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (b.organization_id, v_entry, public._acct(b.company_id, '2100'), 'Input tax', b.currency, b.tax_total, b.tax_total * b.fx_rate);
  end if;

  if coalesce(b.shipping_total, 0) > 0 then
    v_acct := coalesce(public._acct(b.company_id, '6100'), public._acct(b.company_id, '6000'));
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (b.organization_id, v_entry, v_acct, 'Freight & shipping', b.currency, b.shipping_total, b.shipping_total * b.fx_rate);
  end if;

  if coalesce(b.discount_total, 0) > 0 then
    v_acct := coalesce(public._acct(b.company_id, '5150'), public._acct(b.company_id, '5100'));
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (b.organization_id, v_entry, v_acct, 'Purchase discount', b.currency, b.discount_total, b.discount_total * b.fx_rate);
  end if;

  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
    values (b.organization_id, v_entry, v_ap, 'Accounts payable', b.currency, b.total, b.total * b.fx_rate);

  update public.journal_entries set status = 'posted' where id = v_entry;
  update public.purchase_bills set status = 'posted', journal_entry_id = v_entry, posted_at = now() where id = b.id;
  return v_entry;
end;
$$;

-- --- B) item traceability ----------------------------------------------------
create or replace function public.report_item_traceability(p_company uuid, p_item uuid)
returns table (party_type text, party_id uuid, party_name text, direction text,
               total_qty numeric, total_value numeric, movements bigint, last_date date)
language sql stable security definer set search_path = public as $$
  select
    case when m.supplier_id is not null then 'supplier'
         when m.customer_id is not null then 'customer' else 'internal' end,
    coalesce(m.supplier_id, m.customer_id),
    coalesce(s.name, c.name, initcap(m.movement_type)),
    case when m.quantity >= 0 then 'in' else 'out' end,
    sum(abs(m.quantity)),
    round(sum(abs(m.quantity) * m.unit_cost), 2),
    count(*),
    max(m.created_at)::date
  from public.inventory_movements m
  left join public.suppliers s on s.id = m.supplier_id
  left join public.customers c on c.id = m.customer_id
  where m.company_id = p_company and m.item_id = p_item
    and m.organization_id in (select public.user_org_ids())
  group by 1, 2, 3, 4
  order by 4, 3;
$$;

-- --- C) funds / advances ------------------------------------------------------
create table public.fund_accounts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  name            text not null,
  description     text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (company_id, name)
);
create index idx_fund_accounts_company on public.fund_accounts(company_id);

create table public.fund_transactions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  fund_account_id uuid not null references public.fund_accounts(id) on delete cascade,
  txn_date        date not null default current_date,
  entry_type      text not null check (entry_type in ('deposit', 'payment', 'receipt', 'adjustment')),
  amount          numeric(18,4) not null check (amount <> 0),
  supplier_id     uuid references public.suppliers(id),
  customer_id     uuid references public.customers(id),
  counterparty    text,
  reference       text,
  memo            text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);
create index idx_fund_tx_account on public.fund_transactions(fund_account_id, txn_date desc);

select public._apply_org_policies('public.fund_accounts');
select public._apply_org_policies('public.fund_transactions');

grant all on public.fund_accounts, public.fund_transactions to anon, authenticated, service_role;
grant execute on all routines in schema public to anon, authenticated, service_role;

-- ==== 0023_company_logo.sql ====
-- 0023 — company logo (stored as a compact data-URL) shown on printed documents.
alter table public.companies add column if not exists logo_url text;

-- ==== 0024_aging_base_currency.sql ====
-- ===========================================================================
-- 0024_aging_base_currency — A/R and A/P aging now report the outstanding
-- balance CONVERTED TO THE COMPANY BASE CURRENCY (× the document's fx_rate),
-- so the dashboard tiles and aging reports consolidate mixed-currency
-- documents into one comparable figure (matching the ledger, which is already
-- stored in base currency).
-- ===========================================================================

create or replace function public.report_ar_aging(p_company uuid, p_as_of date default current_date)
returns table (
  party_id uuid, party_name text,
  current numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric, total numeric
) language sql stable security definer set search_path = public as $$
  with outstanding as (
    select i.customer_id, c.name,
           (i.total - i.amount_paid) * coalesce(i.fx_rate, 1) as bal,
           (p_as_of - coalesce(i.due_date, i.invoice_date)) as age
    from public.sales_invoices i
    join public.customers c on c.id = i.customer_id
    where i.company_id = p_company and i.status = 'posted'
      and i.total - i.amount_paid > 0
      and i.organization_id in (select public.user_org_ids())
  )
  select customer_id, name,
    round(sum(bal) filter (where age <= 0), 2),
    round(sum(bal) filter (where age between 1 and 30), 2),
    round(sum(bal) filter (where age between 31 and 60), 2),
    round(sum(bal) filter (where age between 61 and 90), 2),
    round(sum(bal) filter (where age > 90), 2),
    round(sum(bal), 2)
  from outstanding group by customer_id, name order by name;
$$;

create or replace function public.report_ap_aging(p_company uuid, p_as_of date default current_date)
returns table (
  party_id uuid, party_name text,
  current numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric, total numeric
) language sql stable security definer set search_path = public as $$
  with outstanding as (
    select b.supplier_id, s.name,
           (b.total - b.amount_paid) * coalesce(b.fx_rate, 1) as bal,
           (p_as_of - coalesce(b.due_date, b.bill_date)) as age
    from public.purchase_bills b
    join public.suppliers s on s.id = b.supplier_id
    where b.company_id = p_company and b.status = 'posted'
      and b.total - b.amount_paid > 0
      and b.organization_id in (select public.user_org_ids())
  )
  select supplier_id, name,
    round(sum(bal) filter (where age <= 0), 2),
    round(sum(bal) filter (where age between 1 and 30), 2),
    round(sum(bal) filter (where age between 31 and 60), 2),
    round(sum(bal) filter (where age between 61 and 90), 2),
    round(sum(bal) filter (where age > 90), 2),
    round(sum(bal), 2)
  from outstanding group by supplier_id, name order by name;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;

-- ==== 0025_currency_everywhere.sql ====
-- ===========================================================================
-- 0025_currency_everywhere — bring foreign-currency + fx_rate support to the
-- two remaining document types that lacked it:
--   • expenses         — add fx_rate; record_expense now takes currency + rate
--                        and posts base amounts = amount × fx_rate (credit leg
--                        is the balancing figure so rounding never unbalances).
--   • fund_transactions— add currency + fx_rate so advances/funds can be held
--                        in any currency; the balance is consolidated to base.
-- Sales/purchase orders and credit/debit notes already carry currency+fx_rate
-- (migrations 0007/0010) and their posting RPCs already use it — only the API
-- create/update paths needed to stop hardcoding the base currency.
-- ===========================================================================

-- --- A) expenses -------------------------------------------------------------
alter table public.expenses
  add column if not exists fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0);

-- Drop the old 9-arg signature so adding currency+rate params doesn't leave an
-- ambiguous overload behind.
drop function if exists public.record_expense(uuid, date, uuid, numeric, numeric, uuid, uuid, text, text);

create or replace function public.record_expense(
  p_company uuid, p_date date, p_category_account uuid, p_amount numeric,
  p_tax_amount numeric default 0, p_paid_account uuid default null,
  p_supplier uuid default null, p_reference text default null, p_memo text default null,
  p_currency text default null, p_fx_rate numeric default 1
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_base text; v_ccy text; v_fx numeric; v_total numeric;
  v_entry uuid; v_expense uuid; v_credit uuid; v_status text;
  v_base_amount numeric; v_base_tax numeric;
begin
  select organization_id, base_currency into v_org, v_base from public.companies where id = p_company;
  if v_org is null then raise exception 'Company % not found', p_company; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  v_ccy := coalesce(nullif(p_currency, ''), v_base);
  v_fx  := coalesce(p_fx_rate, 1);
  if v_fx <= 0 then v_fx := 1; end if;
  if v_ccy = v_base then v_fx := 1; end if;

  v_total := p_amount + coalesce(p_tax_amount, 0);
  -- Base-currency legs: round each debit, then make the credit their exact sum
  -- so sum(base_debit) = sum(base_credit) regardless of fx rounding.
  v_base_amount := round(p_amount * v_fx, 4);
  v_base_tax := round(coalesce(p_tax_amount, 0) * v_fx, 4);

  if p_paid_account is not null then
    v_credit := p_paid_account; v_status := 'paid';
  else
    v_credit := coalesce((select payable_account_id from public.suppliers where id = p_supplier),
                         public._acct(p_company, '2000'));
    v_status := 'unpaid';
  end if;

  insert into public.journal_entries (organization_id, company_id, entry_date, memo, reference, status, source_type, created_by)
    values (v_org, p_company, p_date, coalesce(p_memo, 'Expense'), p_reference, 'draft', 'expense', auth.uid())
    returning id into v_entry;

  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
    values (v_org, v_entry, p_category_account, coalesce(p_memo, 'Expense'), v_ccy, p_amount, v_base_amount);
  if coalesce(p_tax_amount, 0) > 0 then
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, public._acct(p_company, '2100'), 'Input tax', v_ccy, p_tax_amount, v_base_tax);
  end if;
  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
    values (v_org, v_entry, v_credit, 'Expense payment', v_ccy, v_total, v_base_amount + v_base_tax);

  update public.journal_entries set status = 'posted' where id = v_entry;

  insert into public.expenses (organization_id, company_id, expense_date, category_account_id, supplier_id,
    paid_account_id, payment_status, amount, tax_amount, total, currency, fx_rate, reference, memo, journal_entry_id, created_by)
    values (v_org, p_company, p_date, p_category_account, p_supplier, p_paid_account, v_status,
            p_amount, coalesce(p_tax_amount,0), v_total, v_ccy, v_fx, p_reference, p_memo, v_entry, auth.uid())
    returning id into v_expense;

  return v_expense;
end;
$$;

-- --- B) fund transactions ----------------------------------------------------
alter table public.fund_transactions
  add column if not exists currency text references public.currencies(code),
  add column if not exists fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0);

grant execute on all routines in schema public to anon, authenticated, service_role;

-- ==== 0026_payment_statement_base_currency.sql ====
-- ===========================================================================
-- 0026_payment_statement_base_currency — make payments and statements honour
-- foreign currency the same way every other document already does.
--   • payments        — add fx_rate; record_payment posts base_debit/base_credit
--                        = amount × fx_rate, so a EUR payment shows its converted
--                        base-currency (e.g. AED) value in the General Ledger,
--                        Trial Balance, P&L and Balance Sheet (all read base_*).
--   • statements       — customer/supplier statements now report every line in
--                        base currency (× the document's fx_rate) instead of raw
--                        mixed document amounts, matching the ledger.
-- General Ledger (0018) and account-activity reports (0009) already read the
-- base_debit/base_credit columns, so once payments store the right base amount
-- they display correctly with no further change.
-- ===========================================================================

-- --- A) payments -------------------------------------------------------------
alter table public.payments
  add column if not exists fx_rate numeric(18, 8) not null default 1 check (fx_rate > 0);

-- Drop the old signature so the added p_fx_rate param doesn't leave an overload.
drop function if exists public.record_payment(uuid, text, uuid, date, numeric, text, text, uuid, text, jsonb);

create or replace function public.record_payment(
  p_company uuid, p_party_type text, p_party_id uuid, p_date date,
  p_amount numeric, p_currency text, p_method text, p_deposit_account uuid,
  p_reference text, p_allocations jsonb default '[]'::jsonb, p_fx_rate numeric default 1
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_base text;
  v_fx numeric;
  v_base_amount numeric;
  v_ctrl uuid;
  v_entry uuid;
  v_payment uuid;
  a jsonb;
  v_doc uuid;
  v_alloc numeric;
  v_doc_org uuid;
begin
  select organization_id, base_currency into v_org, v_base from public.companies where id = p_company;
  if v_org is null then raise exception 'Company % not found', p_company; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;

  v_fx := coalesce(p_fx_rate, 1);
  if v_fx <= 0 then v_fx := 1; end if;
  if p_currency = v_base then v_fx := 1; end if;
  v_base_amount := round(p_amount * v_fx, 4);

  -- the cash/bank account must belong to this org
  if not exists (select 1 from public.accounts where id = p_deposit_account and organization_id = v_org) then
    raise exception 'Invalid deposit account for this organization';
  end if;

  -- the party must belong to this org
  if p_party_type = 'customer' then
    if not exists (select 1 from public.customers where id = p_party_id and organization_id = v_org) then
      raise exception 'Invalid customer for this organization';
    end if;
  elsif p_party_type = 'supplier' then
    if not exists (select 1 from public.suppliers where id = p_party_id and organization_id = v_org) then
      raise exception 'Invalid supplier for this organization';
    end if;
  else
    raise exception 'party_type must be customer or supplier';
  end if;

  insert into public.payments
    (organization_id, company_id, party_type, customer_id, supplier_id, payment_date,
     amount, currency, fx_rate, method, deposit_account_id, reference, created_by)
    values (v_org, p_company, p_party_type,
            case when p_party_type = 'customer' then p_party_id end,
            case when p_party_type = 'supplier' then p_party_id end,
            p_date, p_amount, p_currency, v_fx, p_method, p_deposit_account, p_reference, auth.uid())
    returning id into v_payment;

  insert into public.journal_entries
    (organization_id, company_id, entry_date, memo, status, source_type, source_id, created_by)
    values (v_org, p_company, p_date,
            initcap(p_party_type) || ' payment', 'draft', 'payment', v_payment, auth.uid())
    returning id into v_entry;

  if p_party_type = 'customer' then
    v_ctrl := coalesce((select receivable_account_id from public.customers where id = p_party_id),
                       public._acct(p_company, '1200'));
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, p_deposit_account, 'Payment received', p_currency, p_amount, v_base_amount);
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (v_org, v_entry, v_ctrl, 'Accounts receivable', p_currency, p_amount, v_base_amount);
  else
    v_ctrl := coalesce((select payable_account_id from public.suppliers where id = p_party_id),
                       public._acct(p_company, '2000'));
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, v_ctrl, 'Accounts payable', p_currency, p_amount, v_base_amount);
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
      values (v_org, v_entry, p_deposit_account, 'Payment made', p_currency, p_amount, v_base_amount);
  end if;

  update public.journal_entries set status = 'posted' where id = v_entry;
  update public.payments set journal_entry_id = v_entry where id = v_payment;

  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_alloc := (a->>'amount')::numeric;
    if v_alloc is null or v_alloc <= 0 then
      raise exception 'Allocation amount must be positive';
    end if;
    if p_party_type = 'customer' then
      v_doc := (a->>'invoice_id')::uuid;
      select organization_id into v_doc_org from public.sales_invoices where id = v_doc;
      if v_doc_org is distinct from v_org then
        raise exception 'Invalid allocation: invoice does not belong to this organization';
      end if;
      insert into public.payment_allocations (organization_id, payment_id, invoice_id, amount)
        values (v_org, v_payment, v_doc, v_alloc);
      update public.sales_invoices set amount_paid = amount_paid + v_alloc where id = v_doc;
    else
      v_doc := (a->>'bill_id')::uuid;
      select organization_id into v_doc_org from public.purchase_bills where id = v_doc;
      if v_doc_org is distinct from v_org then
        raise exception 'Invalid allocation: bill does not belong to this organization';
      end if;
      insert into public.payment_allocations (organization_id, payment_id, bill_id, amount)
        values (v_org, v_payment, v_doc, v_alloc);
      update public.purchase_bills set amount_paid = amount_paid + v_alloc where id = v_doc;
    end if;
  end loop;

  return v_payment;
end;
$$;

-- --- B) statements in base currency -----------------------------------------
drop function if exists public.report_customer_statement(uuid, uuid);
create function public.report_customer_statement(p_company uuid, p_customer uuid default null)
returns table (txn_date date, party_id uuid, party_name text, doc_type text, reference text, charge numeric, credit numeric)
language sql stable security definer set search_path = public as $$
  select i.invoice_date, c.id, c.name, 'invoice', i.invoice_number, round(i.total * coalesce(i.fx_rate, 1), 2), 0
    from public.sales_invoices i join public.customers c on c.id = i.customer_id
    where i.company_id = p_company and i.status = 'posted'
      and (p_customer is null or i.customer_id = p_customer)
      and i.organization_id in (select public.user_org_ids())
  union all
  select n.note_date, c.id, c.name, 'credit_note', n.note_number, 0, round(n.total * coalesce(n.fx_rate, 1), 2)
    from public.credit_notes n join public.customers c on c.id = n.customer_id
    where n.company_id = p_company and n.status = 'posted'
      and (p_customer is null or n.customer_id = p_customer)
      and n.organization_id in (select public.user_org_ids())
  union all
  select p.payment_date, c.id, c.name, 'payment', p.reference, 0, round(p.amount * coalesce(p.fx_rate, 1), 2)
    from public.payments p join public.customers c on c.id = p.customer_id
    where p.company_id = p_company and p.party_type = 'customer' and not p.reversed
      and (p_customer is null or p.customer_id = p_customer)
      and p.organization_id in (select public.user_org_ids())
  order by 3, 1;
$$;

drop function if exists public.report_supplier_statement(uuid, uuid);
create function public.report_supplier_statement(p_company uuid, p_supplier uuid default null)
returns table (txn_date date, party_id uuid, party_name text, doc_type text, reference text, charge numeric, credit numeric)
language sql stable security definer set search_path = public as $$
  select b.bill_date, s.id, s.name, 'bill', b.bill_number, round(b.total * coalesce(b.fx_rate, 1), 2), 0
    from public.purchase_bills b join public.suppliers s on s.id = b.supplier_id
    where b.company_id = p_company and b.status = 'posted'
      and (p_supplier is null or b.supplier_id = p_supplier)
      and b.organization_id in (select public.user_org_ids())
  union all
  select n.note_date, s.id, s.name, 'debit_note', n.note_number, 0, round(n.total * coalesce(n.fx_rate, 1), 2)
    from public.debit_notes n join public.suppliers s on s.id = n.supplier_id
    where n.company_id = p_company and n.status = 'posted'
      and (p_supplier is null or n.supplier_id = p_supplier)
      and n.organization_id in (select public.user_org_ids())
  union all
  select p.payment_date, s.id, s.name, 'payment', p.reference, 0, round(p.amount * coalesce(p.fx_rate, 1), 2)
    from public.payments p join public.suppliers s on s.id = p.supplier_id
    where p.company_id = p_company and p.party_type = 'supplier' and not p.reversed
      and (p_supplier is null or p.supplier_id = p_supplier)
      and p.organization_id in (select public.user_org_ids())
  order by 3, 1;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;

-- ==== 0027_user_approval.sql ====
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

-- ==== 0028_expense_ops.sql ====
-- ===========================================================================
-- 0028_expense_ops — full lifecycle for expenses (edit / delete / reverse-pay).
-- record_expense (0025) posts an expense immediately. These helpers let the
-- API edit, delete, or un-pay an already-posted expense while keeping the GL
-- balanced by mirroring the original journal entry (via _mirror_entry, 0015).
--   • reverse_expense(id)          — post a mirror of the expense's JE
--                                    (used by DELETE: neutralise then drop row).
--   • revise_expense(id, …)        — mirror the old JE, post a fresh one from the
--                                    new values, update the row in place (edit).
--   • reverse_expense_payment(id)  — a paid expense becomes payable: Dr cash /
--                                    Cr A/P, flip payment_status to 'unpaid'.
-- ===========================================================================

-- Neutralise an expense's posting by mirroring its journal entry.
create or replace function public.reverse_expense(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_company uuid; v_entry uuid;
begin
  select organization_id, company_id, journal_entry_id
    into v_org, v_company, v_entry
    from public.expenses where id = p_id for update;
  if v_org is null then raise exception 'Expense not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if v_entry is null then return null; end if;
  return public._mirror_entry(v_org, v_company, v_entry, 'expense_reversal', p_id, 'Reversal of expense');
end;
$$;

-- Edit a posted expense: reverse the old journal entry, post a new one, and
-- update the expenses row in place (same id, new journal_entry_id).
create or replace function public.revise_expense(
  p_id uuid, p_date date, p_category_account uuid, p_amount numeric,
  p_tax_amount numeric default 0, p_paid_account uuid default null,
  p_supplier uuid default null, p_reference text default null, p_memo text default null,
  p_currency text default null, p_fx_rate numeric default 1
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_company uuid; v_base text; v_old uuid; v_ccy text; v_fx numeric;
  v_total numeric; v_entry uuid; v_credit uuid; v_status text;
  v_base_amount numeric; v_base_tax numeric;
begin
  select e.organization_id, e.company_id, e.journal_entry_id, c.base_currency
    into v_org, v_company, v_old, v_base
    from public.expenses e join public.companies c on c.id = e.company_id
    where e.id = p_id for update;
  if v_org is null then raise exception 'Expense not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  -- neutralise the previous posting
  if v_old is not null then
    perform public._mirror_entry(v_org, v_company, v_old, 'expense_reversal', p_id, 'Revision of expense');
  end if;

  v_ccy := coalesce(nullif(p_currency, ''), v_base);
  v_fx  := coalesce(p_fx_rate, 1);
  if v_fx <= 0 then v_fx := 1; end if;
  if v_ccy = v_base then v_fx := 1; end if;

  v_total := p_amount + coalesce(p_tax_amount, 0);
  v_base_amount := round(p_amount * v_fx, 4);
  v_base_tax := round(coalesce(p_tax_amount, 0) * v_fx, 4);

  if p_paid_account is not null then
    v_credit := p_paid_account; v_status := 'paid';
  else
    v_credit := coalesce((select payable_account_id from public.suppliers where id = p_supplier),
                         public._acct(v_company, '2000'));
    v_status := 'unpaid';
  end if;

  insert into public.journal_entries (organization_id, company_id, entry_date, memo, reference, status, source_type, source_id, created_by)
    values (v_org, v_company, p_date, coalesce(p_memo, 'Expense'), p_reference, 'draft', 'expense', p_id, auth.uid())
    returning id into v_entry;

  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
    values (v_org, v_entry, p_category_account, coalesce(p_memo, 'Expense'), v_ccy, p_amount, v_base_amount);
  if coalesce(p_tax_amount, 0) > 0 then
    insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
      values (v_org, v_entry, public._acct(v_company, '2100'), 'Input tax', v_ccy, p_tax_amount, v_base_tax);
  end if;
  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
    values (v_org, v_entry, v_credit, 'Expense payment', v_ccy, v_total, v_base_amount + v_base_tax);

  update public.journal_entries set status = 'posted' where id = v_entry;

  update public.expenses set
    expense_date = p_date, category_account_id = p_category_account, supplier_id = p_supplier,
    paid_account_id = p_paid_account, payment_status = v_status, amount = p_amount,
    tax_amount = coalesce(p_tax_amount, 0), total = v_total, currency = v_ccy, fx_rate = v_fx,
    reference = p_reference, memo = p_memo, journal_entry_id = v_entry
    where id = p_id;
  return p_id;
end;
$$;

-- Reverse the *payment* of a paid expense (keep the expense recognised, but make
-- it payable again): Dr cash/bank (restore) / Cr A/P.
create or replace function public.reverse_expense_payment(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_company uuid; v_paid uuid; v_status text;
  v_total numeric; v_ccy text; v_fx numeric; v_ap uuid; v_entry uuid; v_base_total numeric;
begin
  select organization_id, company_id, paid_account_id, payment_status, total, currency, fx_rate
    into v_org, v_company, v_paid, v_status, v_total, v_ccy, v_fx
    from public.expenses where id = p_id for update;
  if v_org is null then raise exception 'Expense not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if v_status <> 'paid' then raise exception 'Only a paid expense can have its payment reversed'; end if;
  if v_paid is null then raise exception 'This expense has no paid-from account'; end if;

  v_ap := public._acct(v_company, '2000');
  v_base_total := round(v_total * coalesce(v_fx, 1), 4);

  insert into public.journal_entries (organization_id, company_id, entry_date, memo, status, source_type, source_id, created_by)
    values (v_org, v_company, current_date, 'Reverse expense payment', 'draft', 'expense_payment_reversal', p_id, auth.uid())
    returning id into v_entry;
  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, debit, base_debit)
    values (v_org, v_entry, v_paid, 'Reverse expense payment', v_ccy, v_total, v_base_total);
  insert into public.journal_lines (organization_id, journal_entry_id, account_id, description, currency, credit, base_credit)
    values (v_org, v_entry, v_ap, 'Now payable', v_ccy, v_total, v_base_total);
  update public.journal_entries set status = 'posted' where id = v_entry;

  update public.expenses set payment_status = 'unpaid', paid_account_id = null where id = p_id;
  return v_entry;
end;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;

-- ==== 0029_funds_gl_payment.sql ====
-- ===========================================================================
-- 0029_funds_gl_payment — connect the Funds module to the ledger.
--   • fund_accounts gain gl_account_id → the cash/bank account the fund maps to.
--   • fund_transactions gain a 'withdrawal' entry type (money leaving the fund,
--     same sign effect as 'payment').
--   • receive_invoice_payment(invoice, fund, amount?) posts a real GL payment
--     (Dr fund's cash/bank / Cr A/R, settling the invoice via record_payment)
--     AND records a fund receipt so the fund balance grows. This backs both the
--     invoice "Payment type = fund" flow and customer deposits (partial amounts).
-- ===========================================================================

alter table public.fund_accounts
  add column if not exists gl_account_id uuid references public.accounts(id);

-- Allow a 'withdrawal' transaction type (behaves like 'payment' for balances).
alter table public.fund_transactions
  drop constraint if exists fund_transactions_entry_type_check;
alter table public.fund_transactions
  add constraint fund_transactions_entry_type_check
  check (entry_type in ('deposit', 'payment', 'receipt', 'adjustment', 'withdrawal'));

-- Receive a payment/deposit for an invoice through a fund. Amount defaults to
-- the full outstanding balance; a smaller amount records a partial deposit.
create or replace function public.receive_invoice_payment(
  p_invoice uuid, p_fund uuid, p_amount numeric default null, p_date date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_company uuid; v_customer uuid; v_ccy text; v_fx numeric;
  v_total numeric; v_paid numeric; v_status text; v_number text;
  v_out numeric; v_amt numeric; v_gl uuid; v_fund_org uuid; v_payment uuid;
  v_when date := coalesce(p_date, current_date);
begin
  select organization_id, company_id, customer_id, currency, fx_rate, total, amount_paid, status, invoice_number
    into v_org, v_company, v_customer, v_ccy, v_fx, v_total, v_paid, v_status, v_number
    from public.sales_invoices where id = p_invoice for update;
  if v_org is null then raise exception 'Invoice not found'; end if;
  if not public.user_can_write(v_org) then raise exception 'Not authorized'; end if;
  if v_status <> 'posted' then raise exception 'Only a posted invoice can receive a payment'; end if;

  v_out := round(v_total - coalesce(v_paid, 0), 4);
  if v_out <= 0 then raise exception 'Invoice is already fully paid'; end if;

  v_amt := coalesce(p_amount, v_out);
  if v_amt <= 0 then raise exception 'Amount must be positive'; end if;
  if v_amt > v_out + 0.0049 then raise exception 'Amount exceeds the outstanding balance'; end if;
  if v_amt > v_out then v_amt := v_out; end if;

  select gl_account_id, organization_id into v_gl, v_fund_org from public.fund_accounts where id = p_fund;
  if v_fund_org is null then raise exception 'Fund not found'; end if;
  if v_fund_org <> v_org then raise exception 'Fund belongs to another organization'; end if;
  if v_gl is null then raise exception 'This fund is not linked to a cash/bank account — set one on the fund first'; end if;

  -- Ledger: settle A/R against the fund's cash/bank account.
  v_payment := public.record_payment(
    v_company, 'customer', v_customer, v_when,
    v_amt, v_ccy, 'fund', v_gl, v_number,
    jsonb_build_array(jsonb_build_object('invoice_id', p_invoice, 'amount', v_amt)),
    coalesce(v_fx, 1));

  -- Fund: money received into the fund (consolidated to base via fx_rate).
  insert into public.fund_transactions
    (organization_id, company_id, fund_account_id, txn_date, entry_type, amount,
     customer_id, currency, fx_rate, reference, memo, created_by)
    values (v_org, v_company, p_fund, v_when, 'receipt', v_amt,
            v_customer, v_ccy, coalesce(v_fx, 1), v_number,
            'Invoice ' || v_number || ' payment', auth.uid());

  return v_payment;
end;
$$;

grant execute on all routines in schema public to anon, authenticated, service_role;

-- ==== 0030_line_kind.sql ====
-- ===========================================================================
-- 0030_line_kind — distinguish product "items" from "services" on document
-- lines so the invoice can render the two-table layout (Items table + Services
-- table). Purely presentational: posting still resolves accounts per line, so
-- a service line (no item_id) continues to post to revenue.
-- ===========================================================================

alter table public.sales_invoice_lines
  add column if not exists line_kind text not null default 'item'
  check (line_kind in ('item', 'service'));

alter table public.purchase_bill_lines
  add column if not exists line_kind text not null default 'item'
  check (line_kind in ('item', 'service'));

-- ==== 0031_documents.sql ====
-- ===========================================================================
-- 0031_documents — attach files (PDFs, images…) to invoices. Bytes live in a
-- private Supabase Storage bucket 'invoice-docs' under {org}/{invoice}/{file};
-- this table holds the metadata. The browser uploads/downloads directly via
-- signed URLs (storage RLS scopes access by org path); the API owns metadata.
-- ===========================================================================

create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  invoice_id      uuid references public.sales_invoices(id) on delete cascade,
  name            text not null,
  mime            text,
  size            bigint,
  storage_path    text not null,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_documents_invoice on public.documents(invoice_id, created_at desc);

select public._apply_org_policies('public.documents');

-- Storage bucket + RLS. Guarded so the migration still applies on a plain
-- Postgres (no Supabase 'storage' schema) during local validation.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public)
      values ('invoice-docs', 'invoice-docs', false)
      on conflict (id) do nothing;

    execute $p$ drop policy if exists "invoice_docs_read" on storage.objects $p$;
    execute $p$ create policy "invoice_docs_read" on storage.objects for select to authenticated
      using (bucket_id = 'invoice-docs'
             and (storage.foldername(name))[1]::uuid in (select public.user_org_ids())) $p$;

    execute $p$ drop policy if exists "invoice_docs_insert" on storage.objects $p$;
    execute $p$ create policy "invoice_docs_insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'invoice-docs'
                  and (storage.foldername(name))[1]::uuid in (select public.user_org_ids())) $p$;

    execute $p$ drop policy if exists "invoice_docs_delete" on storage.objects $p$;
    execute $p$ create policy "invoice_docs_delete" on storage.objects for delete to authenticated
      using (bucket_id = 'invoice-docs'
             and (storage.foldername(name))[1]::uuid in (select public.user_org_ids())) $p$;
  end if;
end $$;

-- ==== 0032_soft_delete.sql ====
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

-- ==== 0033_audit_reports.sql ====
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

-- record migration history so future 'supabase db push' sees these as applied.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name) values
  ('0001','core_tenancy'),
  ('0002','ledger'),
  ('0003','inventory_partners'),
  ('0004','rls'),
  ('0005','rpc'),
  ('0006','grants'),
  ('0007','sales_purchases'),
  ('0008','posting_rpc'),
  ('0009','reports'),
  ('0010','orders_returns'),
  ('0011','advanced_rpc'),
  ('0012','expenses'),
  ('0013','ship_to'),
  ('0014','company_profile_terms'),
  ('0015','reverse_restore'),
  ('0016','revise'),
  ('0017','statements_all'),
  ('0018','gl_party'),
  ('0019','posting_fixes'),
  ('0020','reverse_journal'),
  ('0021','secure_record_payment'),
  ('0022','traceability_funds_docextras'),
  ('0023','company_logo'),
  ('0024','aging_base_currency'),
  ('0025','currency_everywhere'),
  ('0026','payment_statement_base_currency'),
  ('0027','user_approval'),
  ('0028','expense_ops'),
  ('0029','funds_gl_payment'),
  ('0030','line_kind'),
  ('0031','documents'),
  ('0032','soft_delete'),
  ('0033','audit_reports')
on conflict (version) do nothing;
commit;
