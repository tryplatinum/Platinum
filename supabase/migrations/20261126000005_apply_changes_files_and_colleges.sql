-- apply_changes again, now knowing the new firm-scoped tables:
--
--   * document_types             upsert only (folders are archived, never deleted). Row level
--                                security still limits writes to the firm's owner.
--   * college_list_drafts and college_list_draft_items   upsert and delete
--   * firm.sortFilesAutomatically   the owner's "Sort files automatically" switch
--
-- Not here on purpose: document_events (insert only, so it cannot be upserted)
-- and the college directory (shared, written only by the import).
--
-- Deleting a document, a student or the whole caseload through this function
-- removes rows only. Stored files are removed by the server first
-- (server/documentSorting.ts), which then deletes the rows.
--
-- Nothing else in it changes.

create or replace function public.apply_changes(firm uuid, changes jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Parents before children, so foreign keys hold inside the batch.
  upsert_order constant text[] := array['document_types', 'students', 'parents', 'meetings', 'tasks', 'colleges', 'documents', 'reports', 'outbox', 'reminder_rules', 'activity', 'personal_notes', 'weekly_texts', 'college_list_drafts', 'college_list_draft_items'];
  -- The log tables (outbox, activity) are never deleted from row by row, and
  -- folders (document_types) are archived, not deleted.
  delete_order constant text[] := array['college_list_draft_items', 'college_list_drafts', 'weekly_texts', 'personal_notes', 'documents', 'reports', 'colleges', 'tasks', 'meetings', 'parents', 'students'];
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

    -- Every column except the ones the database fills in. firm_id always comes
    -- from the argument, never from the payload.
    select
      string_agg(format('%I', a.attname), ', ' order by a.attnum),
      string_agg(
        case a.attname
          when 'firm_id' then '$2'
          when 'id' then 'coalesce(r.id, gen_random_uuid())'
          else
            -- A required column the payload leaves out takes its default, so a
            -- browser still running an older version keeps working after a
            -- column is added.
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
