// In-memory progress for one assistant request. The panel polls it while the
// model works. Nothing here is student content: only a short step label.
// One process only, same as the in-memory rate limit. Entries expire.

const TTL_MS = 5 * 60 * 1000

type Row = { counselorId: string; step: string; at: number }

const rows = new Map<string, Row>()

const TOOL_STEP: Record<string, string> = {
  get_student: 'Reading the profile…',
  list_tasks: 'Checking tasks…',
  list_deadlines: 'Checking deadlines…',
  search_meetings: 'Looking through meetings…',
  list_recent_messages: 'Checking messages…',
  get_notes_to_remember: 'Reading notes…',
  list_students_needing_attention: 'Checking who needs attention…',
  propose_message: 'Drafting the message…',
  propose_parent_update: 'Drafting the message…',
  propose_task: 'Drafting a task…',
  propose_profile_change: 'Drafting a profile change…',
  propose_meeting_times: 'Drafting meeting times…',
  prepare_meeting_brief: 'Preparing the brief…',
  essay_brainstorm: 'Brainstorming…',
}

export function stepFor(toolNames: string[]): string {
  const drafting = toolNames.find((name) => name.startsWith('propose_'))
  if (drafting) return TOOL_STEP[drafting] ?? 'Drafting…'
  if (toolNames.length === 1) return TOOL_STEP[toolNames[0]!] ?? 'Checking the record…'
  return 'Checking the record…'
}

export function setProgress(requestId: string, counselorId: string, step: string) {
  rows.set(requestId, { counselorId, step, at: Date.now() })
}

export function readProgress(requestId: string, counselorId: string): string | null {
  const row = rows.get(requestId)
  if (!row || row.counselorId !== counselorId) return null
  if (Date.now() - row.at > TTL_MS) {
    rows.delete(requestId)
    return null
  }
  return row.step
}

export function clearProgress(requestId: string) {
  rows.delete(requestId)
}
