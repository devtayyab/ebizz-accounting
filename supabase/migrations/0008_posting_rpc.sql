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
