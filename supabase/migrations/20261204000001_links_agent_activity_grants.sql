-- Student link expiry, narrower table privileges, the assistant's daily budget,
-- and who an activity line says it came from.
--
--   * student_links.expires_at is required. Rows without one get 30 days from
--     now; new rows default to 30 days. Signed-in people can no longer read
--     token_hash.
--   * agent_threads, agent_messages, agent_proposals and reminder_skips: every
--     privilege is revoked from signed-in people, then only what the app uses is
--     granted back. Approving, discarding and editing a proposal go through
--     decide_agent_proposal and edit_agent_proposal.
--   * agent_proposals and agent_threads point at a student of the same firm.
--   * agent_usage counts model calls per firm per UTC day. reserve_agent_call
--     checks and takes one in a single statement.
--   * The outbox's unused write policies are dropped. Writes go through
--     queue_message and cancel_message only.
--   * activity.actor_user. A signed-in person may write only their own
--     counselor lines. Student, parent, AI and system lines come from security
--     definer functions or the service role.

-- ── Student links ───────────────────────────────────────────────────────────

update public.student_links set expires_at = now() + interval '30 days' where expires_at is null;
alter table public.student_links alter column expires_at set default (now() + interval '30 days');
alter table public.student_links alter column expires_at set not null;

-- A column grant is ignored while a table-wide select exists, so select is
-- revoked for the whole table and granted back column by column.
revoke select on table public.student_links from authenticated;
grant select (id, firm_id, student_id, created_by, created_at, updated_at, revoked_at, expires_at)
  on table public.student_links to authenticated;

-- ── Assistant tables and reminder skips ─────────────────────────────────────

revoke all on table public.agent_threads from public, anon, authenticated;
revoke all on table public.agent_messages from public, anon, authenticated;
revoke all on table public.agent_proposals from public, anon, authenticated;
revoke all on table public.reminder_skips from public, anon, authenticated;

grant select on table public.agent_threads to authenticated;
grant select on table public.agent_messages to authenticated;
grant select on table public.agent_proposals to authenticated;
grant select, insert, delete on table public.reminder_skips to authenticated;

grant all on table public.agent_threads to service_role;
grant all on table public.agent_messages to service_role;
grant all on table public.agent_proposals to service_role;
grant all on table public.reminder_skips to service_role;

drop policy if exists agent_proposals_update on public.agent_proposals;

-- A proposal or a thread for a student of another firm was never valid.
delete from public.agent_proposals p
where not exists (select 1 from public.students s where s.id = p.student_id and s.firm_id = p.firm_id);
delete from public.agent_threads t
where t.student_id is not null
  and not exists (select 1 from public.students s where s.id = t.student_id and s.firm_id = t.firm_id);

alter table public.agent_proposals drop constraint if exists agent_proposals_student_id_fkey;
alter table public.agent_proposals
  add constraint agent_proposals_firm_id_student_id_fkey
  foreign key (firm_id, student_id) references public.students (firm_id, id) on delete cascade;

alter table public.agent_threads drop constraint if exists agent_threads_student_id_fkey;
alter table public.agent_threads
  add constraint agent_threads_firm_id_student_id_fkey
  foreign key (firm_id, student_id) references public.students (firm_id, id) on delete cascade;

-- Approve or discard a pending proposal. The decider is always the caller.
-- Returns false when the proposal is not pending or not in the caller's firm.
create function public.decide_agent_proposal(proposal uuid, decision text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if decision not in ('approved', 'discarded') then
    raise exception 'A proposal is approved or discarded.' using errcode = '22023';
  end if;
  update public.agent_proposals p
  set status = decision, decided_by = (select auth.uid()), decided_at = now()
  where p.id = proposal and p.status = 'pending' and public.is_firm_member(p.firm_id);
  return found;
end
$$;

-- Replace the payload of a pending proposal (an edit in Approvals, or the
-- English added by /api/translate). Nothing else on the row changes.
create function public.edit_agent_proposal(proposal uuid, payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'The draft is missing.' using errcode = '22023';
  end if;
  update public.agent_proposals p
  set payload = edit_agent_proposal.payload
  where p.id = proposal and p.status = 'pending' and public.is_firm_member(p.firm_id);
  return found;
end
$$;

revoke execute on function public.decide_agent_proposal(uuid, text) from public, anon;
revoke execute on function public.edit_agent_proposal(uuid, jsonb) from public, anon;
grant execute on function public.decide_agent_proposal(uuid, text) to authenticated;
grant execute on function public.edit_agent_proposal(uuid, jsonb) to authenticated;

-- ── The assistant's daily budget ────────────────────────────────────────────

create table public.agent_usage (
  firm_id uuid not null references public.firms (id) on delete cascade,
  day date not null,
  calls integer not null default 0 check (calls >= 0),
  primary key (firm_id, day)
);

alter table public.agent_usage enable row level security;
revoke all on table public.agent_usage from public, anon, authenticated;
grant all on table public.agent_usage to service_role;

-- Takes one model call from today's budget (UTC). True when it was taken. The
-- check and the increment are one statement, so two callers at the limit
-- cannot both get the last call.
create function public.reserve_agent_call(firm uuid, day_limit integer)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with taken as (
    insert into public.agent_usage as u (firm_id, day, calls)
    select firm, (now() at time zone 'utc')::date, 1
    where day_limit > 0
    on conflict (firm_id, day) do update set calls = u.calls + 1
    where u.calls < day_limit
    returning 1
  )
  select exists (select 1 from taken)
$$;

revoke execute on function public.reserve_agent_call(uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_agent_call(uuid, integer) to service_role;

-- ── Outbox ──────────────────────────────────────────────────────────────────

drop policy if exists outbox_insert on public.outbox;
drop policy if exists outbox_update on public.outbox;
drop policy if exists outbox_delete on public.outbox;

-- ── Activity ────────────────────────────────────────────────────────────────

-- Defaults to the caller, so lines written by queue_message, cancel_message and
-- the other functions a counselor calls record who did it. Null for the
-- service role and for older rows.
alter table public.activity
  add column actor_user uuid default auth.uid() references auth.users (id) on delete set null;

drop policy if exists activity_insert on public.activity;
drop policy if exists activity_update on public.activity;

create policy activity_insert on public.activity for insert to authenticated
  with check (public.is_firm_member(firm_id) and actor = 'counselor' and actor_user = (select auth.uid()));
create policy activity_update on public.activity for update to authenticated
  using (public.is_firm_member(firm_id) and actor = 'counselor' and actor_user = (select auth.uid()))
  with check (public.is_firm_member(firm_id) and actor = 'counselor' and actor_user = (select auth.uid()));

-- The one AI line the browser used to write itself: drafts for a meeting are
-- ready. The text is built here from the meeting's own title.
create function public.log_meeting_drafts_ready(meeting uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.meetings%rowtype;
  entry public.activity;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  select * into m from public.meetings x where x.id = meeting;
  if not found or not public.is_firm_member(m.firm_id) then
    raise exception 'That meeting was not found.' using errcode = '42501';
  end if;
  insert into public.activity (firm_id, student_id, actor, text)
  values (m.firm_id, m.student_id, 'ai', 'Drafts from “' || m.title || '” are ready for review')
  returning * into entry;
  return to_jsonb(entry);
end
$$;

revoke execute on function public.log_meeting_drafts_ready(uuid) from public, anon;
grant execute on function public.log_meeting_drafts_ready(uuid) to authenticated;
