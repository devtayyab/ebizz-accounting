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
