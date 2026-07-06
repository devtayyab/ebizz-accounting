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
