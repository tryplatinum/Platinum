# Platinum overview

A reference for the whole codebase, written from the code on `main` at the start of the feature freeze. Where the code and older docs disagree, this file follows the code. The list of disagreements is at the end of "Known limitations and roadmap".

## 1. At a glance

Platinum is a web workspace for a college-counseling firm. Counselors keep the firm's students, families, tasks, colleges, meetings, essays and files in one database, and an AI assistant drafts the follow-through. A person approves every outbound message before it can leave, and the dispatcher sends only to an allowlist.

| Who | What they do in it |
| --- | --- |
| Counselor | Signs in on a laptop, works the caseload, reviews and approves drafts |
| Firm owner | A counselor with the `owner` role: firm settings, owner-only folders, deleting students or the caseload when owner-only files are involved |
| Student | Opens a secret link on their phone (no login), sees their tasks and meetings, marks tasks done, adds files |
| Parent | Receives approved messages (email or text today). Has no page or login |

**Stage:** a prototype on invented data. Only invented people are in the product until a privacy review. Real sending is off by default and limited to the founders' own addresses and numbers.

## 2. Stack

| Layer | What | Version (package.json) |
| --- | --- | --- |
| Frontend | React, React Router | `react` ^19.3.1, `react-router-dom` ^7.18.6 |
| Build | Vite, `@vitejs/plugin-react` | `vite` ^8.3.8 |
| Styling | Tailwind CSS (via `@tailwindcss/vite`), Inter and Manrope fonts | `tailwindcss` ^4.3.5 |
| State | Zustand (one store) | `zustand` ^5.1.0 |
| Validation | Zod, shared by browser and server | `zod` ^4.6.7 |
| Language | TypeScript 7 for `typecheck` (`@typescript/native`), TypeScript 6 for ESLint's type-aware rules | ^7.0.2 / ^6.0.2 |
| Backend | Vercel functions in `api/` (Web `Request`/`Response` handlers) | `@vercel/functions` ^3.11.3 |
| Database, auth, files | Supabase: Postgres, Auth, Storage, row level security | `@supabase/supabase-js` ^2.119.2, CLI `supabase` ^3.2.0 |
| AI | Anthropic Messages API, server only | `@anthropic-ai/sdk` ^1.12.0 |
| AI models | `claude-sonnet-5-5` for everything (override with `ANTHROPIC_MODEL`); `claude-haiku-5-5` for file sorting | |
| Files | `pdf-lib` (first pages of a PDF), `sharp` and `heic-convert` (photo copies for sorting) | ^1.17.1, ^0.35.5, ^2.1.0 |
| Other | `lucide-react` icons, `qrcode-generator` | ^1.79.0, 2.0.4 |
| Hosting | Vercel (`vercel.json` rewrites non-`/api` paths to `index.html`). `public/_redirects` covers static hosts | |
| Lint | ESLint, `typescript-eslint`, `eslint-plugin-react-hooks` | ^10.15.0 |

## 3. Architecture

```
 Browser (React, Zustand store)                     Counselor's iPhone
   │  supabase-js as the signed-in person              │ Apple Shortcut
   │  (tables, apply_changes, queue_message,           │ POST /api/phone (claim, report)
   │   Storage uploads)                                │
   │                                                   │
   ├──────────────► Supabase ◄─────────────────────────┼───────────┐
   │                Auth · Postgres + RLS · Storage    │           │
   │                       ▲                           │           │
   │  fetch /api/* with    │ as the user (RLS)         │           │
   │  Bearer access token  │ or service role           │           │
   ▼                       │                           ▼           │
 api/*.ts (Vercel functions) ──► server/* ─────────────────────────┘
                                  │
                                  ├─► Anthropic (drafts, assistant, sorting, translation)
                                  ├─► Google OAuth, Drive API, Gmail API
                                  └─► Transport: log · Gmail · phone job
```

How a request flows: the browser reads and writes the firm's data directly through Supabase as the signed-in person, so row level security decides what it can reach. Anything that needs a secret (Anthropic, Google, the service role) goes through a function in `api/`. Each handler is thin: it rate-limits, calls `identify()` in `server/supabase.ts` to verify the Supabase access token and find the caller's firm, validates the body, and hands off to `server/`. Server code reads with the caller's own client where it can, and uses the service role only for work no signed-in person can do (the student link, the dispatcher, assistant rows, Google tokens, phone jobs). Outbound messages never go from the browser to a provider: the browser calls `queue_message`, then `/api/dispatch` sends what is due.

## 4. Repo map

| Path | What is in it |
| --- | --- |
| `api/` | Nine Vercel functions, one file per route. Handlers only |
| `server/` | Server logic: Claude calls, prompts, dispatcher, rate limit, Supabase clients, student link, files, colleges |
| `server/agent/` | The assistant: run loop, tools, proposals, history, summary header, formatting, translation |
| `server/google/` | OAuth connection, token encryption, Drive browse/import/sync, the fake Drive for local work |
| `server/phoneGateway/` | Phone pairing, device keys, jobs, claim and report, the wake email |
| `server/transport/` | The `Transport` interface and its log, Gmail and phone implementations, plus `getTransport` |
| `shared/` | Zod schemas and pure rules used by both browser and server (AI contract, outbox, dispatch, files, Google, phone, agent) |
| `src/screens/counselor/` | Counselor screens: Today, Inbox (`Approvals.tsx`), Students, Meetings, Messages, Weekly texts, Documents, Activity, Settings, Sign in |
| `src/screens/counselor/student/` | Student page tabs: Overview, Profile, Meetings, Essays, Documents, Reports, College list |
| `src/screens/student/` | The student's phone page and its link layout |
| `src/screens/PhoneSetup.tsx` | `/phone-setup`, opened on the counselor's iPhone |
| `src/components/` | Shared UI (`ui.tsx`), layout, forms, and folders for `agent/`, `files/`, `google/`, `meeting/`, `phone/` |
| `src/store/` | The Zustand store (`store.ts`) plus file, list-draft and session slices |
| `src/data/` | `repo.ts` (the only file that talks to tables), `seed.ts` and `fixtures.ts` (invented sample caseload) |
| `src/lib/` | Derived facts (`derive.ts`), AI facts (`facts.ts`), reminders, college bands, dates, Supabase client, generated DB types |
| `src/services/` | Browser clients for each `/api` route, and the outbox and dispatch helpers |
| `supabase/migrations/` | SQL migrations, in order |
| `scripts/` | Test scripts, the college import, asset builders, an in-memory Supabase stand-in |
| `docs/` | `BUILD_LOG.md`, this file, model comparison, phone and Drive screenshots, iOS setup draft |
| `design/` | Brand guide and approved HTML mockups (reference only) |
| `public/` | Logo files and `_redirects` |

