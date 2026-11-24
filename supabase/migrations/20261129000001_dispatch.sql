-- M0.3: student_links.expires_at, and harden queue_message / cancel_message.
--
-- Hardening check against 20261128000001:
--   * Both functions are security definer.
--   * Execute is granted only to authenticated (revoked from public and anon).
--   * cancel_message already qualifies the parameter as cancel_message.id.
--   * search_path was '' — set it to public, pg_temp as required.
--
-- expires_at is null on existing rows (they do not expire). New links created
-- at send time get a 30-day expiry. Lookup rejects expired links.

alter table public.student_links
  add column if not exists expires_at timestamptz;

-- Dispatch outcomes are recorded as system activity (not a person).
alter table public.activity drop constraint if exists activity_actor_check;
alter table public.activity add constraint activity_actor_check
  check (actor in ('student', 'parent', 'counselor', 'ai', 'system'));

create or replace function public.queue_message(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := (select auth.uid());
  student uuid;
  firm uuid;
  parent uuid;
  task uuid;
  message public.outbox;
  entry public.activity;
begin
  if caller is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'The message is missing.' using errcode = '22023';
  end if;

  begin
    student := (payload ->> 'studentId')::uuid;
  exception when others then
    raise exception 'The message needs a student.' using errcode = '22023';
  end;

  select s.firm_id into firm from public.students s where s.id = student;
  if firm is null or not public.is_firm_member(firm) then
    raise exception 'You are not a member of this firm.' using errcode = '42501';
  end if;

  if payload ->> 'toKind' not in ('student', 'parent') or nullif(btrim(payload ->> 'toName'), '') is null then
    raise exception 'The message needs a recipient.' using errcode = '22023';
  end if;
  if payload ->> 'channel' not in ('email', 'wechat', 'line', 'text') then
    raise exception 'The message needs a channel.' using errcode = '22023';
  end if;
  if payload ->> 'language' not in ('en', 'zh-Hans', 'zh-Hant') then
    raise exception 'The message needs a language.' using errcode = '22023';
  end if;
  if payload ->> 'kind' not in ('parent_report', 'reminder_upcoming', 'reminder_late', 'meeting_recap', 'essay_feedback', 'weekly_text') then
    raise exception 'The message needs a kind.' using errcode = '22023';
  end if;
  if nullif(btrim(payload ->> 'body'), '') is null then
    raise exception 'The message needs a body.' using errcode = '22023';
  end if;

  if payload ->> 'toKind' = 'parent' then
    begin
      parent := (payload ->> 'parentId')::uuid;
    exception when others then
      parent := null;
    end;
    if parent is null or not exists (
      select 1 from public.parents p where p.id = parent and p.student_id = student and p.firm_id = firm
    ) then
      raise exception 'The message needs the parent it is addressed to.' using errcode = '22023';
    end if;
  end if;

  if nullif(payload ->> 'taskId', '') is not null then
    begin
      task := (payload ->> 'taskId')::uuid;
    exception when others then
      task := null;
    end;
    if task is null or not exists (
      select 1 from public.tasks t where t.id = task and t.student_id = student and t.firm_id = firm
    ) then
      task := null;
    end if;
  end if;

  insert into public.outbox (
    id, firm_id, student_id, to_kind, to_name, parent_id, channel, language, kind,
    body, body_en, trigger, task_id, note, dedupe_key,
    status, send_after, approved_by, approved_at, approval
  ) values (
    coalesce(
      case when payload ->> 'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (payload ->> 'id')::uuid end,
      gen_random_uuid()
    ),
    firm,
    student,
    payload ->> 'toKind',
    btrim(payload ->> 'toName'),
    parent,
    payload ->> 'channel',
    payload ->> 'language',
    payload ->> 'kind',
    payload ->> 'body',
    nullif(payload ->> 'bodyEn', ''),
    case when payload ->> 'trigger' = 'automatic' then 'automatic' else 'approved' end,
    task,
    nullif(payload ->> 'note', ''),
    nullif(payload ->> 'dedupeKey', ''),
    'queued',
    now() + interval '60 seconds',
    caller,
    now(),
    jsonb_build_object(
      'by', coalesce(nullif(btrim(payload ->> 'approvedBy'), ''), 'Counselor'),
      'byId', caller,
      'at', now()
    )
  ) returning * into message;

  insert into public.activity (firm_id, student_id, actor, text)
  values (
    firm,
    student,
    'counselor',
    'Approved a ' || replace(message.kind, '_', ' ') || ' to ' || message.to_name || '.'
  ) returning * into entry;

  return jsonb_build_object('message', to_jsonb(message), 'activity', to_jsonb(entry));
end
$$;

create or replace function public.cancel_message(id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := (select auth.uid());
  message public.outbox;
  entry public.activity;
begin
  if caller is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;

  select * into message from public.outbox o where o.id = cancel_message.id;
  if not found or not public.is_firm_member(message.firm_id) then
    raise exception 'That message is not in your firm.' using errcode = '42501';
  end if;
  if message.status <> 'queued' or now() >= message.send_after then
    raise exception 'That message can no longer be undone.' using errcode = '42501';
  end if;

  update public.outbox o set status = 'cancelled' where o.id = message.id returning * into message;

  insert into public.activity (firm_id, student_id, actor, text)
  values (
    message.firm_id,
    message.student_id,
    'counselor',
    'Cancelled a ' || replace(message.kind, '_', ' ') || ' to ' || message.to_name || '.'
  ) returning * into entry;

  return jsonb_build_object('message', to_jsonb(message), 'activity', to_jsonb(entry));
end
$$;

revoke execute on function public.queue_message(jsonb) from public, anon;
revoke execute on function public.cancel_message(uuid) from public, anon;
grant execute on function public.queue_message(jsonb) to authenticated;
grant execute on function public.cancel_message(uuid) to authenticated;
