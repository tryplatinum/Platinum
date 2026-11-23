-- The life of a "thing to remember".
--
--   * event_date_approx   the student only said roughly when ("next month or
--                         so"), and event_date is an estimate. The note is
--                         still kept until then instead of being dropped at
--                         the next meeting.
--   * uses                each time a sent message mentioned the note:
--                         [{at, stage, in}]. A note is mentioned once before
--                         its event and once after, so nothing is repeated.
-- apply_changes reads a table's columns when it runs, so it needs no change.
alter table public.personal_notes add column event_date_approx boolean not null default false;
alter table public.personal_notes add column uses jsonb not null default '[]'::jsonb check (jsonb_typeof(uses) = 'array');