## 5. Features

Status: **Working** (in use end to end), **Partial** (works with a stated piece missing), **Off by default** (needs server settings), **Stub** (shape exists, nothing happens).

| Feature | What the user sees | How it works | Main files | Status |
| --- | --- | --- | --- | --- |
| Sign-in and firms | Email and password sign-in, sign-up, password reset. First sign-in asks for a firm name | Supabase Auth. `create_firm` makes the firm with the caller as owner and seeds folders. One account belongs to one firm. No invitations | `src/screens/counselor/SignIn.tsx`, `src/store/session.ts`, `src/components/RequireFirm.tsx` | Working |
| Today | Where a counselor lands after signing in (`/app/today`): three numbers (meetings today, waiting, slipping), the oldest draft for three different students as short rows that open in place, meetings today and tomorrow, up to five students behind or slipping, and four ways to start something | Computed from data already loaded. No AI call and no extra request on opening | `src/screens/counselor/Today.tsx`, `src/lib/today.ts` | Working |
| Templates | A firm's reusable task plans, messages and handouts, managed at `/app/templates` and used from a student's tasks, the Students table (tick students, then "Assign a template"), the reminder box and Essays | A plan's offsets become dates in code and are shown before anything is added. A message template only makes drafts in `message_drafts`; approving one calls `sendMessage` like any other send. Blanks come from a fixed list filled by code; one that cannot be filled blocks approval. No model call | `shared/templates.ts`, `src/store/templates.ts`, `src/components/templates.tsx`, `src/screens/counselor/Templates.tsx`, `supabase/migrations/20261206000001_templates.sql` | Working in the preview and offline. **The migration is not on the database yet** |
| Google Calendar | Optional add-on to the Google connection, turned on in Settings: each meeting scheduled in Platinum gets one event on the counselor's own calendar, and the counselor's events are shown beside meetings on Today and the Meetings calendar, where one can be linked to a student | One permission, `calendar.events.owned`, asked for on its own. Every write passes `sendUpdates=none` and holds no guest (`assertQuiet`), so Google contacts nobody. The description is a link back and nothing else. Platinum deletes only an event it made. Events are read live and not stored | `shared/calendar.ts`, `server/google/calendar.ts`, `api/google.ts`, `src/lib/calendarSync.ts`, `src/components/google/CalendarBits.tsx`, `supabase/migrations/20261207000001_calendar.sql` | Working offline against the invented calendar and in the preview. **Never run against real Google. The migration is not on the database yet** |
| Roster | Students list with status, under a line about the firm's caseload | Store data plus derived status, late counts and deadlines from `derive.ts` | `src/screens/counselor/Students.tsx`, `src/lib/derive.ts` | Working |
| Student detail | Tabs for profile, tasks (owned by student, parent or counselor), college list, documents, essays, meetings, reports | Store actions diffed into one `apply_changes` transaction | `src/screens/counselor/StudentPage.tsx`, `student/*.tsx`, `src/components/TaskRows.tsx` | Working |
| Meetings and paste-in notes | Schedule a meeting, log one by pasting notes or a transcript; calendar view | No recording or calendar sync. Notes are stored on the meeting | `src/screens/counselor/Meetings.tsx`, `src/components/forms.tsx` | Working |
| Meeting drafts loop | After logging notes: a review with recap, tasks, profile changes, things to remember, parent updates | `draftFromMeeting` on `/api/ai`. Drafts are `pending`; approval creates the real rows. The "drafts are ready" activity line comes from `log_meeting_drafts_ready` | `src/services/workflows.ts`, `src/components/meeting/MeetingReview.tsx`, `server/prompts.ts` | Working |
| Inbox and Undo | `/app`: every pending draft and assistant proposal, files to file or check, and college list drafts, as a list of short rows with the open one shown whole beside it (in place of it on a phone). `?item=` holds what is open. An Undo toast for the length of the hold (`UNDO_SECONDS`, 10 seconds) after approving a send. A draft on WeChat or LINE, which are not connected, offers Copy instead of a send | Approve calls `queue_message`, which holds the row for the hold; Undo calls `cancel_message` | `src/screens/counselor/Approvals.tsx`, `src/lib/inbox.ts`, `src/lib/delivery.ts`, `src/store/store.ts`, `src/data/repo.ts` | Working |
| Activity | Firm-wide log, newest first, filters, Load more | `activity` table; counselor lines carry `actor_user`; AI and system lines come from functions or the server | `src/screens/counselor/Activity.tsx` | Working |
| Parent updates and reports | Bilingual drafts in English, Simplified or Traditional Chinese, per `Parent.language` | `parentReport` and meeting drafts; facts computed in code. Chinese has not been reviewed by a native speaker | `src/screens/counselor/student/ReportsTab.tsx`, `src/lib/facts.ts`, `src/components/Bilingual.tsx` | Working |
| Weekly texts | Messages → Weekly texts: one short text per student per week, Draft all, Copy, Open in Messages | `weeklyText` feature; facts and link from `reminders.ts`; model picks which task leads. English only | `src/screens/counselor/WeeklyTexts.tsx`, `src/lib/reminders.ts` | Working |
| Reminders and skips | Messages → Scheduled reminders; rules in Settings; "Run the daily send now"; Skip once or until turned back on | Rules per firm; queue computed in the browser; skips in `reminder_skips`. No scheduler | `src/lib/reminders.ts`, `src/screens/counselor/Messages.tsx`, `src/components/ReminderComposer.tsx` | Partial |
| Student link page | `/s/<token>` on the student's phone: tasks, meetings, deadlines, latest recap, essay feedback, Add a file | `/api/student` finds the link by token hash and returns a page built field by field. Three writes plus upload | `api/student.ts`, `server/studentLink.ts`, `src/screens/student/StudentView.tsx`, `src/components/StudentLinkModal.tsx` | Working |
| Assistant panel and tools | Side panel per student plus a general thread; suggested prompts, source chips, proposals as approval cards (`ApprovalCard.tsx`), decided in the panel or the Inbox | `POST /api/agent` runs a tool loop; writes only pending proposals | `src/components/agent/AgentPanel.tsx`, `api/agent.ts`, `server/agent/*` | Working |
| Meeting brief | Brief card before a meeting; also from the assistant ("Prep me…") | `preMeetingBrief` feature; computed facts beside the AI part. Prepared on request only | `src/components/meeting/BriefCard.tsx`, `server/agent/brief.ts` | Working |
| Essay feedback and brainstorm | Notes on a pasted essay (observation, question, location); brainstormed angles from the assistant | Output schemas have no field for replacement text. The UI says Platinum never writes or rewrites essay text | `src/screens/counselor/student/EssaysTab.tsx`, `shared/contract.ts`, `server/agent/essay.ts` | Working |
| College directory and list drafts | Type-ahead "Add college" with Scorecard figures; "Draft a list" grouped Reach / Target / Likely | Directory imported by hand. Bands set by code rules; the AI only chooses candidates and writes checked reasons. "Add to list" is `add_draft_to_college_list` | `api/colleges.ts`, `server/collegeTools.ts`, `server/collegeListDrafts.ts`, `src/lib/collegeBands.ts`, `src/screens/counselor/ListDraft.tsx` | Working |
| Document storage and auto-sorting | Upload window, Documents screen ("Waiting for you", "Check these"), per-student Documents tab | Browser uploads straight to a private bucket; the server checks type by first bytes and hash; the AI suggests a folder (counselor uploads) or files it (student uploads) | `api/documents.ts`, `server/documentSorting.ts`, `server/fileText.ts`, `src/screens/counselor/Documents.tsx` | Working |
| Owner-only files | Files in Decisions and awards, Financial aid, Identity and visa, Firm paperwork (or any folder marked so) disappear for non-owners | `document_is_owner_only` is called by the table policies, the bucket policies and the event log | `supabase/migrations/20261127000002_owner_only_link_rows.sql`, `src/components/files/FolderSettings.tsx` | Working |
| Gmail sending | Settings: turn on sending from Gmail. Approved emails go from the approver's own address | `GmailTransport` with the `gmail.send` scope, chosen when `TRANSPORT_EMAIL=gmail` | `server/transport/gmail.ts`, `src/components/google/GoogleAccount.tsx` | Off by default |
| Google Drive and the Picker | Connect Google Drive, choose files or folders in Google's Picker, import them, link a folder to a student | `drive.file` scope; Picker gets a short-lived access token from `/api/google` | `api/google.ts`, `server/google/*`, `src/components/google/DrivePicker.tsx`, `DriveFolders.tsx` | Off by default |
| Phone gateway (iPhone Shortcut) | Settings → Your phone: setup code, test text, last used, revoke. Messages shows "Waiting for your phone" and unconfirmed states | Dispatcher makes a job; a wake email nudges the phone; the Shortcut claims, sends with Messages, reports | `api/phone.ts`, `server/phoneGateway/*`, `server/transport/phoneGateway.ts`, `src/components/phone/YourPhone.tsx`, `docs/phone-gateway/ios-setup.md` | Off by default (setup steps are a draft) |
| Dispatcher and allowlist | Messages shows queued, sending, sent, failed | `/api/dispatch` claims due rows, checks `SEND_ALLOWLIST`, fills any student link, picks a transport | `api/dispatch.ts`, `server/dispatch.ts`, `shared/dispatch.ts` | Working (log transport by default) |
| Translation ("Show in English") | Button on a Chinese assistant draft, in the Inbox or the assistant panel | `/api/translate` makes one call, then saves the English on the proposal for reuse | `api/translate.ts`, `server/agent/translate.ts` | Working |
| LINE and WeChat | Channels can be chosen and stored on a parent | `resolveAddress` refuses both with "channel not connected yet." No transport, no webhook | `shared/dispatch.ts`, `server/agent/channels.ts` | Stub |

