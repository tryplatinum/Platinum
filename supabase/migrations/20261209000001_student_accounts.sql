-- Student sign-ins.
--
-- A student can be given a sign-in (email and password) that opens exactly what
-- their student link opens. A student is never a firm_members row and never
-- passes is_firm_member, so every existing policy keeps them out of every
-- table. What a student sees is still built on the server, field by field, by
-- the same code the link uses (server/studentLink.ts).
--
--   * student_accounts: one row a sign-in. The student reads their own row;
--     members read their firm's rows. No direct writes.
--   * A sign-in is exactly one kind of account. Two triggers refuse a
--     membership for a person who has a student account, and a student account
--     for a person who is a member. create_firm says so in plain words first.
--   * invite_student: any member. Refused below 9th grade, without the
--     "a parent or guardian knows" tick the first time, when the student
--     already has a sign-in, or when an invitation is already waiting.
--   * accept_student_invitation: service role only, called by /api/account
--     after it has verified the sign-in. Records the student's own
--     "I am 13 or older" tick.
--   * set_student_account_disabled: any member turns a sign-in off or on.
--   * student_account_consents: who ticked which sentence, when, and which
--     wording. Insert only: an update is refused for everyone, and a delete is
--     refused unless the whole firm is being deleted.
--
-- The grade rule: the school year turns over on July 1. A student who
-- graduates in the calendar year the current school year ends in is in 12th
-- grade. grade = 12 - (grad_year - that year). Below 9 is refused.
--
-- None of this is a legal review. It records what the screens asked.

-- ── The table ───────────────────────────────────────────────────────────────

