// Reply chips. Built only from records a tool returned on this turn.
// The model's own `sources` arrays on propose_* calls are not read here.

import type { AgentTurnSource } from '../../shared/agent.js'
import { joinAssistantText } from './text.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LIMIT = 12

function chip(kind: string, id: string, detail: string): AgentTurnSource | undefined {
  const name = kind.trim()
  const record = id.trim()
  const text = detail.replace(/\s+/g, ' ').trim()
  if (!name || !record || !text) return undefined
  const titled = name.charAt(0).toUpperCase() + name.slice(1)
  const short = text.length > 80 ? `${text.slice(0, 77)}…` : text
  return { kind: name, id: record, label: `${titled} · ${short}` }
}

function shortDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return iso
  const month = MONTHS[Number(match[2]) - 1]
  const day = Number(match[3])
  if (!month || !day) return iso
  return `${month} ${day}`
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function asList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const row = asRecord(item)
    return row ? [row] : []
  }) : []
}

function idOf(row: Record<string, unknown>): string {
  return typeof row.id === 'string' ? row.id : ''
}

/** Records cited by one successful tool result. Unknown tools cite nothing. */
export function sourcesFromTool(name: string, data: unknown): AgentTurnSource[] {
  const out: AgentTurnSource[] = []
  const push = (source: AgentTurnSource | undefined) => {
    if (source) out.push(source)
  }
  if (name === 'get_student') {
    const row = asRecord(data)
    if (row) push(chip('student', idOf(row), `${String(row.firstName ?? '')} ${String(row.lastName ?? '')}`.trim()))
  } else if (name === 'list_tasks') {
    for (const row of asList(data)) push(chip('task', idOf(row), String(row.title ?? '')))
  } else if (name === 'list_deadlines') {
    for (const row of asList(data)) {
      const kind = row.kind === 'college' ? 'college' : 'task'
      push(chip(kind, idOf(row), String(row.label ?? '')))
    }
  } else if (name === 'search_meetings') {
    for (const row of asList(data)) {
      const when = typeof row.date === 'string' ? shortDate(row.date) : String(row.title ?? '')
      push(chip('meeting', idOf(row), when))
    }
  } else if (name === 'list_recent_messages') {
    for (const row of asList(data)) push(chip('message', idOf(row), String(row.toName ?? row.kind ?? '')))
  } else if (name === 'get_notes_to_remember') {
    for (const row of asList(data)) push(chip('note', idOf(row), String(row.text ?? '')))
  } else if (name === 'list_students_needing_attention') {
    for (const row of asList(data)) push(chip('student', idOf(row), String(row.name ?? '')))
  } else if (name === 'find_students') {
    for (const row of asList(asRecord(data)?.matches)) push(chip('student', idOf(row), String(row.name ?? '')))
  } else if (name === 'list_pending_review') {
    for (const row of asList(asRecord(data)?.waiting)) push(chip('waiting', String(row.key ?? ''), `${String(row.kind ?? '')}${row.student ? `, ${String(row.student)}` : ''}`))
  } else if (name === 'list_meetings') {
    for (const row of asList(asRecord(data)?.meetings)) push(chip('meeting', idOf(row), `${typeof row.date === 'string' ? shortDate(row.date) : ''}${row.student ? `, ${String(row.student)}` : ''}`))
  } else if (name === 'list_reminders_due') {
    for (const row of asList(asRecord(data)?.due)) push(chip('task', String(row.taskId ?? ''), String(row.task ?? '')))
    for (const row of asList(asRecord(data)?.alreadySent)) push(chip('message', idOf(row), String(row.to ?? '')))
  } else if (name === 'list_files') {
    for (const row of asList(asRecord(data)?.files)) push(chip('file', idOf(row), String(row.title ?? '')))
    for (const row of asList(asRecord(data)?.tasksMissingADocument)) push(chip('task', idOf(row), String(row.title ?? '')))
  } else if (name === 'list_college_list') {
    for (const row of asList(data)) push(chip('college', idOf(row), String(row.name ?? '')))
  } else if (name === 'list_essays') {
    for (const row of asList(data)) push(chip('essay', idOf(row), String(row.name ?? '')))
  } else if (name === 'list_templates') {
    for (const row of asList(data)) push(chip('template', idOf(row), String(row.name ?? '')))
  } else if (name === 'list_calendar') {
    for (const row of asList(asRecord(data)?.events)) push(chip('event', idOf(row), `${typeof row.date === 'string' ? shortDate(row.date) : ''} ${String(row.title ?? '')}`))
  } else if (name === 'prepare_meeting_brief') {
    const row = asRecord(data)
    if (row) {
      const when = typeof row.meetingDate === 'string' ? shortDate(row.meetingDate) : String(row.meetingTitle ?? '')
      push(chip('meeting', typeof row.meetingId === 'string' ? row.meetingId : '', when))
    }
  }
  return out
}

export function dedupeSources(sources: AgentTurnSource[], limit = LIMIT): AgentTurnSource[] {
  const seen = new Set<string>()
  const out: AgentTurnSource[] = []
  for (const source of sources) {
    const key = `${source.kind}:${source.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(source)
    if (out.length >= limit) break
  }
  return out
}

function parseBody(content: unknown): unknown {
  if (typeof content !== 'string') return content
  try {
    return JSON.parse(content) as unknown
  } catch {
    return undefined
  }
}

/** Tool names from an assistant message, keyed by the tool-use id. */
export function toolNamesIn(content: unknown): Map<string, string> {
  const names = new Map<string, string>()
  if (!Array.isArray(content)) return names
  for (const block of content) {
    const row = asRecord(block)
    if (row?.type === 'tool_use' && typeof row.id === 'string' && typeof row.name === 'string') names.set(row.id, row.name)
  }
  return names
}

/** Sources from a stored tool-role message. `names` comes from the assistant turn that called them. */
export function sourcesFromStoredTools(content: unknown, names: Map<string, string>): AgentTurnSource[] {
  if (!Array.isArray(content)) return []
  const out: AgentTurnSource[] = []
  for (const block of content) {
    const row = asRecord(block)
    if (!row || row.type !== 'tool_result' || row.is_error === true) continue
    const name = typeof row.tool_use_id === 'string' ? names.get(row.tool_use_id) : undefined
    if (!name) continue
    const body = parseBody(row.content)
    const errorOnly = asRecord(body)
    if (errorOnly && 'error' in errorOnly && Object.keys(errorOnly).length === 1) continue
    out.push(...sourcesFromTool(name, body))
  }
  return out
}

/** Visible text of a stored user or assistant message. Tool-use blocks contribute nothing. */
export function textFromContent(content: unknown): string {
  if (typeof content === 'string') return joinAssistantText([content])
  if (!Array.isArray(content)) return ''
  return joinAssistantText(
    content.map((block) => {
      const row = asRecord(block)
      return row?.type === 'text' && typeof row.text === 'string' ? row.text : ''
    }),
  )
}