## 6. The AI assistant in detail

### Tools

All tools are in `server/agent/tools.ts`. Read tools use the counselor's own Supabase client. On a student thread, every read is locked to that thread's student.

| Tool | What it does |
| --- | --- |
| `get_student` | Profile and parents, with each parent's language and channel |
| `list_tasks` | Tasks for a student, filtered by open, overdue or owner |
| `list_deadlines` | Upcoming task due dates and college application deadlines |
| `search_meetings` | Meeting notes, transcript and recap by keyword or date range |
| `list_recent_messages` | Recent outbox rows for a student: status, kind, date |
| `get_notes_to_remember` | Approved "things to remember" for the student |
| `list_students_needing_attention` | General thread only: students who are overdue, stalled or without a recent meeting |
| `propose_message` | Pending message for the Inbox. Server refuses over 120 words (text, LINE, WeChat) or 200 (email) |
| `propose_parent_update` | Pending parent update, same limits |
| `propose_task` | Pending new task |
| `propose_profile_change` | Pending profile field change |
| `propose_meeting_times` | Two or three time slots with reasons. Approving records the choice; no calendar write |
| `prepare_meeting_brief` | Runs the brief and returns it as the reply. Not a proposal |
| `essay_brainstorm` | Brainstorms essay angles from the prompt and the student's record. Never writes essay text |

### How a request runs

`POST /api/agent` (`api/agent.ts` → `server/agent/run.ts`):

1. Rate limit by address, then `identify()`, then per-person rate limit. Body under 20,000 bytes; `message` 1 to 8,000 characters (`shared/agent.ts`).
2. Take one model call from the firm's daily budget (`reserve_agent_call`). None left: 429 "Daily assistant limit reached."
3. Load the counselor's name, the firm name and, on a student thread, a live student summary (`server/agent/summary.ts`), which includes which channels can actually send (`server/agent/channels.ts`).
4. Find or create this counselor's thread for the student (or the general thread), load the last 80 rows of history with thinking blocks removed, and save the new user message.
5. Loop for up to `AGENT_MAX_ROUNDS` rounds (default 8). Every round after the first takes another call from the budget. Each round calls Claude, saves the assistant row, runs any tool calls in parallel, and saves the tool results.
6. When a round's only tool is a successful brief, brainstorm or drafted message, the server writes the reply itself (`server/agent/format.ts`) and skips the extra model call.
7. If the round limit or the budget runs out, the reply ends with a note and any unanswered tool calls are closed so the next turn is valid.
8. The response carries the reply, the proposals made, source chips built from tool results (`server/agent/sources.ts`), and timing.

