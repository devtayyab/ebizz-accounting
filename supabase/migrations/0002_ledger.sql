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
