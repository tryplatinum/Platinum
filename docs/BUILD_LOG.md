# Build log

## Current milestone

M0.2 is in the code, not yet on the database. A message can enter the outbox only through `queue_message`, which records the signed-in member and holds it for 60 seconds. `cancel_message` undoes it during that window. Student-link tokens are no longer stored; only the hash is. Real delivery is still M1. Nothing sends on a timer (M2).

## Last session

- Agent: Cursor
- Date: 2026-11-23
- What changed: Added `supabase/migrations/20261126000001_outbox_queue.sql`. The app queues through `queueMessage` in `src/data/repo.ts` instead of `simulateSend`. Approval shows a 60-second toast with Undo. Messages list uses "Queued, sends in Ns", "Cancelled", or "Not delivered yet (delivery arrives in M1)". Copying a student link works only immediately after create or rotate. `scripts/test-outbox.ts` checks the shared payload rules. Kevin’s sample caseload now includes one draft parent report, "Progress this week".
- Unfinished: `npm run db:push` did not apply. The Supabase CLI is not linked (`Cannot find project ref. Have you run supabase link?`). `npm run db:types` was not run. `src/lib/database.types.ts` was edited by hand to match the migration. The signed-in checks (approve, undo, direct insert rejected, old link dies) were not run.

## Known issues

- Until the migration is applied, approving a message will fail because `queue_message` does not exist yet, and old databases still have `student_links.token`.
- Loading the sample no longer writes the old simulated outbox history. Those rows were not real sends. New approvals are the queue.
- There is still no on-screen activity list. `queue_message` and `cancel_message` insert the approval and cancel lines into `activity`.
- The AI rate limit in `server/rateLimit.ts` is still memory inside one function instance.
- The sample caseload still uses real colleges, Common App, CSS Profile, and activity organizations (USACO, DECA, HOSA, FRC, Habitat for Humanity).

## Next step

Link the Supabase project (`npx supabase link`), run `npm run db:push`, then `npm run db:types`, and fix anything the generated types disagree with. Then sign in, reset the demo, and approve Kevin’s draft report "Progress this week". Confirm the countdown, Undo, a row that stays queued after 60 seconds, a rejected direct insert, a rejected `apply_changes` outbox write, and that rotating a student link kills the old `/s/:token`. After that, M1 is real delivery to the founders’ allowlist. Do not add a scheduler in that change.