While it waits, the panel polls `GET /api/agent?progress=<requestId>` for a step label ("Writing a reply…", "Brainstorming…"). `GET /api/agent?studentId=` returns the thread's last 50 user and assistant messages.

**Daily budget:** `AGENT_DAILY_LIMIT` model calls per firm per UTC day, default 200. Counted in `agent_usage`. One question costs one call per round, so typically one or two.

### How proposals reach the Inbox

`insertProposal` (`server/agent/proposals.ts`) first finds the student with the counselor's own client in the counselor's firm, then inserts a `pending` row in `agent_proposals` with the service role. The browser loads proposals with the rest of the firm's data, and Approvals lists them as "From the assistant" with rationale and sources. Editing calls `edit_agent_proposal`; approving or discarding calls `decide_agent_proposal`. On approval the store acts on the kind: a message or parent update goes to `sendMessage` (so `queue_message` and the 10-second Undo), a task is added, a profile change is applied, meeting times are recorded in Activity (`src/store/store.ts`, `approveAgentProposal`).

### Thinking settings

| Call | Setting |
| --- | --- |
| Assistant loop | `thinking: { type: 'between_tools' }`, which is thinking off on `claude-sonnet-5-5`. `max_tokens` 4,000, or 200 once a proposal exists |
| Shared AI features (`runFeature`) | Model default (adaptive) thinking; `effort` set per feature in `server/prompts.ts` (low or medium). `max_tokens` 16,000 |
| Meeting brief (assistant) | `runFeature`, `max_tokens` 4,000, `AGENT_FAST_MODEL` if set |
| Essay brainstorm | Direct structured call, model default thinking, `max_tokens` 700, `AGENT_FAST_MODEL` if set |
| Translation | Main model, `max_tokens` 800. Never the fast model |
| File sorting | `ANTHROPIC_SORT_MODEL` (default `claude-haiku-5-5`), low effort |

Thinking blocks are never saved to `agent_messages` and never replayed in later turns.

### Model

`claude-sonnet-5-5` unless `ANTHROPIC_MODEL` is set (`server/claude.ts`). `AGENT_FAST_MODEL` is empty by default; when set, only the brief and the brainstorm use it. Parent-facing messages never use it. Shared features can fall back to another model inside the same call when a request is declined (`AI_REFUSAL_FALLBACK=off` turns that off).

### Measured timings

From `docs/BUILD_LOG.md`, the latest `test:agent` run (wall time, model time in brackets):

| Case | Target | Measured |
| --- | --- | --- |
| "What's overdue?" | 6 s | 5.6 s (2.0 s); 2.7 s (1.3 s) in a later case |
| Draft a reminder (Chinese email) | 12 s | 9.6 s (6.6 s, one model call) |
| Meeting brief | 10 s | 9.3 s (brief tool 5.1 s) |
| Essay brainstorm | 12 s | 10.4 s (brainstorm tool 6.1 s) |

About 2.5 s of each request is database work before the first model call.

## 7. Sending messages

### From draft to delivery

1. **Draft.** An AI draft (meeting review, reminder, weekly text, parent report) or an assistant proposal. Nothing is queued yet.
2. **Approval.** A counselor presses approve or send. Pressing Copy or Open in Messages on a weekly text also counts, and records the text as "Sent from your own phone".
3. **`queue_message`.** A database function and the only way into `outbox`. It checks the caller belongs to the student's firm, that the parent and task belong to that student, and the channel, language, kind and body. It stores `approved_by` as the caller and sets `send_after` `UNDO_SECONDS` seconds ahead, with status `queued`.
4. **Undo window.** For 10 seconds the toast offers Undo, which calls `cancel_message` (status `cancelled`).
5. **Dispatcher.** The browser calls `POST /api/dispatch` when the window ends and on app load. `dispatchFirm` claims each due row (`queued` → `sending`) so two callers cannot send it twice.
6. **Address and allowlist.** `resolveAddress` picks the phone or email from the student or parent record (LINE and WeChat are refused). `allowlistAllows` checks it against `SEND_ALLOWLIST`; an empty list allows nothing. A refused row is marked `failed` with "recipient not on allowlist".
7. **Student link.** If a message to a student contains `{{student_link}}`, the dispatcher mints a fresh 30-day link, stores only its hash, and fills the address into the outgoing copy. The stored outbox row keeps the placeholder.
8. **Transport.** `getTransport(channel)` chooses one, then the row becomes `sent`, `failed`, or stays `sending` while a phone works on it. Each outcome writes an activity line.

### Transports

| Transport | When it is chosen | What it does |
| --- | --- | --- |
| Log (`server/transport/log.ts`) | Default for every channel; any unknown `TRANSPORT` value | Prints the outbox id, channel, a masked recipient and the body length, and returns a `log_` id. Never prints the body or subject |
| Gmail (`server/transport/gmail.ts`) | Email, when `TRANSPORT_EMAIL` is exactly `gmail` | Sends a plain-text email from the approving counselor's connected Gmail with `gmail.send`. The subject comes from the message kind and language (`shared/emailSubject.ts`) |
| Phone (`server/transport/phoneGateway.ts`) | Text, when `TRANSPORT_TEXT` is exactly `phone` | Makes a `phone_send_jobs` row for the approver's phone and sends the fixed wake email. The Shortcut claims the job, sends it, and reports. A text already marked "Sent from your own phone" is recorded without a job |

The assistant only offers channels that can send: email when Gmail is the transport and connected, text when the phone is the transport and paired. The log transport counts only with `ALLOW_LOG_TRANSPORT=true` (development).

### Statuses

`outbox.status` (`shared/outbox.ts`): `queued`, `cancelled`, `sending`, `sent`, `failed`.

For phone texts, `outbox.delivery_detail` adds the case: `phone_waiting` (handed to the phone), `phone_sent`, `phone_unknown` (no report within the 10-minute lease; the counselor chooses "It was sent" or "Send again"), `phone_expired` (the phone never claimed it), `phone_failed`, `phone_none` (no phone paired). Phone jobs have their own statuses: `pending`, `claimed`, `submitted`, `failed`, `unknown`, `expired`, `cancelled` (`shared/phoneGateway.ts`). An unconfirmed job is never handed out again.

