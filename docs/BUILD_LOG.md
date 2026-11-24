# Build log

## Current milestone

M0.2 is on the remote as `20261128000001`. Undo is broken there: `cancel_message` raises `column reference "id" is ambiguous`. The fix is written as `20261128000002_cancel_message_qualify.sql` and is not applied yet. The CLI asked for confirmation and this session did not pass `--yes`. Direct `insert` and `update` on `outbox` already return `42501`. Real delivery is still M1.

## Last session

- Agent: Cursor
- Date: 2026-11-23
- What changed: Added `supabase/migrations/20261128000002_cancel_message_qualify.sql`. It replaces `cancel_message` so the update uses `o.id` and `cancel_message.id`. `search_path` is `public, pg_temp`. Grants are restated. `queue_message` was not replaced: it has no `id` parameter, and every `id` it uses is already table-qualified. `npm run db:push` changed nothing. `npm run db:types` left `src/lib/database.types.ts` unchanged, because the function's arguments and return type are the same.
- Unfinished: Apply `20261128000002` (the user runs the push). Then Undo within 60 seconds, Undo after 60 seconds from the console, and the console update that must return `42501`.

## Known issues

- Undo fails on the live database until `20261128000002` is applied.
- Loading the sample does not write the old simulated outbox history.
- There is still no on-screen activity list.
- The AI rate limit in `server/rateLimit.ts` is still memory inside one function instance.
- The sample caseload still uses real colleges, Common App, CSS Profile, and activity organizations (USACO, DECA, HOSA, FRC, Habitat for Humanity).

## Next step

Run `npm run db:push` and confirm it when the CLI asks. Then Undo a queued message within 60 seconds, call `cancel_message` from the console after the window (the row must stay queued), and run `supabase.from('outbox').update({status:'sent'}).eq('status','queued').select()` and expect `42501`. After that, M1 is real delivery. Do not add a scheduler in that change.
