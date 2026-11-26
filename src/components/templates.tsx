// Using and editing templates. The Templates page manages the library; these
// windows are how a template is used from where a counselor already is: pick
// one, see exactly what it will make for each student, then make it.
//
// Nothing here sends. A task plan and a handout make ordinary tasks. A message
// template makes drafts for the Inbox, one a recipient, each approved on the
// shared card. Every blank is filled by code from the student's record.

import { Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  PLACEHOLDERS,
  TEMPLATE_KIND_LABEL,
  TEMPLATE_KIND_PURPOSE,
  addDaysISO,
  bodyFor,
  fillPlaceholders,
  offsetWords,
  placeholderToken,
  planDates,
  planNeedsDate,
  templateOutboxKind,
  unknownPlaceholders,
  type HandoutContent,
  type MessageContent,
  type PlaceholderValues,
  type PlanTask,
  type TaskPlanContent,
  type TemplateKind,
} from '../../shared/templates'
import { formatDateLong, todayISO, type ISODate } from '../lib/dates'
import { fullName, nextMeeting } from '../lib/derive'
import { CHANNEL_LABEL, LANGUAGE_LABEL } from '../lib/language'
import type { NewMessageDraft, TemplateTask } from '../store/templates'
import { useData, useStore } from '../store/store'
import type { AppData, ID, OwnerType, Parent, Student, Template } from '../types'
import { Button, Disclosure, Empty, Field, Modal, Note, Pill, cx, inputBase, inputClass, textareaClass, useConfirm, useToast } from './ui'

export const liveTemplates = (data: AppData, kinds?: TemplateKind[]) => (data.templates ?? []).filter((t) => !t.archived && (!kinds || kinds.includes(t.kind)))

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The parent a message "to the parent" goes to: the main contact, or the first on file. */
export const mainParent = (student: Student): Parent | undefined => student.parents.find((p) => p.isPrimary) ?? student.parents[0]

/** What the code knows for one student. Each value comes from the record; none is written by a model. */
export function placeholderValues(data: AppData, student: Student, parent: Parent | undefined, dueDate?: ISODate): PlaceholderValues {
  const meeting = nextMeeting(data, student.id)
  return {
    student_first_name: student.firstName,
    student_full_name: fullName(student),
    parent_name: parent?.name,
    counselor_name: data.firm.counselorName,
    firm_name: data.firm.name,
    next_meeting_date: meeting ? formatDateLong(meeting.date) : undefined,
    due_date: dueDate ? formatDateLong(dueDate) : undefined,
  }
}

/** The draft a message template makes for one student, or why it makes none. */
export function draftFor(data: AppData, template: Template, student: Student, dueDate?: ISODate): { draft?: NewMessageDraft; problems: string[]; skipped?: string } {
  const content = template.content as MessageContent
  const parent = content.to === 'parent' ? mainParent(student) : undefined
  if (content.to === 'parent' && !parent) return { problems: [], skipped: `${student.firstName} has no parent on file.` }
  const language = parent?.language ?? 'en'
  const chosen = bodyFor(content, language)
  const filled = fillPlaceholders(chosen.body, placeholderValues(data, student, parent, dueDate), content.to === 'student')
  return {
    problems: filled.problems,
    draft: {
      studentId: student.id,
      templateId: template.id,
      toKind: content.to,
      parentId: parent?.id,
      toName: parent ? parent.name : fullName(student),
      channel: parent ? parent.channel : (student.preferredChannel ?? 'text'),
      language,
      kind: templateOutboxKind(content.to),
      subject: content.subject?.trim() || undefined,
      body: filled.text,
      untranslated: chosen.missing || undefined,
    },
  }
}

// ── Pick one ────────────────────────────────────────────────────────────────

