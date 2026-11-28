-- More kinds of assistant proposal.
--
-- The assistant still only proposes: each of these is a pending row a counselor
-- approves or discards on the same card as every other draft, and approving
-- one runs in the counselor's own browser, through the action the screen
-- already uses. Nothing here lets the assistant write a record or send.
--
--   schedule_meeting   a meeting, with two or three times to choose from.
--                      Replaces meeting_times, which is no longer created;
--                      rows of that kind already stored stay valid and readable.
--   apply_template     a task plan's dated tasks, or a message template's draft
--   task_change        a new title, owner or due date for one task, or done
--   add_college        a college from the shared directory, by its id
--
-- The check on agent_proposals.kind is widened. Nothing else changes: no
-- column, policy, grant or function.

alter table public.agent_proposals drop constraint if exists agent_proposals_kind_check;
alter table public.agent_proposals add constraint agent_proposals_kind_check
  check (kind in ('message', 'parent_update', 'task', 'profile_change', 'meeting_times', 'schedule_meeting', 'apply_template', 'task_change', 'add_college'));
