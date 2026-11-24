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

## Prior — M3 / M3b

Approvals home at `/app`, Activity, reminder skips (`20261131000001`), edit profile/notes/recap, Waiting on other screens. Merged to main.

## Known issues

- Loading the sample does not write the old simulated outbox history.
- The AI rate limit in `server/rateLimit.ts` is still memory inside one function instance.
- The sample caseload still uses real colleges, Common App, CSS Profile, and activity organizations.
- Permanent reminder skips have no Settings UI to re-enable (toast Undo only).

## Next step

Aaron: `npm run db:push` then `npm run db:types`, then `npm run test:agent`. Manual Approvals check after Reset demo. Then M4b panel.
