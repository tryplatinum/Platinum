# Build log

## SEC-FIX-W1 (branch `sec-fix-w1`)

Narrower Drive access, safer phone pairing, and a time limit on student uploads.

**Migration, written and not pushed:** `supabase/migrations/20261203000001_phone_pairing.sql`. Remote was at `20261202000001`. SEC-FIX-A1 has `20261204000001` locally; push this one first, or `db push` will want `--include-all`. After pushing, run `npm run db:types` (the types in `src/lib/database.types.ts` were edited by hand to match). It:
- lets `phone_send_jobs.body` be null and clears it on rows already submitted, failed, expired or cancelled
- adds `phone_devices.key_expires_at` (existing devices get 90 days from their `created_at`)
- adds `phone_setup_codes` (hash only, single use, 10 minutes; RLS on, service role only)
- changes `claim_phone_send_job` to a 10-minute lease

**Drive.** The scope is `drive.file`, not `drive.readonly`. The app no longer lists My Drive, shared drives or search results; `browseDrive` refuses `root`, `shared`, `drives` and a query. Files and folders are chosen in Google Picker (`DrivePicker.tsx`), which gets a short-lived access token from `POST /api/google { action: 'picker' }`. The Picker needs `VITE_GOOGLE_PICKER_KEY` (a browser key restricted to the Picker API and this site) and `VITE_GOOGLE_APP_ID` (the Cloud project number). A connection without `drive.file` shows "Reconnect Google Drive" (`GoogleStatus.driveReconnect`), and every Drive call says the same until the counselor reconnects. Consent asks with `include_granted_scopes=false`, so the old scope is not carried over.

