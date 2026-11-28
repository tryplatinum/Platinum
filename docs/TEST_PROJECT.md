# A test project

How to run Platinum against a second Supabase project, so sign-up, sends and the assistant can be tried without touching the real one. This page does not create the project and holds no key. You do both yourself.

For looking at screens without any project at all, use the preview instead: `npx vite`, then `http://localhost:5173/preview.html?path=/app`. Saving and sending work there in memory (see `preview.backend.ts`); nothing is stored and nothing is sent.

## 1. Make the project

In the Supabase dashboard, create a new project in the same organization. Call it something that cannot be mistaken for the real one, such as "Platinum test". Note its project ref (the id in its address).

In Authentication → Sign In / Providers → Email, decide about **Confirm email**:

- Off is simplest for testing: sign-up and joining work with no email.
- On is closer to production, but Supabase's built-in email only delivers to addresses on the project's own team, two an hour.

In Authentication → URL Configuration, add `http://localhost:5173/signin` and `http://localhost:5173/reset-password` to Redirect URLs.

## 2. Point `.env.local` at it

Keep your real settings somewhere safe first (for example, copy `.env.local` to `.env.real`, which is ignored by git like every `.env*.local` and `.env` file; check with `git status` that nothing new shows).

In `.env.local`, set these three from the **test** project's Settings → API page:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Leave every `TRANSPORT_*` unset, so nothing can leave: the default transport only logs. To see a message reach "Sent" in Messages, set `ALLOW_LOG_TRANSPORT=true` and put the addresses you will use in `SEND_ALLOWLIST`. Leave `GOOGLE_*` unset unless you are testing Google.

Never commit `.env.local`. The repository is public.

## 3. Push the migration chain to it

The Supabase CLI pushes to whichever project the folder is linked to, so link the test project first:

```
npx supabase link --project-ref <test project ref>
npx supabase migration list --remote
```

The list should show every migration as local only. Then:

```
npm run db:push
```

The CLI asks for confirmation. Read the project name it prints before you answer. Never pass `--yes`.

When you are done testing, **link the real project again** (`npx supabase link --project-ref <real ref>`) and run `npx supabase migration list --remote` to see that you are back. A push made while the wrong project is linked goes to the wrong database.

## 4. Load the sample caseload

```
npm run dev
```

Open `http://localhost:5173/signup`, start a firm, then Settings → Demo data → Reset demo (type RESET). That loads the invented students, parents, tasks, meetings and templates. The college directory is separate and optional: `npm run import:colleges -- --dry-run` shows what it would write; without the flag it needs a College Scorecard key and writes about 2,000 rows.

## 5. The checks that need a database

These create and remove their own rows. Run them only against the test project:

```
npm run test:isolation
npm run test:phone:db
```

`test:ai` and `test:agent` also call Anthropic and cost money.

Then follow `docs/CLICK_THROUGH.md`.
