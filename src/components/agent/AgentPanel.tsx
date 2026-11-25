// The counselor's assistant. It proposes and never acts. A pending proposal is
// the same approval card the Inbox shows, built from the same row in
// data.agentProposals, so a person can decide it in either place.
// Open or closed is remembered in this browser. Each student's thread, and the
// general thread, stay in memory for the session.
// On a laptop it is a panel beside the page. On anything narrower it lies over
// the page and is a dialog: the page behind it is out of reach, Escape closes
// it, and focus goes back to the Assistant button.

import { X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { assistantPrompts } from '../../lib/assistantPrompts'
import { proposalSummary, type AgentHistoryMessage, type AgentProposalKind, type AgentProposalOut, type AgentProposalStatus, type AgentTurnSource } from '../../../shared/agent'
import { useApprovalSends } from '../../lib/approvalSends'
import { findStudent, fullName, proposalApproval } from '../../lib/derive'
import agentClient, { AgentNetworkError, AgentRequestError } from '../../services/agentClient'
import { useData, useStore } from '../../store/store'
import { ApprovalCard, ApproveAll, SendState } from '../ApprovalCard'
import { Spark } from '../Logo'
import { useIsLaptop } from '../motion'
import { Button, Card, Empty, Pill, Skeleton, Thinking, cx, textareaClass } from '../ui'

const OPEN_KEY = 'platinum.agentPanel'


const KIND_LABEL: Record<AgentProposalKind, string> = {
  message: 'Message',
  parent_update: 'Parent update',
  task: 'Task',
  profile_change: 'Profile change',
  meeting_times: 'Meeting times',
}

const STATUS_LABEL: Record<AgentProposalStatus, string> = { pending: 'Pending', approved: 'Approved', discarded: 'Discarded' }
const STATUS_TONE = { pending: 'accent', approved: 'good', discarded: 'neutral' } as const

type CardProposal = {
  id: string
  kind: AgentProposalKind
  studentId: string
  summary: string
  status: AgentProposalStatus
}

type UserBubble = { id: string; role: 'user'; text: string }
type AssistantBubble = { id: string; role: 'assistant'; text: string; sources: AgentTurnSource[]; proposals: CardProposal[] }
/** `retryText` is set for a network failure or a 5xx, which Retry sends again. */
type NoticeBubble = { id: string; role: 'notice'; text: string; tone: 'warn' | 'bad'; retryText?: string }
type Bubble = UserBubble | AssistantBubble | NoticeBubble

type ThreadUi = {
  threadId: string | null
  messages: Bubble[]
  pending: boolean
  draft: string
  hydrated: boolean
  /** When the counselor last sent. A history load that started earlier must not wipe that reply. */
  touchedAt: number
}

const EMPTY_THREAD: ThreadUi = { threadId: null, messages: [], pending: false, draft: '', hydrated: false, touchedAt: 0 }

function emptyThread(): ThreadUi {
  return { ...EMPTY_THREAD, messages: [] }
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === 'open'
  } catch {
    return false
  }
}

function writeOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? 'open' : 'closed')
  } catch {
    // Private mode, or storage disabled. The panel still toggles until reload.
  }
}

let bubbleId = 0
const nextId = () => `agent-${Date.now().toString(36)}-${bubbleId++}`

/**
 * A student's pages (`/app/students/:id` and anything under it) and a student
 * selected in Meetings (`/app/meetings?student=`) use that student's thread.
 * Every other counselor page is the general one.
 */
function studentIdFromLocation(pathname: string, search: string): string | null {
  const [, app, students, id] = pathname.split('/')
  if (app === 'app' && students === 'meetings') return new URLSearchParams(search).get('student')
  if (app !== 'app' || students !== 'students' || !id) return null
  try {
    return decodeURIComponent(id)
  } catch {
    return id
  }
}

function inboxHref(studentId: string | null): string {
  return studentId ? `/app?student=${encodeURIComponent(studentId)}` : '/app'
}

function cardsFromHistory(message: AgentHistoryMessage): CardProposal[] {
  return message.proposals.map((proposal) => ({
    id: proposal.id,
    kind: proposal.kind,
    studentId: proposal.studentId,
    summary: proposal.summary,
    status: proposal.status,
  }))
}