What `drive.file` cannot do: list the rest of a linked folder. Folder sync now sees only files the counselor picked or this app created, so a linked folder no longer picks up new files dropped into it in Drive. Under `GOOGLE_FAKE=1` the Picker is not available (it is Google's own UI), so choosing files needs a real Google project.

**Phone pairing.** "Connect your phone" shows an 8-character setup code (no 0/O/1/I), valid 10 minutes and once. `/phone-setup` has no key in its address: the phone types the code, the page posts `{ action: 'pair', code }` to `/api/phone`, and shows the device key once. Pairing revokes any earlier phone. A device key lasts 90 days. A revoked, expired or unknown key gets 401 `{ "next": "none", "message": "Pair your phone again" }`. Settings shows "Last used" and "Revoke this phone" (sets `revoked_at`).

**Claims (W1b).** Only the device that claimed a job can report it. The lease is 10 minutes. When it runs out with no report, the sweep marks the job `unknown` (unconfirmed) and the outbox row `phone_unknown`, still `sending`. Nothing ever moves a job back to `pending` (`jobCanMove` refuses it), and `claim_phone_send_job` takes only pending jobs, so an unconfirmed text is never handed out again by any device. A late report from the claiming device (after 10 minutes, or for an unconfirmed job) is accepted, logged as `[phone] late report` (no number or text), and recorded as a late event. A job's `body` is set to null in the same update that makes it submitted, failed, expired or cancelled.

**Unconfirmed texts in Messages.** The row says "Your phone didn’t confirm this text. Check your phone’s sent messages." with two actions. "It was sent" calls `resolve { sent: true }`: the job is submitted, the row is sent, and the activity row has `actor: 'counselor'`. "Send again" calls `resolve { sent: false, again: true }`, which fails the old row with "Not confirmed. The counselor sent it again." (that row then offers no Retry and no send-by-hand), and only if that worked, queues the same message as a new approval through `queue_message` with the usual Undo toast. The server makes no job for it; the dispatcher does, after the 60 seconds, as for any approved text.

**Student uploads.** Supabase Storage takes no expiry for a signed upload URL (the route uses the project's fixed `uploadSignedUrlExpirationTime`), so the limit is enforced by the server: `finishStudentUpload` refuses and removes an upload finished more than `STUDENT_UPLOAD_SECONDS` (300) after its URL was issued, and the next start clears unfinished ones older than that. Five minutes, not 60 seconds, because a 25 MB upload from a phone can take minutes.

**Not done here (SEC-FIX-A1's file):** the log transport (`server/transport/log.ts`) prints the whole body, which can hold a substituted student link. The phone path itself logs no body.

Checks: `typecheck`, `lint`, `test:notes` (now with the upload window) and `test:outbox` (phone: setup code single use and expiry, 90-day key, wrong device, an expired claim becomes unconfirmed and no device can claim it, a late report still resolves it, "It was sent" and "Send again", bodies cleared on final status, no `#k=` in the setup screens) all pass. W1b edited only comments in `20261203000001_phone_pairing.sql`; no schema change.

Manual checks after the push: Google consent shows only "See, edit, create and delete only the specific Google Drive files you use with this app"; pairing uses a code and an 11-minute-old code is refused; "Revoke this phone" makes the Shortcut's next request fail; a sent phone text's `phone_send_jobs.body` is null; finishing a student upload after 5 minutes is refused.
## Links, assistant grants, activity authors (branch `sec-fix-a1`)

**Migration not pushed.** `supabase/migrations/20261204000001_links_agent_activity_grants.sql` waits for Aaron to run `npm run db:push`, then `npm run db:types`. The remote was at `20261202000001`. `20261203000001` is left for the phone-pairing migration on the other branch. `src/lib/database.types.ts` was edited by hand to match; regenerate it after the push.

What now holds:

- **Student links** need `expires_at`. Old rows without one got 30 days from the push; new rows default to 30 days; the browser sets 30 days on create and on rotate (`studentLinkExpiry` in `shared/dispatch.ts`). A missing, blank or unreadable expiry does not open. Signed-in people read every column of `student_links` except `token_hash`; the browser selects the columns by name (`LINK_COLUMNS` in `src/data/repo.ts`).
- **Logs.** The log transport prints the outbox id, channel, a masked recipient (`maskRecipient`: last 4 digits, or first letter and domain) and the body length. Never the body or subject. A send error has any `/s/` address replaced before it is logged or stored (`withoutStudentLinks`). `test:outbox` captures every console method during a linked send and a failed one and fails if `/s/` or the body appears.
- **Assistant tables.** Signed-in people may only read `agent_threads`, `agent_messages`, `agent_proposals`; `reminder_skips` also takes insert and delete. Approve, discard and edit go through `decide_agent_proposal` and `edit_agent_proposal` (security definer: pending rows of the caller's firm only; the decider is always the caller). `/api/translate` saves English the same way. `agent_proposals` and `agent_threads` reference `students (firm_id, id)`. `insertProposal` finds the student with the counselor's own client in their firm before the service-role insert.
- **Daily budget.** `agent_usage` (service role only) counts model calls per firm per UTC day. `reserve_agent_call` checks and takes one in a single statement. `runAgent` takes one before the first call (429 when none is left) and one before each later round; when it runs out the turn ends with a note. `AGENT_DAILY_LIMIT` now counts model calls, default 200.
- **Errors.** `/api/agent` (and its history), `/api/translate`, `/api/dispatch` return `{ code, message: 'Something went wrong. Try again.' }` for server failures; the real error is logged on the server. Tool read failures give the model a plain sentence. `file_document`'s 42501 is no longer passed through as text.
- **Outbox** has no insert, update or delete policies left; `queue_message` and `cancel_message` are the only writers.
- **Activity** has `actor_user` (defaults to `auth.uid()`). A signed-in person may insert or update only `actor = 'counselor'` lines with `actor_user` = themselves. `logActivity` stamps counselor lines; `diffData` sends only counselor lines. The meeting "drafts are ready" AI line is written by `log_meeting_drafts_ready` after the save. Loading the sample saves only its counselor lines (README known gaps).
- **Message length.** `propose_message` and `propose_parent_update` refuse a body over 120 words for text, LINE and WeChat, or 200 for email, before the signature (`draftWords` in `server/agent/text.ts`; two Chinese characters count as one word). The tool descriptions say so.
- `AGENTS.md` has the public-repository rule.

Checked: `typecheck`, `lint`, `test:notes`, `test:outbox` pass. The full migration chain plus the new file was run in PGlite (Postgres in WASM) with stub `auth` and `storage` schemas: backfill, column grant, proposal functions, cross-firm proposal refused even for the service role, budget stops at the limit, activity author rules, `apply_changes` and `queue_message` still work. Not run here, because they need the pushed migration: `test:agent` (new cases 11 and 12: another firm's student refused from the general thread; two requests at the limit, one 200 and one 429) and `test:isolation` (new section on link hashes, assistant tables, outbox and activity authors). Draft timing against the 12s target is measured by that `test:agent` run.

After the push: `npm run db:types`, then `npm run test:agent` and `npm run test:isolation`. On the dev server, open a student link dialog (list, create, rotate), approve and discard an assistant draft, draft a meeting and check the Activity screen shows the AI line after a reload.

## M4b-4 (branch `m4b4-agent-speed`)

Agent speed, second pass. The main model is still `claude-sonnet-5-5`. `AGENT_FAST_MODEL` is empty. When set, only the meeting brief and the essay brainstorm use it. Parent messages stay on the main model.

Before, from M4b-3 `test:agent`: overdue 4.5s, draft 21.4s, brief 11.5s, brainstorm 19.7s.

After, main model only:

| Case | Wall | Rounds | What dominated |
|---|---|---|---|
| Overdue question | 3.1s | 1 | One model call, 1.3s. Under 6s. |
| Draft reminder | 13.4s | 2 | The proposing call, 9.2s and 1,183 output tokens, then a 0.9s confirmation. Misses 12s by that first call. |
| Meeting brief | 7.7s | 1 | `prepare_meeting_brief` 4.9s. The brief is the reply, so there is no second model call. Under 10s. |
| Essay brainstorm | 10.6s | 1 | `essay_brainstorm` 7.7s. The lists are the reply. Under 12s. |

With `AGENT_FAST_MODEL=claude-haiku-5-5`, same Kevin case, clean thread: brief 11.6s (the brief call 8.2s, slower than the main model this run) and brainstorm 8.6s (the brainstorm call 4.4s). The two texts are in `docs/agent-model-compare.md`. The fast model is not the default.

Sendability: the log transport counts only when `ALLOW_LOG_TRANSPORT=true`. Otherwise email needs Gmail connected and text needs the phone gateway. WeChat and LINE still never send. The header lists only channels that can send, or says no sendable channel. A missing channel on `propose_message` is filled from those. A blocked name does not force another round.

A reply after a proposal is capped at 200 tokens. A brief or a brainstorm is formatted on the server and returned as the reply. English for a non-English draft is `POST /api/translate`, and Approvals shows it from "Show in English". A stored `bodyEn` is reused.

Checks: `typecheck`, `lint`, `test:notes`, `test:outbox`, and `test:agent` passed, including the flag-off case. On the dev server, with the flag off, asking to email Liu Min produced no proposal and said she has no sendable channel. The meeting prep came back in one round. With the flag on, the reminder reply was the short confirmation, the proposal held the Chinese message, and `POST /api/translate` returned the English and then reused it.

## M4b-3 (branch `m4b3-agent-speed`)

Agent speed and draft quality. The model is still `claude-sonnet-5-5` (or `ANTHROPIC_MODEL`). No configuration problem found. `max_tokens` was 8,000 on the agent loop and 16,000 on every shared feature, including the brief. The agent loop is now 4,000, the agent’s brief call 4,000, and essay brainstorm 1,500.

Before, from the measured `test:agent` run in the prompt: overdue 5.1s, draft reminder 22.5s, meeting brief 13.7s, essay brainstorm 19.0s.

After, this branch, the final `test:agent` timing summary:

| Case | Wall | Rounds | What dominated |
|---|---|---|---|
| Overdue question | 4.5s | 1 | One model call, 2.4s, no tools. Under 6s. |
| Draft reminder | 21.4s | 3 | First model call 12.7s (1,580 output tokens) plus a rejected WeChat `propose_message` (0ms) and two more model calls (4.1s, 2.0s). Misses 12s. The first call alone is over the budget. |
| Meeting brief | 11.5s | 2 | `prepare_meeting_brief` 5.1s, outer model calls 2.2s and 2.5s. Misses 10s by the brief’s own Claude call plus the summary round. |
| Essay brainstorm | 19.7s | 2 | `essay_brainstorm` 11.8s, outer calls 2.6s and 3.2s. Misses 12s because the brainstorm call is already 11.8s. |

Sendability, read from existing config, not from William’s transport code: WeChat never. LINE never (the dispatcher still rejects it, even when a LINE id is stored). Email sends when `TRANSPORT_EMAIL=gmail` and this counselor’s Gmail is connected, otherwise through the log transport. Text sends when `TRANSPORT_TEXT=phone` and a phone is connected, otherwise through the log transport. Either way the person needs an email or a phone on the record.

Progress while waiting is a polled `GET /api/agent?progress=<requestId>`. The step lives in memory for that request. Returning the steps only with the reply would show them after the wait.

Checks: `typecheck`, `lint`, and `test:notes` exit 0. `test:agent` passed all cases, including a sendable channel, no glued sentence, a real activity in the brainstorm, and a dad with no sendable channel. A panel check on a throwaway firm drafted a text to Liu Min, signed Counselor Panel, with no counselor introduction, and the essay brainstorm named FRC Robotics Team 8841. While waiting, the panel showed “Writing a reply…” and then “Brainstorming…”. `test:outbox` passed on a rerun; one phone check (`recent jobs show the recipient’s name`) failed once in the combined run and passed when `test-phone` ran alone.

## Current milestone

M4a (branch `m4a-agent`): server-side assistant — threads per student, tools, proposals, cost guard. **No panel UI** (M4b).

**Taking the DB** for `20261201000001_agent` — William: please don’t push migrations until this lands.

## Last session

- Agent: Cursor
- Date: 2026-11-24
- What changed:
  - Migration `supabase/migrations/20261201000001_agent.sql`: `agent_threads`, `agent_messages`, `agent_proposals` with RLS (select for firm members; inserts service-role only; proposals updatable by members for approve/edit).
  - `POST /api/agent` (`api/agent.ts` + `server/agent/*`): identify → user-scoped reads, service inserts; system prompt in `server/prompts.ts` (`agentSystemPrompt`); tool loop up to `AGENT_MAX_ROUNDS` (default 8); daily firm cap `AGENT_DAILY_LIMIT` (default 200) → 429 “Daily assistant limit reached.”
  - Read tools: get_student, list_tasks, list_deadlines, search_meetings, list_recent_messages, get_notes_to_remember, list_students_needing_attention (general thread). Draft tools: propose_message / parent_update / task / profile_change / meeting_times (pending proposals only). `prepare_meeting_brief` (info), `essay_brainstorm` (Zod structured only).
  - Approvals: pending `agent_proposals` as “From the assistant” with rationale/sources; edit + approve/discard via existing send/task/profile paths; activity on decide.
  - `shared/attention.ts`: status thresholds shared with `derive.summarize`. `shared/agent.ts`: request/response + essay schema.
  - `npm run test:agent` (live Anthropic). `.env.example` + AGENTS.md note.
- Checks: `typecheck`, `lint`, `test:notes`, `test:outbox` exit 0. Migration `20261201000001` applied.
- `npm run test:agent` loads `.env` (`.env.local` overrides), signs in through `scripts/testAccounts.ts` (process.env, not `import.meta.env`), and seeds a small caseload with the counselor’s client. `test:ai` and `test:isolation` load env the same way. History replay includes tool results so the next turn is valid. `npm run test:agent` passed all 8 cases.
- Follow-up: M4b panel UI; no screen for permanent reminder skips (from M3b); file tools M4d.

## Phone gateway, iPhone (branch `phone-gateway-iphone`)

- Agent: Claude Code, unattended run for William
- Date: 2026-11-24
- **THE ALLOWLIST IS THE ONLY GUARD. `text_consent_at`, `text_guardian_consent_at` AND `text_opt_outs` DO NOT EXIST ON MAIN, SO NOTHING HERE CHECKS CONSENT OR OPT-OUT. THIS MUST NOT BE USED WITH REAL FAMILIES UNTIL CONSENT AND OPT-OUT EXIST.** No "Stopped texts" control was built.
- **Applied:** `supabase/migrations/20261202000001_phone_gateway.sql`, pushed by William on 2026-11-24 (the CLI will not take a confirmation from an agent). `src/lib/database.types.ts` was regenerated with `npm run db:types` afterwards. `TRANSPORT_TEXT` is still unset in every deployed environment; William sets it himself.
- Migration history is in step again: `20261201000001_agent.sql` reached `main` with PR 16 and was merged into this branch. It matches the copy in the remote history apart from blank lines, which the history table strips.
- Off by default: text goes to a phone only when `TRANSPORT_TEXT` is exactly `phone`. Unset, a text is handled exactly as before, and `scripts/test-phone.ts` proves it.
- What exists:
  - Migration: `phone_devices`, `phone_send_jobs`, `phone_job_events` (row level security on, no policy, every grant revoked from signed-in people), the function `claim_phone_send_job(device)`, and one nullable column `outbox.delivery_detail`.
  - `shared/phoneGateway.ts`: job statuses and the allowed moves (`jobCanMove`), limits, the fixed sentences, the shapes `/api/phone` answers with.
  - `server/phoneGateway/`: `config.ts`, `keys.ts` (32 random bytes, only the SHA-256 hash stored), `jobs.ts` (every status change goes through `moveJob`: event, outbox row, activity line), `wake.ts` (`wakeDevice`), `device.ts` (claim and report), `counselor.ts` (connect, status, number, test, wake, disconnect, resolve, cancel).
  - `server/transport/phoneGateway.ts` (`PhoneGatewayTransport`) and routing in `server/transport/index.ts`.
  - `api/phone.ts`, added to `FUNCTIONS` in `vite.config.ts`.
  - Browser: Firm settings, "Messaging", "Your phone" (`src/components/phone/YourPhone.tsx`); `/phone-setup` (`src/screens/PhoneSetup.tsx`); new states on the Messages screen; `src/components/OpenInMessages.tsx`, the one "Open in Messages" link, now used by Weekly texts and Messages.
  - `docs/phone-gateway/ios-setup.md`: DRAFT steps, never tried on a phone. William replaces them. Its numbered lines are what `/phone-setup` shows.
  - Tests: `scripts/test-phone.ts` (120 checks), run by `npm run test:outbox` after the outbox checks. `scripts/fakeSupabase.ts` learned database functions and sign-in tokens.
- How an outbox row shows a text on this path (statuses are unchanged; `delivery_detail` says which case):
  - Waiting for your phone: `sending` + `phone_waiting`. The dispatcher only picks up `queued`, so it never takes the row again.
  - Sent from your phone: `sent` + `phone_sent`.
  - Not confirmed: `sending` + `phone_unknown`, with "It was sent" and "It was not sent".
  - Phone did not answer: `failed` + `phone_expired`.
  - Failed on the phone, or the counselor said it was not sent: `failed` + `phone_failed`.
  - No phone, no Gmail, stopped phone: `failed` + `phone_none`.
- Checks: `typecheck`, `lint`, `test:notes`, `test:outbox` (now 127 phone checks), `build` pass, with every `TRANSPORT_*` unset.
- Checked against the real database (`npm run test:phone:db`, which makes and removes its own rows; do not run it unless asked): two claims at once for one job, exactly one gets it; twelve at once for one job, exactly one, five rounds running; three jobs and twelve claims, each handed out once; oldest first; an expired job is never handed out; the function and the three tables refuse anyone without the service role (42501); the checks on the number and the status hold.
- Checked in a browser, locally, with `TRANSPORT_TEXT=phone` and `PHONE_WAKE_FAKE=1`, against the in-memory stand-in for the database with a script playing the phone: "Your phone" (connect form, notice, key shown once, the QR code read back by a decoder to `/phone-setup#k=<key>`, test to own number, state, recent jobs, CSV), and on Messages: Waiting for your phone with Cancel, Sent from your phone (the row changes by itself), Not confirmed with both buttons, Phone did not answer with "Open in Messages", and no phone connected. Screenshots are in `docs/phone-gateway/`. Found and fixed there: Firm settings had two buttons named "Disconnect"; the phone's is now "Disconnect phone".
- **Not verified:**
  - No text left a real phone. No real wake email was sent. No Shortcut was built.
  - The browser run used the stand-in database, not Supabase, so the screens have not been driven against the real tables. The real tables were exercised only by `test:phone:db`.
  - The QR code was read by a decoder, not by an iPhone camera.
  - Whether a message a counselor sends to their own address through the Gmail API arrives in the Inbox and starts a Mail automation. My understanding is that Gmail files a self-addressed message under both Sent and Inbox, but I could not check without sending a real email. No INBOX label is set and the Gmail scope was not widened. If the wake does not reach the Inbox, that is the first thing to look at.
- Decisions made without asking:
  1. "Send a test to my own number" does not go through the outbox. The outbox needs a student, and the counselor is not one. The test job is made by `/api/phone` directly, with the same allowlist check, a fixed text ("Platinum test. Your phone is connected."), and no outbox row. It exercises the job, the wake, the claim and the report, but not the dispatcher.
  2. The counselor had nowhere to keep their own number. It is `phone_devices.own_phone`, saved with a `number` action and a field in "Your phone".
  3. Columns beyond the brief: `phone_devices.own_phone`, `notice_shown_at`, `last_wake_at`; `phone_job_events.late`. Actions beyond the brief: `number`, and `cancel` (the brief asks for a Cancel button but names no action).
  4. A text whose note is "Sent from your own phone" is never handed to the phone. Weekly texts logs a hand-sent text by queueing an outbox row with that note; without this rule, turning on `TRANSPORT_TEXT=phone` would send every hand-sent text a second time. The transport marks such a row sent with `hand_<uuid>`.
  5. "Open in Messages" is not offered on Messages for a text that still holds `{{student_link}}`: the browser cannot fill the link, and the literal placeholder must not be texted to a student. Weekly texts has this same gap today (its `sms:` link carries the draft with the placeholder). I did not change that flow; it needs a decision.
  6. Stopped is worked out from the last three finished jobs, not stored. A job the counselor later answers for stops counting as unanswered.
  7. "Not seen since" starts 7 days after the phone last asked for work.
  8. `test` and `wake` are refused while `TRANSPORT_TEXT` is not `phone`. `connect` is allowed, so a phone can be set up first.
  9. The wake address is checked against `SEND_ALLOWLIST` when connecting, before a job is made, and again when the wake is sent.
  10. The sweeps (expire, lease to unknown) run on every `claim`, every counselor `status` call, and every dispatcher run (the app runs the dispatcher on load and after each undo window). Messages also asks for status every 10 seconds while a row waits. There is still no cron: with every counselor's app closed and the phone silent, a row waits until the next time anyone in the firm opens the app. A sweep that fails never stops the dispatcher.
  11. The caps (20 an hour, 100 a day) count jobs by `claimed_at`. The rate limits on `/api/phone` are the in-memory ones from `server/rateLimit.ts`.
  12. `/phone-setup` leaves the key in the URL fragment, so it stays in the phone browser's history. Reconnecting the phone makes a new key and revokes the old one.
  13. New dependency: `qrcode-generator` 2.0.4 (MIT, no dependencies), for the QR code. It is not a state library, UI kit or ORM, but it is new, so say if it should go.
  14. With `TRANSPORT_TEXT` unset a phone is handed nothing, even a job made while it was on: `claim` answers `none` and the job waits, then expires. Turning the setting off is a real off switch.
- For Aaron, every changed line in the shared files:
  - `shared/outbox.ts`: one import (`phoneStatusLabel`); `outboxStatusLabel` takes an optional `detail` and returns the phone wording first when there is one (3 lines). No status was added.
  - `src/types.ts`: one import, and `OutboxMessage.detail?: DeliveryDetail`.
  - `src/data/repo.ts`: one line in `outboxFrom`, `detail: u(r.delivery_detail)`.
  - `src/store/store.ts`: none.
  - `server/dispatch.ts`: `note` added to `OutboxRow` and to both selects; `outboxId` and `note` passed to the transport; a result with `waiting` goes to the new `markWaiting` (sets `delivery_detail`, leaves the row `sending`) instead of `markSent`; `markFailed` takes an optional detail from the transport's error; `DispatchSummary.waiting`. The allowlist check, the claim, the 60-second window and the student-link step are untouched and still run in the same order. It also calls `sweepJobs()` at the start of `dispatchFirm`, inside a try/catch, and `DispatchSummary` has `swept`. `src/services/dispatch.ts` reloads when `processed + swept > 0`.
  - `server/transport/types.ts`: `TransportSend.outboxId`, `TransportSend.note`, `TransportResult.waiting`.
- William's steps:
  1. Done: the migration is applied and the types are regenerated.
  2. Add his Gmail address and the test numbers (his own, and any test recipient) to `SEND_ALLOWLIST`.
  3. Set `TRANSPORT_TEXT=phone` on a preview deployment. Leave it unset everywhere else.
  4. Firm settings: turn on sending from Gmail, then "Connect an iPhone". Scan the code with the phone.
  5. Build the shortcut and the Mail automation; replace `docs/phone-gateway/ios-setup.md` with the tested steps; set `VITE_PHONE_SHORTCUT_URL`.
  6. Save his own number in "Your phone" and press "Send a test to my own number".

## Prior — M3 / M3b

Approvals home at `/app`, Activity, reminder skips (`20261131000001`), edit profile/notes/recap, Waiting on other screens. Merged to main.

## Known issues

- Loading the sample does not write the old simulated outbox history.
- The AI rate limit in `server/rateLimit.ts` is still memory inside one function instance.
- The sample caseload still uses real colleges, Common App, CSS Profile, and activity organizations.
- Permanent reminder skips have no Settings UI to re-enable (toast Undo only).

## Next step

M4c command bar, or the signed-in panel pass on a reset demo if it was not finished in the browser. File tools stay M4d. Permanent reminder skips still have no Settings screen.

## M4b-2

The panel talks to `POST /api/agent` and `GET /api/agent?studentId=`. `VITE_AGENT_MOCK=true` keeps the canned client.

- `shared/agent.ts` — reply `sources: [{ kind, id, label }]`, plus `AgentHistory` for the thread (`messages` with each reply’s sources and proposals, proposals carrying `status`).
- `server/agent/sources.ts` — chips are built from tool results only (task, meeting, student, and so on). The model’s own source list is not used.
- `server/agent/history.ts` and `GET` on `api/agent.ts` — this counselor’s thread, last 50 user and assistant messages, tool rows left out, read with the counselor’s token.
- `src/services/agentClient.ts` — real client is the default; session token like `aiClient`.
- `src/components/agent/types.ts` — removed. The panel uses `shared/agent.ts`.
- Panel: loads history on open and when the student changes; proposal cards show Pending, Approved, or Discarded; pending cards link to Approvals; 429, 401, and 500 show the server’s text; a reply that created proposals calls `reload(true)` so the Approvals badge updates; `console.debug` logs the reply time, and Thinking… shows the seconds after 3s.

Checks: `typecheck`, `lint`, `test:notes`, `test:outbox` exit 0. `test:agent` passed all 8 cases. Signed-in sample caseload, real agent: “What’s overdue?” 7.3s, “Draft a reminder to their mom about the essay deadline.” 29.3s, “Who needs attention this week?” 7.8s. Source chips matched Kevin’s tasks. The proposal showed Pending, the Approvals badge went from 22 to 23 without a reload, and after approval plus a reload the card showed Approved with the history intact. Sophia’s thread was empty and separate.
