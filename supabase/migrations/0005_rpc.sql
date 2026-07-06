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
