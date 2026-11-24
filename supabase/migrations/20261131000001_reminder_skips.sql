-- Skips for reminder queue items. A skip with until null lasts until undone.
-- A skip with until set is ignored once that day has passed (date, local firm day).

create table public.reminder_skips (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  dedupe_key text not null,
  skipped_by uuid references auth.users (id) on delete set null,
  skipped_at timestamptz not null default now(),
  until date,
  unique (firm_id, dedupe_key)
);

create index reminder_skips_firm_dedupe_idx on public.reminder_skips (firm_id, dedupe_key);

alter table public.reminder_skips enable row level security;

create policy reminder_skips_select on public.reminder_skips
  for select to authenticated using (public.is_firm_member(firm_id));

create policy reminder_skips_insert on public.reminder_skips
  for insert to authenticated with check (public.is_firm_member(firm_id));

create policy reminder_skips_delete on public.reminder_skips
  for delete to authenticated using (public.is_firm_member(firm_id));

revoke all on table public.reminder_skips from public, anon;
grant select, insert, delete on table public.reminder_skips to authenticated;
grant all on table public.reminder_skips to service_role;
