// Offline checks for the Google connection and Drive import. No keys, no
// network: Google is the invented Drive in server/google/fakeDrive.ts, and
// Supabase is the in-memory stand-in in scripts/fakeSupabase.ts. Any request
// to a real address fails the run. Run with:
//
//   npm run test:google        (also part of npm run test:notes)
//
// What is NOT checked here: row level security (who may read which row). That
// is the database's job and needs the real project.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { MAX_FILE_BYTES, MIME } from '../shared/files.js'
import { DRIVE_SCOPE, GMAIL_SEND_SCOPE, REASON, SYNC_BUDGET_MS, driveKind, planSync, takeBatch, type ListedFile } from '../shared/google.js'
import { deleteStoredFiles, sorter } from '../server/documentSorting.js'
import { fakeMode, google } from '../server/google/config.js'
import { GoogleError, STATE_COOKIE, accessTokenFor, connectionStatus, disconnect, finishConnect, forgetAccessTokens, startConnect } from '../server/google/connection.js'
import { browseDrive } from '../server/google/drive.js'
import { importDriveFile, importRemovedAgain, isDuplicate, linkFolder, listFolders, syncClock, syncFolder, unlinkFolder } from '../server/google/driveFiles.js'
import { fakeGoogle } from '../server/google/fakeDrive.js'
import { decryptToken, encryptToken, newNonce, signState, verifyState } from '../server/google/secrets.js'
import type { Caller } from '../server/supabase.js'
import type { Database } from '../src/lib/database.types.js'
import { FAKE_SUPABASE_URL, fakeSupabase } from './fakeSupabase.js'

let failed = 0
function check(name: string, pass: boolean, detail = ''): void {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
const throwsWith = async (work: () => Promise<unknown>, code: string) => {
  try {
    await work()
    return false
  } catch (error) {
    return error instanceof GoogleError ? error.code === code : (error as { status?: number }).status !== undefined && code === 'file'
  }
}

// ── Setup: invented settings, no real address reachable ─────────────────────

process.env.VITE_SUPABASE_URL = FAKE_SUPABASE_URL
process.env.VITE_SUPABASE_ANON_KEY = 'anon'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
process.env.GOOGLE_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64')
delete process.env.GOOGLE_FAKE
delete process.env.ANTHROPIC_API_KEY
const stateFile = join(mkdtempSync(join(tmpdir(), 'platinum-google-')), 'drive.json')
const setDrive = (state: object) => writeFileSync(stateFile, JSON.stringify(state))
setDrive({})
process.env.GOOGLE_FAKE_STATE = stateFile

const db = fakeSupabase()
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const answer = await db.fetch(input, init)
  if (answer) return answer
  throw new Error(`An offline test tried to reach ${new URL(input instanceof Request ? input.url : String(input)).origin}`)
}) as typeof fetch

/** Every request made to "Google" in this run. */
const googleCalls: { method: string; url: URL }[] = []
google.fetch = (url, init) => {
  googleCalls.push({ method: (init?.method ?? 'GET').toUpperCase(), url: new URL(url) })
  return fakeGoogle(url, init)
}
const downloads = () => googleCalls.filter((c) => c.url.searchParams.get('alt') === 'media' || c.url.pathname.endsWith('/export')).length
const listings = () => googleCalls.filter((c) => c.url.pathname === '/drive/v3/files').length

const FIRM = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const OTHER_USER = '33333333-3333-4333-8333-333333333333'
const KEVIN = '44444444-4444-4444-8444-444444444444'
const EMILY = '55555555-5555-4555-8555-555555555555'
const FOLDERS = { transcripts: '66666666-6666-4666-8666-666666666661', tests: '66666666-6666-4666-8666-666666666662', aid: '66666666-6666-4666-8666-666666666663', other: '66666666-6666-4666-8666-666666666664' }
db.table('firms').push({ id: FIRM, sort_files_automatically: true })
db.table('firm_members').push({ firm_id: FIRM, user_id: USER, role: 'owner' }, { firm_id: FIRM, user_id: OTHER_USER, role: 'counselor' })
db.table('students').push({ id: KEVIN, firm_id: FIRM, first_name: 'Kevin', last_name: 'Zhang', archived: false }, { id: EMILY, firm_id: FIRM, first_name: 'Emily', last_name: 'Chen', archived: false })
db.table('document_types').push(
  { id: FOLDERS.transcripts, firm_id: FIRM, name: 'Transcripts and grades', description: '', sensitivity: 'standard', position: 1, archived_at: null },
  { id: FOLDERS.tests, firm_id: FIRM, name: 'Test scores', description: '', sensitivity: 'standard', position: 2, archived_at: null },
  { id: FOLDERS.aid, firm_id: FIRM, name: 'Financial aid', description: '', sensitivity: 'restricted', position: 3, archived_at: null },
  { id: FOLDERS.other, firm_id: FIRM, name: 'Other', description: '', sensitivity: 'standard', position: 4, archived_at: null },
)

