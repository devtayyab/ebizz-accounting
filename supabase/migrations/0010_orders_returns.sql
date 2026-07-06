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
