-- ===========================================================================
-- 0014_company_profile_terms — richer company profile for professional invoice
-- headers, plus reusable default Terms & Conditions / footer, and a per-invoice
-- terms override.
-- ===========================================================================

alter table public.companies
  add column if not exists address_line1  text,
  add column if not exists city           text,
  add column if not exists phone          text,
  add column if not exists email          text,
  add column if not exists tax_number     text,
  add column if not exists invoice_terms  text,
  add column if not exists invoice_footer text;

alter table public.sales_invoices
  add column if not exists terms text;
