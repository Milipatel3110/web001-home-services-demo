-- Run against a throwaway Postgres (see tests/db/run.sh). Simulates the
-- Supabase roles, applies the migration and asserts the security model.
\set ON_ERROR_STOP 1
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase's default privileges grant everything to anon on new tables;
-- reproduce that so the test proves the migration's REVOKE is what protects us.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

\i supabase/migrations/20261102000000_contact_submissions.sql
-- Migration must be re-runnable.
\i supabase/migrations/20261102000000_contact_submissions.sql

do $$
declare n int;
begin
  assert (select relrowsecurity from pg_class where oid = 'public.contact_submissions'::regclass), 'RLS not enabled';
  assert (select count(*) from pg_policies where tablename = 'contact_submissions') = 0, 'unexpected policies';
  assert not has_table_privilege('anon', 'public.contact_submissions', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'), 'anon has privileges';
  assert not has_table_privilege('authenticated', 'public.contact_submissions', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'), 'authenticated has privileges';

  -- anon cannot read or write.
  set local role anon;
  begin insert into public.contact_submissions(request_id,name,email,message) values (gen_random_uuid(),'xx','x@y.z','long enough message');
    raise exception 'anon insert allowed'; exception when insufficient_privilege then null; end;
  begin perform * from public.contact_submissions;
    raise exception 'anon select allowed'; exception when insufficient_privilege then null; end;
  reset role;

  -- service_role: first insert stores, duplicate is a no-op.
  set local role service_role;
  insert into public.contact_submissions(request_id,name,email,message)
    values ('3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c','Ada','ada@example.com','Hello there!')
    on conflict (request_id) do nothing;
  get diagnostics n = row_count; assert n = 1, 'first insert should store 1 row';
  insert into public.contact_submissions(request_id,name,email,message)
    values ('3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c','Other','o@example.com','Changed message')
    on conflict (request_id) do nothing;
  get diagnostics n = row_count; assert n = 0, 'duplicate must insert 0 rows';
  assert (select count(*) from public.contact_submissions) = 1, 'expected exactly 1 row';
  assert (select name from public.contact_submissions) = 'Ada', 'original row overwritten';
  assert (select created_at is not null from public.contact_submissions), 'created_at default missing';
  begin update public.contact_submissions set name = 'y';
    raise exception 'service_role update allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.contact_submissions(request_id,name,email,message) values (gen_random_uuid(),'n','a@b.c','long enough message');
    raise exception 'short name allowed'; exception when check_violation then null; end;
  begin insert into public.contact_submissions(request_id,name,email,message) values (gen_random_uuid(),'nn','a@b.c',repeat('m',1001));
    raise exception 'oversized message allowed'; exception when check_violation then null; end;
  reset role;
  raise notice 'MIGRATION TESTS PASSED';
end $$;
