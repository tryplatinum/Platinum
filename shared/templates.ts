// Templates: a firm's own reusable material. Three kinds in one library: a
// task plan, a message, and a handout. This file is the contract for what a
// template holds and the pure rules for using one: turning offsets into dates
// and filling placeholders. Nothing here calls a model, the network or a clock
// it was not handed. A message template never sends: filling one only makes
// text for a draft a counselor approves.

import { z } from 'zod'

export const TEMPLATE_KINDS = ['task_plan', 'message', 'handout'] as const
export type TemplateKind = (typeof TEMPLATE_KINDS)[number]

export const TEMPLATE_KIND_LABEL: Record<TemplateKind, string> = { task_plan: 'Task plan', message: 'Message', handout: 'Handout' }

/** What each kind is for, said on the Templates page and in its empty states. */
export const TEMPLATE_KIND_PURPOSE: Record<TemplateKind, string> = {
  task_plan: 'A named list of tasks with owners and due dates worked out for each student.',
  message: 'A text or email with blanks that are filled in for each student or parent. It becomes a draft you approve; it never sends itself.',
  handout: 'A worksheet or outline a student works from. Giving one makes a task with the handout attached.',
}

export type TemplateLanguage = 'en' | 'zh-Hans' | 'zh-Hant'

const name = z.string().trim().min(1).max(120)
const line = z.string().trim().min(1).max(200)
const longText = z.string().max(20_000)

// ── Task plan ───────────────────────────────────────────────────────────────

/**
 * When a task is due. `after_assigned`: that many days after the day the plan
 * is applied. `before_date`: that many days before a date the counselor picks
 * when applying it, such as an application deadline.
 */
export const dueOffset = z.object({ from: z.enum(['after_assigned', 'before_date']), days: z.number().int().min(0).max(730) })
export type DueOffset = z.infer<typeof dueOffset>

export const planTask = z.object({
  title: line,
  owner: z.enum(['student', 'parent', 'counselor']),
  due: dueOffset,
  note: z.string().trim().max(1000).optional(),
})
export type PlanTask = z.infer<typeof planTask>

export const taskPlanContent = z.object({
  /** What the picked date is, in the counselor's words: "Application deadline". Asked for only when a task counts back from it. */
  dateLabel: z.string().trim().max(80).optional(),
  tasks: z.array(planTask).min(1).max(60),
})
export type TaskPlanContent = z.infer<typeof taskPlanContent>

// ── Message ─────────────────────────────────────────────────────────────────

export const messageContent = z.object({
  to: z.enum(['student', 'parent']),
  /** For email. Kept with the template and shown on the draft. */
  subject: z.string().trim().max(160).optional(),
  /** One body a language. English is always there; a parent's language is used when it has one. */
  bodies: z.object({ en: longText.min(1), 'zh-Hans': longText.optional(), 'zh-Hant': longText.optional() }),
})
export type MessageContent = z.infer<typeof messageContent>

// ── Handout ─────────────────────────────────────────────────────────────────

