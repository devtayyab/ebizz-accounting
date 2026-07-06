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
