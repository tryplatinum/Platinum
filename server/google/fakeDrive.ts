// A small invented Google, for local work only (GOOGLE_FAKE=1 under
// `npm run dev`; config.ts refuses it anywhere else). It answers the same
// REST calls the real code makes: the token exchange, revoke, Drive's about,
// files.list, files.get, files.export, alt=media, and the list of shared
// drives. So the whole Google feature can be driven in a browser with no
// Google account.
//
// Everything in it is made up: three sample students' folders with subfolders,
// PDFs, images, a Google Doc, a Sheet, a shortcut, a file over the size cap, a
// Google Form and a text file. No real person, school or document.
//
// To try what happens when Drive changes, point GOOGLE_FAKE_STATE at a JSON
// file and edit it between syncs:
//   { "removed": ["kevin-sat"], "touched": { "kevin-transcript": "2026-12-01T10:00:00Z" },
//     "added": [{ "id": "kevin-new", "name": "New essay draft.pdf", "parent": "kevin-essays" }],
//     "expired": true }
// "expired" makes Google answer that the grant is revoked, as it does every
// seven days in testing mode.

import { readFileSync } from 'node:fs'
import { tinyPdf } from '../../shared/files.js'

const FOLDER = 'application/vnd.google-apps.folder'
const DOC = 'application/vnd.google-apps.document'
const SHEET = 'application/vnd.google-apps.spreadsheet'
const FORM = 'application/vnd.google-apps.form'
const SHORTCUT = 'application/vnd.google-apps.shortcut'
const PDF = 'application/pdf'

export const FAKE_ADDRESS = 'sample.counselor@example.com'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send'

