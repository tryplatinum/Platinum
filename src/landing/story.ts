// The one meeting the landing page follows, and everything drawn from it. All
// of it is invented: Emily Chen, her father, her counselor Sarah and the firm
// do not exist. The sentences are the page's settled copy; the ids tie a line
// of a draft to the phrase in the notes it came from.

/** The hold before an approved message is sent. The same number as UNDO_SECONDS in shared/outbox.ts (scripts/test-outbox.ts checks it). */
export const UNDO_SECONDS = 10

export const CHAPTERS = [
  { id: 'top', label: 'The meeting' },
  { id: 'how', label: 'How it works' },
  { id: 'workspace', label: 'The workspace' },
  { id: 'families', label: 'Families' },
  { id: 'rules', label: 'AI rules' },
  { id: 'early', label: 'Request early access' },
] as const

export type ChapterId = (typeof CHAPTERS)[number]['id']

/** A phrase in the notes that something was drafted from. */
export type PhraseId = 'ed2' | 'piq2' | 'piq4' | 'rec' | 'transcript' | 'statement' | 'language' | 'next'

/** The page of notes, line by line: plain words, and the phrases drafts come from. */
export const NOTES: (string | { id: PhraseId; text: string })[][] = [
  [{ id: 'ed2', text: 'ED2 = NYU Tandon, CS.' }],
  [{ id: 'piq2', text: 'PIQ 2 first draft done' }, ', ', { id: 'piq4', text: 'PIQ 4 still open.' }],
  [{ id: 'rec', text: 'Ask Mr. Alvarez for math rec.' }],
  [{ id: 'transcript', text: 'Nov transcript not uploaded yet…' }],
  [{ id: 'statement', text: 'personal statement: revise' }, ' (2 wks)'],
  ['dad: ', { id: 'language', text: 'updates in 中文' }],
  [{ id: 'next', text: 'next mtg Nov 29' }],
]

/** The same notes as one line of plain text, as the copy has them. */
export const NOTES_PASTED = 'ED2 = NYU Tandon, CS. PIQ 2 first draft done, PIQ 4 still open. Ask Mr. Alvarez for math rec. Nov transcript not uploaded yet…'

export interface DraftLine {
  text: string
  from: PhraseId
}

/** The four drafts made from the notes. `summary` is the line the copy gives each. */
export const DRAFTS: { id: string; name: string; summary: string; lines: DraftLine[] }[] = [
  {
    id: 'recap',
    name: 'Recap',
    summary: 'ED2 choice set, two essays in progress',
    lines: [
      { text: 'ED2 choice set: NYU Tandon, Computer Science', from: 'ed2' },
      { text: 'PIQ 2 has a first draft', from: 'piq2' },
      { text: 'PIQ 4 is still to start', from: 'piq4' },
    ],
  },
  {
    id: 'tasks',
    name: 'Tasks',
    summary: '3 new, each with an owner and a due date',
    lines: [
      { text: 'Revise the personal statement · Emily · Dec 8', from: 'statement' },
      { text: 'Ask Mr. Alvarez for a math recommendation · Emily · Dec 1', from: 'rec' },
      { text: 'Upload the November transcript · Emily · Dec 4', from: 'transcript' },
    ],
  },
  { id: 'profile', name: 'Profile', summary: 'Early plan: NYU Tandon, ED2', lines: [{ text: 'Early plan: NYU Tandon, ED2', from: 'ed2' }] },
  {
    id: 'update',
    name: 'Parent update',
    summary: 'In Traditional Chinese, for Mr. Chen',
    lines: [
      { text: 'Written in Traditional Chinese, for Mr. Chen', from: 'language' },
      { text: 'Next meeting on Nov 29', from: 'next' },
    ],
  },
]

/** What approving does, in the copy's words. */
export const OUTCOMES = [
  { name: 'Approved', text: 'Tasks added to Emily’s page' },
  { name: 'Sent', text: 'Parent update, from your Gmail' },
  { name: 'Logged', text: 'Everything shows in the firm’s activity' },
]

/** A fact in the parent update that came from the record, and where in the record it is. */
export interface Fact {
  id: string
  /** Where it came from, as a counselor would find it. */
  source: string
}

export const FACTS: Record<string, Fact> = {
  parent: { id: 'parent', source: 'Parents · Chen Chih-hao, father' },
  counselor: { id: 'counselor', source: 'Firm · counselor on this student' },
  student: { id: 'student', source: 'Student · first name' },
  essay: { id: 'essay', source: 'Essays · UC essay 2, draft 1 saved' },
  school: { id: 'school', source: 'College list · NYU Tandon' },
  plan: { id: 'plan', source: 'College list · plan: ED2' },
  count: { id: 'count', source: 'Tasks · 3 open' },
  window: { id: 'window', source: 'Tasks · latest due date, Dec 8' },
  month: { id: 'month', source: 'Documents · November transcript expected' },
}

