// Offline checks for templates. No keys, no network, no database.
//   npm run test:templates   (also run by npm run test:notes)
//
// What is checked: offsets become the right dates; blanks are filled by code and
// an unfillable one blocks approval; a message template makes drafts and never
// an outbox row until a counselor approves one; archiving a template leaves
// what was made from it alone; and the migration only adds.

import { readFileSync } from 'node:fs'
import { PLACEHOLDERS, addDaysISO, bodyFor, draftProblems, fillPlaceholders, offsetWords, parseTemplateContent, planDates, planNeedsDate, templateOutboxKind, unknownPlaceholders, type MessageContent, type TaskPlanContent } from '../shared/templates'
import { QUEUE_KINDS } from '../shared/outbox'
import { sampleTemplates } from '../src/data/templateSeed'
import { templateActions } from '../src/store/templates'
import type { AppData, Template } from '../src/types'

let failed = 0
function check(name: string, pass: boolean, detail = ''): void {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

// ── Offsets to dates ────────────────────────────────────────────────────────
{
  const plan: TaskPlanContent = { dateLabel: 'Deadline', tasks: [{ title: 'A', owner: 'student', due: { from: 'after_assigned', days: 14 } }, { title: 'B', owner: 'parent', due: { from: 'before_date', days: 21 } }, { title: 'C', owner: 'counselor', due: { from: 'before_date', days: 0 } }] }
  const dated = planDates(plan, '2026-11-26', '2026-12-31')
  check('14 days after it is assigned', dated[0].dueDate === '2026-12-10')
  check('21 days before the picked date', dated[1].dueDate === '2026-12-10')
  check('0 days before is the date itself', dated[2].dueDate === '2026-12-31')
  check('a plan that counts back says it needs a date', planNeedsDate(plan) && !planNeedsDate({ tasks: [plan.tasks[0]] }))
  check('without the date, counted-back tasks have no date yet and the others do', planDates(plan, '2026-11-26')[1].dueDate === undefined && planDates(plan, '2026-11-26')[0].dueDate === '2026-12-10')
  check('a date already behind is flagged, not hidden', planDates(plan, '2026-12-20', '2026-12-31')[1].past === true && planDates(plan, '2026-12-20', '2026-12-31')[2].past === false)
  check('month and year ends', addDaysISO('2026-12-31', 1) === '2027-01-01' && addDaysISO('2027-03-01', -1) === '2027-02-28' && addDaysISO('2028-03-01', -1) === '2028-02-29')
  check('a daylight-saving change does not lose a day', addDaysISO('2027-03-13', 1) === '2027-03-14' && addDaysISO('2027-03-14', 1) === '2027-03-15' && addDaysISO('2027-11-06', 2) === '2027-11-08')
  check('the offset in words', offsetWords({ from: 'after_assigned', days: 14 }) === '14 days after it is assigned' && offsetWords({ from: 'before_date', days: 1 }, 'the UC deadline') === '1 day before the UC deadline')
}

// ── Blanks ──────────────────────────────────────────────────────────────────
{
  const values = { student_first_name: 'Kevin', student_full_name: 'Kevin Zhang', parent_name: 'Zhang Wei', counselor_name: 'Sarah Lindqvist', firm_name: 'Alder & Vine', next_meeting_date: 'Saturday, Nov 28', due_date: 'Tuesday, Dec 1' }
  const all = PLACEHOLDERS.map((p) => `{{${p.key}}}`).join(' | ')
  const filled = fillPlaceholders(all, values, true)
  check('every blank on the list is filled by code', filled.problems.length === 0 && filled.text === 'Kevin | Kevin Zhang | Zhang Wei | Sarah Lindqvist | Alder & Vine | Saturday, Nov 28 | Tuesday, Dec 1 | {{student_link}}', filled.text)
  check('the student link is left for the send path to fill', filled.text.endsWith('{{student_link}}'))
  const unknown = fillPlaceholders('Hi {{nickname}}', values, true)
  check('an unknown blank is an error and stays in the text', unknown.problems.length === 1 && unknown.text === 'Hi {{nickname}}')
  const unfillable = fillPlaceholders('We meet {{next_meeting_date}}', { ...values, next_meeting_date: undefined }, true)
  check('a blank with no value is an error', unfillable.problems.length === 1 && /next meeting/i.test(unfillable.problems[0]))
  check('the student link in a message to a parent is an error', fillPlaceholders('{{student_link}}', values, false).problems.length === 1)
  check('a draft with a blank left in it has a problem; a clean one has none', draftProblems('Hi {{student_first_name}}', true).length === 1 && draftProblems('Hi Kevin {{student_link}}', true).length === 0 && draftProblems('Hi Kevin {{student_link}}', false).length === 1)
  check('an empty draft has a problem', draftProblems('  ', true).length === 1)
  check('the editor names blanks that are not on the list', unknownPlaceholders('{{student_first_name}} {{pet}} {{ pet }}').join() === 'pet')
  const content: MessageContent = { to: 'parent', bodies: { en: 'Hello', 'zh-Hant': '您好' } }
  check('a parent gets the body in their language', bodyFor(content, 'zh-Hant').body === '您好' && !bodyFor(content, 'zh-Hant').missing)
  check('a missing language falls back to English and says so', bodyFor(content, 'zh-Hans').body === 'Hello' && bodyFor(content, 'zh-Hans').missing && bodyFor(content, 'zh-Hans').language === 'en')
  check('template messages use outbox kinds that already exist', (QUEUE_KINDS as readonly string[]).includes(templateOutboxKind('parent')) && (QUEUE_KINDS as readonly string[]).includes(templateOutboxKind('student')))
}

// ── The contract ────────────────────────────────────────────────────────────
{
  const seeds = sampleTemplates()
  check('six to eight sample templates, all three kinds', seeds.length >= 6 && seeds.length <= 8 && new Set(seeds.map((t) => t.kind)).size === 3, String(seeds.length))
  check('every sample template passes the contract', seeds.every((t) => parseTemplateContent(t.kind, t.content).ok), seeds.filter((t) => !parseTemplateContent(t.kind, t.content).ok).map((t) => t.name).join())
  check('no sample message has a blank that is not on the list', seeds.filter((t) => t.kind === 'message').every((t) => unknownPlaceholders(Object.values((t.content as MessageContent).bodies).join(' ')).length === 0))
  check('a plan with no tasks is refused', !parseTemplateContent('task_plan', { tasks: [] }).ok)
  check('a message with no English body is refused', !parseTemplateContent('message', { to: 'student', bodies: { en: '' } }).ok)
  check('a handout link must be https', !parseTemplateContent('handout', { source: 'link', url: 'javascript:alert(1)' }).ok && !parseTemplateContent('handout', { source: 'link', url: 'http://example.com/a' }).ok && parseTemplateContent('handout', { source: 'link', url: 'https://docs.example.com/a' }).ok)
  check('content of the wrong kind is refused', !parseTemplateContent('handout', seeds.find((t) => t.kind === 'task_plan')!.content).ok)
}

// ── The store's actions, on data in memory ──────────────────────────────────
{
  const student = { id: 's1', firstName: 'Kevin', lastName: 'Zhang', parents: [{ id: 'p1', name: 'Zhang Wei', language: 'zh-Hans', channel: 'wechat', isPrimary: true }] }
  let data = { firm: { name: 'Alder & Vine', counselorName: 'Sarah Lindqvist' }, students: [student], tasks: [], activity: [], outbox: [], templates: sampleTemplates(), messageDrafts: [] } as unknown as AppData
  const sent: { body: string; kind: string; trigger: string; note?: string }[] = []
  const actions = templateActions({
    get: () => ({ data, account: { status: 'ready', userId: 'u1' }, sendMessage: (m) => (sent.push(m), `m${sent.length}`) }),
    change: (fn) => {
      data = fn(data)
    },
    batch: (work) => work(),
    log: (d, studentId, text) => ({ ...d, activity: [{ id: `a${d.activity.length}`, at: '', studentId, actor: 'counselor', text }, ...d.activity] }),
  })
  const tpl = (name: string) => data.templates.find((t) => t.name === name) as Template

  // A message template makes drafts, never an outbox row.
  const welcome = tpl('Welcome to the family')
  const batch = actions.addMessageDrafts([{ studentId: 's1', templateId: welcome.id, toKind: 'parent', parentId: 'p1', toName: 'Zhang Wei', channel: 'wechat', language: 'zh-Hans', kind: 'parent_report', body: 'Zhang Wei您好' }])
  check('a message template makes a pending draft', Boolean(batch) && data.messageDrafts.length === 1 && data.messageDrafts[0].status === 'draft')
  check('…and no outbox row, and nothing is handed to sendMessage', data.outbox.length === 0 && sent.length === 0)
  const id = data.messageDrafts[0].id
  actions.updateMessageDraft(id, { body: 'Hello {{parent_name}}' })
  let refused = ''
  try {
    actions.approveMessageDraft(id)
  } catch (e) {
    refused = e instanceof Error ? e.message : 'threw'
  }
  check('a draft with a blank in it cannot be approved', refused !== '' && sent.length === 0 && data.messageDrafts[0].status === 'draft', refused)
  actions.updateMessageDraft(id, { body: 'Zhang Wei您好，欢迎。' })
  const messageId = actions.approveMessageDraft(id)
  check('approving queues it once, through sendMessage, as an approved send', sent.length === 1 && messageId === 'm1' && sent[0].trigger === 'approved' && sent[0].kind === 'parent_report' && sent[0].body === 'Zhang Wei您好，欢迎。')
  check('…and marks the draft approved with who and when', data.messageDrafts[0].status === 'approved' && data.messageDrafts[0].approval?.by === 'Sarah Lindqvist')
  let twice = false
  try {
    actions.approveMessageDraft(id)
  } catch {
    twice = true
  }
  check('a decided draft cannot be approved again', twice && sent.length === 1)
  actions.addMessageDrafts([{ studentId: 's1', toKind: 'student', toName: 'Kevin Zhang', channel: 'text', language: 'en', kind: 'weekly_text', body: 'Hi Kevin' }])
  const other = data.messageDrafts[1].id
  actions.discardMessageDraft(other)
  check('discarding sends nothing', data.messageDrafts[1].status === 'discarded' && sent.length === 1)

  // A task plan makes ordinary tasks, marked with the template.
  const plan = tpl('Onboarding a new junior')
  const n = actions.addTemplateTasks(plan.id, [{ studentId: 's1', title: 'Send your transcript', owner: 'student', dueDate: '2026-12-03' }, { studentId: 's1', title: 'Share the tax return', owner: 'parent', ownerParentId: 'p1', dueDate: '2026-12-17' }, { studentId: 'nobody', title: 'X', owner: 'student', dueDate: '2026-12-01' }])
  check('a task plan adds ordinary tasks marked with the template', n === 3 && data.tasks.length === 2 && data.tasks.every((t) => t.templateId === plan.id && t.source === 'counselor' && t.status === 'todo'))
  check('a task for a student who is not there is not made', !data.tasks.some((t) => t.studentId === 'nobody'))
  check('applying a plan sends nothing', sent.length === 1 && data.outbox.length === 0)

  // A handout becomes a task with the handout on it.
  const sheet = tpl('Essay brainstorm sheet')
  actions.giveHandout(sheet.id, ['s1'], '2026-12-05')
  const given = data.tasks.at(-1)!
  check('a handout becomes a task "Complete: <name>" for the student', given.title === 'Complete: Essay brainstorm sheet' && given.owner === 'student' && given.templateId === sheet.id && given.dueDate === '2026-12-05')
  check('a handout written in Platinum is the task’s own text', Boolean(given.detail?.includes('Essay brainstorm')))
  const linkId = actions.saveTemplate({ kind: 'handout', name: 'Activities worksheet', content: { source: 'link', url: 'https://docs.example.com/worksheet', label: 'Activities worksheet' } })
  actions.giveHandout(linkId, ['s1'], '2026-12-06')
  check('a linked handout is attached to the task as a link', data.tasks.at(-1)!.attachments.length === 1 && data.tasks.at(-1)!.attachments[0].url === 'https://docs.example.com/worksheet' && data.tasks.at(-1)!.attachments[0].kind === 'link')

  // Archive is not delete.
  const before = data.tasks.length
  actions.archiveTemplate(plan.id, true)
  check('an archived template is still there, marked archived', data.templates.some((t) => t.id === plan.id && t.archived))
  check('tasks made from it are untouched and still point at it', data.tasks.length === before && data.tasks.filter((t) => t.templateId === plan.id).length === 2)
  actions.archiveTemplate(plan.id, false)
  check('it can be brought back', data.templates.some((t) => t.id === plan.id && !t.archived))
  const copy = actions.duplicateTemplate(plan.id)
  check('a duplicate is a new template with the same content', Boolean(copy) && copy !== plan.id && data.templates.find((t) => t.id === copy)?.name === 'Onboarding a new junior (copy)')
  let bad = ''
  try {
    actions.saveTemplate({ kind: 'message', name: '  ', content: { to: 'student', bodies: { en: 'Hi' } } })
  } catch (e) {
    bad = e instanceof Error ? e.message : 'threw'
  }
  check('a template with no name is not saved', bad !== '')
}

// ── The migration only adds ─────────────────────────────────────────────────
{
  const dir = new URL('../supabase/migrations/', import.meta.url)
  const sql = readFileSync(new URL('20261206000001_templates.sql', dir), 'utf8')
  const old = readFileSync(new URL('20261128000001_outbox_queue.sql', dir), 'utf8')
  const list = (text: string, name: string) => (text.match(new RegExp(`${name} constant text\\[\\] := array\\[([^\\]]*)\\]`))?.[1] ?? '').split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean)
  const outside = sql.slice(0, sql.indexOf('create or replace function public.apply_changes'))
  check('outside apply_changes the migration drops, truncates, deletes and updates nothing', !/\b(drop|truncate|delete\s+from|update\s+public)\b/i.test(outside.replace(/--.*$/gm, '')))
  check('apply_changes still upserts every table it did, in the same order', list(old, 'upsert_order').join() === list(sql, 'upsert_order').filter((t) => t !== 'templates' && t !== 'message_drafts').join())
  check('…with templates before tasks, and message_drafts added', list(sql, 'upsert_order').indexOf('templates') < list(sql, 'upsert_order').indexOf('tasks') && list(sql, 'upsert_order').includes('message_drafts'))
  check('its delete list is unchanged: templates and drafts are never deleted', list(old, 'delete_order').join() === list(sql, 'delete_order').join())
  check('the rest of apply_changes is word for word what it was', (() => {
    const body = (text: string) => text.slice(text.indexOf('create or replace function public.apply_changes')).split('\n$$;')[0].replace(/upsert_order constant text\[\] := array\[[^\]]*\];/, '')
    return body(old) === body(sql)
  })())
  check('no delete policy or grant on the new tables', !/for delete/.test(outside.replace(/--.*$/gm, '')) && !/grant[^;]*delete/i.test(outside.replace(/--.*$/gm, '')))
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