interface FakeFile {
  id: string
  name: string
  mimeType: string
  /** 'root', a folder id, or a shared drive id. */
  parent: string
  modifiedTime: string
  /** Declared size in bytes, for a file that is "too large" without holding 30 MB in memory. */
  size?: number
  sharedWithMe?: boolean
  target?: string
  /** What the stored PDF says: a heading and a few lines. */
  pdf?: [string, string[]]
  image?: 'png' | 'jpeg'
  text?: string
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWN49vojVsQwtCQA9ASwgZ1TSHoAAAAASUVORK5CYII=', 'base64')
const JPEG = Buffer.from(
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAgP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCjQFQf/9k=',
  'base64',
)

const at = (day: string) => `2026-11-${day}T09:00:00.000Z`
const NOTE = 'Invented sample file. Not a real document.'

const FILES: FakeFile[] = [
  // ── My Drive ──
  { id: 'students', name: 'Students', mimeType: FOLDER, parent: 'root', modifiedTime: at('01') },
  { id: 'office', name: 'Office templates', mimeType: FOLDER, parent: 'root', modifiedTime: at('01') },
  { id: 'office-checklist', name: 'Application checklist template', mimeType: DOC, parent: 'office', modifiedTime: at('02'), pdf: ['Application checklist', ['Transcript requested', 'Test scores sent', 'Essays reviewed', NOTE]] },
  { id: 'office-intake', name: 'New family intake form', mimeType: FORM, parent: 'office', modifiedTime: at('02') },

  // ── Kevin Zhang ──
  { id: 'kevin', name: 'Kevin Zhang', mimeType: FOLDER, parent: 'students', modifiedTime: at('03') },
  { id: 'kevin-transcripts', name: 'Transcripts', mimeType: FOLDER, parent: 'kevin', modifiedTime: at('03') },
  { id: 'kevin-testing', name: 'Testing', mimeType: FOLDER, parent: 'kevin', modifiedTime: at('03') },
  { id: 'kevin-sat-folder', name: 'SAT', mimeType: FOLDER, parent: 'kevin-testing', modifiedTime: at('03') },
  { id: 'kevin-essays', name: 'Essays', mimeType: FOLDER, parent: 'kevin', modifiedTime: at('03') },
  { id: 'kevin-family', name: 'Family finances', mimeType: FOLDER, parent: 'kevin', modifiedTime: at('03') },
  { id: 'kevin-transcript', name: 'Kevin Zhang transcript grades 9-11.pdf', mimeType: PDF, parent: 'kevin-transcripts', modifiedTime: at('04'), pdf: ['Unofficial High School Transcript', ['Student: Kevin Zhang', 'Grades 9 to 11', 'AP Calculus BC: A', 'English 11 Honors: B+', NOTE]] },
  { id: 'kevin-midyear', name: 'Mid-year report photo.jpg', mimeType: 'image/jpeg', parent: 'kevin-transcripts', modifiedTime: at('05'), image: 'jpeg' },
  { id: 'kevin-sat', name: 'SAT score report Aug 2026.pdf', mimeType: PDF, parent: 'kevin-sat-folder', modifiedTime: at('06'), pdf: ['SAT Score Report', ['Student: Kevin Zhang', 'Test date: August 2026', 'Total: 1480', 'Math: 770', 'Reading and Writing: 710', NOTE]] },
  { id: 'kevin-ap', name: 'AP scores screenshot.png', mimeType: 'image/png', parent: 'kevin-testing', modifiedTime: at('06'), image: 'png' },
  { id: 'kevin-essay-doc', name: 'Personal statement draft 3', mimeType: DOC, parent: 'kevin-essays', modifiedTime: at('07'), pdf: ['Personal statement, draft 3', ['Kevin Zhang', 'The robotics lab smelled of solder the first night I stayed late.', NOTE]] },
  { id: 'kevin-activities', name: 'Activities list', mimeType: SHEET, parent: 'kevin', modifiedTime: at('07'), pdf: ['Activities list', ['Robotics club: captain, grades 10 to 12', 'Math tutoring: 2 hours a week', NOTE]] },
  { id: 'kevin-aid', name: 'Financial aid worksheet 2026.pdf', mimeType: PDF, parent: 'kevin-family', modifiedTime: at('08'), pdf: ['Financial Aid Worksheet', ['Family: Zhang', 'Household income and assets, tax year 2025', 'Expected family contribution estimate', NOTE]] },
  { id: 'kevin-video', name: 'Robotics demo recording.mp4', mimeType: 'video/mp4', parent: 'kevin', modifiedTime: at('08'), size: 31_457_280 },
  { id: 'kevin-scan', name: 'Full application binder scan.pdf', mimeType: PDF, parent: 'kevin', modifiedTime: at('08'), size: 41_943_040 },
  { id: 'kevin-notes', name: 'call notes.txt', mimeType: 'text/plain', parent: 'kevin', modifiedTime: at('08'), text: 'Invented notes.' },
  { id: 'kevin-survey', name: 'Senior year survey', mimeType: FORM, parent: 'kevin', modifiedTime: at('08') },
  // The same transcript again under another name: the same contents are stored once.
  { id: 'kevin-transcript-copy', name: 'Copy of transcript.pdf', mimeType: PDF, parent: 'kevin', modifiedTime: at('09'), pdf: ['Unofficial High School Transcript', ['Student: Kevin Zhang', 'Grades 9 to 11', 'AP Calculus BC: A', 'English 11 Honors: B+', NOTE]] },
  { id: 'kevin-shortcut', name: 'Recommendation letter (shortcut)', mimeType: SHORTCUT, parent: 'kevin', modifiedTime: at('09'), target: 'shared-rec' },

  // ── Emily Chen ──
  { id: 'emily', name: 'Emily Chen', mimeType: FOLDER, parent: 'students', modifiedTime: at('03') },
  { id: 'emily-school', name: 'School records', mimeType: FOLDER, parent: 'emily', modifiedTime: at('03') },
  { id: 'emily-transcript', name: 'Emily Chen transcript.pdf', mimeType: PDF, parent: 'emily-school', modifiedTime: at('04'), pdf: ['High School Transcript', ['Student: Emily Chen', 'Grades 9 to 11', 'Cumulative GPA: 3.9', NOTE]] },
  { id: 'emily-resume', name: 'Resume', mimeType: DOC, parent: 'emily', modifiedTime: at('05'), pdf: ['Resume', ['Emily Chen', 'Debate team, orchestra, hospital volunteer', NOTE]] },
  { id: 'emily-passport', name: 'Passport photo page.png', mimeType: 'image/png', parent: 'emily', modifiedTime: at('05'), image: 'png' },

  // ── Sophia Martinez ──
  { id: 'sophia', name: 'Sophia Martinez', mimeType: FOLDER, parent: 'students', modifiedTime: at('03') },
  { id: 'sophia-act', name: 'ACT score report.pdf', mimeType: PDF, parent: 'sophia', modifiedTime: at('04'), pdf: ['ACT Score Report', ['Student: Sophia Martinez', 'Composite: 32', NOTE]] },
  { id: 'sophia-essay', name: 'Why this college essay', mimeType: DOC, parent: 'sophia', modifiedTime: at('05'), pdf: ['Why this college', ['Sophia Martinez', 'I first heard about the marine lab from my aunt.', NOTE]] },

  // ── Shared with me ──
  { id: 'shared-rec', name: 'Recommendation letter Ms. Alvarez.pdf', mimeType: PDF, parent: 'elsewhere', sharedWithMe: true, modifiedTime: at('10'), pdf: ['Letter of Recommendation', ['For: Kevin Zhang', 'From: Ms. Alvarez, Physics', 'Kevin is the student who stays to help others finish the lab.', NOTE]] },
  { id: 'shared-folder', name: 'Cedar Mesa counseling office', mimeType: FOLDER, parent: 'elsewhere', sharedWithMe: true, modifiedTime: at('10') },
  { id: 'shared-profile', name: 'School profile 2026-27.pdf', mimeType: PDF, parent: 'shared-folder', modifiedTime: at('10'), pdf: ['School Profile 2026-27', ['Cedar Mesa High School (invented)', 'Grading scale and course offerings', NOTE]] },

  // ── A shared drive ──
  { id: 'team-deadlines', name: 'Deadlines by college', mimeType: SHEET, parent: 'team-drive', modifiedTime: at('11'), pdf: ['Deadlines by college', ['Early action: November 1', 'Regular decision: January 5', NOTE]] },
]

interface FakeState {
  removed?: string[]
  touched?: Record<string, string>
  added?: { id: string; name: string; parent: string; mimeType?: string }[]
  expired?: boolean
}

function state(): FakeState {
  const path = process.env.GOOGLE_FAKE_STATE
  if (!path) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as FakeState
  } catch {
    return {}
  }
}

