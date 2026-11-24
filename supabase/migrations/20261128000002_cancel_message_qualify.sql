-- Undo failed: UPDATE ... WHERE id = message.id treated "id" as both the
-- outbox column and the cancel_message parameter. Qualify both.
-- queue_message has no parameter named id, and every id it uses is already
-- table-qualified (s.id, p.id, t.id), so it is left as it was.
--
-- CREATE OR REPLACE keeps the grants from 20261128000001. They are stated
-- again so this file shows who may call the function.

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

  update public.outbox o
  set status = 'cancelled'
  where o.id = cancel_message.id
  returning * into message;

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