function cardsFromReply(proposals: AgentProposalOut[]): CardProposal[] {
  return proposals.map((proposal) => ({
    id: proposal.id,
    kind: proposal.kind,
    studentId: proposal.studentId,
    summary: proposalSummary(proposal),
    status: 'pending',
  }))
}

function fromTranscript(message: AgentHistoryMessage): Bubble {
  if (message.role === 'user') return { id: message.id, role: 'user', text: message.text }
  return { id: message.id, role: 'assistant', text: message.text, sources: message.sources, proposals: cardsFromHistory(message) }
}

/** The threads with any newer proposal status written onto their cards. The same object when nothing changed. */
function withStatuses(threads: Record<string, ThreadUi>, status: Map<string, AgentProposalStatus>): Record<string, ThreadUi> {
  const stale = (p: CardProposal) => status.has(p.id) && status.get(p.id) !== p.status
  let changed = false
  const next = Object.fromEntries(
    Object.entries(threads).map(([key, thread]) => {
      if (!thread.messages.some((m) => m.role === 'assistant' && m.proposals.some(stale))) return [key, thread]
      changed = true
      const messages = thread.messages.map((m) => (m.role === 'assistant' ? { ...m, proposals: m.proposals.map((p) => (stale(p) ? { ...p, status: status.get(p.id) ?? p.status } : p)) } : m))
      return [key, { ...thread, messages }]
    }),
  )
  return changed ? next : threads
}

function withoutRetry(messages: Bubble[], text: string): Bubble[] {
  return messages.filter((message) => !(message.role === 'notice' && message.retryText === text))
}

