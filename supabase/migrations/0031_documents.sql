-- ===========================================================================
-- 0031_documents — attach files (PDFs, images…) to invoices. Bytes live in a
-- private Supabase Storage bucket 'invoice-docs' under {org}/{invoice}/{file};
-- this table holds the metadata. The browser uploads/downloads directly via
-- signed URLs (storage RLS scopes access by org path); the API owns metadata.
-- ===========================================================================

create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  invoice_id      uuid references public.sales_invoices(id) on delete cascade,
  name            text not null,
  mime            text,
  size            bigint,
  storage_path    text not null,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_documents_invoice on public.documents(invoice_id, created_at desc);

select public._apply_org_policies('public.documents');

-- Storage bucket + RLS. Guarded so the migration still applies on a plain
-- Postgres (no Supabase 'storage' schema) during local validation.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public)
      values ('invoice-docs', 'invoice-docs', false)
      on conflict (id) do nothing;

    execute $p$ drop policy if exists "invoice_docs_read" on storage.objects $p$;
    execute $p$ create policy "invoice_docs_read" on storage.objects for select to authenticated
      using (bucket_id = 'invoice-docs'
             and (storage.foldername(name))[1]::uuid in (select public.user_org_ids())) $p$;

    execute $p$ drop policy if exists "invoice_docs_insert" on storage.objects $p$;
    execute $p$ create policy "invoice_docs_insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'invoice-docs'
                  and (storage.foldername(name))[1]::uuid in (select public.user_org_ids())) $p$;

    execute $p$ drop policy if exists "invoice_docs_delete" on storage.objects $p$;
    execute $p$ create policy "invoice_docs_delete" on storage.objects for delete to authenticated
      using (bucket_id = 'invoice-docs'
             and (storage.foldername(name))[1]::uuid in (select public.user_org_ids())) $p$;
  end if;
end $$;
