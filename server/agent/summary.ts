// Compact facts for a student thread, read with the counselor's token. The
// header is short on purpose (well under 400 tokens) so a question it already
// answers does not need a tool round.

import { channelsFor, sendableNames, transportCaps, type ChannelState } from './channels.js'
import type { Db } from './types.js'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysLate(due: string, today: string): number {
  return Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000)
}

type ParentRow = {
  id: string
  name: string
  relationship: string
  language: string
  channel: string
  email: string | null
  phone: string | null
  line_id: string | null
  local_name: string | null
}

function parentLine(parent: ParentRow, states: ChannelState[]): string {
  const can = sendableNames(states)
  const who = `- ${parent.name} (${parent.relationship}), ${parent.language}, id ${parent.id}`
  const named = parent.local_name?.trim() ? '' : ' No local name on record.'
  if (can.length === 0) return `${who}. no sendable channel.${named}`
  return `${who}. Send on: ${can.join(', ')}.${named}`
}

/** One block the system prompt can carry. Empty string when there is no such student. */
export async function buildStudentHeader(user: Db, firmId: string, counselorId: string, studentId: string): Promise<string> {
  const today = todayISO()
  const [student, parents, tasks, meetings, caps] = await Promise.all([
    user.from('students').select('first_name, last_name, grad_year, school, gpa, activities').eq('id', studentId).eq('firm_id', firmId).maybeSingle(),
    user.from('parents').select('id, name, relationship, language, channel, email, phone, line_id, local_name').eq('student_id', studentId),
    user.from('tasks').select('title, due_date, status').eq('student_id', studentId),
    user.from('meetings').select('id, title, date, status').eq('student_id', studentId).eq('status', 'scheduled').gte('date', today).order('date').limit(1),
    transportCaps(firmId, counselorId),
  ])
  if (!student.data) return ''

  const open = (tasks.data ?? []).filter((task) => task.status === 'todo' || task.status === 'in_progress')
  const overdue = open.filter((task) => task.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date))
  const upcoming = open.filter((task) => task.due_date >= today).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 3)
  const activities = activityNames(student.data.activities)

  const people = (parents.data ?? []).map((parent) =>
    parentLine(
      parent,
      channelsFor({ email: parent.email, phone: parent.phone, lineId: parent.line_id }, caps),
    ),
  )
  const lines = [
    `Student: ${student.data.first_name} ${student.data.last_name}, class of ${student.data.grad_year}${student.data.school ? `, ${student.data.school}` : ''}${student.data.gpa ? `, GPA ${student.data.gpa}` : ''}.`,
    people.length ? `Parents:\n${people.join('\n')}` : 'Parents: none on the record.',
    activities ? `Activities: ${activities}.` : 'Activities: none on the record.',
    `Open tasks: ${open.length}. Overdue: ${overdue.length}.`,
    overdue.length ? `Overdue: ${overdue.slice(0, 5).map((task) => `${task.title} (${daysLate(task.due_date, today)} days late)`).join('; ')}.` : 'Overdue: none.',
    upcoming.length ? `Next deadlines: ${upcoming.map((task) => `${task.title} on ${task.due_date}`).join('; ')}.` : 'Next deadlines: none.',
    meetings.data?.[0]
      ? `Next meeting: ${meetings.data[0].title} on ${meetings.data[0].date}. id ${meetings.data[0].id}. For a meeting prep, call prepare_meeting_brief with this id and no other tool.`
      : 'Next meeting: none scheduled.',
  ]
  return lines.join('\n')
}

function activityNames(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const row = item as { name?: unknown; role?: unknown }
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      const role = typeof row.role === 'string' ? row.role.trim() : ''
      return name ? (role ? `${name} (${role})` : name) : ''
    })
    .filter(Boolean)
    .slice(0, 4)
    .join('; ')
}
