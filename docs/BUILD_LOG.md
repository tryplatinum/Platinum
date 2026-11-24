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

## Google connect (branches `google-connect` PR 10 and `gmail-transport` PR 11)

- Agent: Claude Code, unattended overnight run for William
- Date: 2026-11-24
- **Not applied yet:** `supabase/migrations/20261130000001_google_drive.sql`. It is the only local migration not on the remote. The CLI refuses to prompt in an agent session and the run was told not to pass `--yes`, so a person must run `npm run db:push` and confirm, then `npm run db:types` (the new tables and columns are in `src/lib/database.types.ts` by hand until then). Until it is applied every Google feature fails closed (Settings shows no Google row).
- What exists:
  - `api/google.ts`: POST actions `status`, `connect`, `disconnect`, `browse`, `import`, `folders`, `link`, `unlink`, `sync`, `import_removed` behind the same caller check and rate limits as `/api/documents`; GET is Google's redirect (checked by signed `state` plus a cookie).
  - `server/google/`: `config.ts` (settings, the one `google.fetch`), `secrets.ts` (AES-256-GCM for refresh tokens, signed state), `connection.ts` (connect, status, disconnect, access tokens, "reconnect"), `drive.ts` (read-only Drive REST), `driveFiles.ts` (import one file, link, sync in bounded batches), `removedHere.ts` (files deleted here are not imported again), `fakeDrive.ts` (invented Google for `GOOGLE_FAKE=1` under `npm run dev` only).
  - `shared/google.ts`: Zod shapes for browser input and Google's answers, limits, and the pure sync decision `planSync`.
  - Browser: `src/services/google.ts`, `src/components/google/` (`GoogleAccount` in Firm settings, `DrivePicker`, `DriveFolders`), buttons on a student's Documents tab and the Documents screen, "From Google Drive" on file rows.
  - PR 11: `server/transport/gmail.ts` (`GmailTransport`), per-channel routing in `server/transport/index.ts` (`TRANSPORT_EMAIL=gmail`), `shared/emailSubject.ts`, and the dispatcher passing `approved_by` and a subject.
- Checks: `typecheck`, `lint`, `test:notes` (now also runs `test:google`), `test:outbox`, `build` all pass. The Drive flow was also driven in a real browser against the invented Drive and an in-memory stand-in for the database (`scripts/fakeSupabase.ts`), because the migration is not applied.
- Not verified: anything against the real database (row level security on the new table, the column grant, the unique index), a real Google sign-in, and AI sorting of synced files with a real key.
- For Aaron:
  - The dispatcher now calls `getTransport(row.channel)` and passes `senderUserId: row.approved_by` and, for email, `subject: emailSubject(row.kind, row.language)`. Nothing before that line changed: the allowlist check, the claim and the student-link step are as he wrote them.
  - `emailSubject` is a proposal. When the outbox has a real subject, pass that instead.
  - To send a first real email to the allowlist: apply the migration, connect Google in Firm settings, press "Turn on sending from Gmail", put the recipient in `SEND_ALLOWLIST`, set `TRANSPORT_EMAIL=gmail`, approve an email message. `TRANSPORT_EMAIL` was unset in every run here; nothing was sent.
- Next step: apply the migration, then walk the numbered manual steps in PR 10's description with the real test Google account.

## Known issues

- Undo fails on the live database until `20261128000002` is applied.
- Loading the sample does not write the old simulated outbox history.
- There is still no on-screen activity list.
- The AI rate limit in `server/rateLimit.ts` is still memory inside one function instance.
- The sample caseload still uses real colleges, Common App, CSS Profile, and activity organizations (USACO, DECA, HOSA, FRC, Habitat for Humanity).
- Real Twilio/Resend providers are M1. Cron backstop is M2.

## Next step

Aaron: `npm run db:push`, then `npm run db:types`. Sign in with `TRANSPORT=log`, `PUBLIC_APP_URL=http://localhost:5173`, and `SEND_ALLOWLIST` set to founder phones/emails. Walk the M0.3 acceptance checklist. After that, M1 wires Resend and Twilio behind the same Transport interface.
