# Build log

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
- **Not applied:** `supabase/migrations/20261202000001_phone_gateway.sql`. It was not pushed. The SQL has never been run anywhere. Until it is applied, "Your phone" stays hidden in Firm settings and `TRANSPORT_TEXT=phone` must stay unset.
- **Migration history is out of step:** `npx supabase migration list --remote` shows `20261201000001` on the remote with no local file on `main`. The new file is named after it. Whoever applied `20261201000001` needs to commit its file before the next `db:push`, or the CLI will complain about a remote version it cannot find locally.
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
- Checks: `typecheck`, `lint`, `test:notes`, `test:outbox`, `build` pass, with every `TRANSPORT_*` unset. `/phone-setup` was opened from the production build in a phone-sized Chrome: it shows the key from the URL fragment, the key is not in any request, and it makes no call to `/api/`.
- **Not verified:**
  - No text left a real phone. No real wake email was sent. No Shortcut was built.
  - The migration is not applied, so nothing ran against the real database: not the tables, the grants, row level security, nor `claim_phone_send_job`. "Two claims at once, exactly one gets it" was proven against the in-memory stand-in, which does the claim in one step of JavaScript, not against Postgres.
  - "Your phone" in Firm settings, the QR code, and the new Messages states were not looked at in a browser (they need the tables). They typecheck and build. The QR code has not been scanned.
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
  10. The sweeps (expire, lease to unknown) run on every `claim` and every counselor `status` call, and Messages asks for status every 10 seconds while a row waits. There is no cron, so with the app closed and the phone silent, a row stays "Waiting for your phone" until someone opens Messages or Firm settings.
  11. The caps (20 an hour, 100 a day) count jobs by `claimed_at`. The rate limits on `/api/phone` are the in-memory ones from `server/rateLimit.ts`.
  12. `/phone-setup` leaves the key in the URL fragment, so it stays in the phone browser's history. Reconnecting the phone makes a new key and revokes the old one.
  13. New dependency: `qrcode-generator` 2.0.4 (MIT, no dependencies), for the QR code. It is not a state library, UI kit or ORM, but it is new, so say if it should go.
  14. Aaron's `20261201000001` is on the remote and not in the repo, so the hand-added types in `src/lib/database.types.ts` cover only this change. Run `npm run db:types` after applying.
- For Aaron, every changed line in the shared files:
  - `shared/outbox.ts`: one import (`phoneStatusLabel`); `outboxStatusLabel` takes an optional `detail` and returns the phone wording first when there is one (3 lines). No status was added.
  - `src/types.ts`: one import, and `OutboxMessage.detail?: DeliveryDetail`.
  - `src/data/repo.ts`: one line in `outboxFrom`, `detail: u(r.delivery_detail)`.
  - `src/store/store.ts`: none.
  - `server/dispatch.ts`: `note` added to `OutboxRow` and to both selects; `outboxId` and `note` passed to the transport; a result with `waiting` goes to the new `markWaiting` (sets `delivery_detail`, leaves the row `sending`) instead of `markSent`; `markFailed` takes an optional detail from the transport's error; `DispatchSummary.waiting`. The allowlist check, the claim, the 60-second window and the student-link step are untouched and still run in the same order.
  - `server/transport/types.ts`: `TransportSend.outboxId`, `TransportSend.note`, `TransportResult.waiting`.
- William's steps:
  1. Sort out `20261201000001` (see above), then `npm run db:push`: check the list shows only `20261202000001_phone_gateway.sql`, confirm, then `npm run db:types`.
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

Aaron: `npm run db:push` then `npm run db:types`, then `npm run test:agent`. Manual Approvals check after Reset demo. Then M4b panel.
