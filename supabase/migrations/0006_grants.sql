-- ===========================================================================
-- 0006_grants — table/function privileges for the Supabase API roles.
--
-- RLS decides WHICH ROWS a caller sees; GRANTs decide whether the role may
-- touch the table at all. PostgREST connects as `anon` (no session) or
-- `authenticated` (logged in), so both need privileges — row visibility is then
-- governed entirely by the RLS policies in 0004. `service_role` bypasses RLS.
--
-- We grant broadly here and lean on RLS as the security boundary, which is the
-- standard Supabase pattern. The default-privileges statements ensure any
-- tables added by FUTURE migrations inherit the same grants automatically.
-- ===========================================================================

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all routines in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on routines to anon, authenticated, service_role;
