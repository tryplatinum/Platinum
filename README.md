# Platinum v0

A workspace for private college counselors: every student in one place, with an AI assistant that drafts the follow-through. v0 is a **functional single-counselor tool**. You can enter your own students, families, tasks, meetings and essays, and it keeps them between visits. It opens with an invented sample caseload so there is something to look at.

It is still a v0. Four limits matter before you put real work in it:

1. **Your data lives in one browser.** There are no accounts and no database. Everything is saved in this browser's storage on this machine. Clearing site data, or using another browser or computer, starts from scratch. There is no backup and no export.
2. **Nothing is delivered.** Reminders, parent reports, recaps and feedback are written to a log (Messages sent). Use "Copy" to paste a message into email, text, WeChat or LINE yourself.
3. **AI requests send data to Anthropic.** When AI is connected, the facts for one student (first name, scores, tasks, deadlines, your pasted notes or essay text) are sent to Anthropic's API to write a draft. Last names, emails, phone numbers and messaging handles are left out. There is no privacy agreement in place, and students are minors: decide whether that is acceptable before entering real students, and leave AI disconnected if it is not.
4. **Nothing AI-written reaches a student or parent until you approve it.** Each approval records who approved and when.

## Run it

Needs Node 20.19 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server, including the AI endpoint at `/api/ai` |
| `npm run build` | Typecheck, then build the static site to `dist/` |
| `npm run preview` | Serve `dist/` locally (static only, so AI drafts are placeholders) |
| `npm run typecheck` | TypeScript only |
| `npm run test:ai` | Call all six AI features for real and print the drafts |

Sign-in is a stand-in: any email and password open the workspace.

**Your own caseload:** in the sidebar open **View and settings → Start empty**, then add students. **Reset demo** in the same menu replaces everything with the sample caseload again.

### Turn on real AI drafts

```bash
cp .env.example .env.local
```

Fill in `.env.local` (git-ignored):

| Variable | Required | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | Your Anthropic key. Server-side only. |
| `PLATINUM_PASSCODE` | yes | Any long random string. The browser must send it to use the endpoint. |
| `ANTHROPIC_MODEL` | no | Model for every AI feature. Default `claude-sonnet-5-5`. |
| `AI_REFUSAL_FALLBACK` | no | `off` stops the API re-running a declined request on a fallback model. |

Restart `npm run dev`, then in the sidebar's **AI** box choose **Enter passcode**. Drafts are then labelled with the model name. Without a key or passcode the app still works and every AI draft is a **placeholder, labelled as one**.

## Deploy

Vercel, with the environment variables above: it builds the Vite site and deploys `api/ai.ts` as a function. `vercel.json` sends every non-`/api` path to `index.html` so deep links load on refresh. Any static host works without AI; `public/_redirects` covers Netlify and Cloudflare Pages.

## What is real and what is faked

| Thing | In v0 |
| --- | --- |
| Students, families, tasks, colleges, meetings, documents, essays | **Real.** You create, edit, archive and remove them. Kept across days in this browser |
| Sample caseload | Invented (`src/data/seed.ts`). Its dates are set relative to the day it is loaded |
| "Late", progress, next deadline, "waiting on", status, counts | **Real**, computed in `src/lib/derive.ts`. Never produced by the AI |
| AI drafts (meeting follow-through, tasks from notes, brief, parent report, essay feedback, reminders) | **Real**, via one server function calling Claude, when a key and passcode are set. Otherwise labelled placeholders |
| Approvals | **Real.** Drafts become tasks, profile changes, recaps and reports only on approval, with approver and time |
| Sending (email, text, WeChat, LINE) | **Faked.** Every send writes to Messages sent and the confirmation says "Delivery is not connected in v0" |
| Reminder rules and queue | Real rules, real queue, fixed wording. No scheduler: a button stands in for the daily send |
| Report schedule | A recorded intention. Nothing is drafted on a timer |
| Meeting recording | None. You paste or type notes or a transcript |
| Files | Only the file name or a link is recorded. Nothing is uploaded or stored |
| Calendar | Platinum's own schedule. No invitations, no calendar sync |
| Sign-in, accounts, sharing between counselors | Stand-in only |
| Payments, college database | Not built |

## How the AI part works

```
screen ─▶ src/services/ai.ts ─▶ POST /api/ai ─▶ server/claude.ts ─▶ Claude
              │  builds facts        passcode,        one prompt and one
              │  (lib/facts.ts)      size cap,        Zod output schema
              ▼                      rate limit       per feature
        draft, review: 'pending' ─▶ counselor approves ─▶ store
```

- **Screens call only `src/services/ai.ts`** (and `services/workflows.ts`, which stores its results as pending drafts): `draftFromMeeting`, `readNotes`, `preMeetingBrief`, `parentReport`, `essayFeedback`, `reminderDraft`.
- **Facts are ours, wording is the model's.** Overdue items, days late and deadlines are computed in our code, sent in, and shown beside the draft. No output schema lets the model supply them. The reminder draft is checked on return: if the task title, due date or days late is not in the text as given, the counselor sees a warning.
- **Fixed shapes.** `shared/contract.ts` has a Zod input and output schema per feature.
- **Errors are shown.** A refusal or a draft cut off at `max_tokens` is discarded and the counselor sees why. Placeholders are used only when real drafts are unavailable (no endpoint, no key, no passcode).
- **Essay guardrail.** The essay schema has an observation, a question and a location per note, and no field for replacement text. The screen says "Feedback only. Platinum never writes or rewrites essay text."
- **Prompts** are in `server/prompts.ts`.

