# Platinum v0

A workspace for private college counselors: every student in one place, with an AI assistant that drafts the follow-through. Counselors sign in with a real account, and each firm's students, families, tasks, meetings and essays are kept in a Postgres database (Supabase) that only that firm can reach. A new firm starts empty; an invented sample caseload is one button away.

It is still a v0. Four limits matter before you put real work in it:

1. **Nothing is delivered.** Reminders, parent reports, recaps and feedback are written to a log (Messages sent). Use "Copy" to paste a message into email, text, WeChat or LINE yourself.
2. **AI requests send data to Anthropic.** When AI is connected, the facts for one student (first name, scores, tasks, deadlines, your pasted notes or essay text) are sent to Anthropic's API to write a draft. Last names, emails, phone numbers and messaging handles are left out. There is no privacy agreement in place, and students are minors: decide whether that is acceptable before entering real students.
3. **Nothing AI-written reaches a student or parent until you approve it.** Each approval records who approved (name and account) and when.
4. **A student link is a password.** Anyone holding a student's link can see that student's page and mark their tasks done. Send it only to the student, and revoke it if it leaks.

## Run it

Needs Node 20.19 or newer and a Supabase project.

```bash
npm install
cp .env.example .env.local     # then fill it in, see below
npm run db:push                # creates the tables (once, and after each new migration)
npm run dev                    # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server, including the two server functions at `/api/ai` and `/api/student` |
| `npm run build` | Typecheck, then build the static site to `dist/` |
| `npm run preview` | Serve `dist/` locally (static only: no AI drafts, no student links) |
| `npm run typecheck` | TypeScript only |
| `npm run db:push` | Apply the SQL in `supabase/migrations/` to the linked Supabase project |
| `npm run db:types` | Regenerate `src/lib/database.types.ts` from the linked project |
| `npm run test:isolation` | Check on the real project that firms cannot reach each other and the anon key reaches nothing |
| `npm run test:ai` | Call all six AI features for real and print the drafts |

### Environment variables

In `.env.local` (git-ignored) for local work, and in the host's settings for a deployment:

| Variable | Where it is used | Meaning |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | browser and server | The project URL, `https://<ref>.supabase.co`. Public. |
| `VITE_SUPABASE_ANON_KEY` | browser and server | The **anon / publishable** key (`sb_publishable_…` or a JWT with role `anon`). Public by design: row level security decides what it can reach. |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | The **service role / secret** key (`sb_secret_…`). Bypasses row level security. Used only by the student link function. Never give it a `VITE_` name: anything with that prefix is shipped to the browser. |
| `ANTHROPIC_API_KEY` | server only | Your Anthropic key. Without it the app still runs and AI drafts are labelled placeholders. |
| `ANTHROPIC_MODEL` | server only, optional | Model for every AI feature. Default `claude-sonnet-5-5`. |
| `AI_REFUSAL_FALLBACK` | server only, optional | `off` stops the API re-running a declined request on a fallback model. |

Only the two `VITE_` values reach the browser. The other keys are read from the environment by the server functions and are never logged.

### Set up Supabase

1. Create a project at supabase.com. Copy the URL and the two keys into `.env.local`.
2. Link the CLI once: `npx supabase login`, then `npx supabase link --project-ref <ref>`.
3. `npm run db:push` applies the migrations: the tables, the row level security policies and three database functions.
4. In the dashboard under **Authentication → URL Configuration**, set **Site URL** to where the app runs and add `http://localhost:5173/**` and your deployed URL to **Redirect URLs**. Password reset and email confirmation links go there.
5. **Authentication → Sign In / Providers → Email → Confirm email** decides whether a new account must click an emailed link before signing in. The app handles both. Supabase's built-in mailer sends only a few emails an hour; connect your own SMTP before real counselors sign up.

To change the database, add a new file under `supabase/migrations/`, run `npm run db:push`, then `npm run db:types`. Never edit a migration that has been applied.

### Accounts and firms

Sign up with an email and password. The first sign-in asks for a firm name and your name and creates the firm with you as its owner. One account belongs to one firm; inviting a second counselor is not built yet.