type SignedIn = Extract<Caller, { ok: true }>
const callerFor = (userId: string, role: 'owner' | 'counselor'): SignedIn => ({ ok: true, userId, firmId: FIRM, role, client: createClient<Database>(FAKE_SUPABASE_URL, 'anon', { auth: { persistSession: false, autoRefreshToken: false } }) })
const owner = callerFor(USER, 'owner')
const colleague = callerFor(OTHER_USER, 'counselor')

/** The sorter, without a model: the folder comes from the Drive subfolder hint or the file name. */
const hints: (string | undefined)[] = []
sorter.classify = async (input) => {
  hints.push(input.driveFolder)
  const text = `${input.driveFolder ?? ''} ${input.filename}`.toLowerCase()
  const typeId = /financ/.test(text) ? FOLDERS.aid : /testing|sat |ap /.test(text) ? FOLDERS.tests : /transcript|report/.test(text) ? FOLDERS.transcripts : FOLDERS.other
  return { output: { typeId, title: input.filename.replace(/\.[a-z]+$/i, ''), schoolYear: null, studentName: null, reason: 'Stub.', alternatives: [], sure: typeId !== FOLDERS.other }, model: 'stub' }
}

// ── 1. Token encryption ─────────────────────────────────────────────────────

const KEY = process.env.GOOGLE_TOKEN_KEY
{
  const secret = '1//refresh-token-值'
  const stored = encryptToken(secret, USER, KEY)
  check('a refresh token survives the round trip', decryptToken(stored, USER, KEY) === secret)
  check('…and the stored value does not contain it', !stored.includes('refresh-token') && stored.startsWith('v1.'))
  check('…and two encryptions of the same token differ', encryptToken(secret, USER, KEY) !== stored)
  const refuses = (work: () => unknown) => {
    try {
      work()
      return false
    } catch {
      return true
    }
  }
  check('a value copied to another user does not decrypt', refuses(() => decryptToken(stored, OTHER_USER, KEY)))
  check('another key does not decrypt it', refuses(() => decryptToken(stored, USER, Buffer.alloc(32, 8).toString('base64'))))
  const parts = stored.split('.')
  const flipped = Buffer.from(parts[3], 'base64url')
  flipped[0] ^= 1
  check('a changed ciphertext is refused', refuses(() => decryptToken([parts[0], parts[1], parts[2], flipped.toString('base64url')].join('.'), USER, KEY)))
  check('a key given as hex or as plain words also works', decryptToken(encryptToken(secret, USER, 'ab'.repeat(32)), USER, 'ab'.repeat(32)) === secret && decryptToken(encryptToken(secret, USER, 'some words'), USER, 'some words') === secret)
  check('an empty key is refused', refuses(() => encryptToken(secret, USER, '')))
}

// ── 2. The state check ──────────────────────────────────────────────────────

{
  const nonce = newNonce()
  const now = Date.now()
  const state = signState({ userId: USER, firmId: FIRM, gmail: false }, nonce, KEY, now)
  const claims = verifyState(state, nonce, KEY, now + 1000)
  check('a state we signed is accepted, with who started it', claims?.userId === USER && claims.firmId === FIRM && claims.gmail === false)
  check('…not after ten minutes', verifyState(state, nonce, KEY, now + 601_000) === undefined)
  check('…not in another browser (the cookie must match)', verifyState(state, newNonce(), KEY, now) === undefined && verifyState(state, undefined, KEY, now) === undefined)
  check('…not signed with another key', verifyState(state, nonce, 'another key', now) === undefined)
  const [payload, signature] = state.split('.')
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), u: OTHER_USER })).toString('base64url')
  check('…not with the user changed', verifyState(`${forged}.${signature}`, nonce, KEY, now) === undefined)
  check('nonsense is refused', verifyState('abc', nonce, KEY) === undefined && verifyState('', nonce, KEY) === undefined && verifyState('a.b.c', nonce, KEY) === undefined)
}

