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
