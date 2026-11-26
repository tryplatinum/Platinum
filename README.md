# Platinum v0

A workspace for private college counselors: every student in one place, with an AI assistant that drafts the follow-through. Counselors sign in with a real account, and each firm's students, families, tasks, meetings and essays are kept in a Postgres database (Supabase) that only that firm can reach. A new firm starts empty; an invented sample caseload is one button away.

It is still a v0. Four limits matter before you put real work in it:

1. **Approved messages go only to an allowlist.** Reminders, parent reports, recaps and feedback wait 10 seconds after you approve them, then go out through the allowlist. You can still copy any of them and send it by hand by email, text, WeChat or LINE. The weekly text to each student is always sent by hand: Platinum writes it, and you send it from your own phone.
2. **AI requests send data to Anthropic.** When AI is connected, the facts for one student (first name, scores, tasks, deadlines, your pasted notes or essay text) are sent to Anthropic's API to write a draft. Last names, emails, phone numbers and messaging handles are left out. While "Sort files automatically" is on, the first two pages of every uploaded file are sent too. There is no privacy agreement in place, and students are minors: decide whether that is acceptable before entering real students.
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
| `npm run test:notes` | Check, with no keys or network, that a student's "things to remember" cannot reach a parent report, a parent reminder or the student link's code |
| `npm run test:files` | Check, with no keys or network, what of a photo the sorting model is shown: a reduced copy of a large one, the file name when no copy can be made. `-- path/to/photo.heic` also checks a HEIC file |
| `npm run test:ai` | Call all seven AI features for real and print the drafts (nine calls), then sort three invented files, one of them a phone-sized photo (three more). `npm run test:ai -- sortFile` runs only those. Then one real college list draft for the sample student Kevin against the real directory (one call, or two if a reason is thrown away); `npm run test:ai -- collegeList` runs only that |
| `npm run import:colleges` | Fill the college directory from the College Scorecard, by hand (`-- --dry-run` reports without writing). See "The college directory" |
| `npm run test:bands` | Check, with no keys or network, the band rules (missing data and the under-20% rule included), the candidate cap, the majors match, the check on AI-written reasons, and that the student link and parent reports read no drafts |
| `npm run build:programs` | Rewrite `shared/cipPrograms.ts`, the list of program titles in the directory, by hand after an import. See "Drafting a college list" |

### Environment variables

In `.env.local` (git-ignored) for local work, and in the host's settings for a deployment:

| Variable | Where it is used | Meaning |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | browser and server | The project URL, `https://<ref>.supabase.co`. Public. |
| `VITE_SUPABASE_ANON_KEY` | browser and server | The **anon / publishable** key (`sb_publishable_…` or a JWT with role `anon`). Public by design: row level security decides what it can reach. |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | The **service role / secret** key (`sb_secret_…`). Bypasses row level security. Used by the student link function, and by the files function only for work no signed-in person does (see "Stored files"). Never give it a `VITE_` name: anything with that prefix is shipped to the browser. |
| `ANTHROPIC_API_KEY` | server only | Your Anthropic key. Without it the app still runs and AI drafts are labelled placeholders. |
| `ANTHROPIC_MODEL` | server only, optional | Model for every AI feature. Default `claude-sonnet-5-5`. |
| `AI_REFUSAL_FALLBACK` | server only, optional | `off` stops the API re-running a declined request on a fallback model. |
| `SCORECARD_API_KEY` | `npm run import:colleges` only | A free api.data.gov key for the College Scorecard. Never used by the browser or a server function. |
| `ANTHROPIC_SORT_MODEL` | server only, optional | Model used only to sort uploaded files into folders. Default `claude-haiku-5-5`, the cheapest current model that reads PDFs and images. |

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