// ── 3. The invented Drive is for the dev server only ────────────────────────

{
  const refused = (set: () => void) => {
    const before = { ...process.env }
    process.env.GOOGLE_FAKE = '1'
    set()
    try {
      fakeMode()
      return false
    } catch {
      return true
    } finally {
      for (const key of ['GOOGLE_FAKE', 'VERCEL', 'NODE_ENV', 'PLATINUM_DEV_SERVER']) if (before[key] === undefined) delete process.env[key]
      else process.env[key] = before[key]
    }
  }
  check('GOOGLE_FAKE=1 is refused outside the dev server', refused(() => delete process.env.PLATINUM_DEV_SERVER))
  check('…on Vercel', refused(() => Object.assign(process.env, { PLATINUM_DEV_SERVER: '1', VERCEL: '1' })))
  check('…and in production', refused(() => Object.assign(process.env, { PLATINUM_DEV_SERVER: '1', NODE_ENV: 'production' })))
  check('without it, Google is real', fakeMode() === false)
}

// ── 4. Which files can be stored ────────────────────────────────────────────

check('a Google Doc, Sheet or Slides file is saved as a PDF', ['document', 'spreadsheet', 'presentation'].every((t) => driveKind({ name: 'x', mimeType: `application/vnd.google-apps.${t}` }).kind === 'export'))
check('a Google Form, Site or Map is left out quietly', ['form', 'site', 'map', 'jam'].every((t) => driveKind({ name: 'x', mimeType: `application/vnd.google-apps.${t}` }).kind === 'ignore'))
check('a PDF, photo, Word or Excel file is downloaded', ['a.pdf', 'a.JPG', 'a.png', 'a.heic', 'a.docx', 'a.xlsx'].every((name) => driveKind({ name, mimeType: 'application/octet-stream' }).kind === 'download'))
check('anything else is not stored', driveKind({ name: 'a.mp4', mimeType: 'video/mp4' }).kind === 'unsupported' && driveKind({ name: 'notes.txt', mimeType: 'text/plain' }).kind === 'unsupported')

// ── 5. The sync decision ────────────────────────────────────────────────────