/** "From a template": the firm's templates of the kinds that fit here. Choosing one hands it back; nothing is made yet. */
export function TemplatePicker({ kinds, title = 'From a template', only, onPick, onClose }: { kinds: TemplateKind[]; title?: string; /** Narrows the list further, for example to messages for a parent. */ only?: (template: Template) => boolean; onPick: (template: Template) => void; onClose: () => void }) {
  const list = liveTemplates(useData(), kinds).filter((t) => !only || only(t))
  return (
    <Modal title={title} onClose={onClose}>
      {list.length === 0 ? (
        <Empty title={`No ${kinds.map((k) => TEMPLATE_KIND_LABEL[k].toLowerCase()).join(' or ')} templates yet. ${TEMPLATE_KIND_PURPOSE[kinds[0]]}`}>
          <Link to="/app/templates" className="tap-link font-semibold text-accent underline">
            Open Templates to make one
          </Link>
        </Empty>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {list.map((t, i) => (
            <li key={t.id}>
              <button type="button" data-autofocus={i === 0 || undefined} onClick={() => onPick(t)} className="flex min-h-11 w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-control px-2 py-2 text-left hover:bg-surface-2">
                <Pill>{TEMPLATE_KIND_LABEL[t.kind]}</Pill>
                <span className="text-sm font-semibold text-heading">{t.name}</span>
                <span className="basis-full text-[13px] text-muted">{summaryOf(t)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

/** One line about what is in a template. */
export function summaryOf(t: Template): string {
  if (t.kind === 'task_plan') {
    const c = t.content as TaskPlanContent
    return `${plural(c.tasks.length, 'task')}${planNeedsDate(c) ? `, counted back from ${c.dateLabel || 'a date you pick'}` : ''}`
  }
  if (t.kind === 'message') {
    const c = t.content as MessageContent
    const langs = (['en', 'zh-Hans', 'zh-Hant'] as const).filter((l) => c.bodies[l]?.trim()).map((l) => LANGUAGE_LABEL[l])
    return `To the ${c.to} · ${langs.join(', ')}`
  }
  const c = t.content as HandoutContent
  return c.source === 'text' ? 'Written in Platinum' : 'A link'
}

// ── Use one ─────────────────────────────────────────────────────────────────

/** What a template will make for these students, shown before anything is made. */
export function ApplyTemplate({ template, students, onClose }: { template: Template; students: Student[]; onClose: () => void }) {
  if (template.kind === 'task_plan') return <ApplyPlan template={template} students={students} onClose={onClose} />
  if (template.kind === 'handout') return <GiveHandout template={template} students={students} onClose={onClose} />
  return <MakeDrafts template={template} students={students} onClose={onClose} />
}

const who = (students: Student[]) => (students.length === 1 ? fullName(students[0]) : plural(students.length, 'student'))

interface Row extends TemplateTask {
  key: string
  past: boolean
}

function ApplyPlan({ template, students, onClose }: { template: Template; students: Student[]; onClose: () => void }) {
  const plan = template.content as TaskPlanContent
  const needsDate = planNeedsDate(plan)
  const today = todayISO()
  const [anchor, setAnchor] = useState('')
  const toast = useToast()
  const confirm = useConfirm()
  const addTemplateTasks = useStore((s) => s.addTemplateTasks)
  /** Rows the counselor changed or removed, by key. Everything else follows the plan and the date. */
  const [edits, setEdits] = useState<Record<string, Partial<Row> | null>>({})

  const rows = useMemo(() => {
    const out: Row[] = []
    for (const s of students) {
      planDates(plan, today, anchor || undefined).forEach((t: PlanTask & { dueDate?: ISODate; past: boolean }, i) => {
        const key = `${s.id}:${i}`
        const edit = edits[key]
        if (edit === null) return
        const parent = t.owner === 'parent' ? mainParent(s) : undefined
        out.push({ key, studentId: s.id, title: t.title, owner: t.owner === 'parent' && !parent ? 'counselor' : t.owner, ownerParentId: parent?.id, dueDate: t.dueDate ?? '', detail: t.note, past: t.past, ...edit })
      })
    }
    return out
  }, [students, plan, today, anchor, edits])
  const patch = (key: string, p: Partial<Row>) => setEdits((e) => ({ ...e, [key]: { ...(e[key] ?? {}), ...p } }))
  const ready = rows.length > 0 && rows.every((r) => r.title.trim() && r.dueDate)
  const total = `${plural(rows.length, 'task')} for ${who(students)}`

  const add = async () => {
    // In bulk, one confirm that states the totals.
    if (students.length > 1 && !(await confirm({ title: 'Add these tasks?', body: `${total}, from the “${template.name}” template. Each is an ordinary task you can change afterwards.`, action: `Add ${plural(rows.length, 'task')}` }))) return
    const n = addTemplateTasks(template.id, rows)
    toast(`Added ${plural(n, 'task')} for ${who(students)}.`)
    onClose()
  }

  const list = (s: Student) => {
    const mine = rows.filter((r) => r.studentId === s.id)
    return (
      <ul className="flex flex-col gap-2">
        {mine.length === 0 && <li className="text-sm text-muted">No tasks left for {s.firstName}.</li>}
        {mine.map((r) => (
          <li key={r.key} className="flex flex-wrap items-end gap-2 rounded-control bg-canvas p-2">
            <Field label="Task" className="min-w-[12rem] flex-1">
              <input className={inputClass} value={r.title} onChange={(e) => patch(r.key, { title: e.target.value })} />
            </Field>
            <Field label="Owner">
              <select
                className={inputBase}
                value={r.owner === 'parent' ? `parent:${r.ownerParentId}` : r.owner}
                onChange={(e) => {
                  const v = e.target.value
                  patch(r.key, v.startsWith('parent:') ? { owner: 'parent', ownerParentId: v.slice(7) } : { owner: v as OwnerType, ownerParentId: undefined })
                }}
              >
                <option value="student">{s.firstName}</option>
                {s.parents.map((p) => (
                  <option key={p.id} value={`parent:${p.id}`}>
                    {p.name}
                  </option>
                ))}
                <option value="counselor">You</option>
              </select>
            </Field>
            <Field label="Due" hint={r.past && r.dueDate < today ? 'Already past' : undefined}>
              <input type="date" className={inputBase} value={r.dueDate} onChange={(e) => patch(r.key, { dueDate: e.target.value })} />
            </Field>
            <Button variant="quiet" className="w-11 px-0!" aria-label={`Remove “${r.title}” for ${s.firstName}`} title="Remove" onClick={() => setEdits((e) => ({ ...e, [r.key]: null }))}>
              <Trash2 size={20} strokeWidth={1.75} className="shrink-0" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <Modal title={`${template.name}: ${who(students)}`} onClose={onClose} wide typed>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">These are the tasks this plan will add, with real dates. Change or remove any row first. Nothing is added until you press the button.</p>
        {needsDate && (
          <Field label={plan.dateLabel || 'The date this plan counts back from'} className="self-start">
            <input type="date" data-autofocus className={inputBase} value={anchor} onChange={(e) => setAnchor(e.target.value)} />
          </Field>
        )}
        {needsDate && !anchor ? (
          <Note>Pick the date above to see each task’s due date.</Note>
        ) : students.length === 1 ? (
          list(students[0])
        ) : (
          students.map((s, i) => (
            <Disclosure key={s.id} label={fullName(s)} count={rows.filter((r) => r.studentId === s.id).length} start={i === 0}>
              {list(s)}
            </Disclosure>
          ))
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-[13px] text-muted">{needsDate && !anchor ? '' : total}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ready} onClick={() => void add()}>
            Add {plural(rows.length, 'task')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function GiveHandout({ template, students, onClose }: { template: Template; students: Student[]; onClose: () => void }) {
  const content = template.content as HandoutContent
  const [due, setDue] = useState(() => addDaysISO(todayISO(), 7))
  const giveHandout = useStore((s) => s.giveHandout)
  const toast = useToast()
  return (
    <Modal title={`${template.name}: ${who(students)}`} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          Each student gets a task, “Complete: {template.name}”, with the handout on it. It shows on their own page with their other tasks. Nothing is sent to anyone.
        </p>
        <HandoutPreview content={content} />
        {content.source === 'link' && <Note>Platinum attaches this link as it is. It does not copy the document or change who can open it: check in Google Docs that each student can.</Note>}
        <Field label="Due" className="self-start">
          <input type="date" data-autofocus className={inputBase} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!due}
            onClick={() => {
              const n = giveHandout(template.id, students.map((s) => s.id), due)
              toast(`Gave “${template.name}” to ${n === 1 ? fullName(students[0]) : plural(n, 'student')}.`)
              onClose()
            }}
          >
            Give to {students.length === 1 ? students[0].firstName : plural(students.length, 'student')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function HandoutPreview({ content }: { content: HandoutContent }) {
  return content.source === 'text' ? (
    <p className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-control bg-canvas p-3 text-sm leading-relaxed">{content.text}</p>
  ) : (
    <p className="break-all rounded-control bg-canvas p-3 text-sm">
      {content.label && <span className="block font-semibold">{content.label}</span>}
      <a href={content.url} target="_blank" rel="noreferrer" className="tap-link font-medium text-accent underline">
        {content.url}
      </a>
    </p>
  )
}

function MakeDrafts({ template, students, onClose }: { template: Template; students: Student[]; onClose: () => void }) {
  const data = useData()
  const content = template.content as MessageContent
  const usesDue = Object.values(content.bodies).some((b) => b?.includes(placeholderToken('due_date')))
  const [due, setDue] = useState('')
  const addMessageDrafts = useStore((s) => s.addMessageDrafts)
  const toast = useToast()
  const made = students.map((s) => ({ student: s, ...draftFor(data, template, s, due || undefined) }))
  const drafts = made.flatMap((m) => (m.draft ? [m.draft] : []))
  const blocked = made.filter((m) => m.draft && m.problems.length > 0).length
  return (
    <Modal title={`${template.name}: ${who(students)}`} onClose={onClose} wide typed>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          This makes {plural(drafts.length, 'draft')} in the Inbox, one for each recipient. <strong className="text-ink">Nothing is sent.</strong> Each one waits there for you to read, change and approve.
        </p>
        {usesDue && (
          <Field label="The due date this message mentions" className="self-start">
            <input type="date" data-autofocus className={inputBase} value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        )}
        <ul className="flex flex-col gap-3">
          {made.map((m) => (
            <li key={m.student.id} className="rounded-control bg-canvas p-3">
              {m.draft ? (
                <>
                  <p className="text-[13px] text-muted">
                    <span className="font-semibold text-ink">{fullName(m.student)}</span> · To {m.draft.toName} · {CHANNEL_LABEL[m.draft.channel]}
                    {m.draft.language !== 'en' && ` · ${LANGUAGE_LABEL[m.draft.language]}`}
                  </p>
                  {m.draft.subject && <p className="mt-1 text-[13px] font-semibold">Subject: {m.draft.subject}</p>}
                  <p lang={m.draft.language} className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {m.draft.body}
                  </p>
                  {m.draft.untranslated && <p className="mt-1 text-[13px] font-medium text-warn">No {LANGUAGE_LABEL[m.student.parents.find((p) => p.id === m.draft?.parentId)?.language ?? 'en']} version in this template: this is the English text.</p>}
                  {m.problems.map((p) => (
                    <p key={p} role="alert" className="mt-1 text-[13px] font-semibold text-bad">
                      {p} The draft cannot be approved until it is filled in.
                    </p>
                  ))}
                </>
              ) : (
                <p className="text-sm text-muted">
                  <span className="font-semibold text-ink">{fullName(m.student)}</span> · No draft: {m.skipped}
                </p>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {blocked > 0 && <span className="mr-auto text-[13px] text-muted">{plural(blocked, 'draft')} will need a blank filled in before it can be approved.</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={drafts.length === 0}
            onClick={() => {
              addMessageDrafts(drafts)
              toast(`${plural(drafts.length, 'draft')} in the Inbox. Nothing was sent.`)
              onClose()
            }}
          >
            Put {plural(drafts.length, 'draft')} in the Inbox
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Make or change one ──────────────────────────────────────────────────────

const EMPTY: Record<TemplateKind, () => Template['content']> = {
  task_plan: () => ({ tasks: [{ title: '', owner: 'student', due: { from: 'after_assigned', days: 7 } }] }),
  message: () => ({ to: 'student', bodies: { en: '' } }),
  handout: () => ({ source: 'text', text: '' }),
}

/** The editor for one template. Saving checks it against the shape for its kind and says what is missing. */
export function TemplateEditor({ template, kind, onClose }: { template?: Template; kind: TemplateKind; onClose: () => void }) {
  const [name, setName] = useState(template?.name ?? '')
  const [content, setContent] = useState<Template['content']>(() => template?.content ?? EMPTY[kind]())
  const [error, setError] = useState<string>()
  const saveTemplate = useStore((s) => s.saveTemplate)
  const toast = useToast()
  const save = () => {
    try {
      const cleaned = kind === 'task_plan' ? { ...(content as TaskPlanContent), tasks: (content as TaskPlanContent).tasks.filter((t) => t.title.trim()) } : content
      saveTemplate({ id: template?.id, kind, name, content: cleaned })
      toast(template ? 'Template saved.' : 'Template made.')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This template could not be saved.')
    }
  }
  return (
    <Modal title={template ? `Edit: ${template.name}` : `New ${TEMPLATE_KIND_LABEL[kind].toLowerCase()}`} onClose={onClose} wide typed>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <p className="text-[13px] text-muted">{TEMPLATE_KIND_PURPOSE[kind]}</p>
        <Field label="Name">
          <input data-autofocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        {kind === 'task_plan' && <PlanFields value={content as TaskPlanContent} onChange={setContent} />}
        {kind === 'message' && <MessageFields value={content as MessageContent} onChange={setContent} />}
        {kind === 'handout' && <HandoutFields value={content as HandoutContent} onChange={setContent} />}
        {error && (
          <p role="alert" className="text-[13px] font-semibold text-bad">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">
            {template ? 'Save' : 'Make template'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function PlanFields({ value, onChange }: { value: TaskPlanContent; onChange: (v: TaskPlanContent) => void }) {
  const set = (i: number, p: Partial<PlanTask>) => onChange({ ...value, tasks: value.tasks.map((t, j) => (j === i ? { ...t, ...p } : t)) })
  const needsDate = planNeedsDate(value)
  return (
    <>
      <ul className="flex flex-col gap-2">
        {value.tasks.map((t, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-control bg-canvas p-2">
            <div className="flex flex-wrap items-end gap-2">
              <Field label={`Task ${i + 1}`} className="min-w-[12rem] flex-1">
                <input className={inputClass} value={t.title} onChange={(e) => set(i, { title: e.target.value })} maxLength={200} />
              </Field>
              <Field label="Owner">
                <select className={inputBase} value={t.owner} onChange={(e) => set(i, { owner: e.target.value as PlanTask['owner'] })}>
                  <option value="student">Student</option>
                  <option value="parent">Parent</option>
                  <option value="counselor">Counselor</option>
                </select>
              </Field>
              <Field label="Days">
                <input type="number" min={0} max={730} className={cx(inputBase, 'w-20')} value={t.due.days} onChange={(e) => set(i, { due: { ...t.due, days: Math.max(0, Math.min(730, Math.round(Number(e.target.value) || 0))) } })} />
              </Field>
              <Field label="Counted">
                <select className={inputBase} value={t.due.from} onChange={(e) => set(i, { due: { ...t.due, from: e.target.value as PlanTask['due']['from'] } })}>
                  <option value="after_assigned">after it is assigned</option>
                  <option value="before_date">before a date you pick</option>
                </select>
              </Field>
              <Button variant="quiet" className="w-11 px-0!" aria-label={`Remove task ${i + 1}`} title="Remove" disabled={value.tasks.length === 1} onClick={() => onChange({ ...value, tasks: value.tasks.filter((_, j) => j !== i) })}>
                <Trash2 size={20} strokeWidth={1.75} className="shrink-0" aria-hidden />
              </Button>
            </div>
            <Field label="Note for the task, if any">
              <input className={inputClass} value={t.note ?? ''} onChange={(e) => set(i, { note: e.target.value || undefined })} maxLength={1000} />
            </Field>
            <p className="text-xs text-muted">Due {offsetWords(t.due, value.dateLabel?.trim() || undefined)}.</p>
          </li>
        ))}
      </ul>
      <Button className="self-start" onClick={() => onChange({ ...value, tasks: [...value.tasks, { title: '', owner: 'student', due: { from: needsDate ? 'before_date' : 'after_assigned', days: 7 } }] })}>
        Add a task
      </Button>
      {needsDate && (
        <Field label="What the picked date is called" hint="Asked for when the plan is used, for example “Application deadline”.">
          <input className={inputClass} value={value.dateLabel ?? ''} onChange={(e) => onChange({ ...value, dateLabel: e.target.value || undefined })} maxLength={80} />
        </Field>
      )}
    </>
  )
}

function MessageFields({ value, onChange }: { value: MessageContent; onChange: (v: MessageContent) => void }) {
  const [lang, setLang] = useState<'en' | 'zh-Hans' | 'zh-Hant'>('en')
  const body = value.bodies[lang] ?? ''
  const setBody = (text: string) => onChange({ ...value, bodies: { ...value.bodies, [lang]: lang === 'en' ? text : text || undefined } })
  const unknown = unknownPlaceholders(Object.values(value.bodies).join(' '))
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Field label="Goes to">
          <select className={inputBase} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value as MessageContent['to'] })}>
            <option value="student">The student</option>
            <option value="parent">The student’s parent</option>
          </select>
        </Field>
        <Field label="Subject, for email" className="min-w-[12rem] flex-1" hint="Kept with the template and shown on the draft.">
          <input className={inputClass} value={value.subject ?? ''} onChange={(e) => onChange({ ...value, subject: e.target.value || undefined })} maxLength={160} />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Language of this version">
          <select className={inputBase} value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}>
            {(['en', 'zh-Hans', 'zh-Hant'] as const).map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABEL[l]}
                {value.bodies[l]?.trim() ? '' : l === 'en' ? ' (needed)' : ' (none yet)'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Add a blank">
          <select
            className={inputBase}
            value=""
            onChange={(e) => {
              if (e.target.value) setBody(`${body}${body && !/\s$/.test(body) ? ' ' : ''}${e.target.value}`)
            }}
          >
            <option value="">Choose one…</option>
            {PLACEHOLDERS.map((p) => (
              <option key={p.key} value={placeholderToken(p.key)}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={`Message in ${LANGUAGE_LABEL[lang]}`} hint={value.to === 'parent' ? 'A parent gets the version in their language. Where there is none, the draft uses the English one and says so.' : undefined}>
        <textarea lang={lang} className={textareaClass} rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <p className="text-xs text-muted">Blanks are filled in by Platinum from each student’s record when the template is used. A blank it cannot fill is shown on the draft and blocks approval.</p>
      {unknown.length > 0 && (
        <p role="alert" className="text-[13px] font-semibold text-bad">
          {unknown.map((u) => `{{${u}}}`).join(', ')} {unknown.length === 1 ? 'is' : 'are'} not on the list of blanks. Use “Add a blank”.
        </p>
      )}
    </>
  )
}

function HandoutFields({ value, onChange }: { value: HandoutContent; onChange: (v: HandoutContent) => void }): ReactNode {
  return (
    <>
      <Field label="The handout is">
        <select className={inputBase} value={value.source} onChange={(e) => onChange(e.target.value === 'text' ? { source: 'text', text: '' } : { source: 'link', url: '' })}>
          <option value="text">Written here</option>
          <option value="link">A link, such as a Google Doc</option>
        </select>
      </Field>
      {value.source === 'text' ? (
        <Field label="Text" hint="Shown to the student as written, line for line.">
          <textarea className={textareaClass} rows={12} value={value.text} onChange={(e) => onChange({ source: 'text', text: e.target.value })} />
        </Field>
      ) : (
        <>
          <Field label="Address" hint="Platinum attaches the link as it is. It does not copy the document or change who can open it.">
            <input className={inputClass} inputMode="url" placeholder="https://docs.google.com/…" value={value.url} onChange={(e) => onChange({ ...value, url: e.target.value })} />
          </Field>
          <Field label="What to call it">
            <input className={inputClass} value={value.label ?? ''} onChange={(e) => onChange({ ...value, label: e.target.value || undefined })} maxLength={160} />
          </Field>
        </>
      )}
    </>
  )
}

/** For lists that say when a task came from a template. */
export const templateNameOf = (data: AppData, id?: ID) => (id ? data.templates?.find((t) => t.id === id)?.name : undefined)