**Settings**, under Demo data, has **Reset demo** (deletes the firm's data and loads the sample caseload) and **Start empty** (deletes it and loads nothing). Both ask you to type a word first, because they cannot be undone. If this browser still holds data from the version before accounts, the app offers once to import it into your firm.

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
| Sending (email, text, WeChat, LINE) | **Real for email and text, to the allowlist only.** An approved message waits 10 seconds, then the dispatcher sends it through a transport (the default only logs). LINE and WeChat never send; copy those and send them by hand |
| Weekly text to each student | **Real** drafts and a real record of what was sent or skipped each week. **You** send each text from your own phone ("Copy" or "Open in Messages"); Platinum texts nobody |
| Things to remember about each student | **Real.** Personal details a student mentioned, suggested by the AI from meeting notes or typed in, saved only on approval, and used for one line in a text to the student |
| "Also tell parent" | **Real** setting per student and a real, separate draft to the main contact. Approved and sent on its own, like any message |
| Reminder rules and queue | Real rules, real queue, fixed wording. No scheduler: a button stands in for the daily send |
| Report schedule | A recorded intention. Nothing is drafted on a timer |
| Meeting recording | None. You paste or type notes or a transcript |
| Files | **Real.** Counselors and students upload PDFs, photos, Word and Excel files to a private storage bucket, sorted into the firm's folders. Opening one goes through a link that lives 60 seconds. Older rows that were a name or a link only stay as they are, labelled "name only, no file stored". See "Stored files" |
| Sorting files into folders | **Real**, by AI, and it can be wrong. A student's upload is filed with nobody checking first and is marked "Sorted automatically"; when the AI was not sure it is listed under "Check these". A counselor's upload is never filed by the AI: it waits with a suggestion |
| Calendar | Platinum's own schedule. No invitations, no calendar sync |
| Sign-in and accounts | **Real.** Supabase Auth with email and password: sign up, sign in, sign out, reset password |
| The student's own page | **Real.** A secret link per student opens it on their phone with no login. You create and revoke links from the student page |
| Sharing between counselors, invitations, switching firms | Not built. One account, one firm |
| Payments | Not built |
| College directory | **Real** public figures for about 1,900 U.S. colleges from the U.S. Department of Education College Scorecard, imported by hand and shown with the year each describes. No deadlines, fees, essay prompts or requirements, and no estimate of any student's chance of admission |
| Draft college lists | **Real.** Candidates and bands (Reach, Target, Likely) come from our code and the directory's figures. The AI chooses among the candidates and writes a short reason for each, and its answer is checked. A band is a starting point from public data, not a prediction. Nothing reaches a student's list until a counselor presses "Add to list" |

## How the AI part works

```
screen ─▶ src/services/ai.ts ─▶ POST /api/ai ─▶ server/claude.ts ─▶ Claude
              │  builds facts        session check,   one prompt and one
              │  (lib/facts.ts)      size cap,        Zod output schema
              ▼                      rate limit       per feature
        draft, review: 'pending' ─▶ counselor approves ─▶ store ─▶ database
```

- **Screens call only `src/services/ai.ts`** (and `services/workflows.ts`, which stores its results as pending drafts): `draftFromMeeting`, `readNotes`, `preMeetingBrief`, `parentReport`, `essayFeedback`, `reminderDraft`, `weeklyText`.
- **Facts are ours, wording is the model's.** Overdue items, days late and deadlines are computed in our code, sent in, and shown beside the draft. No output schema lets the model supply them. The reminder draft is checked on return: if the task title, due date or days late is not in the text as given, the counselor sees a warning.
- **Fixed shapes.** `shared/contract.ts` has a Zod input and output schema per feature.
- **Errors are shown.** A refusal or a draft cut off at `max_tokens` is discarded and the counselor sees why. Placeholders are used only when real drafts are unavailable (no endpoint, or a server with no API key).
- **Essay guardrail.** The essay schema has an observation, a question and a location per note, and no field for replacement text. The screen says "Feedback only. Platinum never writes or rewrites essay text."
- **Prompts** are in `server/prompts.ts`.

### The weekly text

Messages → **Weekly texts** lists every included student who has a late task, a task due in the next 7 days, or a meeting in the next 7 days. "Draft all" prepares one short text each (under 480 characters) with a progress count, and carries on past a draft that fails.

- **A week starts on the firm's weekly text day** (default Sunday, set in Settings) and runs for seven days. A student leaves the list when their text is sent or skipped, and comes back when the next week starts. A student can be left out for good with the switch on their profile.
- **The facts are ours.** The meeting time, task titles, due dates, days late, "and N more" and the link are built in `src/lib/reminders.ts` (who gets a text is decided in `src/lib/derive.ts`). At most four tasks are named, late ones first. The model only chooses the words around them. On return, the code checks that every fact string is in the text unchanged and that the text fits; if not, the fixed template is used and labelled. The counselor's private notes are never sent to this feature.
- **What comes first is the AI's call.** When a text names two or more tasks, the model picks the single most urgent one and puts it first ("Start with ..."). This is the one judgment it makes here. It is given each task's category and status and the student's next application deadlines (from `derive.ts`) to weigh: work a near application deadline depends on comes first, then how late a task is, then whether someone else is waiting on it. It returns which task it chose and a one-sentence reason. The code checks that the text really does lead with that task, and the row shows **"Leads with: ..."** and the reason. The application deadlines are for the choice only and are not written into the text. The fixed template keeps the code's order: most overdue first.
- **The link is the student's own no-login link.** One is created when a text is drafted if the student has none. Links are now kept so they can be reused each week (see below). When the app is open at an address only your computer can reach (localhost), the link is left out and the screen says so.
- **You send it.** "Copy" puts the text on the clipboard. "Open in Messages" is an `sms:` link that opens your own messaging app with the number and text filled in; on a computer without one, nothing happens, so Copy is always beside it. Pressing either is your approval: it records who and when, writes the text to Messages with the note "Sent from your own phone", and marks that week's text sent. Platinum cannot know whether you then pressed send on your phone.
- **Students have no language setting yet**, so the text is in English.
- **One personal line, at most.** See "What the AI knows about each student" below. Your private notes on the Profile tab are still never sent to this feature.

### What the AI knows about each student

A counselor who remembers that a student has a tournament on Saturday sounds like someone who listens. "Things to remember" holds those details.

- **Where they come from.** When the AI drafts the follow-through from a meeting, it also picks up the asides: up to three things the student mentioned in passing that are not the business of the meeting (a golf tournament, a trip, a new hobby), each with the sentence that prompted it. They appear in the meeting review as "Things to remember", and you approve, edit or dismiss each one, exactly like profile changes. Only approved ones are saved. You can also type one in on the student's Overview.
- **Dates.** A day the student named ("this Saturday") is worked out and kept. A rough time ("next month or so") is kept as an estimate and shown as "around Dec 20". No time at all means no date.
- **What is left out.** The model is told not to infer or embellish, and to leave out health, sleep, stress and mood, family conflict and money, discipline, relationships, and anything the student asked to keep private. That is an instruction to a model, not a guarantee: read each one before approving it.
- **The life of a note** (`noteStage` in `src/lib/derive.ts`):
  - With a date, it is kept until a week after the event, however far off that is, so something next month survives the meetings in between. It is not mentioned until 14 days before.
  - Without a date, it belongs to the meeting cycle it came from. It is dropped when the next meeting with that student is logged, or after 30 days, whichever comes first.
  - **Nothing is said twice.** A note is mentioned once before its event ("good luck Saturday"), once after ("how did it go?"), or once if it has no date. Sending a text that used a note records that on the note, and it is not offered at that stage again. An estimated date is never asked about afterwards.
  - The Overview card shows where each note stands ("Coming up", "It has happened", "Asked about on Nov 23", "Kept for later"). Finished ones move under "No longer used".
- **How they are used.** A weekly text or a reminder **to the student** is offered up to three live, unsaid notes: what just happened first, then what is coming up, then undated ones. Each comes with its timing, computed in code, so the model knows whether to wish luck or ask how it went. It uses one, opens the weekly text with it, may add nothing to it, and returns which one it used. The draft shows **"Used: …"** with **"Redraft without it"**. When there is something personal to say, a weekly text with a long task list moves one task into "and N more" to make room.
- **Where they are never used.** Nothing a parent reads, and not the student link:
  - `notesForDraft` in `src/lib/facts.ts` is the only function that turns a note into request data, and it returns nothing unless the message is to the student. `buildFacts` and `reportFacts`, which feed parent reports and parent updates, do not contain notes.
  - On the server, only `weeklyText` and `reminderDraft` have a field for notes (`shared/contract.ts`). Any other request has them dropped when it is parsed, and a reminder to a parent that carries notes is refused with a 400.
  - `server/studentLink.ts` reads no `personal_notes` rows and returns an empty list.
  - `npm run test:notes` builds every parent report and parent reminder request for the sample caseload and fails if any note text is in one; `npm run test:isolation` does the same for the real student link response.
- These are not your private notes on the Profile tab. Those still go only to your pre-meeting brief.

### The parent copy

Each student has a setting on the Family card, **Also tell a parent**: always, only when slipping (the default), or never.

- **Slipping** means the student has a late task of their own, or is not responding. **Not responding** (`isNotResponding` in `src/lib/derive.ts`) means they have a late task and have done nothing in the app for 5 or more days since the last message to them.
- In the reminder composer and on each weekly text row, **"Also tell parent"** starts ticked when the setting is "always", or when it is "only when slipping" and the student is slipping. With "never" it is not shown. You can tick or untick it for that one message.
- The parent copy is **its own short draft** to the main contact, in their language and for their preferred channel, written by the existing reminder feature about one task (for a weekly text, the most overdue task, or else the next one due). It is approved and logged on its own, apart from the student's message, and it never includes a thing to remember.

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

`npm run test:isolation` proves this on the real project with two throwaway accounts, then deletes them.

### The student link

A student opens `/s/<token>` on their own phone, with no login. The token is 32 random bytes. The server finds a link by the token's SHA-256 hash. Since the weekly text, the token itself is also kept, readable by the firm's members under the same row level security as the rest of that student's data, so the link can be put in each week's text and copied again. A link made before that has no stored copy: it works, and can be revoked, but cannot be shown again. Tables are **not** opened to anonymous users for this. Instead `api/student.ts` looks the token up with the service role key and returns only what the page needs: first name, upcoming meetings, open and recently finished tasks, application deadlines, the latest approved recap and approved essay feedback. No parent details, no counselor notes, no drafts, no transcripts, no other students.

It accepts three writes, each checked against the token's student and limited to tasks that student owns: mark a task done or not done, leave a progress note, attach a link. Each is recorded in the activity log as done by the student. Requests are rate limited by token and by address (in memory, like the AI endpoint). An unknown token and a revoked one get the same 404.

`/student/:id` is the counselor's preview of that page and sits behind sign-in.

### Stored files

Real files live in one private Supabase Storage bucket, `documents`. A stored file is a row in the `documents` table (the same table essays use) with `storage_path` set and a life-cycle in `file_status`: `uploading`, `sorting`, `suggested`, `filed`. Essays and the older name-or-link rows have neither and are never treated as files to sort.

**Bucket setup.** `npm run db:push` creates the bucket and its policies (`supabase/migrations/20261126000002_documents_bucket.sql`); there is nothing to click in the dashboard. It is private, has no public URLs, takes PDF, JPEG, PNG, HEIC, DOCX and XLSX, and caps a file at 25 MB.

**Path.** `{firm_id}/{student_id or _}/{document_id}/{safe name}`. The second segment is `_` for a counselor's upload made outside a student page. The path is set once and never changes: renaming or moving a file to another folder changes the row only. Because of that, files are always removed by the exact path on each row, never by a student's folder prefix.

**Who can reach a file.** A member of the firm, until it is filed under a folder marked "owner only" (Decisions and awards, Financial aid, Identity and visa, Firm paperwork, or any folder the owner marks so). From then on the row, its log and its object are the firm owner's only. The same goes for an older name-or-link row kept under such a folder, although it holds no file. A counselor who is not the owner can still file a stored file INTO such a folder; the file then leaves their lists and the screen says why. They cannot move a link there. The rule is one database function, `document_is_owner_only`, which the policies, the bucket and the log all call. The anon key alone reaches nothing.

**Uploading** never passes through a server function:

```
counselor:  POST /api/documents start   ─▶ row (file_status uploading, storage_path)
            browser ─▶ Storage, as the signed-in person. Storage accepts an upload only to the exact
                       path of an uploading row of their firm. Resumable (TUS) in 6 MB pieces above 6 MB.
            POST /api/documents finish  ─▶ server reads the object: real type from its first bytes, size, SHA-256
            POST /api/documents suggest ─▶ the AI's suggestion. The file waits (file_status suggested)
            POST /api/documents file    ─▶ a person files it ("Yes, put it there" or Save)

student:    POST /api/student start_upload  ─▶ token, limits, declared size and type checked; row made;
                                               a one-time signed upload URL for that one path
            browser ─▶ Storage, with that URL
            POST /api/student finish_upload ─▶ real type, size and hash checked (a file that fails is deleted
                                               with its row); answers at once; the AI files it afterwards
```

**Sorting.** `server/documentSorting.ts` holds everything that decides or records where a file goes, as plain functions (`classifyDocument`, `matchRoster`, `recentCorrections`, `suggestForCounselor`, `sortStudentDrop`, `fileDocument`, `deleteStoredFiles`, `settleFiles`), so the central AI can call them later.

- **What is sent to Anthropic:** the first two pages of a PDF (or the image; or the first 4,000 characters of a Word or Excel file), the file's name, the firm's open folders with their one-line descriptions, and the firm's last 20 corrections (title, the AI's folder, the folder a person chose). Inline in the request, never through the Files API. No roster and no student record. Limit 2 at the top of this file applies: these are students' documents.
- **The model never picks a student.** It reports the name printed on the document; `matchRoster` matches it to the firm's students in code (exact, then ignoring case and order) and gives up when two students match.
- **A student's upload** is filed automatically: folder and title from the model, `sorted_by auto`, and `needs_check` when the model said it was not sure. The counselor sees "Sorting…" until then.
- **A counselor's upload** is never filed by the AI. It gets a suggestion and waits under "Waiting for you" on the Documents screen, on no student's page, until a person files it. Choosing a different folder from the suggestion is a correction; the AI's suggestion stays on the row, and that pair is what the next request is shown.
- **If the model fails or takes over 40 seconds,** the upload still succeeds: the file goes under Other marked to check, and sorting is tried once more in the background. A folder or title a person set is never overwritten (every automatic write applies only while the row is still in the state the AI found it in).
- **"Sort files automatically"** (Settings, Folders; owner only, on by default). Off: every upload lands under Other to be checked and nothing is sent to the model. The server reads the setting from the database.
- **Large photos and HEIC photos are sorted from a reduced copy.** An image over about 3.5 MB cannot be sent to the model as it is, and HEIC (an iPhone's own format) cannot be sent at all, so the server makes a smaller JPEG in memory (turned upright, at most 1568 pixels on its longest edge) and sorts from that. The stored file is never changed, and a photo added through a student link is stored exactly as taken. If the copy cannot be made, the file is sorted from its name alone and always lands under "Check these".

**After the response.** A student never waits for the model: `finish_upload` answers as soon as the file is checked and hands the sorting to `waitUntil` (`@vercel/functions`), which keeps the function alive on Vercel; in `npm run dev` the promise simply runs. If that work is cut off anyway, the row stays `sorting`. The next time a counselor's browser loads documents it calls `settle`, which files any row stuck in `sorting` for over three minutes under Other marked to check (a counselor's own upload waits there instead), and removes uploads abandoned for over an hour.