{
  const file = (id: string, more: Partial<ListedFile> = {}): ListedFile => ({ id, name: `${id}.pdf`, mimeType: MIME.pdf, modifiedTime: '2026-11-10T09:00:00.000Z', size: 1000, hint: '', ...more })
  const plan = planSync({
    listed: [
      file('new'),
      file('same'),
      file('changed', { modifiedTime: '2026-11-12T09:00:00.000Z' }),
      file('deleted-here'),
      file('half-made'),
      file('video', { name: 'clip.mp4', mimeType: 'video/mp4' }),
      file('huge', { size: MAX_FILE_BYTES + 1 }),
      file('form', { mimeType: 'application/vnd.google-apps.form' }),
      file('settled'),
      file('new'),
    ],
    known: [
      { driveFileId: 'same', documentId: 'd-same', driveModifiedAt: '2026-11-10T09:00:00+00:00', fileStatus: 'filed' },
      { driveFileId: 'changed', documentId: 'd-changed', driveModifiedAt: '2026-11-10T09:00:00+00:00', fileStatus: 'filed' },
      { driveFileId: 'gone', documentId: 'd-gone', driveModifiedAt: '2026-11-10T09:00:00+00:00', fileStatus: 'filed' },
      { driveFileId: 'half-made', documentId: 'd-half', driveModifiedAt: null, fileStatus: 'uploading' },
      { driveFileId: 'elsewhere', documentId: 'd-elsewhere', driveModifiedAt: null, fileStatus: 'filed' },
    ],
    state: { known: ['same', 'changed', 'gone'], removedHere: ['deleted-here'], settled: { settled: '2026-11-10T09:00:00.000Z' } },
    maxBytes: MAX_FILE_BYTES,
  })
  const queued = (id: string) => plan.queue.find((q) => q.id === id)
  check('a new file is imported, once even when it is listed twice', plan.queue.filter((q) => q.id === 'new').length === 1 && queued('new')?.change === 'new')
  check('a file that has not changed is left alone', !queued('same'))
  check('a file changed in Drive replaces its stored copy', queued('changed')?.change === 'changed' && queued('changed')?.documentId === 'd-changed')
  check('a file removed from Drive keeps its copy and is marked', plan.missing.length === 1 && plan.missing[0] === 'gone')
  check('…but a Drive file that never came from this folder is not marked', !plan.missing.includes('elsewhere'))
  check('a file deleted here is not imported again', !queued('deleted-here'))
  check('a half-made row is removed and the file imported again', plan.unfinished.includes('d-half') && queued('half-made')?.change === 'new')
  check('a file that cannot be stored is listed with the reason', plan.skipped.some((s) => s.name === 'clip.mp4' && s.reason === REASON.unsupported) && plan.skipped.some((s) => s.name === 'huge.pdf' && s.reason === REASON.tooLarge))
  check('a Google Form is left out without a word', !queued('form') && !plan.skipped.some((s) => s.name.startsWith('form')))
  check('a file left out last time is not read again until it changes', !queued('settled'))
  const again = planSync({ listed: [file('settled', { modifiedTime: '2026-11-15T09:00:00.000Z' })], known: [], state: { settled: { settled: '2026-11-10T09:00:00.000Z' } }, maxBytes: MAX_FILE_BYTES })
  check('…and is once it does', again.queue.length === 1)
  const limits = planSync({ listed: [], known: [], state: {}, truncated: true, tooDeep: ['Deep folder'], maxBytes: MAX_FILE_BYTES })
  check('the 500-file and 5-level limits are told to the counselor', limits.skipped.some((s) => s.reason === REASON.tooMany) && limits.skipped.some((s) => s.name === 'Deep folder' && s.reason === REASON.tooDeep))
}

// ── 6. The duplicate rule and batching ──────────────────────────────────────

{
  const held = [{ content_hash: 'aa', drive_file_id: 'one', file_status: 'filed' }, { content_hash: 'bb', drive_file_id: null, file_status: 'uploading' }]
  check('the same contents under another Drive id are a duplicate', isDuplicate('aa', held, 'two'))
  check('…the same Drive file is not a duplicate of itself', !isDuplicate('aa', held, 'one'))
  check('…and a file still uploading does not count', !isDuplicate('bb', held, 'two'))

  let clock = 0
  const goOn = takeBatch([1, 2, 3, 4, 5], 0, () => clock, SYNC_BUDGET_MS)
  const taken: number[] = []
  for (let n = 0; goOn(n); n++) {
    taken.push(n)
    clock += 15_000
  }
  check('a batch stops taking files after about 40 seconds', taken.length === 3, `${taken.length} files at 15 s each`)
  clock = 999_999
  check('…but always takes at least one', takeBatch([1], 0, () => clock, SYNC_BUDGET_MS)(0) === true)
  check('…and never more than there are, or than the cap', takeBatch([1, 2], 0, () => 0, SYNC_BUDGET_MS)(2) === false && takeBatch([1, 2, 3], 0, () => 0, SYNC_BUDGET_MS, 2)(2) === false)
}

// ── 7. Connect, status, disconnect ──────────────────────────────────────────

