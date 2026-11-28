// Where the counselor is when they ask, as one line for the system prompt.
//
// The browser sends a route from a fixed list and, at most, the kind and id of
// the one record that is open. Nothing else from the browser is used: no
// title, no text. The record is looked up here with the counselor's own
// client, so row level security decides whether it exists for them, and the
// words in the line come from that lookup. An item that is not found, or is
// not theirs, is dropped and only the route is said.

import type { AgentPage, AgentRoute } from '../../shared/agent.js'
import type { Db } from './types.js'

const PLACE: Record<AgentRoute, string> = {
  today: 'on Today',
  inbox: 'on the Inbox',
  students: 'on the Students list',
  student: 'on a student’s page',
  meetings: 'on Meetings',
  messages: 'on Messages',
  documents: 'on Documents',
  templates: 'on Templates',
  settings: 'in Settings',
  firm: 'on the Firm page',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PROPOSAL_WORDS: Record<string, string> = {
  message: 'message drafted by the assistant',
  parent_update: 'parent update drafted by the assistant',
  task: 'task drafted by the assistant',
  profile_change: 'profile change drafted by the assistant',
  meeting_times: 'set of meeting times from the assistant',
  schedule_meeting: 'meeting proposed by the assistant',
  apply_template: 'template proposed by the assistant',
  task_change: 'task change proposed by the assistant',
  add_college: 'college proposed by the assistant',
}

/** What is open, and whose it is: looked up as the counselor. Undefined when it is not there for them. */
async function openItem(user: Db, firmId: string, kind: string, id: string): Promise<{ what: string; studentId: string | null } | undefined> {
  if (!UUID.test(id)) return undefined
  const one = async (table: 'reports' | 'documents' | 'message_drafts' | 'college_list_drafts' | 'weekly_texts' | 'tasks' | 'meetings' | 'agent_proposals', columns: string) => {
    const { data } = await user.from(table).select(columns).eq('id', id).eq('firm_id', firmId).maybeSingle()
    return (data ?? undefined) as unknown as Record<string, string | null> | undefined
  }
  switch (kind) {
    case 'proposal': {
      const row = await one('agent_proposals', 'student_id, kind, status')
      return row && row.status === 'pending' ? { what: `a pending ${PROPOSAL_WORDS[row.kind ?? ''] ?? 'draft from the assistant'}`, studentId: row.student_id } : undefined
    }
    case 'report': {
      const row = await one('reports', 'student_id')
      return row && { what: 'a drafted parent report', studentId: row.student_id }
    }
    case 'essay': {
      const row = await one('documents', 'student_id')
      return row && { what: 'essay feedback waiting for approval', studentId: row.student_id }
    }
    case 'file': {
      const row = await one('documents', 'student_id')
      return row && { what: 'a file waiting to be filed or checked', studentId: row.student_id }
    }
    case 'message_draft': {
      const row = await one('message_drafts', 'student_id')
      return row && { what: 'a message drafted from a template', studentId: row.student_id }
    }
    case 'college_list': {
      const row = await one('college_list_drafts', 'student_id')
      return row && { what: 'a drafted college list', studentId: row.student_id }
    }
    case 'weekly_text': {
      const row = await one('weekly_texts', 'student_id')
      return row && { what: 'a weekly text draft', studentId: row.student_id }
    }
    case 'reminder': {
      const row = await one('tasks', 'student_id')
      return row && { what: 'a pending reminder about one of their tasks', studentId: row.student_id }
    }
    case 'meeting_draft': {
      const row = await one('meetings', 'student_id')
      return row && { what: 'a draft made from a meeting', studentId: row.student_id }
    }
    default:
      return undefined
  }
}

/**
 * "The counselor is on the Inbox, looking at a pending reminder about one of
 * their tasks for Emily Chen." Empty when no page was sent. In a student's
 * thread, an item that belongs to another student is not named.
 */
export async function pageLine(user: Db, firmId: string, page: AgentPage | undefined, threadStudentId: string | null): Promise<string> {
  if (!page) return ''
  const place = `The counselor is ${PLACE[page.route]}`
  if (!page.itemKind || !page.itemId) return `${place}.`
  const item = await openItem(user, firmId, page.itemKind, page.itemId).catch(() => undefined)
  if (!item || (threadStudentId && item.studentId && item.studentId !== threadStudentId)) return `${place}.`
  let whose = ''
  if (item.studentId) {
    const { data } = await user.from('students').select('first_name, last_name').eq('id', item.studentId).eq('firm_id', firmId).maybeSingle()
    if (!data) return `${place}.`
    whose = ` for ${data.first_name} ${data.last_name}`.trimEnd()
  }
  return `${place}, looking at ${item.what}${whose}. "This" or "it" in their message most likely means that.`
}
