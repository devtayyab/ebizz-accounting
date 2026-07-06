-- 0023 — company logo (stored as a compact data-URL) shown on printed documents.
alter table public.companies add column if not exists logo_url text;
