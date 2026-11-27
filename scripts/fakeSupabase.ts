// A small in-memory stand-in for Supabase's REST and storage endpoints, for
// offline tests. It answers the requests supabase-js makes for plain table
// reads and writes (eq, neq, is, not.is, in, lt, or, order, limit, upsert) and
// for storing, reading and removing objects. It keeps rows in memory and knows
// the unique rules the Google and phone features rely on. A test can also
// register a database function (rpc) and say which access token is which
// person, so identify() in server/supabase.ts works.
//
// It does NOT apply row level security: who may read what is the database's
// job and is checked against the real project (npm run test:isolation), not here.

import { randomUUID } from 'node:crypto'

type Row = Record<string, unknown>

export const FAKE_SUPABASE_URL = 'http://supabase.test'

const DEFAULTS: Record<string, () => Row> = {
  documents: () => ({ needs_check: false, student_id: null, type_id: null, content_hash: null, file_status: null, drive_file_id: null, drive_modified_at: null, drive_url: null, source: null, opened_at: null, ai_suggestion: null, sorted_by: null, title: null, school_year: null }),
  student_drive_folders: () => ({ status: 'idle', progress_done: 0, progress_total: 0, skipped: [], missing_file_ids: [], removed_here_count: 0, sync_state: {}, lease_until: null, last_synced_at: null, last_error: null, drive_url: null }),
  google_connections: () => ({ last_error: null, scopes: [] }),
  document_events: () => ({ detail: {} }),
  // The real table fills `at` in itself.
  activity: () => ({ at: new Date().toISOString() }),
  phone_devices: () => ({ platform: 'ios_shortcut', own_phone: null, notice_shown_at: null, last_wake_at: null, first_seen_at: null, last_seen_at: null, revoked_at: null }),
  phone_send_jobs: () => ({ outbox_id: null, status: 'pending', claim_id: null, claimed_at: null, lease_expires_at: null, reported_at: null, error: null, expires_at: new Date(Date.now() + 600_000).toISOString() }),
  phone_job_events: () => ({ at: new Date().toISOString(), from_status: null, actor_id: null, late: false }),
  phone_setup_codes: () => ({ used_at: null, notice_shown: false }),
}

const UNIQUE: Record<string, (row: Row) => string | undefined> = {
  documents: (r) => (r.drive_file_id && r.student_id ? `${r.firm_id}|${r.student_id}|${r.drive_file_id}` : undefined),
  student_drive_folders: (r) => `${r.student_id}|${r.drive_folder_id}`,
  // One job per outbox row; at most one phone in use per counselor.
  phone_send_jobs: (r) => (r.outbox_id ? String(r.outbox_id) : undefined),
  phone_devices: (r) => (r.revoked_at ? undefined : String(r.counselor_id)),
}
const KEY: Record<string, string> = { google_connections: 'user_id' }