**Deleting.** `apply_changes` and a cascade from deleting a student remove rows only, which would strand the stored objects. So there is one path, `deleteStoredFiles` (`POST /api/documents` `delete`), which removes objects first and rows second, for one document, one student's files, or the whole firm's. The store's delete, **Reset demo** and **Start empty** go through it. One document is removed as the signed-in person, so an owner-only file is the owner's alone to delete. **Deleting a student, or clearing the caseload, while any owner-only file is in the way is allowed only for the firm's owner.** Anyone else is refused, on the server and again in `apply_changes`, with a message that says how many such files there are, and nothing is changed. Otherwise a student's or firm's files are removed with the service role, filtered by the caller's firm, so that files still uploading or waiting with no student go too.

**The log.** `document_events` records uploaded, auto_sorted, suggested, approved, typed, renamed, viewed, downloaded and deleted, insert only. A "deleted" entry for a file from an owner-only folder carries no title or file name, since the log outlives the file.

**Limits.** 25 MB a file. On a student link: 10 files a day, 200 MB per student in total, and the link's existing rate limits by token and address. The daily count is per student, not per link. Each file dropped through a link records which link it came through (`documents.student_link_id`), and its row reads "Added through the student link" with the date. `/api/documents`: 120 requests per person per five minutes, in memory like the others.