### The endpoint's protection is a stopgap

`/api/ai` has no sign-in in front of it. It protects itself with a shared passcode header, a 60 KB request cap and a per-address rate limit that lives in one function instance's memory. Anyone with the passcode can spend your API budget. Set a spend limit on the key, and replace all of this with real accounts before more than one firm uses it.

## Code layout

```
api/ai.ts                 The one server function: checks, then runs a feature
server/claude.ts          The Claude call (SDK, structured output, error mapping)
server/prompts.ts         Instructions for each AI feature
shared/contract.ts        Zod schemas for every request and response
scripts/test-ai.ts        Calls every feature for real and prints the drafts
design/reference/         The nine approved HTML mockups (visual reference only)

src/types.ts              Every data shape
src/data/seed.ts          The invented sample caseload
src/data/fixtures.ts      Placeholder drafts and sample meeting notes
src/store/store.ts        The one store. Every change to data is an action here
src/store/migrate.ts      Carries saved data forward when shapes change
src/lib/derive.ts         Derived facts: late, progress, deadlines, waiting on, status,
                          essay groups, document categories, meeting buckets, approvals
src/lib/facts.ts          Facts sent to the AI and shown beside drafts
src/lib/reminders.ts      Reminder queue and fixed wording (three languages)
src/services/ai.ts        The AI module. Real endpoint, labelled placeholder fallback
src/services/workflows.ts Draft a meeting / prepare a brief and store the result
src/services/outbox.ts    Simulated sending

src/components/ui.tsx     Card, Button, Pill, Tabs, SegmentedControl, FilterChips, DateChip,
                          ProgressWithCount, CheckCircle, Toast, Modal, AI tags
src/components/Layout.tsx Sidebar layout, student layout, view and settings menu
src/components/forms.tsx  Add student, add/edit parent, schedule meeting, log a meeting
src/components/StudentTable.tsx, TaskRows.tsx, ReminderComposer.tsx, Bilingual.tsx
src/components/meeting/   MeetingReview (numbered sections), MeetingReport, BriefCard

src/screens/counselor/    CommandCenter, Students, StudentPage (+ student/ tabs),
                          Meetings (by student, calendar), Messages, SignIn
src/screens/student/      The student's phone-width view
src/App.tsx               All routes, and redirects from the old URLs
```

Rules of thumb:

- Screens never keep their own copy of data. Read with `useData()`, change through a store action.
- Anything computed goes in `lib/derive.ts`, so every screen agrees.
- Colours are tokens in `src/index.css`. No raw hex in screens.
- Every send goes through the store's `sendMessage` (or an approve action) and the confirmation includes `SENT_NOTE`.

## How to add a feature

**A screen:** add the file under `src/screens/`, a `<Route>` in `src/App.tsx`, and a nav entry in `Layout.tsx` if it needs one.

**New data:** add the type to `src/types.ts`, an action to the store, sample rows to the seed, then bump `SCHEMA` in `src/store/migrate.ts` **and add a migration step**. Saved data is real now: never discard it.

**An AI feature:**

1. Add an input and an output schema to `shared/contract.ts`. Give the output no field for anything our code should compute.
2. Add a prompt to `server/prompts.ts`.
3. Add a function to `src/services/ai.ts` that builds the facts, calls `callAi`, and has a labelled placeholder.
4. Store the result as a draft with `review: 'pending'`; write an approve action that sets `approval` and only then creates the real record.
5. Show `<AiTag>`, `<PlaceholderNote>` and `<AiErrorNote>`. Add the feature to `scripts/test-ai.ts`.

## Known gaps

- **One browser, no backup.** See limit 1. An export/import of the saved data would be the first thing to add.
- **No privacy setup for real students.** See limit 3.
- **Chinese needs a native speaker.** The placeholder drafts, seeded reports and fixed reminder wording were written by a non-native speaker, and the model's Chinese has not been reviewed by one.
- **Editing one side of a bilingual message does not update the other.** The counselor must keep them in step.
- **Reminder toggles in the meeting review are the firm-wide rules**, not per-meeting settings.
- **A pre-meeting brief's AI part is prepared on request**, not automatically, so viewing a student does not spend an AI call.
- **Essay text is pasted in.** The linked Google Doc is not read. Students cannot paste drafts from their view; they attach links.
- **"Requested and not received"** clears when anything is attached to the task; it does not check what was attached.
- **The sample caseload's dates are fixed on the day it is loaded.** After a few days it drifts out of date; Reset demo refreshes it.
- **No automated tests in the repo.** The flows were checked with a browser script that is not committed.
- Drafts vary between runs. The code drops a proposed task only when its title exactly matches an open one.
