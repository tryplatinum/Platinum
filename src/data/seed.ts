// The seed dataset. Every person, school and document here is invented.
// NEVER put real student data in this file: the students are minors.
//
// All dates are offsets from today (d(-3) = three days ago), so the demo never
// looks stale. buildSeed() is called on first load, on "Reset demo", and when
// the calendar day changes (see store.ts).
//
// NOTE: The Chinese text was written by a non-native speaker and needs a
// native review before it is shown to a Mandarin-speaking parent or counselor.

import { addDays, formatDate, formatDateZh, timestampAt, todayISO } from '../lib/dates'
import type {
  ActivityEvent,
  Actor,
  AppData,
  ApplicationPlan,
  Attachment,
  Channel,
  CollegeApp,
  CollegeStatus,
  DocumentKind,
  ID,
  Language,
  Meeting,
  OutboxMessage,
  OwnerType,
  ParentReport,
  ReminderRule,
  Student,
  StudentDocument,
  Task,
  TaskCategory,
} from '../types'
import {
  IDS,
  KEVIN_ESSAY_PROMPT,
  KEVIN_ESSAY_TEXT,
  SOPHIA_ESSAY_PROMPT,
  SOPHIA_ESSAY_TEXT,
  kevinMeetingDrafts,
} from './fixtures'

export const DEFAULT_REMINDER_RULES: ReminderRule[] = [
  {
    id: 'student_upcoming',
    label: 'Remind students before a task is due',
    description: 'A short nudge to the student ahead of the due date.',
    days: 2,
    mode: 'automatic',
  },
  {
    id: 'student_late',
    label: 'Remind students when a task is late',
    description: 'Sent the day after a due date passes, then every few days.',
    days: 1,
    mode: 'automatic',
  },
  {
    id: 'parent_upcoming',
    label: 'Remind parents before their own task is due',
    description: 'Only for tasks a parent owns, in their language, on their channel.',
    days: 2,
    mode: 'automatic',
  },
  {
    id: 'parent_late',
    label: 'Remind parents when their own task is late',
    description: 'Only for tasks a parent owns.',
    days: 1,
    mode: 'needs_approval',
  },
  {
    id: 'parent_escalation',
    label: 'Tell parents when their student falls behind',
    description: 'When a student’s task is this many days late, let the primary parent know.',
    days: 3,
    mode: 'needs_approval',
  },
]