export function fakeSupabase() {
  const tables = new Map<string, Row[]>()
  const objects = new Map<string, Uint8Array>()
  /** Database functions a test has registered, by name. */
  const functions = new Map<string, (args: Row) => unknown>()
  /** Access token to user id, for /auth/v1/user. */
  const users = new Map<string, string>()
  /** What Supabase Auth knows about a person, for tests that need an address: user id to email and whether it is confirmed. */
  const people = new Map<string, { email: string; confirmed: boolean }>()
  const authUser = (id: string) => {
    const known = people.get(id)
    return { id, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date(0).toISOString(), ...(known ? { email: known.email, email_confirmed_at: known.confirmed ? new Date(0).toISOString() : null } : {}) }
  }
  const table = (name: string) => tables.get(name) ?? tables.set(name, []).get(name)!
  let seq = 0

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const value = (text: string): unknown => (text === 'null' ? null : text === 'true' ? true : text === 'false' ? false : text)
  const same = (a: unknown, b: unknown) => (typeof a === 'number' ? a === Number(b) : a === b)

  function test(row: Row, column: string, expression: string): boolean {
    const dot = expression.indexOf('.')
    const op = expression.slice(0, dot)
    const rest = expression.slice(dot + 1)
    const have = row[column]
    switch (op) {
      case 'eq':
        return same(have, value(rest))
      case 'neq':
        return have !== null && have !== undefined && !same(have, value(rest))
      case 'is':
        return (have ?? null) === value(rest)
      case 'not':
        return !test(row, column, rest)
      case 'lt':
        return have !== null && have !== undefined && String(have) < rest
      case 'lte':
        return have !== null && have !== undefined && String(have) <= rest
      case 'gt':
        return have !== null && have !== undefined && String(have) > rest
      case 'gte':
        return have !== null && have !== undefined && String(have) >= rest
      case 'in':
        return rest
          .replace(/^\(|\)$/g, '')
          .split(',')
          .map((v) => v.replace(/^"|"$/g, ''))
          .includes(String(have))
      default:
        throw new Error(`fakeSupabase: operator ${op} is not supported`)
    }
  }

  function matching(name: string, params: URLSearchParams): Row[] {
    let rows = [...table(name)]
    for (const [key, expression] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue
      if (key === 'or') {
        const parts = expression.replace(/^\(|\)$/g, '').split(',')
        rows = rows.filter((row) => parts.some((part) => test(row, part.slice(0, part.indexOf('.')), part.slice(part.indexOf('.') + 1))))
      } else rows = rows.filter((row) => test(row, key, expression))
    }
    const order = params.get('order')
    if (order) {
      const [column, direction] = order.split(',')[0].split('.')
      const compare = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? '')))
      rows.sort((a, b) => compare(a[column], b[column]) * (direction === 'desc' ? -1 : 1))
    }
    const offset = Number(params.get('offset') ?? 0)
    const limit = params.get('limit')
    return rows.slice(offset, limit ? offset + Number(limit) : undefined)
  }

  const conflict = (name: string, row: Row) => {
    const key = UNIQUE[name]?.(row)
    return key !== undefined && table(name).some((other) => other !== row && UNIQUE[name](other) === key)
  }

  async function rest(name: string, url: URL, init: RequestInit): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase()
    const headers = new Headers(init.headers)
    const single = headers.get('accept')?.includes('vnd.pgrst.object')
    const reply = (rows: Row[], status = 200) => {
      if (!single) return json(rows, status)
      if (rows.length === 1) return json(rows[0], status)
      return json({ code: 'PGRST116', details: `The result contains ${rows.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' }, 406)
    }
    if (method === 'GET' || method === 'HEAD') return reply(matching(name, url.searchParams))
    if (method === 'DELETE') {
      const gone = matching(name, url.searchParams)
      tables.set(name, table(name).filter((row) => !gone.includes(row)))
      return reply(gone)
    }
    const body = JSON.parse(String(init.body)) as Row | Row[]
    if (method === 'PATCH') {
      const rows = matching(name, url.searchParams)
      for (const row of rows) {
        const before = { ...row }
        Object.assign(row, body, { updated_at: new Date().toISOString() })
        if (conflict(name, row)) {
          Object.assign(row, before)
          return json({ code: '23505', message: 'duplicate key value violates unique constraint', details: null, hint: null }, 409)
        }
      }
      return reply(rows)
    }
    if (method === 'POST') {
      const made: Row[] = []
      for (const given of Array.isArray(body) ? body : [body]) {
        const key = KEY[name] ?? 'id'
        const existing = headers.get('prefer')?.includes('resolution=merge-duplicates') ? table(name).find((row) => row[key] === given[key]) : undefined
        if (existing) {
          Object.assign(existing, given, { updated_at: new Date().toISOString() })
          made.push(existing)
          continue
        }
        const now = new Date().toISOString()
        const row: Row = { ...(DEFAULTS[name]?.() ?? {}), id: randomUUID(), seq: ++seq, created_at: now, updated_at: now, ...given }
        table(name).push(row)
        if (conflict(name, row)) {
          table(name).pop()
          return json({ code: '23505', message: 'duplicate key value violates unique constraint', details: null, hint: null }, 409)
        }
        made.push(row)
      }
      return reply(made, 201)
    }
    throw new Error(`fakeSupabase: ${method} is not supported`)
  }

  async function storage(url: URL, init: RequestInit): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase()
    const path = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\/object\//, ''))
    if (method === 'DELETE') {
      const { prefixes } = JSON.parse(String(init.body)) as { prefixes: string[] }
      const bucket = path
      for (const prefix of prefixes) objects.delete(`${bucket}/${prefix}`)
      return json(prefixes.map((name) => ({ name })))
    }
    if (method === 'GET') {
      const bytes = objects.get(path)
      return bytes ? new Response(bytes as BodyInit, { headers: { 'content-type': 'application/octet-stream' } }) : json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, 404)
    }
    const upsert = new Headers(init.headers).get('x-upsert') === 'true' || method === 'PUT'
    if (objects.has(path) && !upsert) return json({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, 409)
    const body = init.body as unknown
    const bytes = body instanceof Uint8Array ? body : body instanceof ArrayBuffer ? new Uint8Array(body) : body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : body instanceof FormData ? new Uint8Array(await (body.get('') as Blob).arrayBuffer()) : new TextEncoder().encode(String(body))
    objects.set(path, new Uint8Array(bytes))
    return json({ Key: path, Id: randomUUID() })
  }

  return {
    tables,
    objects,
    table,
    users,
    people,
    /** Registers a stand-in for a database function called with supabase.rpc(name, args). */
    rpc(name: string, handler: (args: Row) => unknown) {
      functions.set(name, handler)
    },
    /** Handles a request to the fake project, or returns undefined for any other address. */
    async fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response | undefined> {
      const request = input instanceof Request ? input : undefined
      const url = new URL(request ? request.url : String(input))
      if (url.origin !== FAKE_SUPABASE_URL) return undefined
      const options: RequestInit = request ? { method: request.method, headers: request.headers, body: request.body ? await request.arrayBuffer() : undefined } : init
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const handler = functions.get(url.pathname.slice('/rest/v1/rpc/'.length))
        if (!handler) return json({ code: 'PGRST202', message: 'function not found', details: null, hint: null }, 404)
        const body = options.body === undefined || options.body === null ? '{}' : typeof options.body === 'string' ? options.body : new TextDecoder().decode(options.body as ArrayBuffer)
        try {
          return json(handler(JSON.parse(body || '{}') as Row))
        } catch (error) {
          // A database function's refusal: thrown as { code, message }, answered as PostgREST would.
          const refusal = error as { code?: string; message?: string }
          if (typeof refusal.code !== 'string') throw error
          return json({ code: refusal.code, message: refusal.message ?? '', details: null, hint: null }, 400)
        }
      }
      if (url.pathname === '/auth/v1/user') {
        const id = users.get(new Headers(options.headers).get('authorization')?.replace(/^Bearer\s+/i, '') ?? '')
        return id ? json(authUser(id)) : json({ message: 'invalid token' }, 401)
      }
      // The admin API the service role uses to read, or delete, one sign-in.
      if (url.pathname.startsWith('/auth/v1/admin/users/')) {
        const id = url.pathname.slice('/auth/v1/admin/users/'.length)
        if (!people.has(id)) return json({ code: 404, error_code: 'user_not_found', msg: 'User not found' }, 404)
        if ((options.method ?? 'GET').toUpperCase() === 'DELETE') {
          people.delete(id)
          for (const [token, user] of users) if (user === id) users.delete(token)
          return json({})
        }
        return json(authUser(id))
      }
      if (url.pathname.startsWith('/rest/v1/')) return rest(url.pathname.slice('/rest/v1/'.length), url, options)
      if (url.pathname.startsWith('/storage/v1/object/')) return storage(url, options)
      return json({ message: 'not found' }, 404)
    },
  }
}
