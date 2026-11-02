-- WEB-001: contact form submissions.
-- Writes happen only server-side (Windmill flow using the service_role key).
-- Browsers never talk to this table: RLS is on, there are no policies, and
-- anon/authenticated have no table privileges at all.

create table if not exists public.contact_submissions (
  request_id  uuid        primary key,
  name        text        not null check (char_length(name)    between 2 and 80),
  email       text        not null check (char_length(email)   between 3 and 254),
  message     text        not null check (char_length(message) between 10 and 1000),
  created_at  timestamptz not null default now()
);

comment on table public.contact_submissions is
  'WEB-001 contact form. Inserted idempotently by Windmill flow f/web001/contact_intake (on conflict (request_id) do nothing).';

alter table public.contact_submissions enable row level security;

-- Deny every anonymous / end-user operation. No RLS policies are created on
-- purpose: with RLS enabled and no policy, PostgREST returns zero rows / 401
-- even if a grant were added back by mistake.
revoke all on table public.contact_submissions from anon, authenticated;
revoke all on table public.contact_submissions from public;

-- service_role bypasses RLS; reset Supabase's default ALL grant and give it
-- only what the flow needs (insert + select to confirm idempotent inserts).
-- Operators manage data via the dashboard / SQL editor (postgres role).
revoke all on table public.contact_submissions from service_role;
grant select, insert on table public.contact_submissions to service_role;
