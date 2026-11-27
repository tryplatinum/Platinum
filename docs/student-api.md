# The student API

For whoever builds the student phone app. A student with a sign-in gets exactly what their student link gets: one page of their own data, three writes on their own tasks, and adding a file. Nothing else is readable or writable, and there is no request that lists or downloads a file.

Status: built and checked offline (`npm run test:accounts`, `npm run test:accounts:db`). **It has not run against a real database or real Supabase Auth.** The migrations it needs (`20261208000001`, `20261209000001`) are not pushed. No part of this has had a legal review; students are mostly minors.

No secret appears in this document. The Supabase project URL and the anon key are public values (the web app ships them); the app must never hold the service role key.

## 1. How a student gets a sign-in

A student cannot sign up on their own. A counselor invites them: the counselor gets a link, `https://<app>/join#<secret>`, and sends it themselves. The student opens it in a browser, makes a password with the invited email address, and ticks "I am 13 or older". The app does not need to implement this; it can open the link in the system browser. After that the student signs in with the email and password.

A student account is refused for a student below 9th grade.

## 2. Signing in and staying signed in

Authentication is Supabase Auth, email and password. Use a Supabase client library, or the REST calls below. `<SUPABASE_URL>` and `<ANON_KEY>` are the project's public values.

**Sign in**

```
POST <SUPABASE_URL>/auth/v1/token?grant_type=password
apikey: <ANON_KEY>
content-type: application/json

{ "email": "…", "password": "…" }
```

Answers 200 with `access_token` (a JWT, about an hour), `refresh_token`, `expires_in`, `expires_at` and `user`. A wrong email or password is 400 with `invalid_credentials`; show "That email or password is not right." An unconfirmed address is 400 `email_not_confirmed`; show "Confirm your email first: open the link we sent you."

**Refresh**

```
POST <SUPABASE_URL>/auth/v1/token?grant_type=refresh_token
apikey: <ANON_KEY>
content-type: application/json

{ "refresh_token": "…" }
```

Refresh shortly before `expires_at`, and once more when any request below answers 401 `unauthorized`. A refresh token is used once: keep the new one from each answer. If the refresh fails, sign the student out and show the sign-in screen. Keep both tokens in the platform's secure storage (Keychain, Keystore), never in plain preferences or logs.

**Change password** (signed in): `PUT <SUPABASE_URL>/auth/v1/user` with `apikey`, `authorization: Bearer <access_token>` and `{ "password": "…" }`. At least 8 characters.

**Forgot password**: `POST <SUPABASE_URL>/auth/v1/recover` with `apikey` and `{ "email": "…" }`. Always show the same sentence, "If that address has an account, a link is on its way", whatever the answer.

**Sign out**: `POST <SUPABASE_URL>/auth/v1/logout` with the access token, then forget both tokens.

## 3. Which kind of account is this

`/api/student` answers that by itself: a student gets their page, and anyone else gets 403 `not_a_student`. The app does not need to read any table.

## 4. `/api/student`

Every request carries `authorization: Bearer <access_token>` and `accept: application/json`. Do not send an `x-student-token` header: that is the link's credential, and when it is present the sign-in is ignored.

Every answer is JSON with `cache-control: no-store`. Success is `{ "ok": true, … }`. Failure is `{ "ok": false, "code": "…", "message": "…" }`; `code` is present for the failures in section 6 and absent for the rest. Go by `code` and the status, not by the words.

### GET: the page

```
GET /api/student
```

```
{ "ok": true, "data": { … } }
```

`data` has the shape the web app's store uses. Only these parts are ever filled in for a student; every other list in it is empty and should be ignored.

| Field | What it holds |
| --- | --- |
| `firm.name` | The firm's name |
| `firm.counselorName`, `firm.counselorFirstName` | The firm owner's name, for "From Sarah" |
| `students[0]` | `id`, `firstName`, `gradYear`, `onboardedOn`. Always exactly one. `lastName` is empty, and so are school, notes, tests, parents |
| `tasks[]` | Open tasks, and tasks done in the last 30 days. `id`, `title`, `category`, `owner` (`student`, `parent`, `counselor`), `dueDate`, `status` (`todo`, `in_progress`, `done`), `completedOn`, `completedBy`, `createdOn`. For the student's own tasks also `detail`, `progressNote`, `attachments[]`. For other people's tasks those three are left out |
| `meetings[]` | Up to five scheduled meetings from yesterday on (`id`, `title`, `date`, `time`, `durationMin`, `location`, `status: "scheduled"`), and the most recent completed meeting whose recap a counselor approved (`status: "completed"`, `recap.summary`, `recap.nextSteps[]`) |
| `colleges[]` | `id`, `name`, `plan`, `deadline`, `status`, `fit`. No notes |
| `documents[]` | Essays with approved feedback only: `id`, `name`, `category`, `addedOn`, `feedback.overall`, `feedback.strengths[]`, `feedback.points[]`. Never a stored file |

Dates are `YYYY-MM-DD`; a meeting's `time` is `HH:MM`, 24-hour, in the counselor's local time with no zone.

