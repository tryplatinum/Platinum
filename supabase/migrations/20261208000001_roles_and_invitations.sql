-- Roles and invitations.
--
-- Until now an owner could write firm_members rows directly, including a row
-- for any user id. From here on nobody writes that table directly:
--
--   * A person joins a firm by accepting an invitation (accept_counselor_invitation,
--     service role only, called by /api/account after it has verified the sign-in).
--   * A role changes through set_member_role. Only an owner may call it. An owner
--     can make a counselor an owner, and can step down only while another owner exists.
--   * A member is removed through remove_member (owners, counselors only) or leaves
--     through leave_firm. Either way that person's Google connection is deleted,
--     their phone is revoked, their messages that are still queued or waiting for
--     their phone are cancelled, and one activity line is written. Their sign-in
--     is not deleted, and nothing they approved or logged before is changed.
--   * A member renames themselves through rename_self. apply_changes calls it.
--   * A firm with members always has an owner. The functions check it with the
--     firm row locked; a deferred constraint trigger refuses any other path.
--
-- Invitations are links a person copies. Platinum sends nothing: no outbox row
-- is made and no transport is called. Only the SHA-256 hash of the 32-byte
-- secret is stored, as for student links, and signed-in people cannot read it.
--
-- Also here, because it is a role rule on the same function: apply_changes
-- refuses to delete a student, or clear the caseload, for anyone but an owner.
--
-- Tightened: firm_members loses insert, update and delete for signed-in people.
-- Loosened: nothing. activity.student_id may now be null, for a line about the
-- firm itself; who may read or write activity is unchanged.

-- ── firm_members: read only for signed-in people ────────────────────────────

drop policy firm_members_insert on public.firm_members;
drop policy firm_members_update on public.firm_members;
drop policy firm_members_delete on public.firm_members;
revoke insert, update, delete on table public.firm_members from authenticated;

-- A line about the firm, not about one student (a member joined or was removed).
alter table public.activity alter column student_id drop not null;

-- The backstop for "a firm with members always has an owner". Deferred, so a
-- firm that is deleted whole (its members go with it) passes.
create function public.firm_keeps_an_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.firm_members m where m.firm_id = old.firm_id)
     and not exists (select 1 from public.firm_members m where m.firm_id = old.firm_id and m.role = 'owner') then
    raise exception 'A firm needs at least one owner.' using errcode = '23514';
  end if;
  return null;
end
$$;

revoke execute on function public.firm_keeps_an_owner() from public, anon, authenticated;

create constraint trigger firm_keeps_an_owner
  after delete or update of role on public.firm_members
  deferrable initially deferred
  for each row execute function public.firm_keeps_an_owner();

-- ── Renaming yourself ───────────────────────────────────────────────────────