export type Lang = 'en' | 'zh-Hant' | 'zh-Hans'

/** One update in three languages. A string is a sentence part the model wrote; a pair is a fact placed from the record. */
export const UPDATE: Record<Lang, (string | [factId: string, text: string])[]> = {
  en: [
    'Hello ',
    ['parent', 'Mr. Chen'],
    ', this is ',
    ['counselor', 'Sarah'],
    ', ',
    ['student', 'Emily'],
    '’s counselor. A quick update: this week Emily finished the ',
    ['essay', 'first draft of her second UC essay'],
    ' and confirmed ',
    ['school', 'NYU Tandon'],
    ' as her ',
    ['plan', 'ED2'],
    ' school. ',
    ['count', 'Three things'],
    ' are due in the next ',
    ['window', 'two weeks'],
    ': revise the personal statement, ask her math teacher for a recommendation, and upload the ',
    ['month', 'November'],
    ' transcript.',
  ],
  'zh-Hant': [
    ['parent', '陳先生'],
    '您好，我是 ',
    ['student', 'Emily'],
    ' 的升學顧問 ',
    ['counselor', 'Sarah'],
    '。跟您更新一下近況：Emily 本週完成了 ',
    ['essay', 'UC 申請文章第二篇的初稿'],
    '，並確認以',
    ['school', '紐約大學工學院'],
    '作為 ',
    ['plan', 'ED2'],
    ' 的申請學校。接下來',
    ['window', '兩週'],
    '有',
    ['count', '三件事'],
    '要完成：修改個人陳述、請數學老師寫推薦信、上傳',
    ['month', '十一月'],
    '的成績單。',
  ],
  'zh-Hans': [
    ['parent', '陈先生'],
    '您好，我是 ',
    ['student', 'Emily'],
    ' 的升学顾问 ',
    ['counselor', 'Sarah'],
    '。跟您更新一下近况：Emily 本周完成了 ',
    ['essay', 'UC 申请文章第二篇的初稿'],
    '，并确认以',
    ['school', '纽约大学工学院'],
    '作为 ',
    ['plan', 'ED2'],
    ' 的申请学校。接下来',
    ['window', '两周'],
    '有',
    ['count', '三件事'],
    '要完成：修改个人陈述、请数学老师写推荐信、上传',
    ['month', '十一月'],
    '的成绩单。',
  ],
}

export const LANG_LABEL: Record<Lang, string> = { en: 'English', 'zh-Hant': '繁體中文', 'zh-Hans': '简体中文' }

/** The update as plain text, for a screen reader and for the hero card. */
export const updateText = (lang: Lang) => UPDATE[lang].map((part) => (typeof part === 'string' ? part : part[1])).join('')

/** The eight areas of the workspace, in the copy's words. */
export const AREAS = [
  { id: 'today', name: 'Today', text: 'What is waiting for your review, who is behind or slipping, and your next meeting. One click to send a reminder.' },
  { id: 'students', name: 'Students', text: 'Profile, parents, tasks, college list, essays, meetings and files for each student. Tasks can belong to the student, a parent or you.' },
  { id: 'meetings', name: 'Meetings', text: 'Schedule, log and search every meeting. Ask for a brief before the next one and get the open items and what changed since.' },
  { id: 'colleges', name: 'College lists', text: 'Add colleges with published figures attached, or have a Reach, Target and Likely list drafted with a reason for each school.' },
  { id: 'documents', name: 'Documents', text: 'Upload files or bring them in from Google Drive. Each one is sorted into the right student’s folder, and you confirm the ones it wasn’t sure about.' },
  { id: 'essays', name: 'Essays', text: 'Feedback as observations and questions tied to places in the draft. The writing stays the student’s.' },
  { id: 'student', name: 'Student page', text: 'Each student sees their own tasks, deadlines and latest recap on their phone, checks things off and adds files.' },
  { id: 'assistant', name: 'Assistant', text: 'Ask about one student or the whole caseload. Answers cite the record, and anything it wants to change or send waits in your Inbox.' },
] as const

export type AreaId = (typeof AREAS)[number]['id']

/** Where each of the four drafts lives on the student's page. */
export const DRAFT_HOME: Record<string, AreaId> = { recap: 'meetings', tasks: 'students', profile: 'colleges', update: 'today' }