const request = (path: string, cookie?: string) => new Request(`http://localhost:5173${path}`, { headers: cookie ? { cookie } : {} })
const cookieOf = (setCookie: string) => setCookie.split(';')[0]
{
  check('before connecting, status says so', (await connectionStatus(owner)).connected === false)

  const started = startConnect(owner, request('/api/google'), {})
  const url = new URL(started.url)
  const p = url.searchParams
  check('the consent address is Google’s, for the authorization code flow', url.origin + url.pathname === 'https://accounts.google.com/o/oauth2/v2/auth' && p.get('response_type') === 'code')
  check('…with offline access and prompt=consent', p.get('access_type') === 'offline' && p.get('prompt') === 'consent')
  check('…asking for drive.readonly and nothing else', p.get('scope') === DRIVE_SCOPE)
  check('…sending the person back to /api/google on this address', p.get('redirect_uri') === 'http://localhost:5173/api/google')
  check('…with our client id and never the secret', p.get('client_id') === process.env.GOOGLE_CLIENT_ID && !started.url.includes('test-client-secret'))
  check('…and a state tied to this browser by an HttpOnly cookie', Boolean(p.get('state')) && /HttpOnly/.test(started.setCookie) && /SameSite=Lax/.test(started.setCookie) && started.setCookie.startsWith(`${STATE_COOKIE}=`))
  const withGmail = new URL(startConnect(owner, request('/api/google'), { gmail: true }).url).searchParams
  check('turning on Gmail asks for gmail.send on top, keeping what was granted', withGmail.get('scope') === `${DRIVE_SCOPE} ${GMAIL_SEND_SCOPE}` && withGmail.get('include_granted_scopes') === 'true')

  const state = p.get('state')!
  const before = googleCalls.length
  check('a callback with a bad state is refused', (await finishConnect(request(`/api/google?code=fake-code&state=${state}x`, cookieOf(started.setCookie)))).outcome === 'failed')
  check('…and one without the cookie', (await finishConnect(request(`/api/google?code=fake-code&state=${state}`))).outcome === 'failed')
  check('…before Google is asked anything', googleCalls.length === before)
  check('a bad code is refused', (await finishConnect(request(`/api/google?code=wrong&state=${state}`, cookieOf(started.setCookie)))).outcome === 'failed' && db.table('google_connections').length === 0)
  check('pressing Cancel at Google changes nothing', (await finishConnect(request(`/api/google?error=access_denied&state=${state}`, cookieOf(started.setCookie)))).outcome === 'declined' && db.table('google_connections').length === 0)

  const done = await finishConnect(request(`/api/google?code=fake-code&state=${state}`, cookieOf(started.setCookie)))
  const row = db.table('google_connections')[0]
  check('a good callback connects', done.outcome === 'connected' && row?.user_id === USER && row.firm_id === FIRM)
  check('…and clears the cookie', /Max-Age=0/.test(done.clearCookie))
  check('…storing the refresh token encrypted', typeof row.refresh_token_encrypted === 'string' && !String(row.refresh_token_encrypted).includes('fake-refresh-token') && decryptToken(String(row.refresh_token_encrypted), USER, KEY) === 'fake-refresh-token')
  const status = await connectionStatus(owner)
  check('status gives the address and what is allowed', status.connected && status.address === 'sample.counselor@example.com' && status.drive && !status.gmail)
  check('…and never a token', !JSON.stringify(status).includes('token'))
  check('a colleague has no connection of their own', (await connectionStatus(colleague)).connected === false)
  check('…and cannot read Drive through someone else’s', await throwsWith(() => browseDrive(OTHER_USER, { parent: 'root' }), 'not_connected'))
}

// ── 8. Browse and search ────────────────────────────────────────────────────

{
  const root = await browseDrive(USER, { parent: 'root' })
  check('My Drive lists its folders', root.entries.some((e) => e.name === 'Students' && e.kind === 'folder'))
  const kevin = await browseDrive(USER, { parent: 'kevin' })
  check('a long folder comes in pages', Boolean(kevin.nextPageToken))
  const rest = await browseDrive(USER, { parent: 'kevin', pageToken: kevin.nextPageToken })
  const all = [...kevin.entries, ...rest.entries]
  check('a file too large or of a kind that cannot be stored says so', Boolean(all.find((e) => e.name.endsWith('.mp4'))?.blocked) && all.find((e) => e.name.startsWith('Full application'))?.blocked === REASON.tooLarge && Boolean(all.find((e) => e.name === 'Senior year survey')?.blocked))
  check('a shortcut shows as the file it points to', all.find((e) => e.name.includes('shortcut'))?.id === 'shared-rec')
  check('Shared with me and shared drives are listed', (await browseDrive(USER, { parent: 'shared' })).entries.some((e) => e.id === 'shared-rec') && (await browseDrive(USER, { parent: 'drives' })).entries[0]?.kind === 'drive')
  check('a shared drive opens like a folder', (await browseDrive(USER, { parent: 'team-drive' })).entries.some((e) => e.label === 'Google Sheet'))
  const search = await browseDrive(USER, { parent: 'root', query: "SAT's" }).then(() => browseDrive(USER, { parent: 'root', query: 'transcript' }))
  check('search finds files by name across the Drive', search.entries.filter((e) => /transcript/i.test(e.name)).length >= 3)
  const last = googleCalls.findLast((c) => c.url.searchParams.get('q')?.includes("SAT\\'s"))
  check('…and a quote in the search text is escaped', Boolean(last))
}

