# Platinum v0

A workspace for private college counselors: every student in one place, with an AI assistant that drafts the follow-through. **v0 is an interview prop**, shown in the last five minutes of customer discovery calls. It is not the product.

Three rules hold everywhere in this code:

1. **Synthetic data only.** Every student, parent and school is invented. Never put real student data in: the students are minors, there is no privacy setup, and with AI switched on the text you enter is sent to Anthropic's API.
2. **Nothing is really sent.** Emails, texts, WeChat and LINE messages only appear in an on-screen log.
3. **Nothing AI-written reaches a student or parent until a counselor approves it**, and each approval records who approved and when.

## Run it

Needs Node 20.19 or newer (built on Node 24).

```bash
npm install
npm run dev        # http://localhost:5173
```

That is enough to demo. Without an API key the AI features show **placeholder drafts, labelled as placeholders**.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server, including the AI endpoint at `/api/ai` |
| `npm run build` | Typecheck, then build the static site to `dist/` |
| `npm run preview` | Serve `dist/` locally (static only, so AI is placeholders) |
| `npm run typecheck` | TypeScript only |
| `npm run test:ai` | Call all five AI features for real and print the drafts |

Sign-in accepts anything. **Reset demo** (top right) restores the sample data. The sample data is also rebuilt automatically each new day, because every date in it is relative to today.

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

Restart `npm run dev`, then in the app's sidebar open **AI connection** and enter the passcode once. The dot turns green and drafts are labelled with the model name. `npm run dev` serves the endpoint itself, so you do not need `vercel dev` (it works too, if you prefer it).

Check it end to end with `npm run test:ai` (five real model calls), or `npm run test:ai -- parentReport` for one feature.

## Deploy

Vercel, with no settings beyond the environment variables above: it builds the Vite site and deploys `api/ai.ts` as a function. `vercel.json` sends every non-`/api` path to `index.html`, so deep links such as `/app/students/s-kevin` load on refresh.

Any static host works for the app without AI (drafts become placeholders). `public/_redirects` provides the deep-link fallback on Netlify and Cloudflare Pages; other hosts need their own "serve index.html for unknown paths" rule.

## What is real and what is faked

| Thing | In v0 |
| --- | --- |
| Students, parents, schools, documents | Invented, in `src/data/seed.ts` |
| Database | None. One store in the browser, saved to `localStorage` |
| Sign-in | Fake. Any credentials work |
| AI drafts | **Real**, via one server function calling Claude, when a key and passcode are set. Otherwise hand-written placeholders, labelled as such |
| "What is overdue", "next deadline", "needs attention" | Real, computed in `src/lib/derive.ts`. Never produced by the AI |
| Sending (email, text, WeChat, LINE) | Faked. `src/services/outbox.ts` only writes a log entry |
| Reminders | Real rules and real queue, fixed wording (not AI). "Run the 8:00 AM send now" stands in for a scheduler |
| AI notetaker in meetings | Faked. There is no recording; sample meeting notes in `src/data/fixtures.ts` stand in for a transcript |
| File uploads | Only the file name is recorded. Nothing is stored |
| Scheduling, payments, college search, mobile apps | Not built |

### Changes from the original brief

- **One server function exists** (`api/ai.ts`). The brief said no backend; we later decided AI should be real, and an API key cannot live in browser code. Everything else is still browser-only.
- **Model:** `claude-sonnet-5-5`, read from `ANTHROPIC_MODEL`.
- **Refusal fallback is on by default.** If Claude declines a request on safety grounds, the API may re-run it on a fallback model in the same call. If that also declines, the screen shows the refusal as an error. Set `AI_REFUSAL_FALLBACK=off` to remove it.

## How the AI part works

```
screen ─▶ src/services/ai.ts ─▶ POST /api/ai ─▶ server/claude.ts ─▶ Claude
              │  builds facts        passcode,        one prompt and one
              │  (src/lib/facts.ts)  size cap,        Zod output schema
              ▼                      rate limit       per feature
        draft, review: 'pending' ─▶ counselor approves ─▶ store
```

- **Screens call only `src/services/ai.ts`**: `draftFromMeeting`, `readNotes`, `preMeetingBrief`, `parentReport`, `essayFeedback`.
- **The browser sends the facts with each request**, since there is no database. They are built in `src/lib/facts.ts`. Last names, emails, phone numbers and messaging handles are left out. The counselor's private notes go only to the pre-meeting brief.
- **Facts are ours, wording is the model's.** Overdue items, days late and deadlines are computed in our code, sent in, and shown beside the draft. No output schema lets the model supply them.
- **Fixed shapes.** `shared/contract.ts` has a Zod input and output schema per feature; the endpoint uses structured outputs, so every response matches.
- **Errors are shown, not hidden.** A refusal or a draft cut off at `max_tokens` is discarded and the counselor sees why. Placeholders are used only when real drafts are unavailable altogether (no endpoint, no key, no passcode entered).
- **Essay guardrail.** The essay schema has an observation, a question and a location for each note. It has no field for replacement text, so there is nowhere to put a rewrite. The prompt tells the model it is an editor writing margin notes and explains why. The screen says "Feedback only. We never write or rewrite essays."
- **Prompts** live in `server/prompts.ts`: one per feature, with shared sections on staying with the record, keeping a student's confidences from parents, and writing Chinese natively. Effort is set per feature there.

