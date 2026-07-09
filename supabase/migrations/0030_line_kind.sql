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
