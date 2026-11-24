-- Outbox rows are a queue, not a log the browser can write.
--
-- A signed-in firm member can still read the outbox. They cannot insert, update
-- or delete it, and apply_changes refuses a batch that names it. The only way
-- in is queue_message, which records who approved it and holds it for 60
-- seconds. cancel_message undoes it during that window.
--
-- Existing rows were simulated sends. They are marked sent so the new sender
-- (M1) will not deliver them.
--
-- The checks already on reports and weekly texts stay: an AI report cannot be
-- marked sent without an approval, and a weekly text cannot be marked sent
-- without one. The message that goes with that approval is queued here.

alter table public.outbox add column status text;
alter table public.outbox add column send_after timestamptz;
alter table public.outbox add column approved_by uuid references auth.users (id) on delete set null;
alter table public.outbox add column approved_at timestamptz;
alter table public.outbox add column provider_message_id text;
alter table public.outbox add column error text;

update public.outbox set
  status = 'sent',
  send_after = sent_at,
  approved_at = coalesce(
    case when approval ->> 'at' ~ '^\d{4}-\d{2}-\d{2}' then (approval ->> 'at')::timestamptz end,
    sent_at
  ),
  approved_by = case
    when approval ->> 'byId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (approval ->> 'byId')::uuid
  end,
  note = case
    when note is null or btrim(note) = '' then 'Legacy simulated send.'
    else note || ' Legacy simulated send.'
  end;

alter table public.outbox alter column status set default 'queued';
alter table public.outbox alter column status set not null;
alter table public.outbox add constraint outbox_status_check
  check (status in ('queued', 'cancelled', 'sending', 'sent', 'failed'));
alter table public.outbox alter column send_after set not null;

revoke insert, update, delete on table public.outbox from authenticated;

-- The raw token was readable by every firm member. Lookup already uses the hash.
alter table public.student_links drop column token;

-- apply_changes from 20261127000001, plus one refusal: a batch that names the
-- outbox is rejected, and the outbox is no longer in the upsert list. Everything
-- else (folders, college-list drafts, the owner-only delete guard, sortFilesAutomatically)
-- is unchanged.

create or replace function public.apply_changes(firm uuid, changes jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Parents before children, so foreign keys hold inside the batch.
  upsert_order constant text[] := array['document_types', 'students', 'parents', 'meetings', 'tasks', 'colleges', 'documents', 'reports', 'reminder_rules', 'activity', 'personal_notes', 'weekly_texts', 'college_list_drafts', 'college_list_draft_items'];
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

  if changes -> 'firm' ? 'name' then
    update public.firms set name = btrim(changes -> 'firm' ->> 'name') where id = firm;
    if not found then
      raise exception 'Only the firm''s owner can rename it.' using errcode = '42501';
    end if;
  end if;
  if changes -> 'firm' ? 'displayName' then
    update public.firm_members set display_name = btrim(changes -> 'firm' ->> 'displayName')
    where firm_id = firm and user_id = (select auth.uid());
    if not found then
      raise exception 'Only the firm''s owner can change member names.' using errcode = '42501';
    end if;
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

create function public.queue_message(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
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

create function public.cancel_message(id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
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

  update public.outbox set status = 'cancelled' where id = message.id returning * into message;

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
