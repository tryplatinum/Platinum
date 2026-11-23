-- Student links: a student opens their page with a secret link, no login.
--
-- Only the SHA-256 hash of the 32-byte token is stored, so reading this table
-- does not give anyone a working link. Counselors manage links through the
-- policies below. The link itself is redeemed by the server function
-- api/student.ts with the service role key; no table is opened to anon.

create table public.student_links (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  student_id uuid not null,
  -- Hex SHA-256 of the token.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (firm_id, student_id) references public.students (firm_id, id) on delete cascade
);

create index student_links_firm_student_idx on public.student_links (firm_id, student_id);

alter table public.student_links enable row level security;
create policy student_links_select on public.student_links for select to authenticated using (public.is_firm_member(firm_id));
create policy student_links_insert on public.student_links for insert to authenticated with check (public.is_firm_member(firm_id));
create policy student_links_update on public.student_links for update to authenticated
  using (public.is_firm_member(firm_id)) with check (public.is_firm_member(firm_id));
create policy student_links_delete on public.student_links for delete to authenticated using (public.is_firm_member(firm_id));

revoke all on table public.student_links from public, anon, authenticated;
grant select, insert, update, delete on table public.student_links to authenticated;
grant all on table public.student_links to service_role;

create trigger set_updated_at before update on public.student_links
  for each row execute function public.set_updated_at();