## 8. Accounts and authentication

| Who | How they prove it | Where |
| --- | --- | --- |
| Counselor | Supabase email and password. The browser holds the session and sends the access token as `Authorization: Bearer` to every `/api` route | `src/store/session.ts`, `server/supabase.ts` |
| Firm membership | `firm_members` row with role `owner` or `counselor`. One firm per account. `create_firm` is the only way a firm is made, and makes the caller its owner | `supabase/migrations/20261123000001_schema_and_policies.sql` |
| Student | A link token: 32 random bytes, only its SHA-256 hash stored. Expires 30 days after it is made or rotated. Created from the student page, or minted by the dispatcher when a message needs one. Sent in the `x-student-token` header | `server/studentLink.ts`, `src/data/repo.ts`, `server/dispatch.ts` |
| Phone | An 8-character setup code (hash stored, single use, 10 minutes) typed on `/phone-setup`, exchanged for a device key (hash stored, shown once, 90 days). Pairing revokes any earlier phone. The counselor can revoke it | `server/phoneGateway/counselor.ts`, `server/phoneGateway/device.ts`, `server/phoneGateway/keys.ts` |
| Google | OAuth web flow with an HMAC-signed `state` tied to an HttpOnly cookie, ten-minute expiry. Refresh tokens encrypted with AES-256-GCM under `GOOGLE_TOKEN_KEY` | `server/google/connection.ts`, `server/google/secrets.ts` |

**Google scopes:**

| Scope | Asked for when | Google classification |
| --- | --- | --- |
| `https://www.googleapis.com/auth/drive.file` | Connecting Drive | Non-sensitive (only files the user picks or the app creates) |
| `https://www.googleapis.com/auth/gmail.send` | Only when the counselor turns on sending from Gmail | Sensitive (send only, cannot read mail) |

Consent uses `include_granted_scopes=false`, so an older, broader Drive grant is not carried over. A connection without `drive.file` is asked to reconnect.

**How API routes identify the caller.** Every counselor route calls `identify()`, which verifies the Bearer token with Supabase (`auth.getUser`), then reads the caller's `firm_members` row through row level security. The firm id and user id always come from there, never from the request body. `/api/student` identifies by link token hash. `/api/phone` identifies the phone by device key hash on `claim` and `report`, and the counselor by `identify()` on everything else. The Google redirect (`GET /api/google`) is identified by its signed `state`, and membership is checked again before the code is exchanged.

**Where the service role is used, and why:**

| Where | Why |
| --- | --- |
| `server/studentLink.ts` | A student has no Supabase session. Reads and writes are filtered by the link's firm and student |
| `server/dispatch.ts` | Claiming and updating outbox rows and minting links, which no signed-in person may write directly |
| `server/agent/run.ts`, `proposals.ts` | Assistant threads, messages, proposals and the budget are not writable by signed-in people |
| `server/documentSorting.ts` | Background sorting after a student upload; deleting a student's or the firm's files after the owner-only check |
| `server/google/*` | `google_connections` and `student_drive_folders` hold server-only columns |
| `server/phoneGateway/*` | Phone tables have no grants for signed-in people |
| Scripts | The college import and the test scripts that make throwaway accounts |

## 9. Backend APIs

### Internal routes

| Route | Method | Purpose | Caller | Auth | File |
| --- | --- | --- | --- | --- | --- |
| `/api/ai` | GET | Whether AI is available, and the model name | Anyone | None; returns no secrets | `api/ai.ts` |
| `/api/ai` | POST | One AI draft for a feature (`draftFromMeeting`, `readNotes`, `preMeetingBrief`, `parentReport`, `essayFeedback`, `reminderDraft`, `weeklyText`). Writes nothing | Firm member | `identify()`; 60 KB cap; 30 per person per 5 min | `api/ai.ts` |
| `/api/agent` | POST | One assistant turn | Firm member | `identify()`; 20 KB cap; 40 per person per 5 min; daily budget | `api/agent.ts` |
| `/api/agent` | GET | Thread history, or progress for a request id | Firm member | `identify()` | `api/agent.ts` |
| `/api/translate` | POST | English for a pending assistant message | Firm member | `identify()` | `api/translate.ts` |
| `/api/dispatch` | POST | Send the firm's due queued messages | Firm member | `identify()`; firm from the caller only | `api/dispatch.ts` |
| `/api/student` | GET | The student page | Student | Link token header; same 404 for unknown, revoked and expired | `api/student.ts` |
| `/api/student` | POST | Mark a task done, leave a note, attach a link, `start_upload`, `finish_upload` | Student | Link token; limits by token and address | `api/student.ts` |
| `/api/documents` | POST | `start`, `finish`, `suggest`, `file`, `rename`, `open` (60-second signed URL), `delete`, `settle` | Firm member | `identify()`; user client so storage policies apply | `api/documents.ts` |
| `/api/colleges` | POST | `search`, `get`, `band`, `draft` (list draft) | Firm member | `identify()`; user client only; 10 drafts per person per 5 min | `api/colleges.ts` |
| `/api/google` | POST | `status`, `picker`, `connect`, `disconnect`, `browse`, `import`, `folders`, `link`, `unlink`, `sync`, `import_removed` | Firm member | `identify()`; Zod per action | `api/google.ts` |
| `/api/google` | GET | OAuth redirect back from Google | Browser that started connect | Signed `state` plus cookie | `api/google.ts` |
| `/api/phone` | POST | Phone: `pair`, `claim`, `report`. Counselor: `status`, `connect`, `number`, `test`, `wake`, `disconnect`, `resolve`, `cancel` | Phone or firm member | Setup code (`pair`), device key (`claim`, `report`), `identify()` (the rest) | `api/phone.ts` |

All routes answer `cache-control: no-store`. Server failures return a fixed sentence; the real error is logged on the server only. In `npm run dev`, `vite.config.ts` mounts all nine routes.

### External services