export function buildSeed(): AppData {
  const today = todayISO()
  const d = (offset: number) => addDays(today, offset)
  const en = (offset: number) => formatDate(d(offset))
  const zh = (offset: number) => formatDateZh(d(offset))
  const now = new Date()
  const senior = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear()

  const tasks: Task[] = []
  const meetings: Meeting[] = []
  const colleges: CollegeApp[] = []
  const documents: StudentDocument[] = []
  const reports: ParentReport[] = []
  const outbox: OutboxMessage[] = []
  const activity: ActivityEvent[] = []

  let counter = 0
  const nid = (prefix: string) => `${prefix}-${++counter}`

  // ── Small builders so the data below reads like a caseload, not like JSON ──

  type TaskOpts = Partial<Pick<Task, 'detail' | 'status' | 'progressNote' | 'ownerParentId' | 'attachments' | 'id'>> & {
    /** Offset of the day it was completed. Marks the task done. */
    doneOn?: number
  }
  const task = (
    studentId: ID,
    title: string,
    category: TaskCategory,
    owner: OwnerType,
    due: number,
    opts: TaskOpts = {},
  ) => {
    const { doneOn, ...rest } = opts
    tasks.push({
      id: nid('t'),
      studentId,
      title,
      category,
      owner,
      dueDate: d(due),
      status: doneOn !== undefined ? 'done' : 'todo',
      completedOn: doneOn !== undefined ? d(doneOn) : undefined,
      createdOn: d(Math.min(due, doneOn ?? due) - 14),
      source: 'counselor',
      attachments: [],
      ...rest,
    })
  }
  const link = (name: string, url: string, on: number, by: Actor = 'student'): Attachment => ({
    id: nid('a'),
    kind: 'link',
    name,
    url,
    addedOn: d(on),
    addedBy: by,
  })

  const college = (
    studentId: ID,
    name: string,
    plan: ApplicationPlan,
    deadline: number,
    status: CollegeStatus,
    fit: CollegeApp['fit'],
    note?: string,
  ) => colleges.push({ id: nid('c'), studentId, name, plan, deadline: d(deadline), status, fit, note })

  const doc = (
    studentId: ID,
    name: string,
    kind: DocumentKind,
    on: number,
    by: Actor,
    extra: Partial<StudentDocument> = {},
  ) => documents.push({ id: nid('doc'), studentId, name, kind, addedOn: d(on), addedBy: by, ...extra })

  const met = (
    studentId: ID,
    title: string,
    on: number,
    time: string,
    extra: Partial<Meeting> = {},
  ) =>
    meetings.push({
      id: nid('m'),
      studentId,
      title,
      date: d(on),
      time,
      durationMin: 45,
      status: on < 0 ? 'completed' : 'scheduled',
      aiAttended: true,
      ...extra,
    })
  const recap = (summary: string, nextSteps: string[]) => ({ recap: { summary, nextSteps, review: 'approved' as const } })

  /** A report that already went out: adds the report and its log entry. */
  const sentReport = (
    student: Student,
    parentId: ID,
    on: number,
    subject: string,
    bodyEn: string,
    bodyLocal?: string,
  ) => {
    const parent = student.parents.find((p) => p.id === parentId)!
    reports.push({
      id: nid('r'),
      studentId: student.id,
      parentId,
      createdOn: d(on),
      status: 'sent',
      language: parent.language,
      channel: parent.channel,
      subject,
      bodyEn,
      bodyLocal,
      sentOn: d(on),
    })
    outbox.push({
      id: nid('o'),
      sentAt: timestampAt(on, '17:40'),
      studentId: student.id,
      toKind: 'parent',
      toName: parent.name,
      parentId,
      channel: parent.channel,
      language: parent.language,
      kind: 'parent_report',
      body: bodyLocal ?? bodyEn,
      bodyEn: bodyLocal ? bodyEn : undefined,
      trigger: 'approved',
    })
  }

  const sent = (
    studentId: ID,
    on: number,
    time: string,
    to: { kind: 'student' | 'parent'; name: string; parentId?: ID; channel: Channel; language: Language },
    kind: OutboxMessage['kind'],
    body: string,
    bodyEn?: string,
  ) =>
    outbox.push({
      id: nid('o'),
      sentAt: timestampAt(on, time),
      studentId,
      toKind: to.kind,
      toName: to.name,
      parentId: to.parentId,
      channel: to.channel,
      language: to.language,
      kind,
      body,
      bodyEn,
      trigger: 'automatic',
    })

  const did = (studentId: ID, on: number, time: string, actor: Actor, text: string) =>
    activity.push({ id: nid('ev'), at: timestampAt(on, time), studentId, actor, text })

  const gdoc = (slug: string) => `https://docs.google.com/document/d/demo-${slug}/edit`

  // ══ 1. Kevin Zhang: senior, badly behind. The demo's main character. ══════

  const kevin: Student = {
    id: IDS.kevin,
    firstName: 'Kevin',
    lastName: 'Zhang',
    localName: '张凯文',
    gradYear: senior,
    school: 'Westmont Ridge High School',
    city: 'Cupertino, CA',
    email: 'kevin.zhang@example.com',
    gpa: 3.78,
    gpaWeighted: 4.31,
    tests: {
      sat: 1490,
      aps: [
        { subject: 'Calculus BC', score: 5 },
        { subject: 'Computer Science A', score: 5 },
        { subject: 'Physics 1', score: 4 },
      ],
    },
    majors: ['Computer Science', 'Data Science'],
    interests: ['Robotics', 'Competitive programming', 'Teaching'],
    activities: [
      { id: 'act-kevin-1', name: 'FRC Robotics Team 8841', role: 'Software lead', detail: 'Leads six programmers; Innovation in Control award at regionals.' },
      { id: 'act-kevin-2', name: 'USACO', role: 'Gold division' },
      { id: 'act-kevin-3', name: 'Math Club', role: 'Treasurer' },
    ],
    counselorNotes:
      'Very strong technically, avoids writing until the last minute. Works best with short deadlines and one specific ask at a time. Dad makes the financial decisions and is slow on WeChat: voice messages get answered, long texts do not. Mom replies the same day.',
    onboardedOn: d(-410),
    parents: [
      {
        id: IDS.kevinDad,
        name: 'Zhang Wei',
        localName: '张伟',
        relationship: 'Father',
        language: 'zh-Hans',
        channel: 'wechat',
        contact: 'WeChat: zhangwei_sv',
        note: 'Slow to reply. Travels to Shenzhen often. Decides on finances.',
      },
      {
        id: IDS.kevinMom,
        name: 'Liu Min',
        localName: '刘敏',
        relationship: 'Mother',
        language: 'zh-Hans',
        channel: 'wechat',
        contact: 'WeChat: liumin0612',
        note: 'Replies same day. Good backchannel to Dad.',
      },
    ],
  }

  task(kevin.id, 'Upload 2025 tax return for the CSS Profile', 'financial', 'parent', -10, {
    ownerParentId: IDS.kevinDad,
    detail: 'NYU needs the CSS Profile by the ED2 deadline. Two reminders sent, no reply yet.',
  })
  task(kevin.id, 'UC PIQ 3 and 4: first drafts', 'essay', 'student', -8, {
    detail: 'PIQ 3 (greatest talent or skill) and PIQ 4 (educational opportunity or barrier). 350 words each.',
  })
  task(kevin.id, 'Common App personal statement: third draft', 'essay', 'student', -5, {
    status: 'in_progress',
    progressNote: 'Stuck on the middle section. Not sure what to cut.',
    attachments: [link('Personal statement (Google Doc)', gdoc('kevin-ps'), -9)],
  })
  task(kevin.id, 'Ask Ms. Brandt (AP CSA) to upload her recommendation', 'recommendation', 'student', -3)
  task(kevin.id, 'Finish UC activities and awards section', 'application', 'student', 2, { status: 'in_progress' })
  task(kevin.id, 'Pay UC application fees (4 campuses)', 'financial', 'parent', 5, { ownerParentId: IDS.kevinMom })
  task(kevin.id, 'Submit UC application', 'application', 'student', 6)
  task(kevin.id, 'Send Kevin’s family the NYU cost estimate', 'financial', 'counselor', 2)
  task(kevin.id, 'Carnegie Mellon supplements: three short essays', 'essay', 'student', 20)
  task(kevin.id, 'Georgia Tech “Why this major” essay', 'essay', 'student', 24)
  task(kevin.id, 'Finalize college list with parents', 'planning', 'student', -32, { doneOn: -30 })
  task(kevin.id, 'Common App: profile, family and education sections', 'application', 'student', -26, { doneOn: -25 })
  task(kevin.id, 'Submit UIUC and Purdue Early Action applications', 'application', 'student', -22, { doneOn: -22 })
  task(kevin.id, 'UC PIQ 1 and 2: final drafts', 'essay', 'student', -16, {
    doneOn: -15,
    attachments: [link('UC PIQs (Google Doc)', gdoc('kevin-piq'), -15)],
  })
  task(kevin.id, 'Brag sheet for recommenders', 'recommendation', 'student', -45, { doneOn: -41 })

  college(kevin.id, 'UIUC (Grainger)', 'EA', -22, 'submitted', 'Target', 'CS + Math')
  college(kevin.id, 'Purdue', 'EA', -22, 'submitted', 'Target')
  college(kevin.id, 'UC Berkeley', 'UC', 6, 'in_progress', 'Reach', 'EECS')
  college(kevin.id, 'UC San Diego', 'UC', 6, 'in_progress', 'Target')
  college(kevin.id, 'UC Irvine', 'UC', 6, 'in_progress', 'Likely')
  college(kevin.id, 'UC Santa Barbara', 'UC', 6, 'in_progress', 'Likely')
  college(kevin.id, 'NYU (Tandon)', 'ED2', 12, 'in_progress', 'Target', 'ED2 choice. Waiting on Dad for cost sign-off.')
  college(kevin.id, 'Carnegie Mellon (SCS)', 'RD', 40, 'in_progress', 'Reach')
  college(kevin.id, 'Georgia Tech', 'RD', 41, 'in_progress', 'Reach')
  college(kevin.id, 'Northeastern', 'RD', 40, 'considering', 'Target')

  doc(kevin.id, 'Personal statement, draft 2', 'essay', -9, 'student', {
    id: IDS.kevinEssay,
    url: gdoc('kevin-ps'),
    essayPrompt: KEVIN_ESSAY_PROMPT,
    essayText: KEVIN_ESSAY_TEXT,
  })
  doc(kevin.id, 'UC PIQ 1 and 2, final', 'essay', -15, 'student', { url: gdoc('kevin-piq') })
  doc(kevin.id, 'Transcript through junior year.pdf', 'transcript', -60, 'parent')
  doc(kevin.id, 'SAT score report, August.pdf', 'score_report', -75, 'student')
  doc(kevin.id, 'Recommender brag sheet.docx', 'recommendation', -41, 'student')
  doc(kevin.id, 'Activities resume.pdf', 'resume', -50, 'student')

  met(kevin.id, 'College list review with parents', -29, '17:00', {
    durationMin: 60,
    ...recap('We settled your list: ten schools, with NYU as the likely ED2 choice if you still feel the same after visiting.', [
      'Submit UIUC and Purdue Early Action.',
      'Visit NYU over the fall break and take notes on what you see.',
    ]),
  })
  met(kevin.id, 'Essay planning', -14, '16:00', {
    ...recap('UC PIQ 1 and 2 are done and they are good. We mapped out PIQ 3 and 4 and talked through the personal statement.', [
      `First drafts of PIQ 3 and 4 by ${en(-8)}.`,
      `Personal statement draft 3 by ${en(-5)}.`,
      'Ask Ms. Brandt to upload her recommendation.',
    ]),
  })
  const kevinDrafts = kevinMeetingDrafts()
  met(kevin.id, 'Weekly check-in: ED2 decision and essay triage', -1, '16:30', {
    id: IDS.kevinMeeting,
    durationMin: 42,
    ai: kevinDrafts.ai,
    recap: kevinDrafts.recap,
  })
  met(kevin.id, 'UC submission check', 3, '16:30', { durationMin: 30 })

  sentReport(
    kevin,
    IDS.kevinDad,
    -14,
    'Progress update after essay planning',
    `Hello Mr. Zhang, this is Sarah, Kevin's counselor. A quick update after our meeting on ${en(-14)}. Kevin's UIUC and Purdue applications are submitted. He has finished the first two University of California essays, and first drafts of the next two are due ${en(-8)}. His main essay is on its second draft and needs one more round. One item needs your help: the CSS Profile financial aid form needs your 2025 tax return. Could you upload it by ${en(-10)}? Thank you.`,
    `张先生您好，我是凯文的升学顾问 Sarah。跟您同步一下${zh(-14)}面谈后的进展：凯文的 UIUC 和普渡大学申请已经提交。加州大学（UC）的前两篇文书已经定稿，后两篇计划在${zh(-8)}前交初稿。主文书目前是第二稿，还需要再修改一轮。有一件事需要您帮忙：CSS Profile 助学金申请需要 2025 年的报税表，麻烦您在${zh(-10)}前上传。谢谢！`,
  )
  sent(
    kevin.id,
    -7,
    '08:00',
    { kind: 'student', name: 'Kevin Zhang', channel: 'text', language: 'en' },
    'reminder_late',
    `Hi Kevin, “UC PIQ 3 and 4: first drafts” was due ${en(-8)} and is now 1 day late. Can you send what you have today?`,
  )
  sent(
    kevin.id,
    -6,
    '09:15',
    { kind: 'parent', name: 'Zhang Wei', parentId: IDS.kevinDad, channel: 'wechat', language: 'zh-Hans' },
    'reminder_late',
    `张先生您好，「上传 2025 年报税表（CSS Profile）」原定${zh(-10)}完成，目前已逾期4天。这一项需要您这边协助，方便的话请尽快处理，有困难可以随时告诉我。`,
    `Hello Mr. Zhang, “Upload 2025 tax return for the CSS Profile” was due ${en(-10)} and is now 4 days late. This one needs your help. Please take care of it when you can, and tell me if anything is in the way.`,
  )
  sent(
    kevin.id,
    -4,
    '08:00',
    { kind: 'student', name: 'Kevin Zhang', channel: 'text', language: 'en' },
    'reminder_late',
    `Hi Kevin, “Common App personal statement: third draft” was due ${en(-5)} and is now 1 day late. Can you send what you have today?`,
  )
  did(kevin.id, -9, '22:14', 'student', 'Kevin linked “Personal statement (Google Doc)” to the third-draft task')
  did(kevin.id, -4, '21:02', 'student', 'Kevin updated “Common App personal statement: third draft”: Stuck on the middle section')
  did(kevin.id, -1, '17:15', 'ai', 'AI notetaker drafted 5 tasks, 2 parent updates and 3 profile changes from the weekly check-in')

  // ══ 2. Emily Chen: senior, on track ═══════════════════════════════════════

  const emily: Student = {
    id: 's-emily',
    firstName: 'Emily',
    lastName: 'Chen',
    localName: '陳怡安',
    gradYear: senior,
    school: 'Pacific Crest Academy',
    city: 'Irvine, CA',
    email: 'emily.chen@example.com',
    gpa: 3.94,
    gpaWeighted: 4.52,
    tests: {
      sat: 1540,
      aps: [
        { subject: 'Biology', score: 5 },
        { subject: 'Chemistry', score: 5 },
        { subject: 'English Language', score: 5 },
      ],
    },
    majors: ['Biology', 'Public Health'],
    interests: ['Global health', 'Violin'],
    activities: [
      { id: 'act-emily-1', name: 'Science Olympiad', role: 'Captain', detail: 'State finalist in Disease Detectives.' },
      { id: 'act-emily-2', name: 'Hoag Hospital volunteer', role: 'Patient transport', detail: '180 hours.' },
      { id: 'act-emily-3', name: 'Youth Symphony', role: 'Second violin' },
    ],
    counselorNotes:
      'Self-driven; my job is mostly to stop her over-editing. Mom is in Taipei half the year and prefers LINE in the evening Taipei time. Dad reads email but rarely answers.',
    onboardedOn: d(-520),
    parents: [
      { id: 'p-emily-mom', name: 'Chen Shu-fen', localName: '陳淑芬', relationship: 'Mother', language: 'zh-Hant', channel: 'line', contact: 'LINE: shufen.chen' },
      { id: 'p-emily-dad', name: 'Chen Chih-hao', localName: '陳志豪', relationship: 'Father', language: 'zh-Hant', channel: 'email', contact: 'chihhao.chen@example.com', note: 'Reads everything, rarely replies.' },
    ],
  }
  task(emily.id, 'Submit UC application', 'application', 'student', 6, { status: 'in_progress', progressNote: 'Final proofread done. Submitting Friday.' })
  task(emily.id, 'Johns Hopkins supplement: second draft', 'essay', 'student', 9, { attachments: [link('JHU supplement (Google Doc)', gdoc('emily-jhu'), -3)] })
  task(emily.id, 'Rice short answers and “The Box”', 'essay', 'student', 15)
  task(emily.id, 'Ask school counselor to send the mid-year report', 'recommendation', 'counselor', 10)
  task(emily.id, 'Confirm CSS Profile is sent to Cornell and Rice', 'financial', 'parent', 12, { ownerParentId: 'p-emily-dad' })
  task(emily.id, 'Submit Cornell Early Decision application', 'application', 'student', -21, { doneOn: -23 })
  task(emily.id, 'UC PIQs: final drafts', 'essay', 'student', -10, { doneOn: -12 })
  task(emily.id, 'Personal statement: final', 'essay', 'student', -30, { doneOn: -31 })
  college(emily.id, 'Cornell (CALS)', 'ED', -21, 'submitted', 'Reach', 'Decision expected mid-month.')
  college(emily.id, 'UC Berkeley', 'UC', 6, 'in_progress', 'Target')
  college(emily.id, 'UCLA', 'UC', 6, 'in_progress', 'Target')
  college(emily.id, 'UC San Diego', 'UC', 6, 'in_progress', 'Likely')
  college(emily.id, 'Johns Hopkins', 'RD', 40, 'in_progress', 'Reach')
  college(emily.id, 'Rice', 'RD', 42, 'in_progress', 'Reach')
  college(emily.id, 'Emory', 'RD', 40, 'considering', 'Target')
  doc(emily.id, 'Personal statement, final', 'essay', -31, 'student', { url: gdoc('emily-ps') })
  doc(emily.id, 'JHU supplement, draft 1', 'essay', -3, 'student', { url: gdoc('emily-jhu') })
  doc(emily.id, 'Transcript with senior fall grades.pdf', 'transcript', -18, 'counselor')
  doc(emily.id, 'SAT score report.pdf', 'score_report', -120, 'student')
  met(emily.id, 'Post-ED check-in', -6, '15:00', {
    ...recap('Cornell is in. The UC application is ready after one last proofread. Next up is Johns Hopkins.', [
      'Submit the UC application this Friday.',
      `Second draft of the Johns Hopkins supplement by ${en(9)}.`,
    ]),
  })
  met(emily.id, 'RD supplements review', 8, '15:00')
  sentReport(
    emily,
    'p-emily-mom',
    -6,
    'Update after Cornell ED submission',
    `Hello Mrs. Chen, this is Sarah, Emily's counselor. A quick update: Emily's Cornell Early Decision application went in on time, and the decision should come around ${en(18)}. Her University of California application has had its final proofread and she plans to submit this Friday. Next she will work on the Johns Hopkins supplement, with a second draft due ${en(9)}. Emily is on plan in every area. Message me on LINE any time.`,
    `陳媽媽您好，我是怡安的升學顧問 Sarah。跟您更新一下怡安的近況：康乃爾大學的 ED 申請已如期送出，結果預計在${zh(18)}前後公布。加州大學（UC）的申請已經完成最後校對，預計這週五提交。接下來的重點是約翰霍普金斯大學的補充文書，第二稿預計${zh(9)}完成。怡安目前各項進度都在計畫內，請您放心。有任何問題歡迎隨時用 LINE 跟我聯絡。`,
  )
  did(emily.id, -3, '19:40', 'student', 'Emily linked “JHU supplement (Google Doc)”')

  // ══ 3. Sophia Martinez: senior, slipping ══════════════════════════════════

  const sophia: Student = {
    id: IDS.sophia,
    firstName: 'Sophia',
    lastName: 'Martinez',
    gradYear: senior,
    school: 'Mission Hills High School',
    city: 'San Diego, CA',
    email: 'sophia.martinez@example.com',
    gpa: 3.61,
    gpaWeighted: 3.98,
    tests: { sat: 1310, act: 29, aps: [{ subject: 'Spanish Language', score: 5 }, { subject: 'Psychology', score: 4 }] },
    majors: ['Psychology', 'Education'],
    interests: ['Coaching', 'Child development'],
    activities: [
      { id: 'act-sophia-1', name: 'Varsity soccer', role: 'Captain' },
      { id: 'act-sophia-2', name: 'Peer tutoring', role: 'Algebra tutor' },
      { id: 'act-sophia-3', name: 'Family restaurant', role: 'Weekend closing shifts', detail: '15 hours a week since sophomore year.' },
    ],
    counselorNotes:
      'First in her family to apply to four-year schools. Works weekends, so Sunday-night deadlines fail; set them for Thursday. Mom is supportive and answers texts fast but finds the financial aid forms intimidating.',
    onboardedOn: d(-240),
    parents: [
      { id: IDS.sophiaMom, name: 'Elena Martinez', relationship: 'Mother', language: 'en', channel: 'text', contact: '(619) 555-0142' },
      { id: 'p-sophia-dad', name: 'Carlos Martinez', relationship: 'Father', language: 'en', channel: 'email', contact: 'carlos.martinez@example.com' },
    ],
  }
  task(sophia.id, 'FAFSA: finish the parent section', 'financial', 'parent', -4, { ownerParentId: IDS.sophiaMom, detail: 'Locked out of FSA ID.' })
  task(sophia.id, 'UC PIQ 2: revise after feedback', 'essay', 'student', -2, { status: 'in_progress', attachments: [link('UC PIQs (Google Doc)', gdoc('sophia-piq'), -8)] })
  task(sophia.id, 'Submit UC application', 'application', 'student', 6)
  task(sophia.id, 'Submit Cal State Apply (SDSU, CSULB)', 'application', 'student', 8)
  task(sophia.id, 'University of San Diego supplement', 'essay', 'student', 22)
  task(sophia.id, 'Submit University of Oregon Early Action', 'application', 'student', -20, { doneOn: -20 })
  task(sophia.id, 'UC PIQ 1, 3 and 4: final drafts', 'essay', 'student', -9, { doneOn: -9 })
  college(sophia.id, 'University of Oregon', 'EA', -20, 'submitted', 'Likely')
  college(sophia.id, 'UC Santa Barbara', 'UC', 6, 'in_progress', 'Reach')
  college(sophia.id, 'UC Davis', 'UC', 6, 'in_progress', 'Target')
  college(sophia.id, 'San Diego State', 'RD', 8, 'in_progress', 'Target', 'Cal State Apply')
  college(sophia.id, 'CSU Long Beach', 'RD', 8, 'in_progress', 'Likely', 'Cal State Apply')
  college(sophia.id, 'University of San Diego', 'RD', 24, 'in_progress', 'Target')
  college(sophia.id, 'Loyola Marymount', 'RD', 45, 'considering', 'Target')
  doc(sophia.id, 'UC PIQ 2, draft 1', 'essay', -8, 'student', {
    id: IDS.sophiaEssay,
    url: gdoc('sophia-piq'),
    essayPrompt: SOPHIA_ESSAY_PROMPT,
    essayText: SOPHIA_ESSAY_TEXT,
  })
  doc(sophia.id, 'Transcript.pdf', 'transcript', -40, 'counselor')
  doc(sophia.id, 'ACT score report.pdf', 'score_report', -90, 'student')
  met(sophia.id, 'UC essay review', -9, '18:30', {
    aiAttended: false,
    counselorNotes: 'Took my own notes this time; Sophia asked not to be recorded.',
    ...recap('Three of your four PIQs are finished. PIQ 2 has a great story hiding in the middle of it.', [
      `Revise PIQ 2 by ${en(-2)}.`,
      'Ask your mom to finish the FAFSA parent section.',
    ]),
  })
  met(sophia.id, 'UC final check and Cal State Apply', 5, '18:30')
  sentReport(
    sophia,
    IDS.sophiaMom,
    -9,
    'Update after UC essay review',
    `Hi Elena, Sarah here. Sophia's Oregon application is in and three of her four UC essays are finished. She is revising the last one this week. The one thing I need from you is the parent section of the FAFSA by ${en(-4)}. If the FSA ID gives you trouble, text me and we can do it together by phone.`,
  )
  sent(
    sophia.id,
    -1,
    '08:00',
    { kind: 'student', name: 'Sophia Martinez', channel: 'text', language: 'en' },
    'reminder_late',
    `Hi Sophia, “UC PIQ 2: revise after feedback” was due ${en(-2)} and is now 1 day late. Can you send what you have today?`,
  )

  // ══ 4. Jason Wu: junior, on track ═════════════════════════════════════════

  const jason: Student = {
    id: 's-jason',
    firstName: 'Jason',
    lastName: 'Wu',
    localName: '吴子轩',
    gradYear: senior + 1,
    school: 'Arcadia Heights High School',
    city: 'Arcadia, CA',
    email: 'jason.wu@example.com',
    gpa: 3.88,
    gpaWeighted: 4.2,
    tests: { aps: [{ subject: 'World History', score: 4 }] },
    majors: ['Economics', 'Applied Mathematics'],
    interests: ['Investing', 'Tennis'],
    activities: [
      { id: 'act-jason-1', name: 'DECA', role: 'Chapter VP', detail: 'Business Finance written event.' },
      { id: 'act-jason-2', name: 'Investment Club', role: 'Founder', detail: '34 members, paper-trading league.' },
      { id: 'act-jason-3', name: 'JV Tennis', role: 'Doubles' },
    ],
    counselorNotes:
      'Parents want a top-10 economics programme and ask about rankings in every message. Jason is more interested in fit than they are. PSAT 1410; first SAT planned for March.',
    onboardedOn: d(-150),
    parents: [
      { id: 'p-jason-dad', name: 'Wu Jianguo', localName: '吴建国', relationship: 'Father', language: 'zh-Hans', channel: 'wechat', contact: 'WeChat: wujg88' },
      { id: 'p-jason-mom', name: 'Chen Li', localName: '陈丽', relationship: 'Mother', language: 'zh-Hans', channel: 'wechat', contact: 'WeChat: lily_chen_la' },
    ],
  }
  task(jason.id, 'Register for the March SAT', 'testing', 'student', 10)
  task(jason.id, 'DECA regionals: finish the written event', 'planning', 'student', 6, { status: 'in_progress' })
  task(jason.id, 'Shortlist five summer programmes', 'planning', 'student', 14)
  task(jason.id, 'Build Jason’s junior-year testing timeline', 'testing', 'counselor', 4)
  task(jason.id, 'Choose senior-year courses with school counselor', 'planning', 'student', -18, { doneOn: -19 })
  task(jason.id, 'Send sophomore transcript', 'application', 'parent', -40, { ownerParentId: 'p-jason-mom', doneOn: -42 })
  college(jason.id, 'University of Michigan', 'EA', 345, 'considering', 'Target')
  college(jason.id, 'University of Chicago', 'ED', 345, 'considering', 'Reach')
  college(jason.id, 'NYU (Stern)', 'RD', 405, 'considering', 'Reach')
  college(jason.id, 'UC Berkeley', 'UC', 372, 'considering', 'Reach')
  college(jason.id, 'USC', 'EA', 345, 'considering', 'Target')
  doc(jason.id, 'Sophomore transcript.pdf', 'transcript', -42, 'parent')
  doc(jason.id, 'PSAT score report.pdf', 'score_report', -30, 'student')
  met(jason.id, 'Junior-year plan', -12, '17:30', {
    ...recap('We set the plan for junior year: first SAT in March, one strong summer programme, and keep the investment club growing.', [
      `Register for the March SAT by ${en(10)}.`,
      `Shortlist five summer programmes by ${en(14)}.`,
    ]),
  })
  met(jason.id, 'Summer programme shortlist', 16, '17:30')
  sentReport(
    jason,
    'p-jason-dad',
    -12,
    'Junior-year plan',
    `Hello Mr. Wu, this is Sarah, Jason's counselor. Jason is having a good semester: his GPA is holding at 3.88 and his DECA written event for regionals is nearly finished. Next we will set his testing timeline; the plan is a first SAT in March. Before winter break I will send you and Ms. Chen a shortlist of summer programmes to look at together.`,
    `吴先生您好，我是子轩的升学顾问 Sarah。子轩这学期状态不错：GPA 保持在 3.88，DECA 区域赛的书面项目也快完成了。接下来我们会把 11 年级的标化考试时间表定下来，初步计划是明年 3 月第一次考 SAT。寒假前我会把暑期项目的备选名单发给您和子轩妈妈，到时候可以一起商量。`,
  )

  // ══ 5. Aarav Patel: senior, on track ══════════════════════════════════════

  const aarav: Student = {
    id: 's-aarav',
    firstName: 'Aarav',
    lastName: 'Patel',
    gradYear: senior,
    school: 'Evergreen Valley Preparatory',
    city: 'San Jose, CA',
    email: 'aarav.patel@example.com',
    gpa: 3.91,
    gpaWeighted: 4.4,
    tests: { sat: 1520, aps: [{ subject: 'Physics C: Mechanics', score: 5 }, { subject: 'Calculus BC', score: 5 }] },
    majors: ['Mechanical Engineering'],
    interests: ['Electric vehicles', 'Cricket'],
    activities: [
      { id: 'act-aarav-1', name: 'Solar car team', role: 'Mechanical lead' },
      { id: 'act-aarav-2', name: 'County science fair', role: 'Second place, engineering' },
      { id: 'act-aarav-3', name: 'Cricket club', role: 'Co-founder' },
    ],
    counselorNotes: 'Organised and early with everything. Both parents are engineers and read every draft; remind them the essays must stay in his voice.',
    onboardedOn: d(-300),
    parents: [
      { id: 'p-aarav-mom', name: 'Priya Patel', relationship: 'Mother', language: 'en', channel: 'email', contact: 'priya.patel@example.com' },
      { id: 'p-aarav-dad', name: 'Rajesh Patel', relationship: 'Father', language: 'en', channel: 'email', contact: 'rajesh.patel@example.com' },
    ],
  }
  task(aarav.id, 'Submit UC application', 'application', 'student', 6, { status: 'in_progress', progressNote: 'Waiting on one last read of PIQ 3.' })
  task(aarav.id, 'MIT essays: second drafts (five short answers)', 'essay', 'student', 12, { status: 'in_progress', attachments: [link('MIT essays (Google Doc)', gdoc('aarav-mit'), -2)] })
  task(aarav.id, 'Request mid-year transcript', 'application', 'student', 18)
  task(aarav.id, 'Send CSS Profile to Cornell', 'financial', 'parent', 14, { ownerParentId: 'p-aarav-mom' })
  task(aarav.id, 'Submit Purdue, Georgia Tech and Michigan Early Action', 'application', 'student', -22, { doneOn: -24 })
  task(aarav.id, 'UC PIQs: final drafts', 'essay', 'student', -6, { doneOn: -7 })
  college(aarav.id, 'Purdue', 'EA', -22, 'submitted', 'Likely')
  college(aarav.id, 'Georgia Tech', 'EA', -22, 'submitted', 'Target')
  college(aarav.id, 'University of Michigan', 'EA', -22, 'submitted', 'Target')
  college(aarav.id, 'UC Berkeley', 'UC', 6, 'in_progress', 'Reach')
  college(aarav.id, 'UCLA', 'UC', 6, 'in_progress', 'Reach')
  college(aarav.id, 'MIT', 'RD', 40, 'in_progress', 'Reach')
  college(aarav.id, 'Cornell', 'RD', 41, 'in_progress', 'Reach')
  doc(aarav.id, 'MIT essays, draft 1', 'essay', -2, 'student', { url: gdoc('aarav-mit') })
  doc(aarav.id, 'Transcript.pdf', 'transcript', -35, 'counselor')
  doc(aarav.id, 'Teacher recommendation form, Mr. Okafor.pdf', 'recommendation', -28, 'counselor')
  met(aarav.id, 'MIT essay brainstorm', -4, '16:00', {
    ...recap('Your UC application is one read away from done. For MIT, the solar car steering failure is the story to tell.', [
      'Submit the UC application after the final read of PIQ 3.',
      `Second drafts of the MIT short answers by ${en(12)}.`,
    ]),
  })
  met(aarav.id, 'MIT and Cornell review', 10, '16:00')
  sentReport(
    aarav,
    'p-aarav-mom',
    -4,
    'Update after MIT essay brainstorm',
    `Hi Priya, Sarah here. Aarav's three Early Action applications are in and his UC application will be submitted this week. He is now drafting the MIT short answers, due ${en(12)}. One request: please send the CSS Profile to Cornell by ${en(14)}. He is in very good shape.`,
  )

  // ══ 6. Mia Lin: junior, slipping ══════════════════════════════════════════

  const mia: Student = {
    id: IDS.mia,
    firstName: 'Mia',
    lastName: 'Lin',
    localName: '林語彤',
    gradYear: senior + 1,
    school: 'Bayview International School',
    city: 'San Mateo, CA',
    email: 'mia.lin@example.com',
    gpa: 3.72,
    tests: { toefl: 108, aps: [] },
    majors: ['Architecture', 'Environmental Design'],
    interests: ['Sketching', 'Sustainable housing'],
    activities: [
      { id: 'act-mia-1', name: 'Yearbook', role: 'Design editor' },
      { id: 'act-mia-2', name: 'Habitat for Humanity club', role: 'Member', detail: 'Two build weekends.' },
    ],
    counselorNotes:
      'Talented and quiet; goes silent when she is behind instead of asking for help. Mom lives in Taipei and manages things by LINE, usually late evening Pacific. Dad is local and handles logistics by email.',
    onboardedOn: d(-200),
    parents: [
      { id: IDS.miaMom, name: 'Lin Mei-ling', localName: '林美玲', relationship: 'Mother', language: 'zh-Hant', channel: 'line', contact: 'LINE: meiling_lin', note: 'In Taipei. Replies late evening Pacific time.' },
      { id: 'p-mia-dad', name: 'David Lin', relationship: 'Father', language: 'en', channel: 'email', contact: 'david.lin@example.com' },
    ],
  }
  task(mia.id, 'Portfolio: choose eight pieces and photograph them', 'application', 'student', -6, { detail: 'Needed for summer programme applications.' })
  task(mia.id, 'Research summer architecture programmes (Cornell, USC, Cal Poly)', 'planning', 'student', 7)
  task(mia.id, 'Confirm winter-break dates for campus visits', 'planning', 'parent', 3, { ownerParentId: IDS.miaMom })
  task(mia.id, 'Schedule Mia’s next meeting', 'planning', 'counselor', 1)
  task(mia.id, 'Take TOEFL', 'testing', 'student', -60, { doneOn: -62 })
  college(mia.id, 'Cornell (AAP)', 'ED', 345, 'considering', 'Reach')
  college(mia.id, 'USC (Architecture)', 'RD', 375, 'considering', 'Reach')
  college(mia.id, 'Cal Poly San Luis Obispo', 'RD', 372, 'considering', 'Target')
  college(mia.id, 'University of Washington', 'RD', 358, 'considering', 'Target')
  college(mia.id, 'Pratt Institute', 'EA', 345, 'considering', 'Likely')
  doc(mia.id, 'TOEFL score report.pdf', 'score_report', -55, 'parent')
  doc(mia.id, 'Portfolio sketches (Google Drive folder)', 'other', -44, 'student', { url: 'https://drive.google.com/drive/folders/demo-mia-portfolio' })
  met(mia.id, 'Portfolio planning', -37, '16:00', {
    ...recap('You have more than enough work for a portfolio. The job now is choosing.', [
      'Pick eight pieces and photograph them in daylight.',
      'Look at three summer programmes and note what each asks for.',
    ]),
  })

  // ══ 7. Daniel Kim: senior, behind ═════════════════════════════════════════

  const daniel: Student = {
    id: IDS.daniel,
    firstName: 'Daniel',
    lastName: 'Kim',
    gradYear: senior,
    school: 'Glenridge High School',
    city: 'La Cañada, CA',
    email: 'daniel.kim@example.com',
    gpa: 3.45,
    gpaWeighted: 3.8,
    tests: { act: 30, aps: [{ subject: 'Macroeconomics', score: 4 }] },
    majors: ['Business', 'Sports Management'],
    interests: ['Basketball', 'Sneakers', 'Marketing'],
    activities: [
      { id: 'act-daniel-1', name: 'Varsity basketball', role: 'Point guard' },
      { id: 'act-daniel-2', name: 'Church youth group', role: 'Student leader' },
    ],
    counselorNotes:
      'Has two admits already and has eased off since. Responds to texts, not email. Parents are relaxed about deadlines; do not rely on them to chase him.',
    onboardedOn: d(-180),
    parents: [
      { id: IDS.danielMom, name: 'Grace Kim', relationship: 'Mother', language: 'en', channel: 'text', contact: '(818) 555-0177' },
      { id: 'p-daniel-dad', name: 'James Kim', relationship: 'Father', language: 'en', channel: 'text', contact: '(818) 555-0164' },
    ],
  }
  task(daniel.id, 'UC PIQ 4: first draft', 'essay', 'student', -4)
  task(daniel.id, 'UC activities list: add hours and descriptions', 'application', 'student', -3, { status: 'in_progress' })
  task(daniel.id, 'USC supplement: outline', 'essay', 'student', -1)
  task(daniel.id, 'Submit UC application', 'application', 'student', 6)
  task(daniel.id, 'Submit FAFSA', 'financial', 'parent', 10, { ownerParentId: 'p-daniel-dad' })
  task(daniel.id, 'Boston University supplement', 'essay', 'student', 26)
  task(daniel.id, 'Submit Indiana Early Action', 'application', 'student', -24, { doneOn: -24 })
  task(daniel.id, 'UC PIQ 1 to 3: final drafts', 'essay', 'student', -12, { doneOn: -10 })
  college(daniel.id, 'Indiana University (Kelley)', 'EA', -24, 'admitted', 'Target', 'Direct admit to Kelley.')
  college(daniel.id, 'Arizona State (W. P. Carey)', 'Rolling', -40, 'admitted', 'Likely')
  college(daniel.id, 'UC Irvine', 'UC', 6, 'in_progress', 'Reach')
  college(daniel.id, 'UC Santa Barbara', 'UC', 6, 'in_progress', 'Reach')
  college(daniel.id, 'USC (Marshall)', 'RD', 40, 'in_progress', 'Reach')
  college(daniel.id, 'Boston University', 'RD', 41, 'in_progress', 'Target')
  college(daniel.id, 'University of Miami', 'RD', 40, 'considering', 'Target')
  doc(daniel.id, 'UC PIQ 1 to 3, final', 'essay', -10, 'student', { url: gdoc('daniel-piq') })
  doc(daniel.id, 'Indiana admission letter.pdf', 'other', -5, 'parent')
  doc(daniel.id, 'Transcript.pdf', 'transcript', -38, 'counselor')
  met(daniel.id, 'Early results and UC plan', -17, '19:00', {
    ...recap('Three PIQs are done. One essay and the activities list stand between you and a finished UC application.', [
      `First draft of PIQ 4 by ${en(-4)}.`,
      `Add hours to your activities list by ${en(-3)}.`,
    ]),
  })
  // This meeting was recorded but its drafts are not generated yet, so the
  // demo can show the AI "processing" a meeting live.
  met(daniel.id, 'Check-in after Kelley admit', -3, '19:00', { id: IDS.danielMeeting, durationMin: 35 })
  met(daniel.id, 'UC final check', 4, '19:00', { durationMin: 30 })
  sent(
    daniel.id,
    -2,
    '08:00',
    { kind: 'student', name: 'Daniel Kim', channel: 'text', language: 'en' },
    'reminder_late',
    `Hi Daniel, “UC PIQ 4: first draft” was due ${en(-4)} and is now 2 days late. Can you send what you have today?`,
  )

  // ══ 8. Chloe Wang: sophomore, just onboarded ══════════════════════════════

  const chloe: Student = {
    id: 's-chloe',
    firstName: 'Chloe',
    lastName: 'Wang',
    localName: '王思琪',
    gradYear: senior + 2,
    school: 'Saratoga Oaks School',
    city: 'Saratoga, CA',
    email: 'chloe.wang@example.com',
    gpa: 3.96,
    tests: { aps: [] },
    majors: ['Undecided'],
    interests: ['Biology', 'Creative writing'],
    activities: [
      { id: 'act-chloe-1', name: 'Debate', role: 'JV Lincoln-Douglas' },
      { id: 'act-chloe-2', name: 'Piano', role: 'ABRSM Grade 8' },
      { id: 'act-chloe-3', name: 'Literary magazine', role: 'Staff writer' },
    ],
    counselorNotes: 'Intake done. Mom found us through another family at the school and has high expectations. Chloe has not said much yet about what she wants.',
    onboardedOn: d(-6),
    parents: [
      { id: 'p-chloe-mom', name: 'Wang Xiaoyan', localName: '王晓燕', relationship: 'Mother', language: 'zh-Hans', channel: 'wechat', contact: 'WeChat: xiaoyan_w' },
    ],
  }
  task(chloe.id, 'Complete the onboarding questionnaire', 'planning', 'student', 2, { status: 'in_progress', progressNote: 'About half done.' })
  task(chloe.id, 'Upload freshman-year transcript', 'application', 'parent', 4, { ownerParentId: 'p-chloe-mom' })
  task(chloe.id, 'Draft Chloe’s four-year course plan', 'planning', 'counselor', 9)
  doc(chloe.id, 'Intake form.pdf', 'other', -6, 'parent')
  met(chloe.id, 'Intake meeting with Chloe and her mother', -6, '10:00', {
    durationMin: 60,
    ...recap('Welcome, Chloe! We talked about what you enjoy at school and how the next two years will work.', [
      'Finish the onboarding questionnaire.',
      'Think about one activity you would do even if it did not count for college.',
    ]),
  })
  met(chloe.id, 'Four-year plan', 9, '10:00')

  // ══ 9. Ethan Nguyen: junior, on track ═════════════════════════════════════

  const ethan: Student = {
    id: 's-ethan',
    firstName: 'Ethan',
    lastName: 'Nguyen',
    gradYear: senior + 1,
    school: 'Fountain Grove High School',
    city: 'Garden Grove, CA',
    email: 'ethan.nguyen@example.com',
    gpa: 3.83,
    gpaWeighted: 4.1,
    tests: { sat: 1420, aps: [{ subject: 'Biology', score: 4 }] },
    majors: ['Nursing', 'Biology'],
    interests: ['Emergency medicine', 'Distance running'],
    activities: [
      { id: 'act-ethan-1', name: 'HOSA', role: 'Chapter secretary' },
      { id: 'act-ethan-2', name: 'Community clinic', role: 'Volunteer', detail: 'Front desk and Vietnamese interpretation.' },
      { id: 'act-ethan-3', name: 'Cross country', role: 'Varsity' },
    ],
    counselorNotes: 'Sure about nursing, which narrows the list early: direct-admit programmes only. Mom is a nurse and a great resource.',
    onboardedOn: d(-120),
    parents: [
      { id: 'p-ethan-mom', name: 'Linh Nguyen', relationship: 'Mother', language: 'en', channel: 'email', contact: 'linh.nguyen@example.com' },
    ],
  }
  task(ethan.id, 'Register for the December SAT retake', 'testing', 'student', 5)
  task(ethan.id, 'Shadowing log: reach 20 hours at the clinic', 'planning', 'student', 21, { status: 'in_progress', progressNote: '13 of 20 hours.' })
  task(ethan.id, 'List direct-admit nursing programmes with their prerequisites', 'planning', 'student', 12)
  task(ethan.id, 'Take the August SAT', 'testing', 'student', -90, { doneOn: -90 })
  task(ethan.id, 'HOSA competitive event: choose a category', 'planning', 'student', -15, { doneOn: -16 })
  college(ethan.id, 'UCLA (Nursing)', 'UC', 372, 'considering', 'Reach')
  college(ethan.id, 'UC Irvine (Nursing)', 'UC', 372, 'considering', 'Reach')
  college(ethan.id, 'University of Washington', 'RD', 358, 'considering', 'Target')
  college(ethan.id, 'University of Pennsylvania (Nursing)', 'ED', 345, 'considering', 'Reach')
  college(ethan.id, 'Cal State Fullerton', 'RD', 372, 'considering', 'Likely')
  doc(ethan.id, 'SAT score report, August.pdf', 'score_report', -70, 'student')
  doc(ethan.id, 'Shadowing log (Google Sheet)', 'other', -20, 'student', { url: 'https://docs.google.com/spreadsheets/d/demo-ethan-log/edit' })
  met(ethan.id, 'Nursing programme research', -10, '17:00', {
    ...recap('Direct-admit nursing is the filter for your whole list. A higher SAT opens two more programmes.', [
      `Register for the December SAT by ${en(5)}.`,
      'Keep the shadowing log up to date.',
    ]),
  })
  met(ethan.id, 'List review', 18, '17:00')

  // ══ 10. Grace Huang: senior, on track ═════════════════════════════════════

  const grace: Student = {
    id: 's-grace',
    firstName: 'Grace',
    lastName: 'Huang',
    localName: '黃郁庭',
    gradYear: senior,
    school: 'Palos Verdes Coast High School',
    city: 'Rancho Palos Verdes, CA',
    email: 'grace.huang@example.com',
    gpa: 3.89,
    gpaWeighted: 4.45,
    tests: { sat: 1500, toefl: 112, aps: [{ subject: 'US Government', score: 5 }, { subject: 'Chinese Language', score: 5 }] },
    majors: ['Political Science', 'International Relations'],
    interests: ['Cross-strait policy', 'Journalism'],
    activities: [
      { id: 'act-grace-1', name: 'Model UN', role: 'Secretary-General' },
      { id: 'act-grace-2', name: 'School newspaper', role: 'Opinion editor' },
      { id: 'act-grace-3', name: 'Mandarin tutoring', role: 'Volunteer tutor' },
    ],
    counselorNotes: 'Moved from Taipei in ninth grade. Confident writer. Mom checks in weekly on LINE and appreciates short, regular updates.',
    onboardedOn: d(-380),
    parents: [
      { id: 'p-grace-mom', name: 'Huang Li-hua', localName: '黃麗華', relationship: 'Mother', language: 'zh-Hant', channel: 'line', contact: 'LINE: lihua.h' },
      { id: 'p-grace-dad', name: 'Huang Kuo-wei', localName: '黃國偉', relationship: 'Father', language: 'zh-Hant', channel: 'email', contact: 'kuowei.huang@example.com' },
    ],
  }
  task(grace.id, 'Georgetown alumni interview: prepare questions', 'application', 'student', 4, { status: 'in_progress' })
  task(grace.id, 'Submit UC application', 'application', 'student', 6, { status: 'in_progress', progressNote: 'Done except the final review.' })
  task(grace.id, 'Tufts supplements', 'essay', 'student', 18)
  task(grace.id, 'Send Grace interview practice questions', 'application', 'counselor', 1)
  task(grace.id, 'Submit Georgetown and Michigan Early Action', 'application', 'student', -22, { doneOn: -23 })
  task(grace.id, 'UC PIQs: final drafts', 'essay', 'student', -8, { doneOn: -9 })
  college(grace.id, 'University of Pittsburgh', 'Rolling', -50, 'admitted', 'Likely', 'With merit scholarship.')
  college(grace.id, 'Georgetown (SFS)', 'EA', -22, 'submitted', 'Reach')
  college(grace.id, 'University of Michigan', 'EA', -22, 'submitted', 'Target')
  college(grace.id, 'UC Berkeley', 'UC', 6, 'in_progress', 'Reach')
  college(grace.id, 'UCLA', 'UC', 6, 'in_progress', 'Target')
  college(grace.id, 'Tufts', 'RD', 40, 'in_progress', 'Target')
  college(grace.id, 'George Washington', 'RD', 42, 'considering', 'Likely')
  doc(grace.id, 'Personal statement, final', 'essay', -28, 'student', { url: gdoc('grace-ps') })
  doc(grace.id, 'Pittsburgh admission letter.pdf', 'other', -8, 'parent')
  doc(grace.id, 'Transcript.pdf', 'transcript', -36, 'counselor')
  met(grace.id, 'Interview prep and RD plan', -7, '15:30', {
    ...recap('Pittsburgh said yes, with a scholarship. Georgetown has offered an alumni interview and we practised the first questions.', [
      `Prepare three questions for your interviewer by ${en(4)}.`,
      'Submit the UC application after the final review.',
    ]),
  })
  met(grace.id, 'Tufts supplements', 7, '15:30')
  sentReport(
    grace,
    'p-grace-mom',
    -7,
    'Pittsburgh admission and next steps',
    `Hello Mrs. Huang, this is Sarah, Grace's counselor. Good news first: Grace has been admitted to the University of Pittsburgh with a merit scholarship. Her Georgetown and Michigan Early Action applications are in, and Georgetown has offered an alumni interview that we are preparing for. Her University of California application will be submitted before the ${en(6)} deadline. She is steady and on plan.`,
    `黃媽媽您好，我是郁庭的升學顧問 Sarah。先跟您分享好消息：郁庭已經收到匹茲堡大學的錄取通知，還拿到了獎學金！喬治城大學和密西根大學的 EA 申請都已送出，喬治城也安排了校友面試，我們正在幫她準備。加州大學（UC）的申請會在${zh(6)}截止前提交。郁庭的進度很穩定，請您放心。`,
  )

  return {
    firm: { name: 'Alder & Vine College Counseling', counselorName: 'Sarah Lindqvist', counselorFirstName: 'Sarah' },
    students: [kevin, emily, sophia, jason, aarav, mia, daniel, chloe, ethan, grace],
    tasks,
    meetings,
    colleges,
    documents,
    reports,
    outbox: outbox.sort((a, b) => b.sentAt.localeCompare(a.sentAt)),
    reminderRules: DEFAULT_REMINDER_RULES.map((r) => ({ ...r })),
    activity: activity.sort((a, b) => b.at.localeCompare(a.at)),
  }
}
