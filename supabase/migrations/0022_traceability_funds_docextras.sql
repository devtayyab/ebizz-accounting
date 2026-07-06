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