create function public.rename_self(display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  update public.firm_members m set display_name = btrim(rename_self.display_name)
  where m.user_id = (select auth.uid());
  if not found then
    raise exception 'You are not a member of a firm.' using errcode = '42501';
  end if;
end
$$;

revoke execute on function public.rename_self(text) from public, anon;
grant execute on function public.rename_self(text) to authenticated;

-- ── Changing a role ─────────────────────────────────────────────────────────

create function public.set_member_role(member uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  firm uuid;
  current_role_ text;
begin
  if caller is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if new_role is null or new_role not in ('owner', 'counselor') then
    raise exception 'A role is owner or counselor.' using errcode = '22023';
  end if;
  select m.firm_id into firm from public.firm_members m where m.user_id = caller and m.role = 'owner';
  if firm is null then
    raise exception 'Only an owner can change a role.' using errcode = '42501';
  end if;
  -- One membership change at a time in a firm, so two owners cannot both step down.
  perform 1 from public.firms f where f.id = firm for update;
  if not exists (select 1 from public.firm_members m where m.user_id = caller and m.firm_id = firm and m.role = 'owner') then
    raise exception 'Only an owner can change a role.' using errcode = '42501';
  end if;
  select m.role into current_role_ from public.firm_members m where m.firm_id = firm and m.user_id = member;
  if current_role_ is null then
    raise exception 'That person is not a member of your firm.' using errcode = '42501';
  end if;
  if current_role_ = new_role then
    return;
  end if;
  if new_role = 'counselor' then
    -- Stepping down is something an owner does to themselves.
    if member <> caller then
      raise exception 'An owner steps down themselves. You cannot change another owner''s role.' using errcode = '42501';
    end if;
    if (select count(*) from public.firm_members m where m.firm_id = firm and m.role = 'owner') < 2 then
      raise exception 'You are the only owner. Make someone else an owner first.' using errcode = '23514';
    end if;
  end if;
  update public.firm_members m set role = new_role where m.firm_id = firm and m.user_id = member;
  -- A line about the firm names the people in its text, so it reads the same to whoever opens Activity.
  insert into public.activity (firm_id, student_id, actor, actor_user, text)
  select firm, null, 'system', caller,
    case when new_role = 'owner'
      then (select o.display_name from public.firm_members o where o.firm_id = firm and o.user_id = caller) || ' made ' || m.display_name || ' an owner.'
      else m.display_name || ' stepped down from owner to counselor.' end
  from public.firm_members m where m.firm_id = firm and m.user_id = member;
end
$$;

revoke execute on function public.set_member_role(uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, text) to authenticated;

-- ── Removing a member, and leaving ──────────────────────────────────────────

-- What removing this member would do, for the confirmation an owner reads first.
create function public.member_removal_summary(member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  firm uuid;
begin
  select m.firm_id into firm from public.firm_members m where m.user_id = (select auth.uid()) and m.role = 'owner';
  if firm is null or not exists (select 1 from public.firm_members m where m.firm_id = firm and m.user_id = member) then
    raise exception 'That person is not a member of your firm.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'google', exists (select 1 from public.google_connections g where g.user_id = member and g.firm_id = firm),
    'phone', exists (select 1 from public.phone_devices d where d.counselor_id = member and d.firm_id = firm and d.revoked_at is null),
    'queued', (
      select count(*)::integer from public.outbox o
      where o.firm_id = firm and o.approved_by = member
        and (o.status = 'queued' or (o.status = 'sending' and exists (
          select 1 from public.phone_send_jobs j where j.outbox_id = o.id and j.status = 'pending')))
    )
  );
end
$$;

revoke execute on function public.member_removal_summary(uuid) from public, anon;
grant execute on function public.member_removal_summary(uuid) to authenticated;

-- The one place a membership ends. Not callable by anyone: remove_member and
-- leave_firm check who is asking, lock the firm, and then call this.
create function public.end_membership_(firm uuid, member uuid, actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who text;
  by_whom text;
  had_google boolean;
  had_phone boolean;
  cancelled integer := 0;
  did text[] := '{}';
begin
  select m.display_name into who from public.firm_members m where m.firm_id = firm and m.user_id = member;
  select m.display_name into by_whom from public.firm_members m where m.firm_id = firm and m.user_id = actor;
  if who is null then
    raise exception 'That person is not a member of your firm.' using errcode = '42501';
  end if;

  delete from public.google_connections g where g.user_id = member and g.firm_id = firm;
  had_google := found;

  -- Texts handed to this person's phone that it has not taken yet.
  with gone as (
    update public.phone_send_jobs j set status = 'cancelled', body = null
    from public.phone_devices d
    where d.id = j.device_id and d.counselor_id = member and d.firm_id = firm and j.status = 'pending'
    returning j.id, j.outbox_id
  ), logged as (
    insert into public.phone_job_events (job_id, from_status, to_status, actor, actor_id)
    select g.id, 'pending', 'cancelled', 'counselor', actor from gone g
  ), rows as (
    update public.outbox o set status = 'cancelled', delivery_detail = null
    from gone g where o.id = g.outbox_id and o.status = 'sending'
    returning 1
  )
  select count(*) into cancelled from rows;

  update public.phone_devices d set revoked_at = now()
  where d.counselor_id = member and d.firm_id = firm and d.revoked_at is null;
  had_phone := found;

  with rows as (
    update public.outbox o set status = 'cancelled'
    where o.firm_id = firm and o.approved_by = member and o.status = 'queued'
    returning 1
  )
  select cancelled + count(*) into cancelled from rows;

  delete from public.firm_members m where m.firm_id = firm and m.user_id = member;

  if had_google then did := array_append(did, 'Google disconnected'); end if;
  if had_phone then did := array_append(did, 'phone revoked'); end if;
  if cancelled > 0 then
    did := array_append(did, cancelled || case cancelled when 1 then ' queued message cancelled' else ' queued messages cancelled' end);
  end if;
  insert into public.activity (firm_id, student_id, actor, actor_user, text)
  values (
    firm, null, 'system', actor,
    case when member = actor then who || ' left the firm' else coalesce(by_whom, 'An owner') || ' removed ' || who || ' from the firm' end
      || case when cardinality(did) > 0 then ': ' || array_to_string(did, ', ') || '.' else '.' end
  );

  return jsonb_build_object('google', had_google, 'phone', had_phone, 'cancelled', cancelled);
end
$$;

revoke execute on function public.end_membership_(uuid, uuid, uuid) from public, anon, authenticated;

create function public.remove_member(member uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  firm uuid;
  their_role text;
begin
  if caller is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  select m.firm_id into firm from public.firm_members m where m.user_id = caller and m.role = 'owner';
  if firm is null then
    raise exception 'Only an owner can remove a member.' using errcode = '42501';
  end if;
  perform 1 from public.firms f where f.id = firm for update;
  if not exists (select 1 from public.firm_members m where m.user_id = caller and m.firm_id = firm and m.role = 'owner') then
    raise exception 'Only an owner can remove a member.' using errcode = '42501';
  end if;
  if member = caller then
    raise exception 'To remove yourself, leave the firm.' using errcode = '22023';
  end if;
  select m.role into their_role from public.firm_members m where m.firm_id = firm and m.user_id = member;
  if their_role is null then
    raise exception 'That person is not a member of your firm.' using errcode = '42501';
  end if;
  if their_role = 'owner' then
    raise exception 'An owner cannot be removed. They step down first.' using errcode = '42501';
  end if;
  return public.end_membership_(firm, member, caller);
end
$$;

revoke execute on function public.remove_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;

create function public.leave_firm()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  firm uuid;
  my_role text;
begin
  if caller is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  select m.firm_id into firm from public.firm_members m where m.user_id = caller;
  if firm is null then
    raise exception 'You are not a member of a firm.' using errcode = '42501';
  end if;
  perform 1 from public.firms f where f.id = firm for update;
  select m.role into my_role from public.firm_members m where m.firm_id = firm and m.user_id = caller;
  if my_role is null then
    raise exception 'You are not a member of a firm.' using errcode = '42501';
  end if;
  if my_role = 'owner' and (select count(*) from public.firm_members m where m.firm_id = firm and m.role = 'owner') < 2 then
    raise exception 'You are the only owner. Make someone else an owner first.' using errcode = '23514';
  end if;
  return public.end_membership_(firm, caller, caller);
end
$$;

revoke execute on function public.leave_firm() from public, anon;
grant execute on function public.leave_firm() to authenticated;

-- ── Invitations ─────────────────────────────────────────────────────────────

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  kind text not null check (kind in ('counselor', 'student')),
  -- Always lower case, so "the same address" is one comparison.
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- For a student invitation, the student of the same firm it gives a sign-in to.
  student_id uuid,
  -- Hex SHA-256 of the secret in the link. The secret itself is never stored.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  foreign key (firm_id, student_id) references public.students (firm_id, id) on delete cascade,
  check ((kind = 'student') = (student_id is not null)),
  check (accepted_at is null or revoked_at is null)
);

-- At most one invitation waiting for an address in a firm, and one for a student.
create unique index invitations_one_pending_idx on public.invitations (firm_id, email)
  where accepted_at is null and revoked_at is null;
create unique index invitations_one_pending_student_idx on public.invitations (firm_id, student_id)
  where accepted_at is null and revoked_at is null and student_id is not null;
create index invitations_firm_idx on public.invitations (firm_id, created_at desc);

alter table public.invitations enable row level security;
create policy invitations_select on public.invitations for select to authenticated using (public.is_firm_member(firm_id));

-- Members read their firm's invitations, every column but the hash. Nobody
-- writes the table directly: there is no insert, update or delete grant.
revoke all on table public.invitations from public, anon, authenticated;
grant select (id, firm_id, kind, email, student_id, created_by, created_at, expires_at, accepted_at, accepted_by, revoked_at)
  on table public.invitations to authenticated;
grant all on table public.invitations to service_role;

-- An owner invites a counselor. `replace` is the "New link" action: the
-- invitation it names is revoked in the same transaction. Refused when the
-- address already has an invitation waiting in this firm, or is already a member.
create function public.invite_counselor(email text, token_hash text, replace uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  firm uuid;
  address text := lower(btrim(invite_counselor.email));
  made public.invitations;
begin
  if caller is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  select m.firm_id into firm from public.firm_members m where m.user_id = caller and m.role = 'owner';
  if firm is null then
    raise exception 'Only an owner can invite a counselor.' using errcode = '42501';
  end if;
  perform 1 from public.firms f where f.id = firm for update;

  if replace is not null then
    update public.invitations i set revoked_at = now()
    where i.id = replace and i.firm_id = firm and i.kind = 'counselor' and i.accepted_at is null and i.revoked_at is null;
    if not found then
      raise exception 'That invitation is no longer waiting.' using errcode = 'PI001';
    end if;
  end if;
  -- One that ran out stops counting as waiting.
  update public.invitations i set revoked_at = now()
  where i.firm_id = firm and i.email = address and i.accepted_at is null and i.revoked_at is null and i.expires_at <= now();

  if exists (
    select 1 from public.firm_members m join auth.users u on u.id = m.user_id
    where m.firm_id = firm and lower(u.email) = address
  ) then
    raise exception 'That address already belongs to a member of your firm.' using errcode = 'PI004';
  end if;
  if exists (select 1 from public.invitations i where i.firm_id = firm and i.email = address and i.accepted_at is null and i.revoked_at is null) then
    raise exception 'That address already has an invitation waiting. Make a new link for it instead.' using errcode = 'PI005';
  end if;

  insert into public.invitations (firm_id, kind, email, token_hash, created_by)
  values (firm, 'counselor', address, invite_counselor.token_hash, caller)
  returning * into made;
  return jsonb_build_object('id', made.id, 'email', made.email, 'expires_at', made.expires_at);
end
$$;

revoke execute on function public.invite_counselor(text, text, uuid) from public, anon;
grant execute on function public.invite_counselor(text, text, uuid) to authenticated;

-- Revoke an invitation that is still waiting. A counselor invitation is the
-- owner's to revoke; a student invitation is any member's.
create function public.revoke_invitation(invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  firm uuid;
  my_role text;
  its_kind text;
begin
  if caller is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  select m.firm_id, m.role into firm, my_role from public.firm_members m where m.user_id = caller;
  select i.kind into its_kind from public.invitations i where i.id = invitation and i.firm_id = firm;
  if firm is null or its_kind is null then
    raise exception 'That invitation was not found.' using errcode = '42501';
  end if;
  if its_kind = 'counselor' and my_role <> 'owner' then
    raise exception 'Only an owner can revoke a counselor''s invitation.' using errcode = '42501';
  end if;
  update public.invitations i set revoked_at = now()
  where i.id = invitation and i.firm_id = firm and i.accepted_at is null and i.revoked_at is null;
  if not found then
    raise exception 'That invitation is no longer waiting.' using errcode = 'PI001';
  end if;
end
$$;

revoke execute on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;

-- The checks every acceptance shares, with the invitation row locked so two
-- requests for the same invitation cannot both get past them. Not callable by
-- anyone: the accept functions call it.
--
--   PI001  the invitation does not work: unknown, expired, revoked or used.
--          One answer for all four.
--   PI002  the person's address is not confirmed yet.
--   PI003  the person's address is not the invited one.
--   PI004  the person already belongs to a firm.
create function public.claim_invitation_(hash text, person uuid, wanted text)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_ public.invitations;
  address text;
  confirmed timestamptz;
begin
  select * into found_ from public.invitations i where i.token_hash = hash and i.kind = wanted for update;
  if found_.id is null or found_.accepted_at is not null or found_.revoked_at is not null or found_.expires_at <= now() then
    raise exception 'This invitation does not work.' using errcode = 'PI001';
  end if;
  select lower(u.email), u.email_confirmed_at into address, confirmed from auth.users u where u.id = person;
  if address is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if confirmed is null then
    raise exception 'Confirm your email address first.' using errcode = 'PI002';
  end if;
  if address <> found_.email then
    raise exception 'This invitation is for another address.' using errcode = 'PI003';
  end if;
  -- One decision at a time about what kind of account this person is.
  perform pg_advisory_xact_lock(hashtextextended(person::text, 0));
  if exists (select 1 from public.firm_members m where m.user_id = person) then
    raise exception 'This account already belongs to a firm.' using errcode = 'PI004';
  end if;
  return found_;
end
$$;

revoke execute on function public.claim_invitation_(text, uuid, text) from public, anon, authenticated;

-- Accepting a counselor's invitation: the membership row and the invitation's
-- "used" mark are one transaction. Service role only. /api/account calls it
-- after verifying the person's sign-in with Supabase; the address and whether
-- it is confirmed are read here, from auth.users, not taken from the request.
create function public.accept_counselor_invitation(hash text, person uuid, display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invitations;
  name_ text := btrim(coalesce(accept_counselor_invitation.display_name, ''));
begin
  if char_length(name_) not between 1 and 200 then
    raise exception 'Your name is missing.' using errcode = '22023';
  end if;
  inv := public.claim_invitation_(hash, person, 'counselor');
  insert into public.firm_members (firm_id, user_id, role, display_name) values (inv.firm_id, person, 'counselor', name_);
  update public.invitations i set accepted_at = now(), accepted_by = person where i.id = inv.id;
  insert into public.activity (firm_id, student_id, actor, actor_user, text)
  values (inv.firm_id, null, 'system', person, name_ || ' joined the firm as a counselor.');
  return jsonb_build_object('kind', 'counselor', 'firm_id', inv.firm_id);
end
$$;

revoke execute on function public.accept_counselor_invitation(text, uuid, text) from public, anon, authenticated;
grant execute on function public.accept_counselor_invitation(text, uuid, text) to service_role;

-- ── apply_changes ───────────────────────────────────────────────────────────
-- apply_changes from 20261206000001, whole, with two changes and nothing else:
--
--   1. Renaming yourself calls rename_self, because a member can no longer
--      update firm_members directly.
--   2. Deleting a student, or clearing the caseload, is the owner's only. It
--      was already the owner's only when an owner-only file was in the way;
--      that check still comes first, unchanged, so its wording is still what
--      a counselor reads in that case.
create or replace function public.apply_changes(firm uuid, changes jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Parents before children, so foreign keys hold inside the batch.
  upsert_order constant text[] := array['document_types', 'students', 'parents', 'meetings', 'templates', 'tasks', 'colleges', 'documents', 'reports', 'reminder_rules', 'activity', 'personal_notes', 'weekly_texts', 'college_list_drafts', 'college_list_draft_items', 'message_drafts'];
  -- The log tables (outbox, activity) are never deleted from row by row, and
  -- folders (document_types) are archived, not deleted.
  delete_order constant text[] := array['college_list_draft_items', 'college_list_drafts', 'weekly_texts', 'personal_notes', 'documents', 'reports', 'colleges', 'tasks', 'meetings', 'parents', 'students'];
  t text;
  items jsonb;
  cols text;
  vals text;
  sets text;
  blocked integer := 0;
begin
  if not public.is_firm_member(firm) then
    raise exception 'You are not a member of this firm.' using errcode = '42501';
  end if;

  if (changes -> 'upsert') ? 'outbox' or (changes -> 'delete') ? 'outbox' then
    raise exception 'Messages are queued with queue_message, not saved with other edits.' using errcode = '42501';
  end if;

  -- Deleting a student, or clearing the caseload, takes the student's documents
  -- with it. When any of those is owner-only, only the owner may do it.
  if not public.is_firm_owner(firm) then
    if coalesce((changes ->> 'clear')::boolean, false) then
      blocked := public.owner_only_file_count(firm);
    elsif jsonb_typeof(changes -> 'delete' -> 'students') = 'array' and jsonb_array_length(changes -> 'delete' -> 'students') > 0 then
      blocked := public.owner_only_file_count(
        firm, array(select value::uuid from jsonb_array_elements_text(changes -> 'delete' -> 'students')));
    end if;
    if blocked > 0 then
      raise exception '% in the way: only the firm''s owner can open %, so only the owner can %. Nothing was changed.',
        case blocked when 1 then '1 owner-only file is' else blocked || ' owner-only files are' end,
        case blocked when 1 then 'it' else 'them' end,
        case when coalesce((changes ->> 'clear')::boolean, false) then 'clear the caseload' else 'delete this student' end
        using errcode = '42501';
    end if;
  end if;

  -- Deleting a student, or clearing the caseload, is the owner's only, files or no files.
  if not public.is_firm_owner(firm) then
    if coalesce((changes ->> 'clear')::boolean, false) then
      raise exception 'Only the firm''s owner can clear the caseload. Nothing was changed.' using errcode = '42501';
    elsif jsonb_typeof(changes -> 'delete' -> 'students') = 'array' and jsonb_array_length(changes -> 'delete' -> 'students') > 0 then
      raise exception 'Only the firm''s owner can delete a student. Nothing was changed.' using errcode = '42501';
    end if;
  end if;

  if changes -> 'firm' ? 'name' then
    update public.firms set name = btrim(changes -> 'firm' ->> 'name') where id = firm;
    if not found then
      raise exception 'Only the firm''s owner can rename it.' using errcode = '42501';
    end if;
  end if;
  if changes -> 'firm' ? 'displayName' then
    perform public.rename_self(changes -> 'firm' ->> 'displayName');
  end if;

  if changes -> 'firm' ? 'weeklyTextDay' then
    update public.firms set weekly_text_day = (changes -> 'firm' ->> 'weeklyTextDay')::smallint where id = firm;
    if not found then
      raise exception 'Only the firm''s owner can change firm settings.' using errcode = '42501';
    end if;
  end if;

  if changes -> 'firm' ? 'sortFilesAutomatically' then
    update public.firms set sort_files_automatically = (changes -> 'firm' ->> 'sortFilesAutomatically')::boolean where id = firm;
    if not found then
      raise exception 'Only the firm''s owner can change firm settings.' using errcode = '42501';
    end if;
  end if;

  if coalesce((changes ->> 'clear')::boolean, false) then
    -- Everything that belongs to a student goes with the student.
    delete from public.students where firm_id = firm;
    delete from public.reminder_rules where firm_id = firm;
  end if;

  foreach t in array upsert_order loop
    items := changes -> 'upsert' -> t;
    continue when items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0;

    select
      string_agg(format('%I', a.attname), ', ' order by a.attnum),
      string_agg(
        case a.attname
          when 'firm_id' then '$2'
          when 'id' then 'coalesce(r.id, gen_random_uuid())'
          else
            case when a.attnotnull and d.adbin is not null
              then format('coalesce(r.%I, %s)', a.attname, pg_catalog.pg_get_expr(d.adbin, d.adrelid))
              else format('r.%I', a.attname)
            end
        end, ', ' order by a.attnum),
      string_agg(format('%I = excluded.%I', a.attname, a.attname), ', ' order by a.attnum)
        filter (where a.attname not in ('id', 'firm_id'))
    into cols, vals, sets
    from pg_catalog.pg_attribute a
    left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = format('public.%I', t)::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attname not in ('seq', 'created_at', 'updated_at');

    execute format(
      'insert into public.%1$I (%2$s)
       select %3$s
       from jsonb_array_elements($1) with ordinality as e(value, ord)
       cross join lateral jsonb_populate_record(null::public.%1$I, e.value) as r
       order by e.ord
       on conflict %4$s do update set %5$s',
      t, cols, vals,
      case t when 'reminder_rules' then '(firm_id, rule)' else '(id)' end,
      sets)
    using items, firm;
  end loop;

  foreach t in array delete_order loop
    items := changes -> 'delete' -> t;
    continue when items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0;
    execute format(
      'delete from public.%I where firm_id = $2 and id in (select value::uuid from jsonb_array_elements_text($1))', t)
    using items, firm;
  end loop;
end
$$;
