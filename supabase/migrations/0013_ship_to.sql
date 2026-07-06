-- ===========================================================================
-- 0013_ship_to — a per-invoice delivery ("Ship To") address, distinct from the
-- customer's billing details and from the dispatch warehouse (location_id).
-- Traders using logistics warehouses ship the same customer's orders to
-- different destinations, so this lives on the invoice, not the customer.
-- ===========================================================================

alter table public.sales_invoices
  add column if not exists ship_to_name    text,
  add column if not exists ship_to_address text,
  add column if not exists ship_to_city    text,
  add column if not exists ship_to_country text;