create table public.student_accounts (
  -- One sign-in is one student account at most.
  user_id uuid primary key references auth.users (id) on delete cascade,
  firm_id uuid not null references public.firms (id) on delete cascade,
  student_id uuid not null,
  invitation_id uuid references public.invitations (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Set while a member has turned the sign-in off. Checked on every request.
  disabled_at timestamptz,
  disabled_by uuid references auth.users (id) on delete set null,
  -- One sign-in per student.
  unique (firm_id, student_id),
  foreign key (firm_id, student_id) references public.students (firm_id, id) on delete cascade
);

alter table public.student_accounts enable row level security;
create policy student_accounts_select on public.student_accounts for select to authenticated
  using (user_id = (select auth.uid()) or public.is_firm_member(firm_id));

revoke all on table public.student_accounts from public, anon, authenticated;
grant select on table public.student_accounts to authenticated;
grant all on table public.student_accounts to service_role;

-- ── One kind of account per sign-in ─────────────────────────────────────────

create function public.one_kind_of_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- One decision at a time about what kind of account this person is.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  if tg_table_name = 'firm_members' then
    if exists (select 1 from public.student_accounts a where a.user_id = new.user_id) then
      raise exception 'This sign-in is a student''s. A student cannot belong to a firm.' using errcode = 'PI004';
    end if;
  elsif exists (select 1 from public.firm_members m where m.user_id = new.user_id) then
    raise exception 'This account already belongs to a firm.' using errcode = 'PI004';
  end if;
  return new;
end
$$;

revoke execute on function public.one_kind_of_account() from public, anon, authenticated;

create trigger one_kind_of_account before insert on public.firm_members
  for each row execute function public.one_kind_of_account();
create trigger one_kind_of_account before insert on public.student_accounts
  for each row execute function public.one_kind_of_account();

-- create_firm from 20261126000001, whole, with one refusal added: a person
-- with a student account cannot start a firm. Nothing else changes.
create or replace function public.create_firm(name text, display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  new_firm uuid;
begin
  if caller is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if exists (select 1 from public.firm_members m where m.user_id = caller) then
    raise exception 'This account already belongs to a firm.' using errcode = '23505';
  end if;
  if exists (select 1 from public.student_accounts a where a.user_id = caller) then
    raise exception 'This sign-in is a student''s. A student cannot start a firm.' using errcode = '42501';
  end if;

  insert into public.firms (name) values (btrim(create_firm.name)) returning id into new_firm;
  insert into public.firm_members (firm_id, user_id, role, display_name)
  values (new_firm, caller, 'owner', btrim(create_firm.display_name));
  perform public.seed_document_types(new_firm);
  return new_firm;
end
$$;

-- ── Who ticked what ─────────────────────────────────────────────────────────

create table public.student_account_consents (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  -- Plain ids, no foreign keys: the record outlives the student row, the
  -- invitation and the sign-in it is about.
  student_id uuid not null,
  invitation_id uuid,
  -- guardian_knows: a member ticked "A parent or guardian of … knows about this
  -- account and agrees to it." student_age: the student ticked "I am 13 or older".
  kind text not null check (kind in ('guardian_knows', 'student_age')),
  -- Which wording was on the screen. The sentences live in shared/account.ts.
  wording_version text not null check (char_length(wording_version) between 1 and 40),
  -- The member, or the student, who ticked it.
  by_user uuid not null,
  at timestamptz not null default now()
);

create index student_account_consents_student_idx on public.student_account_consents (firm_id, student_id);

alter table public.student_account_consents enable row level security;
create policy student_account_consents_select on public.student_account_consents for select to authenticated
  using (public.is_firm_member(firm_id));

revoke all on table public.student_account_consents from public, anon, authenticated;
grant select on table public.student_account_consents to authenticated;
grant all on table public.student_account_consents to service_role;

-- Insert only, for every role. A row goes only when its firm is deleted whole,
-- which arrives here as a cascade (one trigger deeper than a direct delete).
create function public.consents_are_insert_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'A consent record is never changed or removed.' using errcode = '42501';
end
$$;

revoke execute on function public.consents_are_insert_only() from public, anon, authenticated;

create trigger consents_are_insert_only before update or delete on public.student_account_consents
  for each row execute function public.consents_are_insert_only();

-- ── The grade rule ──────────────────────────────────────────────────────────

-- The grade a student with this graduation year is in on a given day. The
-- school year turns over on July 1. shared/account.ts has the same rule.
create function public.student_grade(grad_year integer, on_day date default current_date)
returns integer
language sql
stable
set search_path = ''
as $$
  select 12 - (grad_year - (extract(year from on_day)::integer + case when extract(month from on_day) >= 7 then 1 else 0 end))
$$;

revoke execute on function public.student_grade(integer, date) from public, anon;
grant execute on function public.student_grade(integer, date) to authenticated, service_role;

-- ── Inviting a student ──────────────────────────────────────────────────────

-- Any member invites a student of their firm. `consent_version` is the wording
-- of the "a parent or guardian knows" sentence the member ticked; it is
-- required the first time and recorded. "New link" (`replace`) may leave it
-- out, because the tick is already on record for that student.
--
--   PI005  an invitation is already waiting for the address or the student
--   PI006  below 9th grade: use the student link instead
--   PI007  the student already has a sign-in
--   PI008  the parent or guardian tick is missing
create function public.invite_student(student uuid, email text, token_hash text, consent_version text default null, replace uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  firm uuid;
  address text := lower(btrim(invite_student.email));
  who public.students;
  made public.invitations;
begin
  if caller is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  select m.firm_id into firm from public.firm_members m where m.user_id = caller;
  if firm is null then
    raise exception 'You are not a member of a firm.' using errcode = '42501';
  end if;
  perform 1 from public.firms f where f.id = firm for update;

  select * into who from public.students s where s.id = student and s.firm_id = firm;
  if who.id is null then
    raise exception 'That student was not found.' using errcode = '42501';
  end if;
  if who.archived then
    raise exception 'An archived student cannot be given a sign-in.' using errcode = '22023';
  end if;
  if public.student_grade(who.grad_year) < 9 then
    raise exception '% is below 9th grade, so cannot have a sign-in yet. Use the student link instead.', who.first_name using errcode = 'PI006';
  end if;
  if exists (select 1 from public.student_accounts a where a.firm_id = firm and a.student_id = student) then
    raise exception '% already has a sign-in.', who.first_name using errcode = 'PI007';
  end if;

  if replace is not null then
    update public.invitations i set revoked_at = now()
    where i.id = replace and i.firm_id = firm and i.kind = 'student' and i.student_id = student and i.accepted_at is null and i.revoked_at is null;
    if not found then
      raise exception 'That invitation is no longer waiting.' using errcode = 'PI009';
    end if;
  end if;
  -- One that ran out stops counting as waiting.
  update public.invitations i set revoked_at = now()
  where i.firm_id = firm and (i.email = address or i.student_id = student)
    and i.accepted_at is null and i.revoked_at is null and i.expires_at <= now();

  if exists (
    select 1 from public.invitations i
    where i.firm_id = firm and (i.email = address or i.student_id = student) and i.accepted_at is null and i.revoked_at is null
  ) then
    raise exception 'An invitation is already waiting for that address or that student. Make a new link for it instead.' using errcode = 'PI005';
  end if;

  if nullif(btrim(coalesce(consent_version, '')), '') is null
     and not exists (
       select 1 from public.student_account_consents c
       where c.firm_id = firm and c.student_id = student and c.kind = 'guardian_knows'
     ) then
    raise exception 'Tick that a parent or guardian of % knows about this account and agrees to it.', who.first_name using errcode = 'PI008';
  end if;

  insert into public.invitations (firm_id, kind, email, student_id, token_hash, created_by)
  values (firm, 'student', address, student, invite_student.token_hash, caller)
  returning * into made;
  if nullif(btrim(coalesce(consent_version, '')), '') is not null then
    insert into public.student_account_consents (firm_id, student_id, invitation_id, kind, wording_version, by_user)
    values (firm, student, made.id, 'guardian_knows', btrim(consent_version), caller);
  end if;
  return jsonb_build_object('id', made.id, 'email', made.email, 'expires_at', made.expires_at);
end
$$;

revoke execute on function public.invite_student(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.invite_student(uuid, text, text, text, uuid) to authenticated;

-- ── Accepting a student invitation ──────────────────────────────────────────

-- The shared checks are claim_invitation_ from 20261208000001 (the invitation
-- is live, the address is confirmed and is the invited one, the person belongs
-- to no firm), with the row locked. `age_version` is the wording of the
-- "I am 13 or older" sentence the student ticked.
create function public.accept_student_invitation(hash text, person uuid, age_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invitations;
  who public.students;
begin
  if nullif(btrim(coalesce(age_version, '')), '') is null then
    raise exception 'Tick that you are 13 or older to continue.' using errcode = 'PI008';
  end if;
  inv := public.claim_invitation_(hash, person, 'student');
  if exists (select 1 from public.student_accounts a where a.user_id = person) then
    raise exception 'This sign-in already belongs to a student.' using errcode = 'PI004';
  end if;
  select * into who from public.students s where s.firm_id = inv.firm_id and s.id = inv.student_id;
  -- A student who was archived, or given a sign-in another way, since the invitation was made.
  if who.id is null or who.archived
     or exists (select 1 from public.student_accounts a where a.firm_id = inv.firm_id and a.student_id = inv.student_id) then
    raise exception 'This invitation does not work.' using errcode = 'PI001';
  end if;

  insert into public.student_accounts (user_id, firm_id, student_id, invitation_id)
  values (person, inv.firm_id, inv.student_id, inv.id);
  update public.invitations i set accepted_at = now(), accepted_by = person where i.id = inv.id;
  insert into public.student_account_consents (firm_id, student_id, invitation_id, kind, wording_version, by_user)
  values (inv.firm_id, inv.student_id, inv.id, 'student_age', btrim(age_version), person);
  insert into public.activity (firm_id, student_id, actor, actor_user, text)
  values (inv.firm_id, inv.student_id, 'student', null, who.first_name || ' made a sign-in.');
  return jsonb_build_object('kind', 'student', 'firm_id', inv.firm_id, 'student_id', inv.student_id);
end
$$;

revoke execute on function public.accept_student_invitation(text, uuid, text) from public, anon, authenticated;
grant execute on function public.accept_student_invitation(text, uuid, text) to service_role;

-- ── Turning a sign-in off and on ────────────────────────────────────────────

create function public.set_student_account_disabled(student uuid, disabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  firm uuid;
  first_name_ text;
begin
  if caller is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  select m.firm_id into firm from public.firm_members m where m.user_id = caller;
  select s.first_name into first_name_ from public.students s where s.id = student and s.firm_id = firm;
  if firm is null or first_name_ is null then
    raise exception 'That student was not found.' using errcode = '42501';
  end if;
  update public.student_accounts a
  set disabled_at = case when disabled then coalesce(a.disabled_at, now()) end,
      disabled_by = case when disabled then coalesce(a.disabled_by, caller) end
  where a.firm_id = firm and a.student_id = student;
  if not found then
    raise exception '% has no sign-in.', first_name_ using errcode = '22023';
  end if;
  insert into public.activity (firm_id, student_id, actor, text)
  values (firm, student, 'counselor', case when disabled then 'Turned off ' else 'Turned on ' end || first_name_ || '’s sign-in.');
end
$$;

revoke execute on function public.set_student_account_disabled(uuid, boolean) from public, anon;
grant execute on function public.set_student_account_disabled(uuid, boolean) to authenticated;
