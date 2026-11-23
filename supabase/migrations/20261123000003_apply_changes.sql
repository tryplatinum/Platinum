-- Writes that must succeed or fail together.
--
-- apply_changes: the app's store works out what an action changed (rows to
-- insert or update, rows to delete, across any tables) and sends it here as one
-- batch. It runs in one transaction with the CALLER's permissions (security
-- invoker), so row level security applies to every statement: a batch touching
-- another firm's row fails as a whole. The approval logic stays in the app;
-- this function only makes the result atomic.
--
--   changes = {
--     "firm":   { "name": "...", "displayName": "..." },   -- optional
--     "clear":  true,                                       -- optional: remove the firm's data first
--     "upsert": { "<table>": [ row, ... ], ... },           -- whole rows, snake_case
--     "delete": { "<table>": [ id, ... ], ... }
--   }

create function public.apply_changes(firm uuid, changes jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Parents before children, so foreign keys hold inside the batch.
  upsert_order constant text[] := array['students', 'parents', 'meetings', 'tasks', 'colleges', 'documents', 'reports', 'outbox', 'reminder_rules', 'activity'];
  -- The log tables (outbox, activity) are never deleted from row by row.
  delete_order constant text[] := array['documents', 'reports', 'colleges', 'tasks', 'meetings', 'parents', 'students'];
  t text;
  items jsonb;
  cols text;
  vals text;
  sets text;
begin
  if not public.is_firm_member(firm) then
    raise exception 'You are not a member of this firm.' using errcode = '42501';
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

  if coalesce((changes ->> 'clear')::boolean, false) then
    -- Everything that belongs to a student goes with the student.
    delete from public.students where firm_id = firm;
    delete from public.reminder_rules where firm_id = firm;
  end if;

  foreach t in array upsert_order loop
    items := changes -> 'upsert' -> t;
    continue when items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0;

    -- Every column except the ones the database fills in. firm_id always comes
    -- from the argument, never from the payload.
    select
      string_agg(format('%I', a.attname), ', ' order by a.attnum),
      string_agg(
        case a.attname
          when 'firm_id' then '$2'
          when 'id' then 'coalesce(r.id, gen_random_uuid())'
          else format('r.%I', a.attname)
        end, ', ' order by a.attnum),
      string_agg(format('%I = excluded.%I', a.attname, a.attname), ', ' order by a.attnum)
        filter (where a.attname not in ('id', 'firm_id'))
    into cols, vals, sets
    from pg_catalog.pg_attribute a
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

revoke execute on function public.apply_changes(uuid, jsonb) from public, anon;
grant execute on function public.apply_changes(uuid, jsonb) to authenticated;

-- student_link_write: the one write path for the student link. Called only by
-- the server function api/student.ts with the service role key, AFTER it has
-- matched the link's token to (p_firm, p_student). Updates one of the student's
-- own tasks, records the activity as done by the student, and optionally files
-- an attached link under the student's documents, all in one transaction.

create function public.student_link_write(
  p_firm uuid,
  p_student uuid,
  p_task uuid,
  p_patch jsonb,
  p_activity text,
  p_document jsonb default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.tasks set
    status = coalesce(p_patch ->> 'status', status),
    progress_note = case when p_patch ? 'progress_note' then p_patch ->> 'progress_note' else progress_note end,
    completed_on = case when p_patch ? 'completed_on' then (p_patch ->> 'completed_on')::date else completed_on end,
    completed_by = case when p_patch ? 'completed_by' then p_patch ->> 'completed_by' else completed_by end,
    attachments = case when p_patch ? 'attachments' then p_patch -> 'attachments' else attachments end
  where id = p_task and firm_id = p_firm and student_id = p_student and owner = 'student';
  if not found then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;

  insert into public.activity (firm_id, student_id, actor, text)
  values (p_firm, p_student, 'student', p_activity);

  if p_document is not null then
    insert into public.documents (firm_id, student_id, name, kind, category, added_by, url, task_id)
    values (p_firm, p_student, p_document ->> 'name', 'other', p_document ->> 'category', 'student', p_document ->> 'url', p_task);
  end if;
end
$$;

revoke execute on function public.student_link_write(uuid, uuid, uuid, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.student_link_write(uuid, uuid, uuid, jsonb, text, jsonb) to service_role;
