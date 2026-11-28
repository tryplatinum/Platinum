// The preview's stand-in for the database and the dispatcher. PREVIEW ONLY:
// preview.tsx imports this, and nothing under src/ may. The production build
// starts from index.html and never sees it (scripts/test-notes.ts checks).
//
// The store saves by calling Supabase: apply_changes for edits, queue_message
// and cancel_message for sends, the two proposal functions, and the reminder
// skip writes. Here each of those is answered in memory with success, so a
// counselor's whole path can be clicked through with no project: approve a
// draft, watch the hold, undo it or let it go, and see it in Messages and
// Activity. When the hold is over the "dispatcher" marks the message sent. It
// calls no transport: nothing leaves the page.

import { UNDO_SECONDS } from './shared/outbox'
import { useStore } from './src/store/store'

type Row = Record<string, unknown>

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const now = () => new Date().toISOString()

/** Messages queued in this session, as the database would hold them. */
const outbox = new Map<string, Row>()

const activity = (studentId: unknown, actor: string, text: string): Row => ({ id: crypto.randomUUID(), firm_id: 'f', student_id: studentId ?? null, at: now(), actor, text, actor_user: actor === 'counselor' ? 'u' : null })
const words = (kind: unknown) => String(kind).replaceAll('_', ' ')

function rpc(name: string, args: Row): Response {
  switch (name) {
    // Every edit the store makes. The store already holds the new state; this only says it was saved.
    case 'apply_changes':
      return json(null)
    case 'queue_message': {
      const p = (args.payload ?? {}) as Row
      const at = now()
      const row: Row = {
        id: p.id, firm_id: 'f', student_id: p.studentId, sent_at: at, to_kind: p.toKind, to_name: p.toName, parent_id: p.parentId ?? null,
        channel: p.channel, language: p.language, kind: p.kind, body: p.body, body_en: p.bodyEn ?? null, trigger: p.trigger ?? 'approved',
        task_id: p.taskId ?? null, note: p.note ?? null, dedupe_key: p.dedupeKey ?? null, approval: { by: p.approvedBy ?? 'Counselor', byId: 'u', at },
        status: 'queued', send_after: new Date(Date.now() + UNDO_SECONDS * 1000).toISOString(), approved_by: 'u', approved_at: at,
        provider_message_id: null, error: null, delivery_detail: null,
      }
      outbox.set(String(p.id), row)
      return json({ message: row, activity: activity(p.studentId, 'counselor', `Approved a ${words(p.kind)} to ${String(p.toName)}.`) })
    }
    case 'cancel_message': {
      const row = outbox.get(String(args.id))
      if (!row || row.status !== 'queued') return json({ code: '42501', message: 'That message can no longer be undone.', details: null, hint: null }, 403)
      row.status = 'cancelled'
      return json({ message: row, activity: activity(row.student_id, 'counselor', `Cancelled a ${words(row.kind)} to ${String(row.to_name)}.`) })
    }
    case 'decide_agent_proposal':
    case 'edit_agent_proposal':
      return json(true)
    case 'log_meeting_drafts_ready': {
      const meeting = useStore.getState().data.meetings.find((m) => m.id === args.meeting)
      return json(activity(meeting?.studentId, 'ai', `Drafts from “${meeting?.title ?? 'the meeting'}” are ready for review`))
    }
    case 'owner_only_file_count':
      return json(0)
    default:
      return json({ code: 'PGRST202', message: `The preview has no stand-in for ${name}.`, details: null, hint: null }, 404)
  }
}

/** The "dispatcher": a message whose hold is over is marked sent, here and in the store. No transport is called. */
function dispatch(): Response {
  const due = [...outbox.values()].filter((row) => row.status === 'queued' && Date.parse(String(row.send_after)) <= Date.now())
  if (due.length > 0) {
    const at = now()
    for (const row of due) Object.assign(row, { status: 'sent', sent_at: at, provider_message_id: `preview_${String(row.id).slice(0, 8)}` })
    const sent = new Set(due.map((row) => String(row.id)))
    useStore.setState((s) => ({
      data: {
        ...s.data,
        outbox: s.data.outbox.map((m) => (sent.has(m.id) ? { ...m, status: 'sent' as const, sentAt: at, providerMessageId: `preview_${m.id.slice(0, 8)}` } : m)),
        activity: [...due.map((row) => ({ id: crypto.randomUUID(), at, studentId: String(row.student_id), actor: 'system' as const, text: `Sent a ${words(row.kind)} to ${String(row.to_name)}. (Preview: nothing left this page.)` })), ...s.data.activity],
      },
    }))
  }
  // Zero "processed", so the app does not go on to reload from a database that is not there.
  return json({ ok: true, processed: 0, sent: 0, failed: 0, waiting: 0, swept: 0 })
}

/** An answer for a request the store makes when saving, or undefined for anything else. */
export function previewBackend(url: string, init?: RequestInit): Response | undefined {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (url.includes('/api/dispatch')) return dispatch()
  const rest = url.split('/rest/v1/')[1]
  if (rest === undefined) return undefined
  const [path] = rest.split('?')
  const body = (() => {
    try {
      return JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Row
    } catch {
      return {}
    }
  })()
  if (path.startsWith('rpc/')) return rpc(path.slice(4), body)
  // Skipping a reminder: the old skip for that key is deleted, then the new one is inserted and read back.
  if (path === 'reminder_skips' && method === 'POST') return json({ id: crypto.randomUUID(), firm_id: 'f', skipped_at: now(), ...body }, 201)
  // Any other table: a write is accepted, a read finds nothing. The preview's data is the store's.
  return json(method === 'GET' || method === 'HEAD' ? [] : null)
}
