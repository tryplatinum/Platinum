# Build log

## Current milestone

M0.3 (branch `m0.3-dispatch`): recipient allowlist, Transport + LogTransport, `POST /api/dispatch`, student-link placeholder at send time, Messages status/Retry. Merged `origin/main` (PR #8 / M0.2c: `20261128000002_cancel_message_qualify.sql`). Migrations not yet on remote: `20261128000002` and `20261129000001`. **Aaron must run `npm run db:push`** (CLI asks for confirmation; no `--yes`). Then `npm run db:types`.

## Last session

- Agent: Cursor
- Date: 2026-11-24
- What changed:
  - Brought in M0.2c from main: `cancel_message` qualifies `o.id` / `cancel_message.id`, `search_path = public, pg_temp`, grants restated.
  - Migration `supabase/migrations/20261129000001_dispatch.sql`: `student_links.expires_at` (nullable; old rows never expire), activity actor may be `system`, restates queue/cancel hardening (including `search_path` on `queue_message`).
  - `shared/dispatch.ts`: allowlist parse/match, phone/email normalize, address resolution, `{{student_link}}` fill/preview, link expiry helper.
  - `server/transport/`: Transport interface + `LogTransport`; `TRANSPORT` env (default `log`).
  - `server/dispatch.ts` + `api/dispatch.ts`: claim queued→sending, allowlist, student link mint (30 days), transport, sent/failed + activity. Service role for status updates after `identify()`.
  - Client: call `/api/dispatch` when undo countdown ends and on firm app load. Weekly texts draft with `{{student_link}}`; preview shows `[student link added when sent]`. Messages shows status/error and Retry (re-queues).
  - `AGENTS.md`, `.env.example` (`SEND_ALLOWLIST`, `TRANSPORT`, `PUBLIC_APP_URL`), `scripts/test-outbox.ts` extended.
- Checks: `typecheck`, `lint`, `test:notes`, `test:outbox` all exit 0. `db:push` stopped on confirmation. `expires_at` was added to `database.types.ts` by hand for typecheck.
- Unfinished / for Aaron:
  1. `npm run db:push` (confirm when asked) — applies `20261128000002` then `20261129000001`.
  2. `npm run db:types`.
  3. Manual checks in the M0.3 prompt (off-list fail, on-list `log_…`, weekly link URL, old links, undo, LINE fail, Retry, double trigger).

## Known issues

- Undo fails on the live database until `20261128000002` is applied.
- Loading the sample does not write the old simulated outbox history.
- There is still no on-screen activity list.
- The AI rate limit in `server/rateLimit.ts` is still memory inside one function instance.
- The sample caseload still uses real colleges, Common App, CSS Profile, and activity organizations (USACO, DECA, HOSA, FRC, Habitat for Humanity).
- Real Twilio/Resend providers are M1. Cron backstop is M2.

## Next step

Aaron: `npm run db:push`, then `npm run db:types`. Sign in with `TRANSPORT=log`, `PUBLIC_APP_URL=http://localhost:5173`, and `SEND_ALLOWLIST` set to founder phones/emails. Walk the M0.3 acceptance checklist. After that, M1 wires Resend and Twilio behind the same Transport interface.
