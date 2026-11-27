# Build log

## Accounts and landing (branch `accounts-and-landing`, from `main` at `c23ea84`)

One branch, one pull request, a commit or more per part. **No migration in this branch has been pushed**, and no account flow has run against the real database. On 2026-11-27 `npx supabase migration list --remote` showed every migration through `20261207000001` (templates and calendar included) on the remote.

**PGlite is not a dependency.** The database checks (`scripts/test-accounts-db.ts`, helper `scripts/pgliteChain.ts`) run the whole migration chain in PGlite with stand-ins for the `auth` and `storage` schemas. Adding the package was not allowed in this run, so the script looks for it in `node_modules` or in `PGLITE_DIR` and, when it is missing, prints that it was skipped and exits 0. `npm run test:notes` on a clean checkout therefore skips those checks. To run them: `npm install --no-save --no-package-lock @electric-sql/pglite`.

### Part A: roles and invitations in the database

**Migration, written and NOT pushed:** `supabase/migrations/20261208000001_roles_and_invitations.sql`.

- `firm_members`: the three write policies are dropped and insert, update and delete are revoked from signed-in people. Members still read their firm's rows.
- `invitations` (one table for both kinds; the student kind is used from Part B). Members read every column but `token_hash`. No direct writes.
- Functions: `invite_counselor(email, token_hash, replace)`, `revoke_invitation`, `accept_counselor_invitation` (service role only), `set_member_role`, `member_removal_summary`, `remove_member`, `leave_firm`, `rename_self`. Two helpers nobody can call: `claim_invitation_`, `end_membership_`.
- A deferred constraint trigger, `firm_keeps_an_owner`, refuses any path that leaves a firm with members and no owner. Deleting a whole firm still works.
- `apply_changes` restated whole with two changes: renaming yourself calls `rename_self`, and deleting a student or clearing the caseload is refused for anyone but an owner (Part F's first point, placed here because it is the same function).
- `activity.student_id` may be null, for a line about the firm itself. `activityFrom` in `src/data/repo.ts` reads it as an empty id; the Activity screen already shows a line with no student.

**Choices the brief did not settle.**
- *An owner cannot demote or remove another owner.* An owner steps down themselves, and only then can be removed. The brief lists "make a counselor an owner" and "step down or leave"; taking an owner's role away from them is not in it.
- *A counselor can leave.* Leaving does what removal does (Google, phone, queued messages, one line).
- *Activity lines about the firm are `system` lines* that name the people in their text ("Avery Stone removed Dana Whitlock from the firm: …"), because the Activity screen shows every `counselor` line under the name of whoever is looking.
- *"Queued and unsent"* is every outbox row that person approved that is still `queued`, plus a text handed to their phone that the phone has not taken yet (the job is cancelled and its words cleared).
- *Error codes.* The functions raise `PI001` (the invitation does not work: unknown, expired, revoked or used, one answer), `PI002` (address not confirmed), `PI003` (another address), `PI004` (already in a firm), `PI005` (an invitation is already waiting), and `23514` for the last owner. `server/account.ts` turns them into the reasons in `shared/account.ts`.
- *The address and its confirmation are read twice:* by the server from Supabase's own answer about the sign-in, and again inside the accept function from `auth.users`, with the invitation row locked.
- *Deleting the sign-in of a firm's only owner* in the Supabase dashboard is now refused while the firm has other members. Make another owner first.

**Server:** `api/account.ts` (added to `FUNCTIONS` in `vite.config.ts`), `server/account.ts`, `shared/account.ts`. `server/supabase.ts` gained `signedIn()` (who is signed in, without a firm, for `accept`); `identify()` is unchanged. `server/google/connection.ts` gained `disconnectMember()`, which revokes the grant at Google before the database deletes the row.

**Checked.** `npm run test:accounts` (55 checks, in-memory Supabase): one answer for unknown, expired, revoked, used and malformed previews; the rate limit; accept needs a verified sign-in, the right address and a confirmed one; only the hash reaches the database; the caller's id never comes from the body; counselors are refused every owner action before the database is asked; removal revokes at Google and calls the database once. `npm run test:accounts:db` (67 checks, PGlite): everything above as the database enforces it, including the last owner, direct writes to `firm_members`, the hash column, "New link", and that removal does all four things and writes one line. **Not run:** a real database, real Supabase Auth, two accepts truly at once (PGlite has one connection; the check is that the second is refused and that the row is locked).

### Part B: student accounts

**Migration, written and NOT pushed:** `supabase/migrations/20261209000001_student_accounts.sql`, after `20261208000001`.

- `student_accounts` (auth user as the key, `(firm_id, student_id)` unique and a composite foreign key, the invitation, `disabled_at`). The student reads their own row, members read their firm's, nobody writes it directly.
- `student_account_consents`: insert only for every role. A trigger refuses an update, and refuses a delete unless it arrives as a cascade from deleting the whole firm.
- `one_kind_of_account` triggers on `firm_members` and `student_accounts`; `create_firm` restated whole with one refusal added.
- `invite_student`, `accept_student_invitation` (service role only), `set_student_account_disabled`, `student_grade`.

**The school-year boundary is July 1.** A student who graduates in the calendar year the current school year ends in is in 12th grade; grade = 12 − (grad_year − that year); below 9 is refused. The rule is in `shared/account.ts` (`gradeFor`, `maySignIn`) and again in the database (`student_grade`), and `test:accounts:db` checks the two agree for ten graduation years on both sides of the boundary.

**`/api/student`** takes the link token as before, or a student sign-in's Bearer token when no link token is sent. `findStudentAccount` returns the same `Link` the link path makes, so the page, the three writes and the two upload steps are the same code. The link path's answers are unchanged; the sign-in path adds a `code` (`unauthorized`, `signin_off`, `not_a_student`). A file added by a signed-in student is recorded like a link upload with no link row.

**Choices the brief did not settle.**
- *"New link" for a student does not ask for the guardian tick again*; the tick already on record for that student stands.
- *An archived student cannot be invited*, and an invitation made before the student was archived stops working.
- *A student deleting their sign-in* deletes the auth user (the account row goes with it) and writes one activity line. The consent records stay. The firm's record of the student is untouched.
- *A student deleted by the firm* loses the account row with the student; the auth user is left with no kind of account, and sees the "no firm, no invitation" screen.
- *Wording versions* are `guardian-2026-11-27` and `age-2026-11-27` in `shared/account.ts`. The server sends its own version, never the request's.

**From the review of Part A** (fixed in this commit, in the two unpushed migrations): an owner acting on an invitation that was just used now gets "no longer waiting" (`PI009`) instead of the invitee's dead-link sentence; the last-owner refusal has its own code (`PI010`); accept takes the firm lock before the invitation lock, the order "New link" uses; a person who starts a firm in another tab mid-accept is told they already belong to a firm; `invite_counselor` re-checks the caller after the lock; rate-limit keys for addresses and people no longer share a prefix.

**Checked.** `test:accounts` is now 95 checks and `test:accounts:db` 119. New: the same page byte for byte by link and by sign-in; a turned-off or archived sign-in refused on the next request; 16 requests across the 9 counselor routes with a student's token, all 401 or 403; a student session against all 37 tables; deleting a sign-in. **Not run:** a real database, real Supabase Auth.

### Part C: sign-in, sign-up and join screens

No migration. Front end, plus fixes from the review of Part B in the unpushed `20261209000001` and the server.

- **One place decides where a signed-in person belongs:** `homeOf(account)` in `src/store/session.ts`. Member: `/app/today`. Student: `/me`. Neither: `/start`. `RequireFirm`, `/signin`, `/signup`, `/setup`, `/start`, `/join`, `/me` and `/reset-password` all apply it. A page asked for before sign-in is honoured for members only, and only when it is an `/app` or `/student` address.
- **`Account` gained `student`** (with `off` when a counselor turned the sign-in off). `enter()` reads the membership, then the student's own `student_accounts` row, then falls to `needs_firm`. A signed-in student's page is held like a link's (`mode: 'student_link'`, no `linkToken`); `src/services/studentLink.ts` sends the link token when there is one and the session's token when there is not.
- **`/signin`** is for everyone. The sign-up toggle is gone; "Start a firm" goes to `/signup`.
- **`/signup`**: name, email, password, firm name. With a session straight away the firm is made and the person lands on Today as owner. When Supabase wants the address confirmed first, the firm's name and the person's name are kept in `sessionStorage` (`pending-firm`) and `/setup` is filled in with them at the first sign-in.
- **`/join#<secret>`** (`src/screens/Join.tsx`): the secret is read from the fragment, kept in memory for the tab, and removed from the address at once with a replacing navigation. Preview, then "Create a password" or "I have a sign-in", then accept. States: loading, dead link (one message for all four causes, and for no link at all), could not be checked (Try again), confirm your email first (open the invitation link again afterwards), another address (Sign out), a sign-in already in use, and done.
- **`/start`**: "Start a firm", "I was invited", Sign out, and Delete this sign-in (behind `ConfirmDialog`).
- **`/me`** exists with the student home on it and the turned-off screen. Its header and Account page are Part E.
- `signUp` now sends the confirmation link back to `/signin` (it was `/app`).

**From the review of Part B.** `invite_student` re-checks membership after the firm lock; the guardian tick can be left out only by "New link"; the grade is checked again at accept; a consent row's wording version must start `guardian-` or `age-`; the service role has only select and insert on consent rows, and a delete is allowed only once the firm row is gone; a student cannot read who turned their sign-in off; one student's sign-in is answered even when archived, so it can still be turned off; the address shown for a sign-in is read from the sign-in itself; a person who belongs to nothing can delete their leftover sign-in (a student whose record the firm deleted).

**Choices the brief did not settle.** The join page asks the person to type the invited address (the preview shows it masked). A counselor gives their name on the join page, because `firm_members` needs one. `/start` is a new address; `/setup` still works and links to it.

**Checked** by hand from `preview.html`, 22 states at 375 and 1440, light and dark (`docs/accounts/c*.png`): no console error and no sideways scroll in any. `preview.tsx` now stands in for Supabase Auth and `/api/account`, with switches listed at its top. **Not run:** real Supabase Auth, a real confirmation or reset email, Safari, a phone.

### Part D: the owner screen

No migration. `src/screens/counselor/Firm.tsx` at `/app/firm`, behind `RequireOwner` (a counselor goes to Today), with a "Firm" link in the sidebar footer above Settings for owners only. Hiding it is tidiness; the server and the database refuse every action.

- **Counts** in the header: counselors (every member), active students, students with a sign-in (on or turned off).
- **Team**: name, address, role, joined, a "You" mark. Make owner and Remove on a counselor; Step down and Leave firm on yourself; nothing on another owner. Remove first asks the server what removal will do and says only that (`removalWords`). Leave asks for the word LEAVE. The only owner trying to step down or leave gets the server's refusal as an amber note that says what to do.
- **Invitations**: an email makes a link, shown once with its expiry and "Platinum does not email this". Waiting invitations list with New link and Revoke; an expired one is marked. Asking for a second invitation for an address offers New link in place.
- **Student sign-ins**: every active student with the state pill, address and expiry, filtered by state, with Invite, New link, Revoke, Turn off, Turn on.
- **For counselors**: a "Sign-in" button beside "Student link" on the student page opens the same panel for that one student (`src/components/account/StudentSignIn.tsx`): the consent tick, the link to copy, and a QR code (`src/components/account/QrCode.tsx`, drawn in the browser with `qrcode-generator`).

No student-to-counselor assignment was added and nothing is counted per counselor.

**Checked** by hand from `preview.html`: 25 states at 375 and 1440, light and dark (`docs/accounts/d*.png`), no console error and no sideways scroll. **Not run:** a real database.

### Part E: the student screen

No migration. `/me` is `StudentAccountLayout` in `src/screens/student/Me.tsx`: a header that names the firm and the student's first name with two places, Home and Account, and nothing from the counselor's navigation. Home is `StudentHome`, the very component the link page renders; the only change to it is that it leaves out its own firm line when the header above already says it. `/me/account` is new: the address, change password (Supabase `updateUser`), sign out, delete my sign-in behind `ConfirmDialog` with the word DELETE and a sentence saying the firm's record stays, and the list of what counselors can see (`COUNSELORS_CAN_SEE` in `shared/account.ts`, the same list the join page shows).

`docs/student-api.md` is for the phone app: signing in and refreshing with Supabase, every `/api/student` request and answer for an account, the three upload steps, deleting the sign-in, and every error with what to show. No secret is in it.

**Checked** by hand from `preview.html`: 9 states at 375 and 1440, light and dark (`docs/accounts/e*.png`), including a member opening `/me` (sent to Today), a student opening `/app/students` (sent to `/me`), and the link page unchanged. **Not run:** a real database, a phone.

### Part F: hardening that belongs with roles

**Migration, written and NOT pushed:** `supabase/migrations/20261210000001_owner_delete_and_stored_files.sql`, after `20261209000001`. Two policies on `students` and `storage.objects` are replaced by stricter ones and one function is added. Nothing is loosened.

1. **Only an owner can delete a student.** `apply_changes` refuses a counselor (Part A's migration); this file makes the table's own delete policy owner-only, so the Data API refuses too. `/api/documents` no longer removes all of a student's or the firm's stored files for a counselor. Settings shows a counselor a sentence in place of Reset demo and Start empty. Editing and archiving a student are unchanged for every member, and everything an owner could do still works.
2. **A stored file needs its row.** The bucket's read and delete policies now ask `stored_file_is_readable(firm, document)`, which is false when the row is missing or belongs to another firm. `document_is_readable` is left as it was, because the file log still has to answer for documents that were deleted. The app removes objects before rows, so nothing it does depends on the old answer.
3. **Student links are `/s#<secret>`.** `studentLinkUrl` in `shared/dispatch.ts` is the one place a link is built (the student link window, the weekly text copy, and the dispatcher). `StudentLinkLayout` reads the fragment, or the path of an older link, removes it from the address with a replacing navigation, and keeps the token in `sessionStorage` for the tab so a reload still works. `Referrer-Policy: no-referrer` is sent for `/s`, `/s/*` and `/join` (`vercel.json`, `public/_headers`) and set as a meta tag by the page. `withoutStudentLinks` strips both forms from anything logged or stored. Links already sent keep working.

**Known limit:** once the address is `/s`, a bookmark of the open page does not carry the secret. The student keeps the message their link came in.

**Added to `scripts/test-isolation.ts`, not run:** a section covering Parts A, B and F against the real database, including two accepts truly at once. It needs the three migrations pushed. `createPerson` in `scripts/testAccounts.ts` makes a sign-in with no firm. Older checks in that script were not changed; any that had a counselor delete a student will now fail by design and should be read with that in mind.

**Checked.** `test:accounts:db` is 132 checks: a counselor's direct delete of a student removes nothing, an owner's does; a stored file with no row, or with another firm's row, is not listed or deletable, and stops being listed when its row is deleted. `test:outbox` checks the new link form and that neither form reaches a log. By hand in the preview: the fragment link, an old path link, no link, the counselor's Settings (`docs/accounts/f*.png`). **Not run:** a real database or real storage.

### Parts C to F: fixes from the review

A read-only review of the four commits found no secret reaching a server, a log or storage, no open redirect and no redirect loop. What it did find, now fixed:

- **An older account lookup could overwrite a newer one.** `enter()` in `src/store/session.ts` now counts each decision (`generation`); a lookup that finishes after a newer one started, or after a sign-out, writes nothing. The student page refresh and a student's task write check that the same student is still the one on screen before keeping the answer.
- **A student link and a student sign-in in one tab.** While a link's page is open, an account lookup notes who is signed in and leaves the page alone. Opening `/me` from there lets go of the link and loads the student's own page.
- **Sign-up with a confirmation step did not make the firm**, though the screen said it would. The firm's name is now kept with the address it was typed for, in `localStorage`, and the firm is made on that person's first sign-in in the same browser. One promise makes it, so two lookups cannot make two. The join page clears a leftover name.
- **Reset password** now says the same sentence whatever Supabase answers; only having no connection is reported.
- **A second link pasted into an open tab** (`/s#…` or `/join#…`) is adopted and removed from the address bar like the first. A student link the server does not know is no longer kept for the next reload.
- **Join**: reloading after the secret was removed says "Open your invitation link again", not that the link is dead; the confirm screen has a way back; the form waits until it is known who is signed in; a message that replaces the form takes focus.
- **`/me/account` opens even when the sign-in is off or the page failed to load**, so a student can always delete their sign-in.
- **Firm page**: two sign-in changes in a row no longer overwrite each other on screen; row buttons name who they act on; a window showing a one-time link no longer closes on an outside click.
- **`scripts/test-isolation.ts`**: setup steps are asserted, the orphan file is confirmed to exist before it is tested, and "zero rows" names columns so an error is not mistaken for an empty answer.

Not changed: `/reset-password` still shows its form to anyone already signed in (as before this branch).

### Part G: landing page

`/` shows the landing page to a signed-out visitor and sends a signed-in one to their home. No migration, no server change, no new dependency.

- **Its own chunk.** `src/main.tsx` is now a few lines: it starts the theme, and loads either `src/landing/entry.tsx` or the app (`src/appMain.tsx`, which is the old `main.tsx`). It decides by looking for Supabase's session key in `localStorage`, without loading Supabase. If that session turns out to be over, the app's `/` route shows the same page, lazily. The built landing chunk has no store, Supabase client or router in it.
- **Files:** `src/landing/Landing.tsx` (the scroll reader, the notes, the chapters), `Workspace.tsx` (the eight areas), `story.ts` (the invented meeting and the settled copy), `landing.css` (all of the motion). `src/services/earlyAccess.ts` is the form's one way out.
- **How it moves.** `useStory` reads the scroll position at most once a frame and writes `--page` on the root and `--p` and `data-step` on each chapter. Everything else is CSS reading those, so scenes play backwards when scrolled back and are right wherever the page is opened. Scrolling is the browser's own. Only transform and opacity are animated. A scene pins (sticky) only when all of it fits on the screen.
- **The early access form sends nothing and stores nothing.** `requestEarlyAccess` answers "not open"; the form says so before and after submitting and never shows success. This is the one thing left to wire up.
- `index.html` has a real title, description and share image (`public/brand/share.png`, made from the brand); `noindex` is kept.
- `test:outbox` checks that the page counts down the same 10 seconds the database holds.

**Where it differs from the brief.**
- *No serif or handwriting font was downloaded.* Adding the font package would be a new dependency, which was not allowed in this run. The accent is the reader's own serif (Iowan, Palatino, Georgia) and the notes use the system's handwriting face, so both vary by device.
- *The four drafts "fly" a short way*, into a row at the top of the student's page with a label saying where each lives; they do not travel across the screen from the chapter above.
- *The update turns from English to Chinese letter by letter at one point in the scroll* (and back when scrolled back), not continuously with the scroll. The facts are highlighted in the sentence in each language and repeated in a row beneath that does not move.
- *The notes page "changes at each chapter"* as: tilting with the pointer in the hero; phrases lighting up; shrinking with a "filed" tag; turning over to show the record; a tag for the gate; a tag for sent or still waiting.
- *On a phone* the notes are a strip held at the top, the Inbox card is part of the hero, and the chapter index is the browser's own menu in the header.
- *Lighthouse was not run* (not installed, and nothing was added). `docs/landing/README.md` has an equivalent phone-profile check with its numbers.

**Sentences in the copy that the overview does not mark Working**, kept as written: "Approved emails send from your own Gmail address" and "Parent update, from your Gmail" (Gmail sending is off by default); "bring them in from Google Drive" (off by default); "Updates are drafted in English, Traditional Chinese or Simplified Chinese" (working, but the Chinese has not been reviewed by a native speaker); "One click to send a reminder" (one click drafts it; it still waits for approval); "Schedule, log and search every meeting" (no dedicated meeting search was found); "We will reply by email" (the form sends nothing yet).

**Checked** in headless Chrome from the preview and the build: 50 states at each of 1440, 768 and 375 in light and dark, scroll sequences, a reduced-motion pass and a keyboard pass (`docs/landing/README.md`). **Not run:** Safari, Firefox, a real phone, a screen reader.

### Part G: fixes from the review

A read-only review of the landing page found nothing wrong with its isolation from the workspace, its scrolling, its form or its requests. What it found, now fixed:

- A card that mounts after the page (the hero's Inbox card, when a wide window is made narrow) now arrives: each `Reveal` watches itself.
- With reduced motion on a phone the notes no longer disappear during Families.
- `/` for a signed-in person whose account lookup failed goes to the workspace's "could not load" screen, not the landing page.
- The line from a draft to the notes is redrawn at most once a frame and only when it has moved. `--page` is written on the thread alone, `--p` is gone, and a scene far from the screen is not measured.
- A tap elsewhere lets go of a highlighted line or fact (Safari does not focus a tapped button).
- Jumps move focus to the chapter; "Request early access" lands on the form; a jump on a short screen now counts the chapter as current.
- A control that takes focus before its scene reaches it is shown. The college keeps focus when it changes band. Approve and Undo keep focus without taking it from a visitor who has moved on.
- The gate's and the log's dots say "Done" or "Not yet" to a screen reader. The header marks the current chapter.
- A scene that grows after load is checked again before it is pinned.

Left as it is: the form's last line, "We will reply by email. No newsletter.", is settled copy and sits under a notice that nothing is sent; a failed chunk load shows a blank page, as for the app; the back button after signing in can show the landing page from the browser's cache until it is reloaded; turning reduced motion on in the middle of a visit takes effect at the next load.

## Google Calendar (branch `google-calendar`, on top of `templates`)

The counselor's meetings in Platinum and their own Google Calendar, kept in step both ways. Optional: asked for on its own in Settings, and the Google connection works without it.

**Migration, written and NOT pushed:** `supabase/migrations/20261207000001_calendar.sql`: two nullable columns on `meetings`, `google_event_id` and `google_sync`. Nothing else. `apply_changes` reads columns from the catalog, so it is not restated. Push order: `20261205000001`, `20261206000001`, then this, then `npm run db:types` (the types were edited by hand). The chain plus this file runs clean in PGlite; the dry run lists the three files.

**Scope.** One: `https://www.googleapis.com/auth/calendar.events.owned` ("See, create, change, and delete events on Google calendars you own"). It is the narrowest that both reads the counselor's events and writes one: `events.list`, `insert`, `patch` and `delete` all accept it, and the calendar's time zone comes back with `events.list`, so no calendar-list or settings scope is needed. `calendar.app.created` is narrower still but cannot see the counselor's own events. Google's Calendar scope page gives no sensitivity tier for any scope; it grants access to user data, so expect it to be treated as sensitive, which means Google's OAuth app verification before real firms connect (and the consent screen names it until then). No restricted scope is used.

- **Rules:** `shared/calendar.ts`. `eventPayload` (title "<first name>: <meeting title>", time, length, place, description = the link back and nothing else, private visibility), `assertQuiet` (throws on any guest field anywhere in a body, on a write without `sendUpdates=none`, on `sendNotifications`, on a meeting link), `wallEnd`, `wallFromGoogle`, `googleChange`, `suggestStudent`.
- **Time.** A meeting has a date and a local time with no zone. The event is sent as that wall-clock time with the calendar's own time zone beside it (read from Google), so Google does the zone arithmetic, including across a daylight-saving change. Events come back in the calendar's zone, and the wall-clock part is what is shown and compared. Platinum never works out an offset. A counselor whose calendar is in another zone than the one they think in will see the calendar's.
- **Server:** `server/google/calendar.ts`, four actions on `/api/google` (`calendar_events`, `calendar_put`, `calendar_remove`, `calendar_off`). No new function, so `FUNCTIONS` in `vite.config.ts` is unchanged. Every write goes through one `write()` that calls `assertQuiet` first. `putEvent` reads the meeting with the caller's own sign-in. An event made by Platinum carries a private mark with the meeting's id; `removeEvent` deletes only an event that carries the mark for that meeting. An event made in Google and linked is only ever moved.
- **Connection:** `startConnect` takes `calendar` and `keep` (what is already on is asked for again, because a consent replaces the grant). `finishConnect` records the calendar only when it was asked for this time or was already on. `calendarOff` drops it from our row at once; Google has no way to give back one permission, so the grant itself stays until Disconnect, and Settings does not claim otherwise.
- **Browser:** `src/lib/calendarSync.ts` (`syncMeetingToCalendar` after the meeting has been saved, `removeMeetingFromCalendar`, `useCalendarEvents` read on open and on Refresh, no polling). `CalendarBits.tsx`: the Google event row, "Link to a student" (a name in the title is a suggestion; the counselor chooses and can change the title), the "Changed in Google Calendar" question with Update and Keep, and "Not on your calendar yet" with Retry. The store gained `setMeetingCalendar` and `whenSaved`.
- **Not synced:** a meeting logged after the fact, and one the assistant schedules. Only the Schedule and Reschedule form and its Delete talk to Google.
- **Invented calendar:** `GOOGLE_FAKE=1` now answers the Calendar API too: a week of made-up events in Pacific time, one naming a sample student, one that moves an hour the third time the week is read. It refuses a write with a guest or a notification.

**Security review of this part, in general words.** Inputs are checked by shape before anything is put in an address. The server acts only with the signed-in counselor's own token and reads the meeting through their own access, so another firm's meeting is not found. Nothing from Google is stored unless a counselor links it, and nothing from Google is handed to a model by this code. One thing to know: a linked event's title becomes the meeting's title, and meeting titles are later read by the assistant like any other; the link window shows the title and lets the counselor change it first. The event description carries a link with a student id in it and no name; the page behind it needs a sign-in. Turning the calendar off stops Platinum using it but does not withdraw the permission at Google.

**Checked** offline (`npm run test:calendar`, 74 checks, part of `test:notes`) against the invented calendar: the payload rule, time zones around midnight and both daylight-saving changes, moved and cancelled, never deleting what Platinum did not make, consent asked for separately. By hand from `preview.html` at 1440 light and 375 dark (28 checks each) with `/api/google` answered by a stand-in: off, on, the calendar view and Today, link, moved (Keep, then Update), cancelled, schedule, Google down then Retry, cancel, turn off with meetings untouched. **Not run:** the `GOOGLE_FAKE=1` dev server by hand (it needs Supabase settings and a sign-in this machine does not have), real Google Calendar, a real database.

## Templates (branch `templates`, on top of `ui-ux-redesign`)

A firm's own reusable material: task plans, messages and handouts, in one library.

**Migration, written and NOT pushed:** `supabase/migrations/20261206000001_templates.sql`. Push `20261205000001` first, by itself, then this one, then run `npm run db:types` (the types in `src/lib/database.types.ts` were edited by hand to match). It only adds: `templates`, `message_drafts`, a nullable `tasks.template_id`, and `apply_changes` restated whole with the two tables added to its upsert list (`templates` before `tasks`). Nothing is in its delete list: a template is archived and a draft is decided, never deleted. `test:templates` checks that the rest of `apply_changes` is word for word what it was. The whole chain plus this file runs clean in PGlite with stub `auth` and `storage` schemas. Until it is pushed, saving a template or a task made from one fails against the real database and the store undoes it and says why; the preview and the offline checks do not need it.

- **Contract and rules:** `shared/templates.ts`. Zod shapes for the three kinds, `planDates` (offsets to dates, in whole calendar days), the fixed list of blanks (`PLACEHOLDERS`), `fillPlaceholders`, `draftProblems`, `bodyFor`. No model call anywhere in applying a template.
- **Store:** `src/store/templates.ts`, spread into the one store like the college list actions. `addTemplateTasks` and `giveHandout` add ordinary tasks with `templateId`. `addMessageDrafts` only adds drafts. `approveMessageDraft` is the one place a template reaches the outbox: it calls the store's own `sendMessage` (so `queue_message`, the hold and Undo) and refuses while a blank is in the text. `store.ts` changed by four lines to spread the actions in and to keep the two new lists in `emptyData`, `merged` and the legacy import.
- **Inbox:** a draft is `template_message` on the shared approval card (`messageDraftApproval` in `derive.ts`). Drafts made together are one group across students, named after the template (`groupName`), with the existing "Approve all", which leaves a draft with a blank where it is.
- **Screens:** `Templates.tsx` (list, kind filter, New, Edit, Duplicate, Archive) and `src/components/templates.tsx` (`TemplatePicker`, `ApplyTemplate`, `TemplateEditor`). Sidebar footer link above Settings; no new item in the main navigation.
- **Sample:** eight invented templates in `src/data/templateSeed.ts`, loaded with the sample caseload.

**Where the brief and the code differ.**
- *One table.* A message draft for a student has nowhere to live today (`reports` needs a parent, `agent_proposals` is the server's and locked down), so there is a second new table, `message_drafts`.
- *A file from Documents as a handout* was not built: every stored file belongs to one student and is only ever served to that student's own link. A handout is text kept in Platinum, or a link.
- *A Google Doc* is attached by its address. Picking with the Picker and "Make a copy for <first name>" were not built; the screen says the link is attached as it is and that Platinum does not copy it or change who can open it.
- *A missing language.* There is no path that translates English into Chinese (the only translation in the app is into English, for assistant drafts). A parent whose language the template lacks gets the English text with an amber line saying so; it does not block approval.
- *The subject line* is kept on the template and the draft, but the outbox has no subject column and `queue_message` may not be restated, so an email still goes out under the subject the dispatcher derives from its kind.
- *Outbox kinds:* a draft to a parent is queued as `parent_report`, one to a student as `weekly_text`.
- *Who may edit:* any member of the firm, as for reminder rules.
- *Rich text:* a handout's text is plain text kept line for line; no editor library was added.
- "Use a template" is in the reminder box. The weekly text editor and the report editor do not have it.

**Checked** offline (`npm run test:templates`, 51 checks, also part of `test:notes`) and by hand from `preview.html` at 1440 light and 375 dark: make each kind, edit, duplicate, archive and bring back; a plan for one student with a date counted back, a row removed and one edited; a plan for four behind one confirm ("20 tasks for 4 students"); a handout from Essays; a message for a WeChat parent (Copy, no send) and a text parent (approved, one `queue_message`); a blank that could not be filled blocking approval. Not run against a real database.

## Up to date with main, then wording and four flow fixes (branch `ui-ux-redesign`, PR 33)

**Merged, not rebased.** `main` (PR 31, the 10-second hold) into `ui-ux-fixes`, then `ui-ux-fixes` into `ui-ux-redesign`. Main's behaviour was kept (`UNDO_SECONDS` in `shared/outbox.ts`, now 10) with each branch's layout and wording. No sentence, toast, dialog, comment or doc gives a number of seconds for the send hold: each reads `UNDO_SECONDS`. The 60 seconds on file download links is a different thing and stays. With 10 seconds, Undo was timed in the preview on a laptop and at 375 by 812 and 375 by 560: it is on screen, on top and 44px high within a tenth of a second of the press, and still cancels when pressed four seconds later.

**The 10-second migration is still not on the database.** `20261205000001_undo_ten_seconds.sql` runs clean in PGlite at the end of the whole chain, and a dry run against the linked project lists only that file. The push itself was refused by the permission check on this machine, so nothing was pushed in this run. A backup was taken first and is outside the repository. Until someone runs `npm run db:push`, the screen says 10 and the database still holds a message for 60: the countdown follows the database.

**Flow.**
- A reminder is approved in one place, the Inbox. Messages, Scheduled reminders shows "To review", a count, and "Review in the Inbox" (`/app?kind=reminder`). "Automatic" and "Run the daily send now" are as they were.
- The reminder box for a WeChat or LINE parent says only "WeChat is not connected. Copy it and send it yourself." The sentence about approval, the log and Undo is shown only when Platinum sends the message itself.
- "Approve 11 of 13" names what it leaves: "2 are for WeChat or LINE and stay here for you to copy.", and the same for weekly texts.
- The Undo toast on a real run: **not checked.** It needs a signed-in session against the real database, which this run did not have. In the preview it holds for the whole 10 seconds on a laptop and a phone.

**Wording.** "Needs attention" is the title of what was "Slipping" on Today; the Behind and Slipping tags keep their names and carry a tooltip and `aria-description` built in `shared/attention.ts` from the numbers `classifyAttention` uses (`ATTENTION_RULE`; `test:notes` checks the words against the thresholds). Drafts for the counselor are "To review" everywhere (Today, the student header, Students, the Inbox's count, the sidebar badge's label, the meeting review, Scheduled reminders); "Waiting on" still means who owes a task. Kind pills: "Note to self", "Weekly text to parent", "Recap for student", "Parent report"; `?kind=` with the old words still filters (`OLD_KIND` in `Approvals.tsx`). "Sample message, not sent." for "Legacy simulated send." (the seed, and shown that way for rows already stored). "Student" and "Parent of" start with a capital in the Sent log. "Sent by a reminder rule" for "Automatic rule". "Oldest first, one per student."

## Design pass (branch `ui-ux-redesign`, added to PR 33)

Front end only. No migration, nothing in `supabase/`, `api/`, `server/` or `shared/`, and `src/store/store.ts` is untouched. Every send still goes through `sendMessage`, `queue_message` and the hold before sending (`UNDO_SECONDS`); Undo still calls `cancel_message`.

- **No promise of a send that cannot happen.** `src/lib/delivery.ts` asks `resolveAddress` (the dispatcher's own rule) whether a channel can be delivered. WeChat and LINE cannot, so a draft on them says "WeChat is not connected. Copy it and send it yourself." and its action is "Copy for WeChat": the text goes to the clipboard and only then is the draft approved, by the same path as before. `ApproveAll`, the meeting review's "everything left", the reminder composer, "Run the daily send now", the Undo toast and the Sent log count and word only what Platinum will send. `test:outbox` checks that the screen and the dispatcher agree on every channel.
- **Sent by hand is recorded as sent.** `approvedToSendByHand` in `server/dispatch.ts`: a row a counselor approved (`trigger = 'approved'`) on a channel `resolveAddress` refuses for anyone (WeChat, LINE) is marked `sent` with a `hand_` id and the note "Sent from your own phone" (a note the row already has is kept), and Activity says "Sent a … to …". That is how the phone transport records a weekly text sent with Copy or Open in Messages. No transport is called, so there is no address for the allowlist to check. A row a rule queued by itself on such a channel still fails with "channel not connected yet.". The hold before sending (`UNDO_SECONDS`) and Undo are untouched: the dispatcher only sees a row once the hold is over and it is still queued. No migration: `trigger` and `note` were already columns. The screen shows such a row as "Approved to send by hand" until then, "Sent" after, and "Not sent: WeChat is not connected" for one that failed.
- **One filled button in a view.** `ApprovalCard`, `WeeklyTextSend` and `FilingRow` take `primary`; without it their main button is outlined. The Inbox's open draft is the one place a draft's button is filled. Buttons inside a student tab, the meeting review and the reminder composer are outlined, because the page has its own. A form's Save is filled only once something has changed. The selected half of a segmented control is tinted, not filled. In the dark theme `--color-primary` is porcelain (`--color-heading`) with midnight text.
- **Inbox** (`Approvals.tsx`): `inboxGroups` and `rowAfter` in `src/lib/inbox.ts` give the rows; `InboxLine.tsx` is the two-line row. Two panes when the page has 760px (`useRoomFor`), so with the assistant open on a small laptop it is one column. What is open is worked out during render from `?item=` and the rows, so a decided row is never shown for a frame after it has gone. Undo reopens the row it brings back, except on a phone once the counselor is back at the list. Keys: Up, Down, J, K, E, Cmd or Ctrl+Enter; they press the pane's `data-action="approve"` and `data-action="edit"` buttons, so a disabled button stays disabled. The "Open <name>" link left the group header; the student's name on the open draft is the same link.
- **Today**: `StatTile` in `ui.tsx`; `waitingSpread` in `src/lib/today.ts` picks the oldest draft for each of three students; a row opens the whole card in place. `StudentCards brief` is the compact slipping row.
- **Student page**: a task that is not late has a `BellRing` icon button; done tasks are a `Disclosure`; a meeting review opens one section at a time (the first with something waiting, then the next); an older meeting with drafts waiting opens its review in place. `PhoneFold` in `ui.tsx` starts the college list and the meeting brief closed below 640px.
- **Found by re-running the old scripts.** Coming back from Google's consent screen (`/app?google=…`) the Inbox's address sync overrode the move to Settings; it now leaves the address alone then. A WeChat parent update in the meeting review had two "Copy for WeChat" buttons that did different things; the card's own is the only one. A decided Inbox row says how it was decided while it leaves (`onDecide` on `ApprovalCard`). A group's name and count stay on one line and the name is cut short.
- **Smaller**: Messages' sending note is a disclosure beside the title. The assistant's suggestions come from `src/lib/assistantPrompts.ts`, fit the page, fill the box and send nothing. The phone student card is about 170px. Tab rows fade at a cut edge. `AiConnection` shows nothing in a built app when the status request gets no answer, so "placeholders" is only shown when the server says there is no key or no sign-in check.

**Checked** from `preview.html` with the sample caseload and the database calls stubbed at the network, in headless Chrome, light and dark, at 1440 and 375, and with reduced motion. Not run against a real database, Google account or phone, or in Safari.

## Today, navigation, interface fixes and motion (branch `ui-ux-redesign`, on top of `ui-ux-fixes`)

Front end only. No migration, server, API, outbox or dispatch change, and `src/store/store.ts` is as `ui-ux-fixes` left it. Every send still goes through `sendMessage`, `queue_message` and the hold before sending (`UNDO_SECONDS`).

- **Today** (`/app/today`, `Today.tsx`, `src/lib/today.ts`): meetings, the three most urgent drafts on the shared card, and students behind or slipping. Opening it asks nobody for anything. Sign-in, the logo and unknown addresses land there. The Inbox stays at `/app`.
- **Navigation.** Today, Inbox, Students, Meetings, Messages, Documents; Activity, Settings and Sign out in the footer. One badge, the Inbox's. The Assistant button is in the sidebar on a laptop, and in the one top bar with the logo and Menu below `lg`.
- **Assistant below `lg`** is a dialog: the page behind it is `inert`, Escape closes it, focus goes back to the button.
- **`src/components/motion.tsx`.** `MotionList` keeps a row on screen for 340 ms after it has left the data (its children must be keyed, and a leaving row gets no new props, so anything it shows about how it was decided is its own state). `Reveal`, `useReveal`, `useMarker`, `Count`, `TimeLeft`, `useRoomFor`, `focusNear`. Timings and keyframes are in `src/index.css`.
- **`ui.tsx`.** `ConfirmDialog` and `useConfirm` replaced all fifteen `window.confirm` and `window.prompt` calls. `Button` has `busy` (it keeps focus, so it is `aria-disabled`, not `disabled`). `CheckRow`, `Disclosure`, `Note`, `Skeleton`, `ProgressBar`, `SendLabel`, `TabPanel`, `usePageTitle`. `Modal` starts focus at `data-autofocus` and gives it back.
- **Approval card.** One place for every edit form, each field labelled. The meeting review uses it too (`meetingApprovals` in `derive.ts`). `data-focus-home` marks where focus goes when a card is replaced by its outcome.
- **Targets.** `tap-link` and `check-row` in `index.css`: 44px on a phone, 24 anywhere.
- **PR 31** (10-second hold) edits some of the same copy. `TimeLeft` goes by the message's own times, so it needs no change.

**The skill.** `ui-ux-pro-max` is not installed on this machine. Its public quick reference was read as text; none of its scripts were run.

**Checked** from `preview.html` with the sample caseload and the database calls stubbed at the network, in headless Chrome, light and dark, at 1440 and 375, and with reduced motion. Not run against a real database, Google account or phone, or in Safari.

## UI and UX fixes (branch `ui-ux-fixes`)

Four fixes. No migration, no API route, no outbox or dispatch change.

- **Assistant wording.** A drafted message ends with "You can approve it below." (`server/agent/format.ts`, the `reply:` instructions in `tools.ts`, the rule in `server/prompts.ts`). "Approvals" is "the Inbox" and "Firm settings" is "Settings" in the other server text. `test:agent` case 2 checks the new sentence; it needs an API key and was not run. Threads already stored keep the old sentence.
- **Remind on any open task** with someone to remind, filled style when late and plain otherwise. `ReminderComposer` already worded a task that is not due yet.
- **Weekly text link.** `src/lib/studentLinks.ts` fills `{{student_link}}` when a counselor copies a text or opens Messages, with one link per student kept in memory for the session and forgotten when it is replaced, revoked or the session ends. The stored text, the outbox row and the log keep the placeholder. Copy hands Safari a promised `ClipboardItem`. Nothing is marked sent unless the copy or the link worked. `OpenInMessages` is a button that follows the `sms:` address, because the address may have to be made first. The character count, the facts and the limit given to the AI allow for the real address (`linkRoom` in `src/lib/reminders.ts`). Messages, Sent uses the same helper.
- **Undo id.** `sendMessage` returns the queued message's id and `approveAgentProposal` resolves to it. If the message was queued but the decision was not saved, it rejects with `ProposalNotDecided`, which carries the id so the card still offers Undo. The order of queueing and deciding is unchanged.

## 10-second Undo (branch `undo-10-seconds`)

An approved message waits 10 seconds instead of 60. `UNDO_SECONDS` in `shared/outbox.ts` is now the one number the store and the copy read, and `test:outbox` checks it against the newest `queue_message` migration.

**Migration, written and not pushed:** `supabase/migrations/20261205000001_undo_ten_seconds.sql`. It is `queue_message` from `20261129000001` with only the interval changed. Checked on 2026-11-25: the remote is at `20261204000001` and a dry run lists only this file. `npm run db:push` asks for confirmation, so a person runs it. Push it and deploy the app close together. Until it is pushed, the copy says 10 but the database still holds 60 (the countdown shows the database's time).

**Known limit:** `save()` queues messages before the other edits and cancels them if those edits fail. That cancel now has to land within 10 seconds of queueing, or the message goes out although the approval was undone on screen. The countdown compares the database's time with the browser clock, so a laptop clock 10 seconds fast hides Undo.

## UX cleanup (branch `ux-cleanup`)

Front end only. No migration, no server, API, outbox or dispatch change. Every send still goes through `sendMessage`, `queue_message` and the hold before sending (`UNDO_SECONDS`). `src/store/store.ts` is unchanged.

- **One approval card.** `src/components/ApprovalCard.tsx` holds the card, its edit forms, `approveItem`, `discardItem`, `ApproveAll` and `SendState`. The Inbox, the assistant panel, Parent reports, Essays and Scheduled reminders use it. `children` replaces the plain preview; `compact` is the panel size.
- **Approval in the assistant.** A pending proposal in the panel is that card, built by `proposalApproval` from `data.agentProposals`. `src/lib/approvalSends.ts` remembers, for the session, which message an approved proposal queued: the store adds the outbox row before its first wait, so the row that is new right after the call is the one. The card's Undo waits for the same queue notice the toast listens to. It also blocks a second press while a decision is on its way, and a card whose message is already queued offers no second approval.
- **Statuses.** The browser loads pending proposals only. The panel copies a decided status onto its cards before the row leaves `data`, and asks the server about a pending card that has no row.
- **Inbox** (`/app`, still `Approvals.tsx`): approvals, files (`FilingRow`, `FileRow`) and college list drafts, filtered by student (`?student=`) and kind (`?kind=`). `src/lib/inbox.ts` gives the one count used by the page, the sidebar badge, Students and the student page.
- **Weekly texts.** The Inbox used to mark one as sent by hand with nothing copied. `WeeklyTextSend.tsx` is now the only way to send one, on both screens, and "Approve all" leaves them.
- **Navigation.** Inbox, Students, Meetings, Messages, Documents; Activity, Settings and Sign out in the footer. `/app/overview` goes to Students, `/app/messages?tab=rules` to Settings, `/app?google=…` to Settings with its toast. `CommandCenter.tsx` is gone. Weekly text day moved to Settings, Reminder rules.

**Not done:** the assistant's server-written replies and some server errors still say "Approvals" and "Firm settings" (`server/agent/format.ts`, `run.ts`, `tools.ts`, `server/prompts.ts`, `server/google/connection.ts`, `server/documentSorting.ts`). `test:agent` case 2 checks for "Review it in Approvals", so change both together. Two comments in `src/types.ts` and `src/data/repo.ts` still name Approvals.

**Found, not changed:** copying a weekly text puts the raw `{{student_link}}` on the clipboard, on both screens. In `approveAgentProposal` the message is queued before the proposal is decided; if the decision fails the message still goes out (the card now shows it with Undo), and if queueing fails the proposal can still end up approved (the card says "Not queued. Nothing was sent.").

Checks: `typecheck`, `lint`, `test:notes` pass. No Supabase settings were on this machine, so the app was run from `preview.html` with the sample caseload and the database calls stubbed at the network. Every changed screen was opened in light and dark at 1280 and 390 wide. Not run against a real database, real Google or a real phone.

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

**Unconfirmed texts in Messages.** The row says "Your phone didn’t confirm this text. Check your phone’s sent messages." with two actions. "It was sent" calls `resolve { sent: true }`: the job is submitted, the row is sent, and the activity row has `actor: 'counselor'`. "Send again" calls `resolve { sent: false, again: true }`, which fails the old row with "Not confirmed. The counselor sent it again." (that row then offers no Retry and no send-by-hand), and only if that worked, queues the same message as a new approval through `queue_message` with the usual Undo toast. The server makes no job for it; the dispatcher does, after the hold, as for any approved text.

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

### Follow-up on `sec-fix-a1`: thinking in replayed history, thinking budget

- **Replay.** The system prompt carries a live student summary, so it changes whenever the record does. A thinking block is signed against the prompt it was made under, and replaying one after a change made Claude refuse the request (a 502). `withoutThinking` in `server/agent/run.ts` drops `thinking` and `redacted_thinking` blocks from every assistant row loaded from `agent_messages`, and they are no longer saved: nothing but replay ever read them (history and sources use text and tool blocks only). Within one request the tool loop still sends the full response back, as the API requires. No beta header.
- **Agent loop thinking: off.** `thinking: { type: 'between_tools' }` on the agent's `messages.create`. On `claude-sonnet-5-5` that is the off switch (`disabled` is rejected with a 400 that says so): no thinking before a reply, only short notes between tool calls. Brief and brainstorm (`runFeature`) unchanged: adaptive thinking with each feature's effort; they already met their targets.
- **Draft confirmation from the server.** When the only tool in a round is a successful `propose_message` or `propose_parent_update`, the reply is written by `formatDraftConfirmation` (`server/agent/format.ts`): "I drafted an email to Liu Min in Simplified Chinese. Review it in Approvals." That drops the second model call.
- **Tests.** `test:agent` case 13: no saved assistant row has a thinking block; a first turn; an older turn planted with a thinking block whose signature the API would reject; a task marked done; a follow-up in the same thread returns 200 and names only the remaining overdue task. Case 12 now passes (one 200, one 429).
- **Joined words** like "twooverdue" and "hasno" were the terminal capture dropping the space at a soft line wrap. The same reply showed the join in different places in two lines, and the run's log file has no joined words.

Timing, `test:agent` wall time (model time in brackets):

| Case | M4b-4 | Now |
|---|---|---|
| Overdue | 3.1s (1.3s) | 5.6s (2.0s); 2.7s (1.3s) in case 13 |
| Draft reminder | 13.4s (9.2s + 0.9s, 1,183 out) | 9.6s (6.6s, 634 out, one call) |
| Meeting brief | 7.7s | 9.3s (brief tool 5.1s) |
| Essay brainstorm | 10.6s | 10.4s (brainstorm tool 6.1s) |

The draft is under 12s but not at 5s. What is left is the model writing the email itself (a Chinese email, 634 output tokens) and about 2.5s of database work per request before the first model call (counselor, firm, student summary, history, the budget reservation). The brief and brainstorm vary by a second or two between runs with no change to them.

Checks: `typecheck`, `lint`, `test:notes`, `test:outbox`, `test:agent` (all cases) pass.

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
  - `server/dispatch.ts`: `note` added to `OutboxRow` and to both selects; `outboxId` and `note` passed to the transport; a result with `waiting` goes to the new `markWaiting` (sets `delivery_detail`, leaves the row `sending`) instead of `markSent`; `markFailed` takes an optional detail from the transport's error; `DispatchSummary.waiting`. The allowlist check, the claim, the hold before sending and the student-link step are untouched and still run in the same order. It also calls `sweepJobs()` at the start of `dispatchFirm`, inside a try/catch, and `DispatchSummary` has `swept`. `src/services/dispatch.ts` reloads when `processed + swept > 0`.
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