| Service | Used for | Configured by |
| --- | --- | --- |
| Supabase Auth | Counselor accounts, sessions, password reset | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (Site URL and redirect URLs in the dashboard) |
| Supabase Postgres | All firm data, the queue, policies and functions | Same, plus `SUPABASE_SERVICE_ROLE_KEY` on the server; optional `SUPABASE_URL`, `SUPABASE_ANON_KEY` aliases |
| Supabase Storage | Private `documents` bucket, 25 MB per file | Same; bucket made by migration |
| Anthropic | Drafts, assistant, brief, brainstorm, list reasons, file sorting, translation | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_SORT_MODEL`, `AGENT_FAST_MODEL`, `AI_REFUSAL_FALLBACK` |
| Google OAuth | Connecting a counselor's Google account | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_KEY`, `GOOGLE_REDIRECT_URI` |
| Gmail API | Sending approved email; the phone wake email | `TRANSPORT_EMAIL`, `SEND_ALLOWLIST` |
| Drive API and Picker | Importing picked files, syncing linked folders | `VITE_GOOGLE_PICKER_KEY`, `VITE_GOOGLE_APP_ID`, `GOOGLE_SYNC_BATCH` |
| Vercel | Hosting the site and functions; `waitUntil` for background sorting | Project settings; the platform sets `VERCEL` |
| Apple Shortcut | Claims and sends texts from the counselor's iPhone | `TRANSPORT_TEXT`, `VITE_PHONE_SHORTCUT_URL`, `PHONE_WAKE_FAKE` (local only) |
| College Scorecard | One-off import of the college directory | `SCORECARD_API_KEY` (import script only) |

## 10. Data model

Row level security is enabled on every table below. "Members" means policies limit rows to the caller's firm; "server only" means no grants for signed-in people.

| Table | Holds | Access |
| --- | --- | --- |
| `firms` | Firm name, weekly text day, sorting switch | Members read; owner updates |
| `firm_members` | User, firm, role, display name | Members read; owner writes |
| `students` | Profile, contact, settings | Members |
| `parents` | Contact, language, channel | Members |
| `meetings` | Schedule, notes, drafts, recap | Members |
| `tasks` | Title, owner (student, parent, counselor), due date, status | Members |
| `colleges` | A student's list, optional link to the directory | Members |
| `documents` | Essays, stored files, name-or-link rows | Members; owner-only rule for restricted folders |
| `reports` | Parent reports; an AI report needs an approval before it can be marked sent | Members |
| `outbox` | Queued and sent messages | Members read; writes only through `queue_message` and `cancel_message` |
| `reminder_rules` | Per-firm reminder rules | Members |
| `activity` | Firm log; `actor_user` on counselor lines | Members read; may write only their own counselor lines |
| `student_links` | Link hash, expiry, revoked time | Members read every column except the hash |
| `weekly_texts` | Each week's draft and sent or skipped state | Members |
| `personal_notes` | Things to remember | Members |
| `document_types` | The firm's folders and their sensitivity | Members read; owner writes |
| `document_events` | Insert-only file log | Members, actor bound to the caller |
| `college_directory`, `college_programs` | Shared Scorecard data | Signed-in read only |
| `college_list_drafts`, `college_list_draft_items` | List drafts and their items | Members |
| `google_connections` | Encrypted refresh token, scopes, address | Server only |
| `student_drive_folders` | Drive folders linked to a student | Members read public columns; server writes |
| `reminder_skips` | Skipped reminder keys | Members read, insert, delete |
| `agent_threads`, `agent_messages`, `agent_proposals` | Assistant conversations and proposals | Members read; changes through functions or the server |
| `agent_usage` | Model calls per firm per UTC day | Server only |
| `phone_devices`, `phone_setup_codes`, `phone_send_jobs`, `phone_job_events` | Phone pairing and jobs | Server only |

Storage: bucket `documents` is private. Object policies require the first path segment to be the caller's firm and call the same owner-only rule as the table.

**Key database functions:**

| Function | What it does |
| --- | --- |
| `is_firm_member`, `is_firm_owner` | Used by every policy |
| `create_firm` | Makes a firm with the caller as owner and seeds folders |
| `apply_changes` | The store's one write path: a batch of upserts and deletes in one transaction, as the caller. Refuses the outbox |
| `queue_message` | The only insert into `outbox`; records the approver and holds 10 seconds |
| `cancel_message` | Cancels a queued row inside its 10 seconds |
| `student_link_write` | The student's task write; server only |
| `file_document` | Files a stored document into a folder for a student |
| `document_is_owner_only`, `document_is_readable`, `document_type_is_open` | The owner-only rule |
| `owner_only_file_count` | How many owner-only files a delete would touch |
| `add_draft_to_college_list` | Writes kept draft colleges into the list and approves the draft |
| `decide_agent_proposal`, `edit_agent_proposal` | Approve or discard, or edit, a pending proposal in the caller's firm |
| `reserve_agent_call` | Takes one model call from today's budget in a single statement |
| `log_meeting_drafts_ready` | Writes the "drafts are ready" AI line |
| `claim_phone_send_job` | Hands the oldest pending job to one device with a 10-minute lease; server only |
| `seed_document_types`, `path_uuid`, `set_updated_at`, `documents_keep_server_columns` | Helpers and triggers |

## 11. Protections in place

