# Platinum

## Product

Platinum is a web workspace for a college-counseling firm. A counselor signs in on a laptop and keeps that firm's students, families, tasks, colleges, meetings, and essays in the firm's own database. An assistant drafts the follow-through (meeting notes, tasks, parent updates, briefs, reminders), and a person approves every outbound message before it can leave. Students and parents are reached by SMS, email, LINE, and WeChat, plus a thin page opened from a secret link. Sending is not built yet. Until a privacy review, the only people in the product are invented, and a future send goes only to an allowlist of the founders' own numbers and accounts.

## Stack and layout

React, Vite, TypeScript, Tailwind, Zustand, and Zod in the browser. Supabase (Postgres, Auth, row level security) is the backend. Anthropic is called from the server only.

- `src/` — the counselor and student screens, the Zustand store, and the browser Supabase client
- `api/` — the two Vercel functions, `/api/ai` and `/api/student`
- `server/` — the Claude call, prompts, server Supabase clients, and the student-link read
- `shared/` — Zod contracts used by the browser and the server
- `supabase/migrations/` — SQL migrations
- `src/data/seed.ts` and `src/data/fixtures.ts` — the invented sample caseload

## Commands

- `npm run dev` — local app, including `/api/ai` and `/api/student`
- `npm run typecheck` — TypeScript only
- `npm run lint` — ESLint
- `npm run test:notes` — offline checks, no keys and no network
- `npm run db:push` — apply migrations to the linked Supabase project
- `npm run db:types` — regenerate `src/lib/database.types.ts` from that project

`npm run test:ai` calls Anthropic. `npm run test:isolation` creates rows in the linked Supabase project. Do not run either unless the task says so.

## Hard rules

- No secrets in client code. Only `VITE_` variables reach the browser.
- LLM calls happen only on the server.
- Every outbound message goes through approval and the outbox, and is never sent directly.
- Only invented people, schools, hospitals, and organizations in seed data.
- Schema changes are new migration files, never edits to old ones.
- No new state libraries, UI kits, or ORMs without approval.
- Don't touch files outside the current task's scope.

## Workflow

One agent per branch. Run `npm run typecheck`, `npm run lint`, and `npm run test:notes` before reporting done. Report the files changed and how to verify.

At the start of every session, read docs/BUILD_LOG.md. Before ending a session, or when stopping mid-task, update it so a different agent can continue without context.

## Copy and i18n

The UI is English. A parent message is in `en`, `zh-Hans`, or `zh-Hant`, following `Parent.language`. Chinese must read naturally, not like a literal translation.