**The student link can add files and nothing else.** It gets back a file's name; it can never list, open or download one. `npm run test:isolation` checks that, along with everything above about who reaches what, using a stand-in for the model.

**The sample caseload** includes five invented PDFs. They are generated in the browser (`tinyPdf` in `shared/files.ts`) and uploaded through the counselor's own upload path, already filed, once the sample students are saved. Loading them makes no AI request.

## Code layout

```
api/ai.ts                 Server function: AI drafts for signed-in members of a firm
api/student.ts            Server function: the student link (read the page, three writes)
server/claude.ts          The Claude call (SDK, structured output, error mapping)
server/prompts.ts         Instructions for each AI feature (eight)
server/supabase.ts        Server-side Supabase: verify a session, the service role client
server/studentLink.ts     What a student link may read and change. The boundary for students
server/rateLimit.ts       The in-memory rate limit both functions use
shared/contract.ts        Zod schemas for every AI request and response
shared/student.ts         Zod schema for the student link's three writes
supabase/migrations/      The database: tables, policies, functions
scripts/test-isolation.ts Two firms, anon, the student link and the AI endpoint, on the real project
scripts/test-ai.ts        Calls every AI feature for real and prints the drafts
api/colleges.ts           Server function: search and look up the college directory
server/collegeTools.ts    The college tools: search, get, a student's list, bands, draft a list (and the central AI's tool definitions)
shared/colleges.ts        The directory's shapes, labels and which figure has which data year
scripts/import-colleges.ts  Fills the college directory from the College Scorecard, by hand
design/reference/         The nine approved HTML mockups (visual reference only)
api/documents.ts          Server function: stored files for signed-in members (start, finish, suggest,
                          file, rename, open, delete, settle). A thin handler
server/documentSorting.ts Everything that decides or records where a file goes, and the one delete path
server/fileText.ts        The first two pages of a PDF; the opening text of a Word or Excel file; a reduced copy of a large or HEIC photo
shared/files.ts           Bucket, limits, file types, the path convention, reading a file's real type
server/collegeListDrafts.ts  Drafting a college list: candidates, bands for a student, the AI step and its
                          checks, saving the draft. One module of plain functions
shared/cipPrograms.ts     Generated: every bachelor's program title in the directory, by CIP code
scripts/build-cip-programs.ts  Rewrites shared/cipPrograms.ts from the directory, by hand
scripts/test-bands.ts     Unit tests for the band rules and the checks on a draft; no keys or network

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
                          essay groups, document categories, meeting buckets, approvals,
                          which notes a draft may use, slipping and not responding
src/lib/facts.ts          Facts sent to the AI and shown beside drafts; the gate that keeps
                          things to remember out of anything a parent reads
src/lib/reminders.ts      Reminder queue and fixed wording (three languages); weekly text facts and template
src/services/ai.ts        The AI module. Real endpoint, labelled placeholder fallback
src/services/studentLink.ts  The browser side of the student link
src/services/workflows.ts Draft a meeting / prepare a brief and store the result
src/services/outbox.ts    Simulated sending
src/services/colleges.ts  The browser side of the college directory: search, figures for linked rows

src/components/ui.tsx     Card, Button, Pill, Tabs, SegmentedControl, FilterChips, DateChip,
                          ProgressWithCount, CheckCircle, Toast, Modal, AI tags
src/components/Layout.tsx Sidebar layout and student preview layout
src/components/RequireFirm.tsx  The gate: session, firm, data loaded
src/components/StudentLinkModal.tsx  Create, copy and revoke a student's link
src/components/forms.tsx  Add student, add/edit parent, schedule meeting, log a meeting
src/components/StudentTable.tsx, TaskRows.tsx, ReminderComposer.tsx, Bilingual.tsx
src/components/meeting/   MeetingReview (numbered sections), MeetingReport, BriefCard
src/components/colleges.tsx  College type-ahead, and the figures for a linked list row

src/screens/counselor/    Approvals (the Inbox), Students, Settings, StudentPage (+ student/ tabs),
                          Meetings (by student, calendar), Messages, WeeklyTexts, SignIn (+ firm setup, reset)
src/screens/student/      The student's phone-width view, and its layout for the secret link
src/App.tsx               All routes, and redirects from the old URLs
src/lib/files.ts          Derived facts about files and folders: waiting, to check, new, which folder
src/services/files.ts     The browser side of files: /api/documents, and uploads straight to storage
src/store/files.ts        The store's file and folder actions (spread into the one store)
src/components/files/     UploadWindow, FilingRow (pickers and suggestion), FileRow and preview, FolderSettings
src/screens/counselor/Documents.tsx   The firm-wide Documents screen
src/screens/student/AddFile.tsx       "Add a file" on the student's own page
src/lib/collegeBands.ts   Reach, Target or Likely by fixed rules, the thresholds, the basis, the candidate cap
src/lib/collegeListDraft.ts  Preferences, majors to programs, the check on AI-written reasons, assembling a draft,
                          which meeting notes the AI reads
src/store/listDrafts.ts   The store's draft list actions (spread into the one store)
src/screens/counselor/ListDraft.tsx   The preferences form and the draft review screen
```