- **Approval enforced in the database.** `outbox` has no write policies; `queue_message` is the only insert and records the approver. `apply_changes` refuses any batch that names the outbox. An AI-drafted report cannot be marked sent without an approval.
- **Undo.** Every approved message waits 10 seconds and can be cancelled.
- **Allowlist.** The dispatcher checks `SEND_ALLOWLIST` before choosing a transport. An empty list sends nothing. Phone claims and the wake address are checked again.
- **Only the dispatcher calls a transport.** The one other send is the fixed "Wake." email to the counselor's own allowlisted Gmail.
- **Row level security on every table**, with explicit revokes for `anon` and narrow grants for signed-in people. Server-only tables have no grants at all.
- **Isolation between firms.** Student-owned rows use a composite `(firm_id, student_id)` foreign key. `npm run test:isolation` proves on the real project that two firms cannot reach each other and the anon key reaches nothing.
- **Student links** are stored only as a hash, expire after 30 days, can be rotated or revoked, and return the same 404 for unknown, revoked and expired. The page is built field by field: no parents, counselor notes, drafts or other students.
- **Phone credentials.** Setup codes and device keys are stored as hashes; codes are single use for 10 minutes; keys expire after 90 days and can be revoked. Finished jobs keep no message text.
- **Log redaction.** The log transport prints a masked recipient and body length only. Student-link addresses are stripped from send errors. Server errors reach the browser as a fixed sentence.
- **Cost guard.** A daily model-call budget per firm, reserved atomically before each call, plus a round limit per request and per-route request limits.
- **The assistant reads with the counselor's token.** Every caseload read goes through row level security. It can write only pending proposals, and only for a student found in the caller's firm. It cannot send, queue or edit records.
- **Narrow Google scopes.** `drive.file` and, only when turned on, `gmail.send`. Refresh tokens are encrypted per user. Fake Google and fake wake modes refuse to run in a build or on Vercel.
- **Files.** A private bucket, type checked by first bytes, 25 MB cap, 60-second download links, owner-only folders enforced in table and storage policies, student uploads limited per day, in total, and to 5 minutes from start to finish.
- **No secrets in the browser.** Only `VITE_` names are bundled; server code is never imported by `src/`.
- **Things to remember never reach a parent.** `npm run test:notes` and `test:isolation` check parent requests and the student link.

## 12. Environment variables

Set in `.env` (or `.env.local`, which overrides) locally and in Vercel project settings for a deployment. Only `VITE_` names reach the browser.

| Name | Required | Reaches browser | Purpose |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes | Yes | Supabase project URL. Public |
| `VITE_SUPABASE_ANON_KEY` | Yes | Yes | Publishable key; row level security decides access |
| `SUPABASE_URL` | No | No | Server alias for the URL. Scripts read it; the dev server does not |
| `SUPABASE_ANON_KEY` | No | No | Server alias for the publishable key, same note |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes for links, dispatch, assistant, files, Google, phone | No | Service role key |
| `ANTHROPIC_API_KEY` | For AI | No | Without it drafts are labelled placeholders |
| `ANTHROPIC_MODEL` | No | No | Model for every AI feature |
| `ANTHROPIC_SORT_MODEL` | No | No | Model for sorting files |
| `AI_REFUSAL_FALLBACK` | No | No | `off` disables the fallback on a declined request |
| `AGENT_DAILY_LIMIT` | No | No | Model calls per firm per UTC day (default 200) |
| `AGENT_MAX_ROUNDS` | No | No | Tool rounds per assistant request (default 8) |
| `AGENT_FAST_MODEL` | No | No | Faster model for brief and brainstorm only |
| `VITE_AGENT_MOCK` | No | Yes | `true` runs the panel against a canned client |
| `SEND_ALLOWLIST` | To send anything | No | Comma-separated phones and emails that may receive a send |
| `TRANSPORT` | No | No | Transport for all channels; only `log` exists |
| `TRANSPORT_EMAIL` | No | No | `gmail` sends email from the approver's Gmail |
| `TRANSPORT_TEXT` | No | No | `phone` hands texts to the approver's iPhone |
| `ALLOW_LOG_TRANSPORT` | No | No | Development: lets the log transport count as able to send |
| `PUBLIC_APP_URL` | For student links in messages | No | Origin used when the dispatcher fills a link |
| `PHONE_WAKE_FAKE` | No | No | Local only: records wake emails instead of sending |
| `VITE_PHONE_SHORTCUT_URL` | For phone setup | Yes | Install link for the Shortcut |
| `GOOGLE_CLIENT_ID` | For Google | No | OAuth client |
| `GOOGLE_CLIENT_SECRET` | For Google | No | OAuth client secret |
| `GOOGLE_TOKEN_KEY` | For Google | No | Encrypts refresh tokens and signs OAuth state |
| `GOOGLE_REDIRECT_URI` | No | No | Redirect address when it is not `/api/google` on the request's host |
| `VITE_GOOGLE_PICKER_KEY` | For the Picker | Yes | Browser key restricted to the Picker API |
| `VITE_GOOGLE_APP_ID` | For the Picker | Yes | Cloud project number |
| `GOOGLE_FAKE` | No | No | Local only: an invented Drive |
| `GOOGLE_FAKE_STATE` | No | No | Local only: file that changes the invented Drive |
| `GOOGLE_SYNC_BATCH` | No | No | Cap on files per sync call |
| `SCORECARD_API_KEY` | For `import:colleges` | No | College Scorecard API key |
| `VERCEL`, `NODE_ENV` | Set by the platform | No | Used to refuse local-only modes |
| `PLATINUM_DEV_SERVER` | Set by `vite.config.ts` | No | Marks the dev server |

## 13. Running and testing

