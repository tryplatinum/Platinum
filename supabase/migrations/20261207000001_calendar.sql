-- Google Calendar: what a meeting remembers about its event.
--
-- Additive only: two nullable columns on meetings. No row is touched, nothing
-- is dropped, and no policy, grant or function changes. apply_changes reads a
-- table's columns from the catalog, so it carries these without being restated.
--
--   * google_event_id: the id of the one event on the counselor's own calendar
--     that goes with this meeting. Null when there is none.
--   * google_sync: 'synced' (the event matches), 'failed' (Google refused or
--     could not be reached: the meeting is saved, the event is not),
--     'linked' (an event made in Google was tied to this meeting; Platinum did
--     not make it and never deletes it), or 'kept:<stamp>' (the counselor chose
--     to keep the meeting as it is after a change made in Google).
--
-- Events themselves are never stored: they are read from Google for the
-- screen. Nothing here holds a title, a guest or any text from Google.

alter table public.meetings add column google_event_id text check (google_event_id is null or google_event_id ~ '^[A-Za-z0-9_-]{1,1024}$');
alter table public.meetings add column google_sync text check (google_sync is null or char_length(google_sync) <= 80);