### The endpoint's protection is a stopgap

There are no accounts, so `/api/ai` protects itself with a shared passcode header, a 60 KB request cap, and a per-address rate limit (30 requests per 5 minutes). The rate limit lives in the function's memory, and serverless instances do not share memory, so it slows abuse down but does not stop it. Anyone with the passcode can spend your API budget. **Replace all three with real sign-in before this is anything more than a demo**, and set a spend limit on the API key in the meantime.

## Code layout

```
api/ai.ts               The one server function: checks, then runs a feature
server/claude.ts        The Claude call (SDK, structured output, error mapping)
server/prompts.ts       Instructions for each AI feature
shared/contract.ts      Zod schemas for every request and response (types shared with the browser)
shared/constants.ts     Endpoint path, header name, size limits
scripts/test-ai.ts      Calls every feature for real and prints the drafts

src/types.ts            Every data shape
src/data/seed.ts        The sample caseload (10 students). Dates are offsets from today
src/data/fixtures.ts    Placeholder drafts and the sample notes the AI reads
src/store/store.ts      The one store. Every change to data is an action here
src/lib/derive.ts       Derived facts: late, next deadline, student status, pending approvals
src/lib/facts.ts        Facts sent to the AI and shown beside drafts
src/lib/reminders.ts    Reminder queue and wording (three languages)
src/lib/dates.ts        Date helpers
src/services/ai.ts      The AI module screens call. Real endpoint, placeholder fallback
src/services/aiClient.ts  Passcode storage and the fetch to /api/ai
src/services/outbox.ts  Simulated sending
src/components/         Shared UI: ui.tsx (Card, Pill, StatusPill, OwnerBadge, SourceBadge…),
                        TaskRow, Bilingual, Layout (demo bar, view switcher), AiConnection
src/screens/counselor/  Sign-in, command center, roster, student detail, meeting review,
                        pre-meeting brief, essay feedback, read notes, parent reports, reminders
src/screens/student/    Tasks, recaps, profile (phone-width)
src/App.tsx             All routes
```

Rules of thumb:

- Screens never keep their own copy of data. Read with `useData()`, change through a store action.
- Anything computed ("is this late?") goes in `lib/derive.ts`, so every screen agrees.
- Colours are tokens in `src/index.css` (`bg-surface`, `text-ink`, `text-ai`…). Purple always means AI-drafted; amber means it needs you.

## How to add a feature

**A screen:** add the file under `src/screens/`, add a `<Route>` in `src/App.tsx`, and a nav entry in `src/components/Layout.tsx` if it needs one. Build it from the pieces in `src/components/ui.tsx`.

**New data:** add the type to `src/types.ts`, sample rows to `src/data/seed.ts`, an action to `src/store/store.ts`, and bump `SCHEMA` in the store so old saved demos are discarded.

**An AI feature:**

1. Add an input and an output schema to `shared/contract.ts`. Give the output no field for anything our code should compute.
2. Add a prompt to `server/prompts.ts`.
3. Add a function to `src/services/ai.ts` that builds the facts, calls `callAi`, and has a placeholder for when AI is unavailable.
4. Store the result as a draft with `review: 'pending'` and a `source`; write an approve action in the store that sets `approval` and only then creates the real record.
5. Show `<SourceBadge>`, `<PlaceholderNote>` and `<AiErrorNote>` on the screen. Add the feature to `scripts/test-ai.ts`.

## Known gaps

- **Chinese text needs a native speaker.** The placeholder drafts, the seeded past reports and the reminder templates were written by a non-native speaker. Have a native speaker check them, and read real model output in both scripts, before any of it goes in front of a Mandarin-speaking parent or counselor.
- **Real AI output has only been spot-checked.** All five features return real drafts through `npm run test:ai`, and the prompts were tuned once against them. Nobody has yet clicked through the real drafts in the browser, and the model's Chinese has not been read by a native speaker. Run `npm run test:ai` and read the drafts again after any prompt change.
- Drafts vary from run to run. The code drops a proposed task only when its title exactly matches an open task; near-duplicates rely on the prompt.
- Placeholder parent reports keep task titles in English inside the Chinese text.
- Editing the English side of a parent message does not update the Chinese side.
- Essay feedback reads text pasted into the page, not the linked Google Doc.
- Reminders have no scheduler; a button stands in for the daily send.
- The store is per browser. Two windows on the same machine stay in sync; two people on different machines do not.
- No automated tests.