Rules of thumb:

- Screens never keep their own copy of data. Read with `useData()`, change through a store action. Screens never import Supabase.
- Anything computed goes in `lib/derive.ts`, so every screen agrees.
- Colours are tokens in `src/index.css`. No raw hex in screens.
- Every send goes through the store's `sendMessage` (or an approve action) and the confirmation includes `SENT_NOTE`.

## The college directory

A shared, read-only table of U.S. colleges (`college_directory`, with each one's bachelor's programs in `college_programs`), filled from the **U.S. Department of Education College Scorecard**. It is the same for every firm: any signed-in person can read it, nobody but the import script can write it, and it is not part of a firm's data.

- **Where it shows.** On a student's Overview, "Add college" searches the directory as you type ("MIT" finds Massachusetts Institute of Technology through its alias). Picking a result links the list row to the directory; "Add it anyway" keeps a typed name for a college the directory does not have. A row from before the directory is offered a possible match by name, and is linked only when you press Link. There is no separate college search screen.
- **What a linked row shows.** The institution's published admit rate, the SAT and ACT middle ranges (25th to 75th percentile of enrolled students), and the average net price, each with the year it describes, and "Source: U.S. Department of Education College Scorecard". A figure the college did not report is a dash, never zero. The figures are read from the directory when the list is shown; they are not copied onto the student's row.
- **What it is not.** The admit rate is the college's own figure for everyone who applied. Nothing in the code, the prompts or the screens estimates one student's chance of admission. The directory has no deadlines, fees, essay prompts or requirements: a college added from it has no plan or deadline until you set them on its row, and shows "Not set" until then.
- **The tools.** `server/collegeTools.ts` has plain functions (`searchColleges`, `getCollege`, `getStudentCollegeList`, `bandCollegesForStudent` and `draftCollegeList`), each with a JSON schema in `collegeToolDefinitions`. They take the caller's own Supabase client, so row level security applies, and the central AI can call the same functions. `POST /api/colleges` exposes `search`, `get`, `band` and `draft` to signed-in members of a firm, with the same in-memory rate limit as the other functions (and at most 10 drafts per person per five minutes).

### Importing it

1. **Get a key.** Sign up at https://api.data.gov/signup/ (free; the key arrives by email) and put it in `.env.local` as `SCORECARD_API_KEY=…`. The script also needs `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. It is never run by the browser or by a server function, and it stops with a clear message when the key is missing.
2. **Look first:** `npm run import:colleges -- --dry-run` fetches everything and prints the summary without writing.
3. **Import:** `npm run import:colleges`. About twenty requests to the Scorecard (the limit is 1,000 an hour; the script waits and retries on a 429).

It keeps institutions that are **currently operating and predominantly grant bachelor's degrees**: 1,935 on 2026-11-23. Rows are upserted by UNITID, the federal id. An institution that is no longer in the source is marked `is_active = false` and never deleted, so links from student lists keep working. If a run would deactivate more than a fifth of the directory it stops and writes nothing, since that is more likely a fault in the source than a wave of closures (`--force` overrides). A missing figure is stored as null, never 0; a figure the table would refuse (a rate outside 0 to 1, an impossible score) is stored as null and counted. The summary prints how many rows were inserted, updated and deactivated, the null count for every column, and the test policy of six well-known schools to compare with what you know. `-- --only=166027,110635` imports just those UNITIDs and deactivates nothing.