/** Open or closed, plus Cmd+J / Ctrl+J. Cmd+K is reserved for the command bar. */
export function useAgentPanel() {
  const [open, setOpen] = useState(readOpen)

  const toggle = useCallback(() => {
    setOpen((current) => {
      const next = !current
      writeOpen(next)
      return next
    })
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    writeOpen(false)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.key.toLowerCase() !== 'j' || event.altKey || event.shiftKey) return
      if (!event.metaKey && !event.ctrlKey) return
      event.preventDefault()
      setOpen((current) => {
        const next = !current
        writeOpen(next)
        return next
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return { open, toggle, close }
}

export function AgentPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname, search } = useLocation()
  const data = useData()
  const routeStudentId = studentIdFromLocation(pathname, search)
  const student = routeStudentId ? findStudent(data, routeStudentId) : undefined
  // A student page whose id is not in the firm falls back to the general thread.
  const studentId = student ? student.id : null
  const threadKey = studentId ?? 'all'
  const title = student ? `Assistant · ${fullName(student)}` : 'Assistant · All students'
  const prompts = assistantPrompts(pathname, student?.firstName)

  const [threads, setThreads] = useState<Record<string, ThreadUi>>({})
  const thread = threads[threadKey] ?? EMPTY_THREAD
  const pendingGuard = useRef<Record<string, boolean>>({})
  const startedAt = useRef(0)
  const [tick, setTick] = useState(0)
  const [progress, setProgress] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const wasOpen = useRef(false)

  // Reload history when the panel opens or the student changes, so a proposal
  // approved on another page shows its new status. An in-flight send is left alone.
  useEffect(() => {
    if (!open) return
    const key = studentId ?? 'all'
    const scope = studentId
    const started = Date.now()
    let cancel = false
    void agentClient.loadThread(scope).then((loaded) => {
      if (cancel) return
      setThreads((prev) => {
        const existing = prev[key]
        if (existing?.pending || (existing?.touchedAt ?? 0) > started) return prev
        return {
          ...prev,
          [key]: {
            threadId: loaded.threadId,
            messages: loaded.messages.map(fromTranscript),
            pending: false,
            draft: existing?.draft ?? '',
            hydrated: true,
            touchedAt: existing?.touchedAt ?? 0,
          },
        }
      })
    }).catch((error: unknown) => {
      if (cancel) return
      const text = error instanceof AgentRequestError || error instanceof AgentNetworkError ? error.message : 'The assistant could not be reached.'
      setThreads((prev) => {
        const existing = prev[key]
        if (existing?.pending || (existing?.touchedAt ?? 0) > started || (existing?.messages.length ?? 0) > 0) return prev
        return {
          ...prev,
          [key]: {
            threadId: existing?.threadId ?? null,
            messages: [{ id: nextId(), role: 'notice', text, tone: 'bad' }],
            pending: false,
            draft: existing?.draft ?? '',
            hydrated: true,
            touchedAt: 0,
          },
        }
      })
    })
    return () => {
      cancel = true
    }
  }, [open, studentId])

  // The browser keeps only pending proposals, so a decided one leaves `data` at the
  // next reload. Its status is copied onto the card while the row is still there.
  const rows = data.agentProposals
  useEffect(() => {
    const status = new Map<string, AgentProposalStatus>(rows.map((row) => [row.id, row.status]))
    setThreads((prev) => withStatuses(prev, status))
  }, [rows])

  // A pending card with no row: it was drafted a moment ago and has not been loaded
  // yet, or it was decided in another tab. Load again, then ask the server.
  const missing = useMemo(() => {
    const known = new Set(rows.map((row) => row.id))
    return thread.messages
      .flatMap((m) => (m.role === 'assistant' ? m.proposals : []))
      .filter((p) => p.status === 'pending' && !known.has(p.id))
      .map((p) => p.id)
      .join()
  }, [rows, thread.messages])
  useEffect(() => {
    if (!open || !missing) return
    let cancel = false
    let tries = 0
    const timer = window.setInterval(() => {
      if (++tries >= 3) window.clearInterval(timer)
      void useStore
        .getState()
        .reload(true)
        .then(() => agentClient.loadThread(studentId))
        .then((loaded) => {
          if (cancel) return
          const status = new Map<string, AgentProposalStatus>(loaded.messages.flatMap((m) => m.proposals.map((p) => [p.id, p.status] as const)))
          setThreads((prev) => withStatuses(prev, status))
        })
        .catch(() => undefined)
    }, 1500)
    return () => {
      cancel = true
      window.clearInterval(timer)
    }
  }, [open, missing, studentId])

  useEffect(() => {
    if (!thread.pending) return
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [thread.pending, threadKey])

  useEffect(() => {
    if (!open) return
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
    // By length: approving a card rewrites its message and must not move the page.
  }, [open, threadKey, thread.messages.length, thread.pending])

  // Opening puts the cursor in the box. Closing gives focus back to the button, unless it has already moved on.
  const laptop = useIsLaptop()
  const covers = open && !laptop
  useEffect(() => {
    if (open && !wasOpen.current) inputRef.current?.focus()
    if (!open && wasOpen.current) {
      const active = document.activeElement
      if (!active || active === document.body || panelRef.current?.contains(active)) document.getElementById('assistant-button')?.focus()
    }
    wasOpen.current = open
  }, [open])

  useEffect(() => {
    if (!covers) return
    const onKey = (event: KeyboardEvent) => {
      // Escape in a window opened from here closes that window only.
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [covers, onClose])

  const patch = (key: string, update: (current: ThreadUi) => ThreadUi) => {
    setThreads((prev) => {
      const current = prev[key] ?? emptyThread()
      return { ...prev, [key]: update(current) }
    })
  }

  const submit = (text: string, retry = false) => {
    const body = text.trim()
    if (!body) return
    const key = threadKey
    const scope = studentId
    if (pendingGuard.current[key]) return
    pendingGuard.current[key] = true
    startedAt.current = Date.now()
    const requestId = crypto.randomUUID()
    setProgress('')
    const poll = window.setInterval(() => {
      void agentClient.progress(requestId).then((step) => {
        if (step) setProgress(step)
      }).catch(() => {
        // A missed poll just leaves the previous step on screen.
      })
    }, 800)
    patch(key, (current) => ({
      ...current,
      pending: true,
      hydrated: true,
      touchedAt: Date.now(),
      draft: retry ? current.draft : '',
      messages: retry ? withoutRetry(current.messages, body) : [...current.messages, { id: nextId(), role: 'user', text: body }],
    }))
    void agentClient
      .send(scope, body, requestId)
      .then((response) => {
        const seconds = (Date.now() - startedAt.current) / 1000
        console.debug(`[agent] reply in ${seconds.toFixed(1)}s`)
        if (response.proposals.length > 0) void useStore.getState().reload(true)
        patch(key, (current) => ({
          ...current,
          pending: false,
          touchedAt: Date.now(),
          threadId: response.threadId,
          messages: [
            ...withoutRetry(current.messages, body),
            { id: nextId(), role: 'assistant', text: response.reply, sources: response.sources, proposals: cardsFromReply(response.proposals) },
          ],
        }))
      })
      .catch((error: unknown) => {
        const seconds = (Date.now() - startedAt.current) / 1000
        console.debug(`[agent] reply failed in ${seconds.toFixed(1)}s`)
        const server = error instanceof AgentRequestError
        const text = server || error instanceof AgentNetworkError ? error.message : 'The assistant could not be reached.'
        const retryable = !server || error.status >= 500
        patch(key, (current) => ({
          ...current,
          pending: false,
          touchedAt: Date.now(),
          messages: [
            ...current.messages,
            { id: nextId(), role: 'notice', text, tone: server && error.status === 429 ? 'warn' : 'bad', retryText: retryable ? body : undefined },
          ],
        }))
      })
      .finally(() => {
        window.clearInterval(poll)
        setProgress('')
        pendingGuard.current[key] = false
      })
  }

  const showSuggestions = thread.hydrated && thread.messages.length === 0 && !thread.pending
  const elapsed = thread.pending && startedAt.current ? Math.floor((Date.now() - startedAt.current) / 1000) : 0
  void tick
  const base = progress || 'Thinking…'
  const thinking = elapsed >= 3 ? `${base.replace(/…$/, '')}… ${elapsed}s` : base

  return (
    <>
      {covers && <div aria-hidden className="motion-page fixed inset-0 z-30 hidden bg-[var(--backdrop)] sm:block lg:hidden" onClick={onClose} />}
      <aside
        id="agent-panel"
        ref={panelRef}
        role={covers ? 'dialog' : undefined}
        aria-modal={covers || undefined}
        aria-labelledby="agent-panel-title"
        data-open={open}
        className={cx(
          'motion-panel z-40 h-dvh min-h-0 w-full flex-col border-l border-line bg-surface',
          open ? 'flex' : 'hidden',
          'fixed inset-y-0 right-0 shadow-float sm:w-96',
          'lg:sticky lg:bottom-auto lg:right-auto lg:top-0 lg:z-10 lg:shrink-0 lg:shadow-none',
        )}
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Spark size={16} />
            <h2 id="agent-panel-title" className="truncate text-base font-semibold" title={title}>
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close assistant"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted hover:bg-surface-2 hover:text-heading"
          >
            <X size={20} strokeWidth={1.75} aria-hidden />
          </button>
        </header>

        <div ref={logRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3 py-4" role="log" aria-label="Conversation" tabIndex={0}>
          {!thread.hydrated && !thread.pending && (
            <div className="flex flex-col gap-3" role="status" aria-label="Opening this conversation">
              <Skeleton className="ml-auto h-9 w-2/3" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}
          {showSuggestions && (
            <Empty
              title={
                <>
                  <span className="block font-display text-base font-semibold text-heading">{student ? `Ask about ${student.firstName}` : 'Ask about your students'}</span>
                  <span className="mt-1 block">Choose one to put it in the box, or write your own. Nothing is sent until you press Send.</span>
                </>
              }
            >
              <div className="flex w-full flex-col gap-2">
                {prompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={thread.pending}
                    onClick={() => {
                      // Fills the box and stops there: the counselor reads it, changes it if they like, and sends it.
                      patch(threadKey, (current) => ({ ...current, draft: prompt }))
                      inputRef.current?.focus()
                    }}
                    className="min-h-11 rounded-control border border-line-strong bg-surface px-3 py-2 text-left text-sm font-medium text-heading hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </Empty>
          )}
          {thread.messages.map((message) => (
            <BubbleView key={message.id} message={message} studentId={studentId} pending={thread.pending} onRetry={(text) => submit(text, true)} />
          ))}
          {thread.pending && <Thinking inline label={thinking} />}
        </div>

        <form
          className="shrink-0 border-t border-line p-3"
          onSubmit={(event) => {
            event.preventDefault()
            submit(thread.draft)
          }}
        >
          <textarea
            ref={inputRef}
            className={textareaClass}
            rows={3}
            value={thread.draft}
            disabled={thread.pending}
            placeholder="Ask the assistant…"
            aria-label="Message the assistant"
            onChange={(event) => {
              const value = event.target.value
              patch(threadKey, (current) => ({ ...current, draft: value }))
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
              event.preventDefault()
              submit(thread.draft)
            }}
          />
          <div className="mt-2 flex justify-end">
            <Button type="submit" variant="remind" disabled={thread.pending || thread.draft.trim() === ''}>
              Send
            </Button>
          </div>
        </form>
      </aside>
    </>
  )
}

function BubbleView({ message, studentId, pending, onRetry }: { message: Bubble; /** The thread's student. Null on the general thread, where each card names its student. */ studentId: string | null; pending: boolean; onRetry: (text: string) => void }) {
  // A bubble made here has just arrived; one from the stored thread was already there.
  const fresh = message.id.startsWith('agent-')
  if (message.role === 'user') {
    return (
      <div className={cx('ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-card bg-primary px-3 py-2 text-sm leading-relaxed text-on-primary', fresh && 'motion-rise')}>
        {message.text}
      </div>
    )
  }
  if (message.role === 'notice') return <Notice message={message} pending={pending} onRetry={onRetry} />
  return (
    <div className={cx('flex w-full flex-col items-start gap-2', fresh && 'motion-rise')}>
      <div className="w-full whitespace-pre-wrap break-words rounded-card border border-line bg-canvas px-3 py-2 text-sm leading-relaxed">{message.text}</div>
      {message.sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {message.sources.map((source) => (
            <Pill key={`${source.kind}:${source.id}`} tone="neutral">
              {source.label}
            </Pill>
          ))}
        </div>
      )}
      {message.proposals.map((proposal) => (
        // Focus comes to this box when the card's buttons are gone.
        <div key={proposal.id} tabIndex={-1} data-focus-home className="w-full focus:outline-none">
          <ProposalCard proposal={proposal} showStudent={proposal.studentId !== studentId} />
        </div>
      ))}
      <ApproveAllInReply proposals={message.proposals} />
    </div>
  )
}

function Notice({ message, pending, onRetry }: { message: NoticeBubble; pending: boolean; onRetry: (text: string) => void }) {
  const warn = message.tone === 'warn'
  return (
    <div role={warn ? 'status' : 'alert'} className={warn ? 'rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn' : 'rounded-lg border border-bad-line bg-bad-tint px-3 py-2 text-[13px] text-bad'}>
      <p>{message.text}</p>
      {message.retryText && (
        <Button className="mt-2" disabled={pending} onClick={() => onRetry(message.retryText ?? '')}>
          Retry
        </Button>
      )}
    </div>
  )
}

/** "Approve all" under a reply that still holds two or more pending proposals. */
function ApproveAllInReply({ proposals }: { proposals: CardProposal[] }) {
  const rows = useData().agentProposals
  const messageOf = useApprovalSends((s) => s.messageOf)
  // One already queued is on its way, even if its row has not caught up.
  const pending = rows.filter((row) => row.status === 'pending' && !messageOf[row.id] && proposals.some((p) => p.id === row.id))
  if (pending.length < 2) return null
  return (
    <div>
      <ApproveAll items={pending.map(proposalApproval)} title="Approve all in this reply?" />
    </div>
  )
}

function ProposalCard({ proposal, showStudent }: { proposal: CardProposal; showStudent: boolean }) {
  const row = useData().agentProposals.find((p) => p.id === proposal.id)
  const messageId = useApprovalSends((s) => s.messageOf[proposal.id])
  const status = row?.status ?? proposal.status

  if (row && status === 'pending') {
    return (
      <Card className="w-full p-3">
        <ApprovalCard item={proposalApproval(row)} compact showStudent={showStudent} />
      </Card>
    )
  }
  return (
    <Card className="motion-fade w-full p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted">{KIND_LABEL[proposal.kind]}</p>
        <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>
      </div>
      <p className="mt-1 break-words text-sm">{proposal.summary}</p>
      {status === 'pending' && (
        <Link to={inboxHref(proposal.studentId)} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline">
          Review in the Inbox
        </Link>
      )}
      {status === 'approved' && messageId && (
        <div className="mt-2">
          <SendState messageId={messageId} />
        </div>
      )}
    </Card>
  )
}