**View and settings** in the sidebar has **Reset demo** (deletes the firm's data and loads the sample caseload) and **Start empty** (deletes it and loads nothing). Both ask you to type a word first, because they cannot be undone. If this browser still holds data from the version before accounts, the app offers once to import it into your firm.

## Deploy

Vercel: it builds the Vite site and deploys `api/ai.ts` and `api/student.ts` as functions. Add the environment variables above to the project (all environments), and add the deployed URL to Supabase's redirect URLs. `vercel.json` sends every non-`/api` path to `index.html` so deep links load on refresh. A static-only host serves the app without AI drafts or student links; `public/_redirects` covers Netlify and Cloudflare Pages.

## What is real and what is faked

| Thing | In v0 |
| --- | --- |
| Students, families, tasks, colleges, meetings, documents, essays | **Real.** Stored in Postgres, scoped to your firm, the same on every device you sign in on |
| Sample caseload | Invented (`src/data/seed.ts`). Loaded into your firm on request, with dates set relative to that day |
| "Late", progress, next deadline, "waiting on", status, counts | **Real**, computed in `src/lib/derive.ts`. Never produced by the AI |
| AI drafts (meeting follow-through, tasks from notes, brief, parent report, essay feedback, reminders) | **Real**, via a server function calling Claude, for signed-in members of a firm. Labelled placeholders when the server has no API key |
| Approvals | **Real.** Drafts become tasks, profile changes, recaps and reports only on approval, with the approver's name, account id and time |
| Sending (email, text, WeChat, LINE) | **Faked.** Every send writes to Messages sent and the confirmation says "Delivery is not connected in v0" |
| Reminder rules and queue | Real rules, real queue, fixed wording. No scheduler: a button stands in for the daily send |
| Report schedule | A recorded intention. Nothing is drafted on a timer |
| Meeting recording | None. You paste or type notes or a transcript |
| Files | Only the file name or a link is recorded. Nothing is uploaded or stored. On a student link, only links can be attached |
| Calendar | Platinum's own schedule. No invitations, no calendar sync |
| Sign-in and accounts | **Real.** Supabase Auth with email and password: sign up, sign in, sign out, reset password |
| The student's own page | **Real.** A secret link per student opens it on their phone with no login. You create and revoke links from the student page |
| Sharing between counselors, invitations, switching firms | Not built. One account, one firm |
| Payments, college database | Not built |

## How the AI part works

```
screen ─▶ src/services/ai.ts ─▶ POST /api/ai ─▶ server/claude.ts ─▶ Claude
              │  builds facts        session check,   one prompt and one
              │  (lib/facts.ts)      size cap,        Zod output schema
              ▼                      rate limit       per feature
        draft, review: 'pending' ─▶ counselor approves ─▶ store ─▶ database
```

- **Screens call only `src/services/ai.ts`** (and `services/workflows.ts`, which stores its results as pending drafts): `draftFromMeeting`, `readNotes`, `preMeetingBrief`, `parentReport`, `essayFeedback`, `reminderDraft`.
- **Facts are ours, wording is the model's.** Overdue items, days late and deadlines are computed in our code, sent in, and shown beside the draft. No output schema lets the model supply them. The reminder draft is checked on return: if the task title, due date or days late is not in the text as given, the counselor sees a warning.
- **Fixed shapes.** `shared/contract.ts` has a Zod input and output schema per feature.
- **Errors are shown.** A refusal or a draft cut off at `max_tokens` is discarded and the counselor sees why. Placeholders are used only when real drafts are unavailable (no endpoint, or a server with no API key).
- **Essay guardrail.** The essay schema has an observation, a question and a location per note, and no field for replacement text. The screen says "Feedback only. Platinum never writes or rewrites essay text."
- **Prompts** are in `server/prompts.ts`.

### Who can call the AI endpoint

`/api/ai` answers only a signed-in member of a firm. The browser sends its Supabase access token as `Authorization: Bearer …`; the function verifies it with Supabase on every request and checks the person belongs to a firm. Requests are capped at 60 KB. The function never writes to the database and never uses the service role key.

**The rate limit is still in memory.** It allows 30 AI requests per person per five minutes, counted in one function instance's memory. Instances do not share memory and are recycled, so it slows a runaway loop down and does not cap spending. Set a spend limit on the Anthropic key. A shared counter (a database table or Redis) is the fix.

## How data is stored

```
screen ─▶ store action ─▶ memory changes at once ─▶ data/repo.ts ─▶ apply_changes() ─▶ Postgres
              ▲                                         one transaction, as the signed-in person
              └──────── undone, with a toast, if the write fails
```

- **The store is the in-memory copy** of the firm's rows. Screens read it with `useData()` exactly as before; `lib/derive.ts` is unchanged.
- **Every action is one transaction.** The store compares the data before and after an action and sends the difference (rows to insert or update, rows to delete, across any tables) to one database function, `apply_changes`. Approving a meeting's drafts creates tasks, changes the profile, files reports and writes the log in a single call: it all lands or none of it does.
- **A failed write is undone.** Memory goes back to what it was, a toast says why, and the data is fetched again.
- **Two devices** stay in step by refetching when the window regains focus. There is no realtime; if two people edit the same row, the last save wins.
- **`src/data/repo.ts` is the only file that talks to Supabase tables.** It maps the camelCase shapes in `src/types.ts` to snake_case rows and back.

### Who can read what

Row level security is on for every table. Each has the same four policies: the row's `firm_id` must be a firm the signed-in person belongs to. A row that belongs to a student is tied to a student of the same firm by a composite foreign key, so one firm cannot attach anything to another's student. The anon key alone has no privileges on any table or function. Firms are created only through `create_firm`, which makes the caller the owner.

`npm run test:isolation` proves this on the real project with two throwaway accounts (171 checks), then deletes them.

### The student link

A student opens `/s/<token>` on their own phone, with no login. The token is 32 random bytes; the database stores only its SHA-256 hash, so a link is shown once when created and cannot be read back. Tables are **not** opened to anonymous users for this. Instead `api/student.ts` looks the token up with the service role key and returns only what the page needs: first name, upcoming meetings, open and recently finished tasks, application deadlines, the latest approved recap and approved essay feedback. No parent details, no counselor notes, no drafts, no transcripts, no other students.

It accepts three writes, each checked against the token's student and limited to tasks that student owns: mark a task done or not done, leave a progress note, attach a link. Each is recorded in the activity log as done by the student. Requests are rate limited by token and by address (in memory, like the AI endpoint). An unknown token and a revoked one get the same 404.

`/student/:id` is the counselor's preview of that page and sits behind sign-in.

## Code layout

```
api/ai.ts                 Server function: AI drafts for signed-in members of a firm
api/student.ts            Server function: the student link (read the page, three writes)
server/claude.ts          The Claude call (SDK, structured output, error mapping)
server/prompts.ts         Instructions for each AI feature
server/supabase.ts        Server-side Supabase: verify a session, the service role client
server/studentLink.ts     What a student link may read and change. The boundary for students
server/rateLimit.ts       The in-memory rate limit both functions use
shared/contract.ts        Zod schemas for every AI request and response
shared/student.ts         Zod schema for the student link's three writes
supabase/migrations/      The database: tables, policies, functions
scripts/test-isolation.ts Two firms, anon, the student link and the AI endpoint, on the real project
scripts/test-ai.ts        Calls every AI feature for real and prints the drafts
design/reference/         The nine approved HTML mockups (visual reference only)

src/types.ts              Every data shape
src/lib/supabase.ts       The one Supabase client in the browser
src/lib/database.types.ts Row types generated from the database
src/data/repo.ts          The only file that talks to tables: mapping, loading, change batches
src/data/seed.ts          The invented sample caseload
src/data/ids.ts           Gives the sample (or imported data) fresh uuid ids
src/data/fixtures.ts      Placeholder drafts and sample meeting notes
src/store/store.ts        The one store. Every change to data is an action here
src/store/session.ts      Sign-in, sign-out, the session, opening a student link
src/store/migrate.ts      Reads data saved by versions before accounts, for the one-time import
src/lib/derive.ts         Derived facts: late, progress, deadlines, waiting on, status,
                          essay groups, document categories, meeting buckets, approvals
src/lib/facts.ts          Facts sent to the AI and shown beside drafts
src/lib/reminders.ts      Reminder queue and fixed wording (three languages)
src/services/ai.ts        The AI module. Real endpoint, labelled placeholder fallback
src/services/studentLink.ts  The browser side of the student link
src/services/workflows.ts Draft a meeting / prepare a brief and store the result
src/services/outbox.ts    Simulated sending

src/components/ui.tsx     Card, Button, Pill, Tabs, SegmentedControl, FilterChips, DateChip,
                          ProgressWithCount, CheckCircle, Toast, Modal, AI tags
src/components/Layout.tsx Sidebar layout, student preview layout, view and settings menu
src/components/RequireFirm.tsx  The gate: session, firm, data loaded
src/components/StudentLinkModal.tsx  Create, copy and revoke a student's link
src/components/forms.tsx  Add student, add/edit parent, schedule meeting, log a meeting
src/components/StudentTable.tsx, TaskRows.tsx, ReminderComposer.tsx, Bilingual.tsx
src/components/meeting/   MeetingReview (numbered sections), MeetingReport, BriefCard

src/screens/counselor/    CommandCenter, Students, StudentPage (+ student/ tabs),
                          Meetings (by student, calendar), Messages, SignIn (+ firm setup, reset)
src/screens/student/      The student's phone-width view, and its layout for the secret link
src/App.tsx               All routes, and redirects from the old URLs
```

Rules of thumb:

- Screens never keep their own copy of data. Read with `useData()`, change through a store action. Screens never import Supabase.
- Anything computed goes in `lib/derive.ts`, so every screen agrees.
- Colours are tokens in `src/index.css`. No raw hex in screens.
- Every send goes through the store's `sendMessage` (or an approve action) and the confirmation includes `SENT_NOTE`.

## How to add a feature

**A screen:** add the file under `src/screens/`, a `<Route>` in `src/App.tsx`, and a nav entry in `Layout.tsx` if it needs one.

**New data:** add the type to `src/types.ts`, a migration under `supabase/migrations/` (with `firm_id`, row level security and the four policies; a new table also goes in `apply_changes`' table lists), the mapping in `src/data/repo.ts`, an action in the store and sample rows in the seed. Then `npm run db:push` and `npm run db:types`. Add the table to `scripts/test-isolation.ts`.

**An AI feature:**

1. Add an input and an output schema to `shared/contract.ts`. Give the output no field for anything our code should compute.
2. Add a prompt to `server/prompts.ts`.
3. Add a function to `src/services/ai.ts` that builds the facts, calls `callAi`, and has a labelled placeholder.
4. Store the result as a draft with `review: 'pending'`; write an approve action that sets `approval` and only then creates the real record.
5. Show `<AiTag>`, `<PlaceholderNote>` and `<AiErrorNote>`. Add the feature to `scripts/test-ai.ts`.

## Known gaps

- **No backups of your own, no export.** The data is in your Supabase project; backups are whatever your Supabase plan provides.
- **Rate limits are in memory** on both server functions. See above.
- **Last save wins.** No realtime and no conflict handling between two devices editing the same thing.
- **A student link cannot be shown again** after it is created, and it does not expire on its own. Revoke and recreate.
- **The activity list shows the latest 300 entries.** Older ones stay in the database.
- **Placeholder drafts recognise sample students by name**, since their ids are new each time the sample is loaded.
- **No privacy setup for real students.** See limit 2.
- **Chinese needs a native speaker.** The placeholder drafts, seeded reports and fixed reminder wording were written by a non-native speaker, and the model's Chinese has not been reviewed by one.
- **Editing one side of a bilingual message does not update the other.** The counselor must keep them in step.
- **Reminder toggles in the meeting review are the firm-wide rules**, not per-meeting settings.
- **A pre-meeting brief's AI part is prepared on request**, not automatically, so viewing a student does not spend an AI call.
- **Essay text is pasted in.** The linked Google Doc is not read. Students cannot paste drafts from their view; they attach links.
- **"Requested and not received"** clears when anything is attached to the task; it does not check what was attached.
- **The sample caseload's dates are fixed on the day it is loaded.** After a few days it drifts out of date; Reset demo refreshes it. Its texts name an invented counselor, not you.
- **Few automated tests.** `npm run test:isolation` covers access rules. The screens were checked with a browser script that is not committed.
- Drafts vary between runs. The code drops a proposed task only when its title exactly matches an open one.