**When to re-run it:** after each Scorecard release, two or three times a year (https://collegescorecard.ed.gov/data/ lists them). **Before you do**, open the new data dictionary's "Most_Recent_Inst_Cohort_Map" tab and update `DICTIONARY_RELEASED` and `DATA_YEARS` at the top of `scripts/import-colleges.ts`. The API does not say which year a field describes, so those constants are the only source for the years printed beside every figure. They are written into each row's `sources` column, per group of fields.

### Where each column comes from

Data dictionary released October 15, 2026 (https://collegescorecard.ed.gov/files/CollegeScorecardDataDictionary.xlsx). API: `https://api.data.gov/ed/collegescorecard/v1/schools`, filtered with `school.operating=1` and `school.degrees_awarded.predominant=3`.

| Our column | Scorecard variable | API field | Data year |
| --- | --- | --- | --- |
| unitid | UNITID | id | 2025-26 |
| name | INSTNM | school.name | 2025-26 |
| aliases | ALIAS | school.alias (one string; split on commas, semicolons and bars) | 2025-26 |
| city, state | CITY, STABBR | school.city, school.state | 2025-26 |
| region | REGION | school.region_id | 2025-26 |
| lat, lon | LATITUDE, LONGITUDE | location.lat, location.lon | 2025-26 |
| url | INSTURL | school.school_url | 2025-26 |
| control | CONTROL | school.ownership | 2025-26 |
| level | ICLEVEL | school.institutional_characteristics.level | 2025-26 |
| locale | LOCALE | school.locale | 2025-26 |
| undergrad_size | UGDS | latest.student.size | Fall 2024 |
| admit_rate | ADM_RATE | latest.admissions.admission_rate.overall | Fall 2024 |
| sat_ebrw_25/50/75 | SATVR25, SATVR50, SATVR75 | latest.admissions.sat_scores.{25th,50th,75th}_percentile.critical_reading | Fall 2024 |
| sat_math_25/50/75 | SATMT25, SATMT50, SATMT75 | latest.admissions.sat_scores.{25th,50th,75th}_percentile.math | Fall 2024 |
| act_25/50/75 | ACTCM25, ACTCM50, ACTCM75 | latest.admissions.act_scores.{25th,50th,75th}_percentile.cumulative | Fall 2024 |
| test_policy, test_policy_code | ADMCON7 | latest.admissions.test_requirements | Fall 2024 |
| open_admissions | OPENADMP (1 yes, 2 no, 3 does not enroll first-time students → null) | latest.school.open_admissions_policy | Fall 2024 |
| tuition_in_state, tuition_out_of_state | TUITIONFEE_IN, TUITIONFEE_OUT | latest.cost.tuition.in_state, latest.cost.tuition.out_of_state | 2025-26 |
| avg_net_price | NPT4_PUB for public, NPT4_PRIV for private | latest.cost.avg_net_price.public, latest.cost.avg_net_price.private | 2024-25 |
| completion_rate | C150_4 | latest.completion.completion_rate_4yr_150nt | Fall 2019 cohort |
| median_earnings | MD_EARN_WNE_P10 | latest.earnings.10_yrs_after_entry.median | measured 2022 and 2023, in 2024 dollars |
| is_active | CURROPER | school.operating | August 2026 |
| college_programs | CIPCODE, CIPDESC, CREDLEV = 3 | latest.programs.cip_4_digit | 2023-24 |
| search_text | none (ours) | the name, the name with punctuation as spaces, and the alias string, lower-cased | |
| pct_submitting_sat, pct_submitting_act | none | none: left null, not filled from another source | |

- **Test policy** comes from the ADMCON7 code, and the raw code is always kept in `test_policy_code`: 1 Required → `required`; 2 Recommended → `optional`; 5 Considered but not required → `optional`; 3 Neither required nor recommended → `not_required` (shown as "Not required or recommended"); 4 Do not know → `unknown`; missing → null. `blind` is never set: the Scorecard does not say whether scores are ignored.
- **SAT and ACT** use the 25th, 50th and 75th percentiles. The Scorecard's "midpoint" variables are not used: their latest data is Fall 2021.
- **Programs** are bachelor's level only (credential level 3), one row per four-digit CIP code. The API lists each code once per credential level and sometimes twice; the import keeps one. The full stop the Scorecard puts at the end of each title is dropped.
- **Net price** can be negative (grants above the cost of attendance) and is stored as reported.
- **`sources` groups:** `identity`, `size`, `admissions`, `tests`, `cost` (tuition), `net_price`, `outcomes` (completion rate), `earnings`, `programs`, each `{ "source": "U.S. Department of Education College Scorecard", "year": "…" }`. Which figure belongs to which group is in `shared/colleges.ts`.

## Drafting a college list

On a student's Overview, **Draft a list** (beside the college list) opens a preferences form, then a draft to review. Three parties each do one thing:

| Who | Does | Never does |
| --- | --- | --- |
| Our code | Finds the candidates, sets every band, supplies every figure | |
| The AI | Chooses among the candidates and writes a short reason for each, plus one note about the list | Decides a band, states a figure, or adds a college that was not a candidate |
| The counselor | Reviews, removes, adds, changes bands, and presses "Add to list" | |

**A band is a starting point from public data for one entering class. It is not a prediction.** Nothing in the code, the prompt or the screens states or implies any student's chance of admission. The admit rate shown is the college's own published figure for everyone who applied, labelled "Admit rate" with its data year. The work has no deadlines, fees, essay prompts or requirements.

### The preferences

Filled in from the student's record and editable: intended majors, the programs a college must offer, states, regions, size, public or private, a net price ceiling, how many per band (default 3 Reach, 5 Target, 3 Likely; up to 10 each), must include and exclude. An empty filter means "any". States and regions are joined with "or"; everything else with "and". Open-admission colleges are left out unless asked for. A college already on the student's list is not proposed again.

- **Majors to programs.** Majors are free text ("Computer Science"); the directory knows programs by four-digit CIP code. The match is made in code (`matchMajors` in `src/lib/collegeListDraft.ts`) against the program titles the directory really has, which are kept in `shared/cipPrograms.ts` (381 titles, generated from `college_programs` by `npm run build:programs`; run it again after an import). A short table of aliases covers common names that are not the Scorecard's title ("Computer Science" also means "Computer and Information Sciences, General"; "Business" means the two general business programs). The form shows the matched programs and the counselor removes or adds any. The model is never asked for a code. A major with no match ("Undecided") filters nothing and the form says so.
- **Size** is small (under 5,000 undergraduates), medium (5,000 to 14,999) or large (15,000 or more).
- **Must include** colleges are always in the draft, banded by the same rules, even when they fail a filter. **Exclude** always wins over the filters; a college in both lists is treated as wanted.

### Candidates

`findCandidates` in `server/collegeListDrafts.ts` is one query on `college_directory` with every hard preference in it (and the matching programs joined), active institutions only, largest first, at most 1,000 rows. Each row is then banded in code, and `capCandidates` cuts the list to **300**: every must-include, then each band's share of the rest in proportion to the mix, most relevant first (more matching programs, then a band that rests on full data, then size). The cut is made after banding so that it cannot leave a band empty.

### How a band is decided

`bandCollege` in `src/lib/collegeBands.ts`, pure functions with the thresholds in one object, `BAND_RULES`. In order:

| Rule | Band |
| --- | --- |
| Admit rate under **20%** | Reach, whatever the student's numbers |
| Best test score at or above the college's 75th percentile **and** admit rate **50%** or more | Likely |
| Best test score below the college's 25th percentile | Reach |
| Otherwise | Target |

- **Best test score.** The student's SAT total against the sum of the college's Reading-and-Writing and Math percentiles (25th with 25th, 75th with 75th), or the ACT composite against the ACT percentiles. With both on file, the test that places the student higher is used. The sum of two section percentiles is not exactly the percentile of the total; it is the closest the public data allows.
- **GPA is not used.** The directory has no GPA figures for colleges, so there is nothing to compare a GPA with. It is recorded in each band's basis for context and no rule reads it. The screen says so.
- **Limited data.** With no SAT or ACT on file, or when the college did not report ranges for the test on file, the band rests on the admit rate alone and is flagged `limitedData`, which the screen shows on the row with what was missing. On the admit rate alone, Likely needs **75%** or more (stricter than the full rule, because half the evidence is missing); under 20% is still Reach; the rest is Target. A college with test ranges but no admit rate is Reach below the 25th percentile and otherwise Target, never Likely. An open-admission college with no admit rate is Likely. A college with no figures at all is Target. All of these are flagged. A college under 20% is not flagged even with no score on file, since no score would change it.
- **The basis.** Every band comes with which rule, which numbers, the thresholds and the data year of each figure (`fit_basis`), and one sentence, `summary`, which the screen shows as "Why Reach: ...". The data years come from the directory row's `sources`; so does the entering class named in the line at the top of the review screen.

### What the AI does, and what is sent to it

One feature, `collegeList`, run through `runFeature` with the same model setting and structured output as the others. It is **server only**: `/api/ai` refuses it, because the candidates come from the database and the answer is checked on the server (`explainCandidates` in `server/collegeListDrafts.ts`).

- **Sent to Anthropic:** the student's graduation year, intended majors, interests and activities; the three most recent meeting records a counselor approved; the counselor's preferences (the net price ceiling as yes or no, not the amount); and the candidates as compact rows: unitid, name, state, band, size as a word, public or private, matching program titles.
- **Not sent:** the student's name, test scores or GPA; any college figure (no admit rate, no score range, no price, no enrolment number: the request has no field for one); parent details; anything from documents; things to remember; the counselor's private notes on the Profile tab; transcripts.
- **"The three most recent notes"** means the record of the student's three most recent completed meetings that a counselor approved: the approved meeting notes (decided, progress, to watch, and the fuller notes), or, when those are not approved, the approved recap. Never the pasted notes or transcript a meeting was logged with, and never a draft nobody approved.
- **It returns** a list of `{ unitid, reason }` and one note. The output has no field for a band, a figure or a chance.
- **The server then checks it.** A unitid that was not a candidate is dropped. A duplicate is dropped. A reason is thrown away if it contains a digit followed by "%" (or "percent"), or any four-digit number (a test score, with or without a comma; a year is caught too), or is empty or over 400 characters. If a reason was thrown away or a band came back short, the model is asked **once more**, for what is missing only. Whatever is still short is filled by our code: first a college the model chose but explained badly, then the most relevant candidates in that band, each with the reason "Matches your filters" and marked as not AI-explained. The overall note passes the same check, comes from the first answer only, and is dropped if it fails. The prompt also tells the model to state no figures and no chances; the check is the guarantee, the prompt is not.
- **If the AI call fails** (no key, an error, a refusal, or no answer in about 100 seconds) a draft is still saved: the ten most relevant candidates in each band, not kept, for the counselor to pick from by hand, with a line saying why the AI did not run.

### Review, and "Add to list"

The review screen groups the draft by band. Each row has the college's name and place, the reason, the directory's figures with their data years, the "why this band" line and the limited-data flag. A counselor can:

- **Remove** a college (it moves to "Removed" and can be put back).
- **Change a band.** The row records `fit_set_by = counselor` and its why line becomes "Set to Reach by a counselor. By the rule it was a Target: ...". Choosing the rule's own band again undoes that.
- **Add a college from the directory.** It is banded by the same rule (`POST /api/colleges` `band`) and has no reason: none is made up.
- **Regenerate.** Opens the preferences again and makes a new draft, discarding the old one. Colleges the counselor removed are carried over as exclusions and colleges they added as must-includes, both visible in the form. A band changed by hand is **not** carried over: bands are set again by the rule.
- **Add to list.** One database function, `add_draft_to_college_list`, writes the kept colleges into the student's list as Planning with no plan or deadline, each with its band, who set it, the why line as its fit reason and the reason as its note; skips any college already on the list; marks the draft approved with who and when; and adds an activity entry. `draftCollegeList` itself never writes to `colleges`.

**Privacy.** A draft is the counselor's alone. `server/studentLink.ts` reads neither draft table and selects no note or fit reason from the college list, and `src/lib/facts.ts`, which builds parent report facts, reads no drafts. `npm run test:bands` fails if either starts to, and `npm run test:isolation` checks the real student link's answer after a draft has been added.

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
- **A student link opens for 30 days** after it is made or replaced. Revoke it if it leaks before then.
- **Loading the sample saves only its counselor activity lines.** The sample's student, parent, AI and system lines show until the next reload.
- **Weekly texts are English only** and one caseload draft is up to one AI request per student: more than 30 students in five minutes will hit the rate limit, and the rows that failed say so and can be drafted again.
- **A sent weekly text means "handed to you"**, not "delivered".
- **Which task a weekly text leads with is a judgment, and can be wrong.** The row shows the choice and the reason; reorder the text yourself if you disagree. The reason is the model's own sentence and is not checked.
- **"Used: …" is what the model says it used.** The code checks the id is one of the notes it was given, not that the wording matches the note. Read the line.
- **A note counts as mentioned when you send the draft that used it**, even if you deleted the personal line by hand first. Use "Redraft without it" to keep the note for another time.
- **A redrafted reminder that is never sent does not use up a note**, so the same note can appear in the next draft until one is sent.
- **The next meeting only retires undated notes once it is logged with a later date** than the meeting they came from. Two meetings logged on the same day are one cycle.
- **A thing to remember is dated when it is saved**, so a note cannot be backdated.
- **"Not responding" only sees activity in the app** (a task started or done, a progress note, a link). A student who replied to you by text still counts as not responding. It looks at the latest 300 activity entries.
- **A parent copy is one more AI request**, so "Draft all" reaches the limit of 30 requests in five minutes sooner when many students are slipping.
- **A parent copy in the reminder composer is not saved** until you send it; closing the composer drops the draft. The one on a weekly text row is saved with the row.
- **Leaving the page in the instant a change is being saved** makes the browser ask first; if you leave anyway, that change is lost.
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
- **Few automated tests.** `npm run test:isolation` covers access rules and `npm run test:notes` covers where things to remember may go. The screens were checked with a browser script that is not committed.
- Drafts vary between runs. The code drops a proposed task only when its title exactly matches an open one.
- **A suggested college match is the closest name, not a certainty.** "Michigan" may offer Michigan State. Nothing is linked until you press Link; "Not this one" is remembered in that browser only.
- **Directory figures are fetched when a list is shown** and kept until the page is reloaded. They are as current as the last import.
- **Aliases are split on commas**, so an alias that itself contains a comma is stored as two. Search is unaffected: it reads the whole alias string.
- **A college is on a list once per link, not once per name.** The same college can be added twice as free text.
- **File storage, not built yet:** document requests ("please upload your transcript" with a slot to fill), parent links, pulling grades or scores out of a document into the profile, search inside or across files, a file's history on screen (the log is recorded but not shown), linking a file to a college, moving a filed file to another student, virus scanning, and versions of a file.
- **The list of everything waiting on the counselor is computed in the browser.** The Inbox gathers drafts, reminders, files and draft college lists from `src/lib/inbox.ts`. There is no server function behind it.
- **There is no "delete student" button.** A student can be archived. The server path and the database both handle deleting one (and refuse a counselor who is not the owner while an owner-only file is in the way), for when a screen is built.
- **Nothing here has been run on Vercel.** Sorting a student's file after the response returns, the recovery of a file whose sorting was cut off, and a list draft finishing inside the function time limit were exercised only on the local dev server.
- **A file the AI sorted can be in the wrong folder**, including an owner-only one, where a counselor who is not the owner will not see it. The owner sees everything; "Check these" lists only the ones the AI doubted.
- **"10 files a day" on a student link is counted per student**, not per link: a student with two live links shares the allowance. The link each file came through is recorded, so a per-link count could be added without another column.
- **A file's contents are not scanned.** The server checks that a file really is the type it claims, by its first bytes, and nothing more.
- **Files are sorted from their first two pages.** A long PDF whose telling page comes later may be filed wrongly.
- **A suggestion that arrives after the upload window is closed** shows the next time the Documents screen loads its data (on focus), not instantly.
- **Other counselors' uploads show as "A colleague"**: there is no member directory in the browser yet.
- **A pre-meeting brief lists recent documents by title**, but only what every member can read. Files waiting to be filed, and files and links in owner-only folders, are left out.
- **A band is a rule applied to public figures, and it is coarse.** It knows nothing about a major's own selectivity, residency, test-optional policies, a student's grades, or anything else a counselor knows. That is why every band can be changed by hand.
- **Many colleges report no test ranges** (about half the directory), and several of the largest report none for one test. Their bands rest on the admit rate alone and are flagged "Limited data".
- **The SAT comparison adds two section percentiles**, which is close to, but not the same as, the percentile of the total.
- **The AI's reasons are not fact-checked.** The check removes figures; it cannot tell whether "known for robotics" is true. Read each reason before adding the list.
- **A reason with any four-digit number is thrown away**, including a harmless year. That college then shows "Matches your filters".
- **When more than 1,000 colleges pass the filters, only the 1,000 largest are read** before banding, so small colleges can be missed by a draft with few filters. The review screen shows how many passed.
- **A college already on the list is never proposed in a draft**, not even as a must-include. A row linked to the directory is matched by its directory id. A row typed in by hand is matched after lowercasing and removing brackets and punctuation, against the directory name, its aliases, the name's initials, the name without "University", "College" and "Main Campus", and a few spelled-out short forms ("UC San Diego", "Georgia Tech", "NYU (Tandon)", "Purdue" are all caught; `alreadyOnList` in `src/lib/collegeListDraft.ts`, tested in `npm run test:bands`). When in doubt it leaves a college out. A nickname none of those catch ("Cal", "Penn") can still be proposed; "Add to list" then skips only an exact name or a directory link.
- **Regenerating does not keep a band you changed by hand.** Removals and additions carry over; bands are set again by the rule.
- **A draft takes one or two AI requests and up to two minutes.** On a host that cuts functions off sooner than 120 seconds the draft may fail; nothing is saved when it does.
- **Discarded and approved drafts stay in the database** and are loaded with the firm's data. There is no screen that lists them.
- **`shared/cipPrograms.ts` is a snapshot.** After a new import, run `npm run build:programs`; until then a new program title cannot be picked in the form.
- **Two people reviewing the same draft** follow the usual rule: the last save wins.