function files(): FakeFile[] {
  const s = state()
  const removed = new Set(s.removed ?? [])
  const added: FakeFile[] = (s.added ?? []).map((a) => ({ id: a.id, name: a.name, parent: a.parent, mimeType: a.mimeType ?? PDF, modifiedTime: at('20'), pdf: [a.name, ['Added to the invented Drive for a test.', NOTE]] }))
  return [...FILES, ...added].filter((f) => !removed.has(f.id)).map((f) => (s.touched?.[f.id] ? { ...f, modifiedTime: s.touched[f.id] } : f))
}

function bytesOf(file: FakeFile): Uint8Array {
  if (file.image) return file.image === 'png' ? PNG : JPEG
  if (file.text) return Buffer.from(file.text, 'utf8')
  // A changed file has changed contents too.
  const [heading, lines] = file.pdf ?? [file.name, [NOTE]]
  const touched = state().touched?.[file.id]
  return tinyPdf(heading, touched ? [...lines, `Revised ${touched.slice(0, 10)}`] : lines)
}

const meta = (file: FakeFile) => ({
  id: file.id,
  name: file.name,
  mimeType: file.mimeType,
  modifiedTime: file.modifiedTime,
  trashed: false,
  webViewLink: `https://drive.google.com/${file.mimeType === FOLDER ? 'drive/folders' : 'file/d'}/${file.id}`,
  ...(file.mimeType.startsWith('application/vnd.google-apps.') ? {} : { size: String(file.size ?? bytesOf(file).length) }),
  ...(file.target ? { shortcutDetails: { targetId: file.target, targetMimeType: FILES.find((f) => f.id === file.target)?.mimeType } } : {}),
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const notFound = () => json({ error: { code: 404, message: 'File not found.' } }, 404)

function list(q: string): FakeFile[] {
  const all = files()
  const parent = q.match(/'((?:[^'\\]|\\.)*)' in parents/)?.[1]
  if (parent !== undefined) return all.filter((f) => f.parent === parent)
  if (/sharedWithMe\s*=\s*true/.test(q)) return all.filter((f) => f.sharedWithMe)
  const term = q.match(/name contains '((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\(.)/g, '$1').toLowerCase()
  if (term !== undefined) return all.filter((f) => f.name.toLowerCase().includes(term) || (f.pdf && [f.pdf[0], ...f.pdf[1]].join(' ').toLowerCase().includes(term)))
  return []
}

/** Answers one request the way Google would. Anything it does not know is a 404. */
export async function fakeGoogle(url: string, init?: RequestInit): Promise<Response> {
  const at = new URL(url)
  const method = (init?.method ?? 'GET').toUpperCase()
  const form = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(typeof init?.body === 'string' ? init.body : '')

  if (at.hostname === 'oauth2.googleapis.com' && at.pathname === '/token' && method === 'POST') {
    if (form.get('grant_type') === 'authorization_code') {
      const code = form.get('code')
      if (code !== 'fake-code' && code !== 'fake-code-gmail') return json({ error: 'invalid_grant', error_description: 'Bad code.' }, 400)
      const gmail = code === 'fake-code-gmail'
      return json({ access_token: 'fake-access-token', expires_in: 3600, refresh_token: gmail ? 'fake-refresh-token-gmail' : 'fake-refresh-token', scope: gmail ? `${DRIVE_SCOPE} ${GMAIL_SCOPE}` : DRIVE_SCOPE, token_type: 'Bearer' })
    }
    if (state().expired || !form.get('refresh_token')?.startsWith('fake-refresh-token')) return json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400)
    return json({ access_token: 'fake-access-token', expires_in: 3600, token_type: 'Bearer' })
  }
  if (at.hostname === 'oauth2.googleapis.com' && at.pathname === '/revoke') return json({})

  // The invented Gmail: accepts a message, sends nothing, and answers with an id.
  if (at.hostname === 'gmail.googleapis.com' && at.pathname === '/gmail/v1/users/me/messages/send' && method === 'POST') {
    if (new Headers(init?.headers).get('authorization') !== 'Bearer fake-access-token' || state().expired) return json({ error: { code: 401, message: 'Invalid Credentials' } }, 401)
    return json({ id: `fake-gmail-${Date.now().toString(36)}`, threadId: 'fake-thread', labelIds: ['SENT'] })
  }

  if (at.hostname !== 'www.googleapis.com' || !at.pathname.startsWith('/drive/v3/')) return notFound()
  const headers = new Headers(init?.headers)
  // A revoked grant: Google stops taking the access token too.
  if (headers.get('authorization') !== 'Bearer fake-access-token' || state().expired) return json({ error: { code: 401, message: 'Invalid Credentials' } }, 401)
  const path = at.pathname.slice('/drive/v3'.length)

  if (path === '/about') return json({ user: { emailAddress: FAKE_ADDRESS } })
  if (path === '/drives') return json({ drives: [{ id: 'team-drive', name: 'Counseling team (shared drive)' }] })
  if (path === '/files') {
    const found = list(at.searchParams.get('q') ?? '').sort((a, b) => Number(b.mimeType === FOLDER) - Number(a.mimeType === FOLDER) || a.name.localeCompare(b.name))
    // Two pages when there is enough, so paging is exercised.
    const size = Math.min(Number(at.searchParams.get('pageSize')) || 100, 8)
    const from = Number(at.searchParams.get('pageToken') ?? 0) || 0
    const page = found.slice(from, from + size)
    return json({ files: page.map(meta), ...(from + size < found.length ? { nextPageToken: String(from + size) } : {}) })
  }
  const one = path.match(/^\/files\/([^/]+)(\/export)?$/)
  const file = one && files().find((f) => f.id === decodeURIComponent(one[1]))
  if (!one || !file) return notFound()
  if (one[2]) {
    if (!file.pdf || !file.mimeType.startsWith('application/vnd.google-apps.')) return json({ error: { code: 403, message: 'Export only supports Docs Editors files.', errors: [{ reason: 'fileNotExportable' }] } }, 403)
    return new Response(bytesOf(file) as BodyInit, { headers: { 'content-type': PDF } })
  }
  if (at.searchParams.get('alt') === 'media') {
    if (file.mimeType.startsWith('application/vnd.google-apps.')) return json({ error: { code: 403, message: 'Only files with binary content can be downloaded.' } }, 403)
    return new Response(bytesOf(file) as BodyInit, { headers: { 'content-type': file.mimeType } })
  }
  return json(meta(file))
}
