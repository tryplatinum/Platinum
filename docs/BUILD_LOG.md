# Build log

## Current milestone

M0.2 is applied on the linked Supabase project as `20261128000001`, after William's file, college, and owner-only migrations. A message enters the outbox only through `queue_message`. Student-link tokens are stored only as a hash. Real delivery is still M1. Nothing sends on a timer (M2).

## Last session

- Agent: Cursor
- Date: 2026-11-23
- What changed: Merged `origin/main` (William's file storage, college directory, list drafts, owner-only files, and the link a file came through). Renamed the outbox migration to `supabase/migrations/20261128000001_outbox_queue.sql` and rebuilt `apply_changes` from his `20261127000001` body, adding only the outbox refusal. `npm run db:push` applied that one migration. `npm run db:types` regenerated `src/lib/database.types.ts`. The generated `outbox.Insert.send_after` is required; the hand edit had it optional. Files dropped through a link still record `documents.student_link_id` (the link row), which does not depend on the raw token.
- Unfinished: The signed-in checks (approve, undo, direct insert rejected, old link dies) were not run in a browser.

## Known issues

- Loading the sample does not write the old simulated outbox history.
- There is still no on-screen activity list. `queue_message`, `cancel_message`, and William's `add_draft_to_college_list` insert activity rows.
- The AI rate limit in `server/rateLimit.ts` is still memory inside one function instance.
- The sample caseload still uses real colleges, Common App, CSS Profile, and activity organizations (USACO, DECA, HOSA, FRC, Habitat for Humanity).

## Next step

Sign in, reset the demo, and approve Kevin's draft report "Progress this week". Confirm the countdown, Undo, a row that stays queued after 60 seconds, a rejected direct insert, a rejected `apply_changes` outbox write, and that rotating a student link kills the old `/s/:token` while files already dropped through that link row still point at it. After that, M1 is real delivery to the founders' allowlist. Do not add a scheduler in that change.

William's migrations now on this branch, already on the remote before this push:

- `20261126000001_file_storage.sql` — stored files, folders, and `create_firm` seeding folders. Already the remote `20261126000001`. Does not touch `apply_changes`, the outbox, or `student_links`.
- `20261126000002_documents_bucket.sql` — private `documents` storage bucket and object policies.
- `20261126000003_college_directory.sql` — shared college directory tables. Not firm data.
- `20261126000004_college_list_drafts.sql` — draft lists and `add_draft_to_college_list`, which inserts an activity row.
- `20261126000005_apply_changes_files_and_colleges.sql` — `apply_changes` learns folders, list drafts, and `sortFilesAutomatically`. Its upsert list still included the outbox.
- `20261127000001_owner_only_removal.sql` — owner-only file rule, and `apply_changes` refuses a non-owner delete or clear that would remove those files.
- `20261127000002_owner_only_link_rows.sql` — name-or-link rows in a restricted folder are owner-only too.
- `20261127000003_document_student_link.sql` — `documents.student_link_id` references `student_links(id)`.
