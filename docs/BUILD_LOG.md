# Build log

## Current milestone

M3b (branch `m3-approvals`): edit everything in Approvals, reminder skips, links to William’s queues.

**DB hold released for Aaron:** `npm run db:push` asked for confirmation on production (`20261131000001_reminder_skips`). Agent stopped. Aaron: run `npm run db:push` (confirm), then `npm run db:types`. Migration list before push: only `20261131000001` was local-only.

## Last session

- Agent: Cursor
- Date: 2026-11-24
- What changed:
  - Migration `supabase/migrations/20261131000001_reminder_skips.sql`: `reminder_skips` (id, firm_id, dedupe_key, skipped_by, skipped_at, until), unique + index on `(firm_id, dedupe_key)`, RLS firm members, select/insert/delete for authenticated.
  - Approvals: Edit on profile changes (proposed value via field-kind editors) and meeting notes/recap (same textareas as meeting review). Approve applies the edited value. Reminders: Skip → “Skip this time” (`until` = tomorrow) or “Skip until I turn it back on” (`until` null). Activity row per skip; toast “Undo skip”.
  - `src/lib/reminders.ts`: `skipIsActive` / `activeSkipKeys`; `reminderQueue` omits active skips.
  - Repo/store: load skips, `skipReminder`, `undoReminderSkip`. Hand types for `reminder_skips` until `db:types` after push.
  - Approvals footer: “Waiting on other screens” counts college list drafts + waiting files from store data; links to existing screens. No William code touched.
  - Meeting review Notes section also editable while pending.
  - Offline skip-filter checks in `test:outbox`.
- Checks: `typecheck`, `lint`, `test:notes`, `test:outbox` exit 0. **`db:push` blocked on confirmation — Aaron runs it.**
- Item types needing only “Edit in meeting review”: **none** — notes, profile, recap, tasks, parent updates, remember all edit inline in Approvals.
- Follow-up: no screen yet to turn permanent skips back on (only Undo from the toast while it is visible, or delete the skip row).

## Prior — M3

Approvals is the counselor home at `/app`. Command center moved to `/app/overview`. Activity log at `/app/activity`.

## Prior (M0.3 / Google)

See git history and earlier BUILD_LOG entries on `main`. Google Drive migration and Gmail transport are on main.

## Known issues

- Loading the sample does not write the old simulated outbox history.
- The AI rate limit in `server/rateLimit.ts` is still memory inside one function instance.
- The sample caseload still uses real colleges, Common App, CSS Profile, and activity organizations.
- Permanent reminder skips have no Settings UI to re-enable (toast Undo only).

## Next step

Aaron: `npm run db:push` then `npm run db:types`. Manual M3b acceptance after Reset demo. Then M4 or merge `m3-approvals`.