**Setup:** Node 20.19 or newer, `npm install`, copy `.env.example` to `.env` and fill it in, then `npm run dev` (http://localhost:5173).

| Script | What it does | Outside service or live database |
| --- | --- | --- |
| `dev` | Vite dev server with all nine `/api` routes | Live Supabase; Anthropic and Google when used |
| `build` | Typecheck, then build to `dist/` | No |
| `preview` | Serve `dist/` (no functions) | No |
| `typecheck` | TypeScript only | No |
| `lint` | ESLint | No |
| `test:notes` | Things-to-remember checks, then `test:google` | No (offline) |
| `test:google` | Google connection and Drive import against fakes | No (offline) |
| `test:outbox` | Outbox and dispatch rules, then `test:phone` | No (offline) |
| `test:phone` | Phone gateway against the in-memory Supabase | No (offline) |
| `test:files` | What of a photo the sorting model sees | No (offline) |
| `test:bands` | College band rules and draft checks | No (offline) |
| `test:ai` | Every AI feature for real, plus file sorting and a list draft | Anthropic; creates and deletes a throwaway account and firm |
| `test:agent` | Assistant cases end to end, with timings | Anthropic; creates and deletes a throwaway firm |
| `test:isolation` | Firm isolation, anon key, student link and endpoints | Live database; creates and deletes rows |
| `test:phone:db` | Real `claim_phone_send_job` under concurrency | Live database; creates and deletes rows |
| `db:push` | Apply migrations to the linked project | Live database (writes) |
| `db:types` | Regenerate `src/lib/database.types.ts` | Live database (reads) |
| `import:colleges` | Fill the college directory (`-- --dry-run` writes nothing) | Scorecard API and live database |
| `build:programs` | Rewrite `shared/cipPrograms.ts` from the directory | Live database (reads) |
| `build:brand` | Rebuild logo files from the master image | No |

Before reporting work done: `typecheck`, `lint`, `test:notes`. Do not run `test:ai`, `test:agent`, `test:isolation` or `test:phone:db` unless the task says so.

**Migration workflow:**

1. Run `npx supabase migration list` (remote versions) and name the new file after the latest remote version.
2. Add a new file in `supabase/migrations/`. Never edit one that has been applied.
3. One person pushes at a time: `npm run db:push`, then `npm run db:types`.
4. Never pass `--yes` or any confirmation-skipping flag against production. If the CLI asks for confirmation, stop and report.

## 14. Migrations

| File | What it changed |
| --- | --- |
| `20261123000001_schema_and_policies.sql` | Firms, members, all core tables, four firm policies per table, `create_firm` |
| `20261123000002_student_links.sql` | Student links stored by token hash |
| `20261123000003_apply_changes.sql` | `apply_changes` batch writer and `student_link_write` |
| `20261123000004_word_limit_zero.sql` | Allows an essay word limit of 0 |
| `20261123000005_report_approval_rule.sql` | An AI report cannot be sent without approval |
| `20261124000001_weekly_texts.sql` | Weekly text day, per-student switch, `weekly_texts`, `outbox.note` |
| `20261125000001_personal_notes.sql` | Things to remember, parent copy setting |
| `20261125000002_weekly_text_lead.sql` | Which task a weekly text leads with, and why |
| `20261125000003_note_life.sql` | Approximate dates and use history on notes |
| `20261126000001_file_storage.sql` | Folders, stored-file columns, `document_events`, `file_document` |
| `20261126000002_documents_bucket.sql` | Private bucket and object policies |
| `20261126000003_college_directory.sql` | Shared college directory and programs |
| `20261126000004_college_list_drafts.sql` | List drafts, items, `add_draft_to_college_list` |
| `20261126000005_apply_changes_files_and_colleges.sql` | `apply_changes` knows folders, drafts and the sorting switch |
| `20261127000001_owner_only_removal.sql` | One owner-only rule; non-owners cannot remove owner-only files |
| `20261127000002_owner_only_link_rows.sql` | Name-or-link rows in owner-only folders follow the same rule |
| `20261127000003_document_student_link.sql` | Which student link a file came through |
| `20261128000001_outbox_queue.sql` | Outbox becomes a queue; `queue_message`, `cancel_message` |
| `20261128000002_cancel_message_qualify.sql` | Fixes an ambiguous column in `cancel_message` |
| `20261129000001_dispatch.sql` | Link expiry column; hardened queue functions |
| `20261130000001_google_drive.sql` | Google connections, Drive columns on documents, linked folders |
| `20261131000001_reminder_skips.sql` | Reminder skips |
| `20261201000001_agent.sql` | Assistant threads, messages, proposals |
| `20261202000001_phone_gateway.sql` | Phone devices, jobs, events, `claim_phone_send_job`, `outbox.delivery_detail` |
| `20261203000001_phone_pairing.sql` | Setup codes, 90-day keys, 10-minute lease, finished jobs drop their text |
| `20261204000001_links_agent_activity_grants.sql` | Required link expiry, narrower assistant grants, proposal functions, daily budget, activity authors |
| `20261205000001_undo_ten_seconds.sql` | `queue_message` holds a message 10 seconds, not 60 |

## 15. Known limitations and roadmap

### Product limitations

- **LINE and WeChat are not connected.** They can be chosen but never send.
- **No scheduler.** Dispatch runs when the app is open (on load and after each Undo window). Reminders need "Run the daily send now". Report schedules are recorded, not run.
- **Skipped reminders cannot be turned back on** except by the Undo toast. There is no settings screen for them.
- **Folder sync is limited by `drive.file`.** A linked folder sees only files picked in the Picker or created by the app, not new files dropped into it in Drive. The Picker does not work with the fake Drive.
- **Phone texting is untested on a real iPhone.** The Shortcut steps in `docs/phone-gateway/ios-setup.md` are a draft.
- **No consent or opt-out records for texting.** Required before real families.
- **One firm per account; no invitations**, no member directory, no firm switching.
- **Weekly texts are English only.** Chinese wording has not been reviewed by a native speaker.
- **No realtime.** Two devices refetch on focus; the last save wins.
- **No delete-student button** (students can be archived). No export or backups beyond Supabase's plan.
- **Essay text is pasted in.** Linked Google Docs are not read.
- **No single list of everything waiting** across weekly texts, files to check and list drafts.
- **The sample caseload names real colleges and organizations** and should be fully invented.
- **Not yet exercised on Vercel:** background sorting after a student upload and long list drafts.

### Remaining milestones

From `docs/BUILD_LOG.md` and earlier build prompts:

| Milestone | Scope |
| --- | --- |
| M4c | Assistant command bar |
| M4d | Assistant file tools |
| M2 | A scheduled backstop for the dispatcher (cron) |
| M5, M6, M8, M9 | Named in the freeze plan; not described in `docs/BUILD_LOG.md` or the code. Write their scope here when it is decided |

### Where older docs and the code disagree

- `README.md` says Vercel deploys `api/ai.ts` and `api/student.ts`; there are nine functions. `AGENTS.md` says `npm run dev` includes `/api/ai` and `/api/student`; it mounts all nine.
- `AGENTS.md` says students and parents are reached by LINE and WeChat; both are refused in code.
- `.env.example` says the log transport prints the body; it prints a masked recipient and the body length only. It also describes Gmail sending as "later"; it exists.
- `docs/BUILD_LOG.md` "Current milestone" still names M4a; the last merged work is the security and agent-speed passes. Its M4a notes describe the daily limit as assistant turns; it now counts model calls.
- `docs/BUILD_LOG.md` says the brief and brainstorm both run through `runFeature`; the brainstorm is a direct structured call in `server/agent/essay.ts`.
- The comment in `server/supabase.ts` lists the student link and dispatcher as the service role's users; the assistant, files, Google and phone code use it too.
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` are not in `vite.config.ts`'s server list, so the dev server ignores them and uses the `VITE_` values.
- `src/types.ts` and `server/transport/*` comments say delivery arrives in M1 (Resend, Twilio); delivery today is Gmail and the phone.