Fetch it when the app opens and when it comes back to the foreground. There is no push and no realtime.

### POST: one of three writes

Each answers with the whole page again, `{ "ok": true, "data": { … } }`, as the server now has it. Replace what the app holds with it. `today` is the student's own calendar date, `YYYY-MM-DD`. The body may be at most 8,000 bytes.

Mark a task done or not done, and or leave a note:

```
{ "action": "progress", "taskId": "<uuid>", "status": "done", "progressNote": "…", "today": "2026-11-27" }
```

`status` is `todo`, `in_progress` or `done` and may be left out. `progressNote` is at most 2,000 characters and may be left out.

Attach a link to a task:

```
{ "action": "attach_link", "taskId": "<uuid>", "name": "My essay draft", "url": "https://…", "today": "2026-11-27" }
```

`name` is 1 to 200 characters. `url` must be `http` or `https`, at most 2,000 characters.

Only a task whose `owner` is `student` can be written. Anything else answers 404.

### POST: adding a file, in three steps

Allowed types: PDF, JPEG, PNG, HEIC, Word (.docx), Excel (.xlsx). At most 25 MB a file, 10 files a day for a student, 200 MB in all. The whole thing must finish within 5 minutes of step 1.

1. Ask for a place to put it:

   ```
   { "action": "start_upload", "filename": "transcript.pdf", "size": 482113, "type": "application/pdf", "today": "2026-11-27" }
   ```

   ```
   { "ok": true, "upload": { "documentId": "<uuid>", "path": "…", "token": "…" } }
   ```

2. Send the file straight to storage. It does not pass through `/api/student`:

   ```
   PUT <SUPABASE_URL>/storage/v1/object/upload/sign/documents/<path>?token=<token>
   authorization: Bearer <ANON_KEY>
   apikey: <ANON_KEY>
   content-type: <the file's type>
   x-upsert: false

   <the file's bytes>
   ```

   The token works once, for that one path.

3. Say it is there:

   ```
   { "action": "finish_upload", "documentId": "<uuid>" }
   ```

   ```
   { "ok": true, "added": { "name": "transcript.pdf" } }
   ```

   The server checks the real size and the real type from the file's first bytes, and removes a file that fails. Show "Added" with the name. The file does not appear in `data`: the student cannot list or open what they added.

## 5. Deleting the sign-in

```
POST /api/account
authorization: Bearer <access_token>
content-type: application/json

{ "action": "delete_my_signin" }
```

Answers `{ "ok": true, "data": null }`. The email and password are removed and the tokens stop working. The firm's record of the student stays, and the screen must say so before the student confirms. Afterwards forget both tokens and show the sign-in screen.

## 6. Every error, and what to show

| Status | `code` | When | What the app should do |
| --- | --- | --- | --- |
| 401 | `unauthorized` | The access token is missing, expired, or not one Supabase issued | Refresh once and retry. If that fails, sign out and show sign-in |
| 403 | `signin_off` | A counselor turned the sign-in off, or the student was archived. Checked on every request | Show "This sign-in has been turned off. Ask your counselor about it." Keep the session; offer Sign out; try again when the app next comes to the foreground |
| 403 | `not_a_student` | The person signed in is a counselor, or belongs to nothing | Show "This sign-in is not a student's." and Sign out |
| 400 | none | The body is not valid: not JSON, an unknown action, a field of the wrong shape. A bad link in `attach_link` says "That does not look like a link. It should start with https://" | A bug in the app, or that one message. Show the message |
| 404 | none | The task is no longer on the student's list, or the upload was not found | Show the message and fetch the page again |
| 410 | none | The upload took longer than 5 minutes | "That upload took too long. Add the file again." |
| 409 | none | The uploaded file could not be read back from storage | Show the message; the student adds it again |
| 413 | none | The body is over 8,000 bytes, the file is over 25 MB, or there is no room left for more files | Show the message |
| 415 | none | The file is not an allowed type. A file whose contents do not match its type is also refused, with its own message and status | Show the message |
| 429 | none | Too many requests: 60 per student and 120 per address in five minutes, or 10 files in a day | "Too many requests. Wait a few minutes and try again." Do not retry automatically |
| 500 | none | Something failed on the server | "Something went wrong. Please try again." |
| 503 | none | The server is not set up for sign-ins | The same sentence |

A request that gets no JSON back at all (no connection, a gateway page) should show "There is no connection right now. Try again in a moment." Time out after 20 seconds, 60 for the upload steps.

For `/api/account` the failure body always has a `code`: `unauthorized` (401), `forbidden` (403, the sign-in belongs to a firm), `rate_limited` (429), `server` (500).

## 7. What the app must not do

- No analytics, trackers or third-party SDKs that send anything about a student anywhere.
- Collect nothing at sign-in beyond the email address and the password.
- Do not read Supabase tables directly. A student's session can read its own account row and the shared college directory and nothing else; everything the app shows comes from `/api/student`.
- Do not store the page on the device beyond what is needed to draw it, and remove it at sign-out.