export const handoutContent = z.discriminatedUnion('source', [
  /** Written in Platinum. Shown to the student as text. */
  z.object({ source: z.literal('text'), text: longText.min(1) }),
  /** A Google Doc or any page, by its address. */
  z.object({ source: z.literal('link'), url: z.string().trim().url().max(2000).refine((u) => /^https:\/\//i.test(u), 'The address must start with https://'), label: z.string().trim().max(160).optional() }),
])
export type HandoutContent = z.infer<typeof handoutContent>

export type TemplateContent = TaskPlanContent | MessageContent | HandoutContent

const CONTENT = { task_plan: taskPlanContent, message: messageContent, handout: handoutContent } as const

export type ContentResult<K extends TemplateKind = TemplateKind> = { ok: true; value: z.infer<(typeof CONTENT)[K]> } | { ok: false; message: string }

/** Checks a template's content against the shape for its kind. The store refuses to save what fails. */
export function parseTemplateContent<K extends TemplateKind>(kind: K, content: unknown): ContentResult<K> {
  const parsed = CONTENT[kind].safeParse(content)
  if (parsed.success) return { ok: true, value: parsed.data as z.infer<(typeof CONTENT)[K]> }
  const first = parsed.error.issues[0]
  return { ok: false, message: first ? `${first.path.join(' ') || 'Template'}: ${first.message}` : 'This template is not complete.' }
}

export const templateName = (raw: string) => name.safeParse(raw)

// ── Dates ───────────────────────────────────────────────────────────────────

type ISODate = string

const DAY = 86_400_000
/** Whole days added to a calendar date, with no time zone in it: "2026-03-08" plus 1 is "2026-03-09" everywhere. */
export function addDaysISO(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * DAY).toISOString().slice(0, 10)
}

export const planNeedsDate = (plan: TaskPlanContent): boolean => plan.tasks.some((t) => t.due.from === 'before_date')

export interface PlannedTask extends PlanTask {
  /** Undefined when the task counts back from a date that has not been picked. */
  dueDate?: ISODate
  /** The real date is already behind the day the plan is applied. Shown, never hidden: the counselor decides. */
  past: boolean
}

/** Every task of a plan with its real due date for one student. `anchor` is the date the counselor picked, if the plan needs one. */
export function planDates(plan: TaskPlanContent, assignedOn: ISODate, anchor?: ISODate): PlannedTask[] {
  return plan.tasks.map((t) => {
    const dueDate = t.due.from === 'after_assigned' ? addDaysISO(assignedOn, t.due.days) : anchor ? addDaysISO(anchor, -t.due.days) : undefined
    return { ...t, dueDate, past: dueDate !== undefined && dueDate < assignedOn }
  })
}

export const offsetWords = (due: DueOffset, dateLabel = 'the date you pick'): string =>
  due.from === 'after_assigned' ? (due.days === 0 ? 'the day it is assigned' : `${due.days} ${due.days === 1 ? 'day' : 'days'} after it is assigned`) : due.days === 0 ? `on ${dateLabel}` : `${due.days} ${due.days === 1 ? 'day' : 'days'} before ${dateLabel}`

// ── Placeholders ────────────────────────────────────────────────────────────

/**
 * The only blanks a template may hold. Each is filled by code from the
 * student's record; none is written by a model. `student_link` is left as it
 * is: the send path puts the student's own address there (fillStudentLink).
 */
export const PLACEHOLDERS = [
  { key: 'student_first_name', label: 'Student’s first name' },
  { key: 'student_full_name', label: 'Student’s full name' },
  { key: 'parent_name', label: 'Parent’s name' },
  { key: 'counselor_name', label: 'Your name' },
  { key: 'firm_name', label: 'Firm name' },
  { key: 'next_meeting_date', label: 'Date of the next meeting' },
  { key: 'due_date', label: 'A due date you pick' },
  { key: 'student_link', label: 'The student’s link' },
] as const
export type PlaceholderKey = (typeof PLACEHOLDERS)[number]['key']

const KEYS: readonly string[] = PLACEHOLDERS.map((p) => p.key)
export const placeholderToken = (key: PlaceholderKey) => `{{${key}}}`
const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g

/** What the code knows for one recipient. A value left out or empty cannot be filled. */
export type PlaceholderValues = Partial<Record<Exclude<PlaceholderKey, 'student_link'>, string>>

export interface Filled {
  text: string
  /** Why this text must not be approved as it stands. Empty when every blank was filled. */
  problems: string[]
}

/** Every `{{…}}` in a body that is not on the list. The editor shows these before a template is saved. */
export function unknownPlaceholders(body: string): string[] {
  return [...new Set([...body.matchAll(TOKEN)].map((m) => m[1]).filter((k) => !KEYS.includes(k)))]
}

/**
 * Fills the blanks. An unknown blank, or one the code has no value for, stays
 * in the text as written and is named in `problems`, which blocks approval.
 * `toStudent` says whether the student's link may be used: it is only ever
 * filled in a message to the student.
 */
export function fillPlaceholders(body: string, values: PlaceholderValues, toStudent: boolean): Filled {
  const problems = new Set<string>()
  const text = body.replace(TOKEN, (whole, raw: string) => {
    if (!KEYS.includes(raw)) {
      problems.add(`“{{${raw}}}” is not a blank Platinum can fill.`)
      return whole
    }
    const key = raw as PlaceholderKey
    if (key === 'student_link') {
      if (!toStudent) problems.add('The student’s link can only go in a message to the student.')
      // Normalised, so the send path finds it.
      return '{{student_link}}'
    }
    const value = values[key]?.trim()
    if (!value) {
      problems.add(`${PLACEHOLDERS.find((p) => p.key === key)?.label ?? key} is not known for this message.`)
      return whole
    }
    return value
  })
  return { text, problems: [...problems] }
}

/** The body for a recipient's language, and whether the template had one in that language. */
export function bodyFor(content: MessageContent, language: TemplateLanguage): { body: string; language: TemplateLanguage; missing: boolean } {
  const own = content.bodies[language]?.trim()
  if (own) return { body: own, language, missing: false }
  return { body: content.bodies.en, language: 'en', missing: language !== 'en' }
}

/** The outbox kind a template message is queued as. No kind was added for templates: these two already exist. */
export const templateOutboxKind = (to: MessageContent['to']) => (to === 'parent' ? 'parent_report' : 'weekly_text') as 'parent_report' | 'weekly_text'

/** Why a draft's text cannot be approved as it stands: a blank that is still in it. Empty when it can. */
export const draftProblems = (body: string, toStudent: boolean): string[] => (body.trim() ? fillPlaceholders(body, {}, toStudent).problems.map((p) => p.replace(' is not known for this message.', ' is still blank: fill it in or take it out.')) : ['The message is empty.'])