// ── 9. Importing picked files ───────────────────────────────────────────────

{
  const pdf = await importDriveFile(owner, { fileId: 'emily-transcript', studentId: EMILY })
  check('a picked PDF enters the upload pipeline for the student', !pdf.already && pdf.document.student_id === EMILY && pdf.document.file_status === 'sorting' && pdf.document.uploaded_by_kind === 'counselor')
  check('…marked as from Google Drive, with a link that opens it there', pdf.document.source === 'google_drive' && pdf.document.drive_file_id === 'emily-transcript' && /^https:\/\/drive\.google\.com\//.test(pdf.document.drive_url ?? ''))
  check('…with its hash recorded and the bytes in storage', /^[0-9a-f]{64}$/.test(pdf.document.content_hash ?? '') && db.objects.has(`documents/${pdf.document.storage_path}`))
  const again = await importDriveFile(owner, { fileId: 'emily-transcript', studentId: EMILY })
  check('the same Drive file again is not stored twice', again.already && again.document.id === pdf.document.id && db.table('documents').length === 1)

  const doc = await importDriveFile(owner, { fileId: 'emily-resume', studentId: EMILY })
  check('a Google Doc is stored as a PDF', doc.document.mime_type === MIME.pdf && doc.document.original_filename === 'Resume.pdf')
  const loose = await importDriveFile(owner, { fileId: 'team-deadlines' })
  check('with no student, the file waits for one', loose.document.student_id === null && loose.document.file_status === 'sorting')
  const viaShortcut = await importDriveFile(owner, { fileId: 'kevin-shortcut' })
  check('a shortcut is followed to its target', viaShortcut.document.drive_file_id === 'shared-rec')
  check('a Google Form is refused', await throwsWith(() => importDriveFile(owner, { fileId: 'kevin-survey', studentId: EMILY }), 'refused'))
  check('a file over 25 MB is refused', await throwsWith(() => importDriveFile(owner, { fileId: 'kevin-scan', studentId: EMILY }), 'refused'))
  check('a folder is refused', await throwsWith(() => importDriveFile(owner, { fileId: 'kevin', studentId: EMILY }), 'refused'))
  check('a file that is not there is refused', await throwsWith(() => importDriveFile(owner, { fileId: 'no-such-file', studentId: EMILY }), 'refused'))
}

// ── 10. A linked folder: sync in batches, interrupted, repeated ─────────────

const kevinDocs = () => db.table('documents').filter((d) => d.student_id === KEVIN)
const byDrive = (id: string) => kevinDocs().find((d) => d.drive_file_id === id)
{
  check('a file cannot be linked as a folder', await throwsWith(() => linkFolder(owner, { folderId: 'kevin-sat', studentId: KEVIN }), 'refused'))
  const folder = await linkFolder(owner, { folderId: 'kevin', studentId: KEVIN })
  check('a folder is linked to the student', folder.name === 'Kevin Zhang' && folder.mine && folder.status === 'syncing')
  check('…and not twice', await throwsWith(() => linkFolder(owner, { folderId: 'kevin', studentId: KEVIN }), 'file'))
  check('a colleague sees the link, and that it is not theirs', (await listFolders(colleague, KEVIN))[0]?.mine === false)

  // Each call takes two files: the clock jumps past the 40 seconds after the second.
  let ticks = 0
  syncClock.now = () => Date.now() + Math.floor(ticks++ / 2) * 25_000
  process.env.GOOGLE_SYNC_BATCH = '2'
  const first = await syncFolder(owner, { id: folder.id })
  check('the first call imports a batch and says more remains', first.more && first.folder.done === 2 && first.folder.total === 9 && kevinDocs().length === 2, `${first.folder.done} of ${first.folder.total}`)
  check('…handing back the rows it filed', first.documents.length === 2 && first.documents.every((d) => d.file_status === 'filed' && d.sorted_by === 'auto'))

  // A second caller while one is under way does nothing.
  db.table('student_drive_folders')[0].lease_until = new Date(Date.now() + 60_000).toISOString()
  const busy = await syncFolder(colleague, { id: folder.id })
  check('two syncs of one folder never run together', busy.busy && kevinDocs().length === 2)
  db.table('student_drive_folders')[0].lease_until = null

  // Interrupted: the next file's row was made and the call died before the file was stored and checked.
  const queue = (db.table('student_drive_folders')[0].sync_state as { queue: { id: string }[] }).queue
  db.table('documents').push({ id: '77777777-7777-4777-8777-777777777777', firm_id: FIRM, student_id: KEVIN, drive_file_id: queue[0].id, file_status: 'uploading', storage_path: `${FIRM}/${KEVIN}/77777777-7777-4777-8777-777777777777/half.pdf`, content_hash: null, name: 'half', kind: 'other' })
  const listedBefore = listings()
  let calls = 1
  let result = await syncFolder(colleague, { id: folder.id })
  check('an interrupted sync carries on from where it stopped', result.folder.done === 4 && listedBefore === listings(), 'the folder was not read again')
  while (result.more && calls++ < 20) result = await syncFolder(owner, { id: folder.id })
  delete process.env.GOOGLE_SYNC_BATCH
  syncClock.now = () => Date.now()

  const docs = kevinDocs()
  const ids = docs.map((d) => d.drive_file_id).sort()
  check('the whole folder is imported, subfolders included', result.folder.status === 'idle' && Boolean(result.folder.lastSyncedAt) && ids.join() === ['kevin-activities', 'kevin-aid', 'kevin-ap', 'kevin-essay-doc', 'kevin-midyear', 'kevin-sat', 'kevin-transcript-copy', 'shared-rec'].sort().join(), `${docs.length} files in ${calls} calls`)
  check('…with no file twice, and the half-made row gone', new Set(ids).size === docs.length && !db.table('documents').some((d) => d.file_status === 'uploading'))
  check('every file is filed for the student, by the AI, like a student’s own upload', docs.every((d) => d.file_status === 'filed' && d.sorted_by === 'auto' && d.source === 'google_drive' && d.uploaded_by_user === USER))
  check('the Drive subfolder is given to the sorter as a hint', hints.includes('Testing / SAT') && hints.includes('Family finances') && byDrive('kevin-sat')?.type_id === FOLDERS.tests && byDrive('kevin-aid')?.type_id === FOLDERS.aid)
  check('a file the sorter was unsure of is marked to check', byDrive('kevin-essay-doc')?.needs_check === true && byDrive('kevin-sat')?.needs_check === false)
  const skipped = result.folder.skipped
  check('what was left out is listed with the reason, by name', skipped.some((s) => s.name.endsWith('.mp4')) && skipped.some((s) => s.name === 'call notes.txt') && skipped.some((s) => s.name.startsWith('Full application') && s.reason === REASON.tooLarge))
  check('…including a second file with the very same contents', skipped.some((s) => s.name === 'Kevin Zhang transcript grades 9-11.pdf' && s.reason === REASON.duplicate))
  check('…but not the Google Form', !skipped.some((s) => /survey/i.test(s.name)))
  check('the server’s working state is never sent to the browser', !('sync_state' in result.folder) && !JSON.stringify(result.folder).includes('queue'))

  // Again, with nothing changed in Drive.
  const downloadsBefore = downloads()
  const repeat = await syncFolder(owner, { id: folder.id })
  check('a second sync imports nothing and downloads nothing', !repeat.more && repeat.documents.length === 0 && kevinDocs().length === 8 && downloads() === downloadsBefore)

  // Drive changes: one file edited, one removed, one added.
  const satBefore = { ...byDrive('kevin-sat')! }
  byDrive('kevin-sat')!.opened_at = '2026-11-20T00:00:00.000Z'
  setDrive({ touched: { 'kevin-sat': '2026-12-01T10:00:00.000Z' }, removed: ['kevin-ap'], added: [{ id: 'kevin-new', name: 'New essay draft.pdf', parent: 'kevin-essays' }] })
  const changed = await syncFolder(owner, { id: folder.id })
  const sat = byDrive('kevin-sat')!
  check('a file changed in Drive replaces the stored copy', sat.id === satBefore.id && sat.content_hash !== satBefore.content_hash && sat.storage_path === satBefore.storage_path && sat.type_id === satBefore.type_id)
  check('…which shows as new again', sat.opened_at === null && Date.parse(String(sat.drive_modified_at)) === Date.parse('2026-12-01T10:00:00.000Z'))
  check('a file added in Drive is imported', Boolean(byDrive('kevin-new')) && kevinDocs().length === 9)
  check('a file removed from Drive keeps its copy and shows “No longer in Drive”', Boolean(byDrive('kevin-ap')) && changed.folder.missingFileIds.join() === 'kevin-ap')

  // Deleted here.
  await deleteStoredFiles(owner, { documentId: String(byDrive('kevin-midyear')!.id) })
  const afterDelete = await syncFolder(owner, { id: folder.id })
  check('a file deleted here is not imported again', !byDrive('kevin-midyear') && afterDelete.folder.removedHere === 1 && afterDelete.documents.length === 0)
  await importRemovedAgain(owner, folder.id)
  const back = await syncFolder(owner, { id: folder.id })
  check('…unless the counselor asks', Boolean(byDrive('kevin-midyear')) && back.folder.removedHere === 0)

  // Google ends the grant (every 7 days in testing mode).
  setDrive({ expired: true })
  forgetAccessTokens()
  const expired = await syncFolder(colleague, { id: folder.id })
  check('when Google ends the grant, the folder says “Reconnect Google to sync” and nothing breaks', expired.folder.status === 'reconnect' && !expired.more && kevinDocs().length === 9)
  check('…status says to reconnect', (await connectionStatus(owner)).reconnect === true)
  check('…and every Drive feature says the same', (await throwsWith(() => browseDrive(USER, { parent: 'root' }), 'reconnect')) && (await throwsWith(() => accessTokenFor(USER), 'reconnect')))

  // Reconnecting puts it right.
  setDrive({})
  const again = startConnect(owner, request('/api/google'), {})
  await finishConnect(request(`/api/google?code=fake-code&state=${new URL(again.url).searchParams.get('state')}`, cookieOf(again.setCookie)))
  check('reconnecting lets the folder sync again', (await connectionStatus(owner)).reconnect === false && (await syncFolder(owner, { id: folder.id })).folder.status === 'idle')

  await unlinkFolder(colleague, folder.id)
  check('unlinking keeps the files already imported', (await listFolders(owner, KEVIN)).length === 0 && kevinDocs().length >= 9)
}

// ── 11. Gmail is asked for separately, and Drive survives a "no" ────────────

{
  const started = startConnect(owner, request('/api/google'), { gmail: true })
  const state = new URL(started.url).searchParams.get('state')
  const declined = await finishConnect(request(`/api/google?error=access_denied&state=${state}`, cookieOf(started.setCookie)))
  const status = await connectionStatus(owner)
  check('declining Gmail leaves the Drive connection as it was', declined.outcome === 'declined' && status.connected && status.drive && !status.gmail)
}

// ── 12. Disconnect ──────────────────────────────────────────────────────────

{
  const revokes = () => googleCalls.filter((c) => c.url.pathname === '/revoke').length
  const before = revokes()
  const status = await disconnect(owner)
  check('disconnect revokes the grant at Google, then deletes the row', revokes() === before + 1 && db.table('google_connections').length === 0 && status.connected === false)
  check('…after which Drive cannot be read', await throwsWith(() => browseDrive(USER, { parent: 'root' }), 'not_connected'))
}

// ── 13. What was asked of Google, over the whole run ────────────────────────

check('Drive was only ever read: every Drive request is a GET', googleCalls.filter((c) => c.url.hostname === 'www.googleapis.com').every((c) => c.method === 'GET'))
check('the only other requests are the token exchange and revoke', googleCalls.filter((c) => c.url.hostname !== 'www.googleapis.com').every((c) => c.url.hostname === 'oauth2.googleapis.com' && ['/token', '/revoke'].includes(c.url.pathname)))
check('nothing was sent to Gmail', !googleCalls.some((c) => c.url.hostname.includes('gmail')))

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll Google checks passed.')
process.exit(failed ? 1 : 0)
