// The counselor's assistant. It proposes and never acts: a proposal is a card
// with a link into Approvals, and approval happens only there.
// Open or closed is remembered in this browser. Each student's thread, and the
// general thread, stay in memory for the session.

import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { proposalSummary, type AgentHistoryMessage, type AgentProposalKind, type AgentProposalOut, type AgentProposalStatus, type AgentTurnSource } from '../../../shared/agent'
import { findStudent, fullName } from '../../lib/derive'
import agentClient, { AgentNetworkError, AgentRequestError } from '../../services/agentClient'
import { useData, useStore } from '../../store/store'
import { Spark } from '../Logo'
import { Button, Card, Empty, Pill, Thinking, cx, textareaClass } from '../ui'

const OPEN_KEY = 'platinum.agentPanel'

const STUDENT_PROMPTS = ["What's overdue?", 'Prep me for our next meeting', 'Draft a parent update'] as const
const GENERAL_PROMPTS = ['Who needs attention this week?', "What's waiting for approval?", 'Who is behind?'] as const

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

/** `/app/students/:id` is a student thread. Every other counselor page is the general one. */
function studentIdFromPath(pathname: string): string | null {
  const [, app, students, id] = pathname.split('/')
  if (app !== 'app' || students !== 'students' || !id) return null
  try {
    return decodeURIComponent(id)
  } catch {
    return id
  }
}

function approvalsHref(studentId: string | null): string {
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
  const { pathname } = useLocation()
  const data = useData()
  const routeStudentId = studentIdFromPath(pathname)
  const student = routeStudentId ? findStudent(data, routeStudentId) : undefined
  // A student page whose id is not in the firm falls back to the general thread.
  const studentId = student ? student.id : null
  const threadKey = studentId ?? 'all'
  const title = student ? `Assistant · ${fullName(student)}` : 'Assistant · All students'
  const prompts = student ? STUDENT_PROMPTS : GENERAL_PROMPTS

  const [threads, setThreads] = useState<Record<string, ThreadUi>>({})
  const thread = threads[threadKey] ?? EMPTY_THREAD
  const pendingGuard = useRef<Record<string, boolean>>({})
  const startedAt = useRef(0)
  const [tick, setTick] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
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

  useEffect(() => {
    if (!thread.pending) return
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [thread.pending, threadKey])

  useEffect(() => {
    if (!open) return
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [open, threadKey, thread.messages, thread.pending])

  useEffect(() => {
    if (open && !wasOpen.current) inputRef.current?.focus()
    wasOpen.current = open
  }, [open])

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
    patch(key, (current) => ({
      ...current,
      pending: true,
      hydrated: true,
      touchedAt: Date.now(),
      draft: retry ? current.draft : '',
      messages: retry ? withoutRetry(current.messages, body) : [...current.messages, { id: nextId(), role: 'user', text: body }],
    }))
    void agentClient
      .send(scope, body)
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
        pendingGuard.current[key] = false
      })
  }

  const showSuggestions = thread.hydrated && thread.messages.length === 0 && !thread.pending
  const elapsed = thread.pending && startedAt.current ? Math.floor((Date.now() - startedAt.current) / 1000) : 0
  void tick
  const thinking = elapsed >= 3 ? `Thinking… ${elapsed}s` : 'Thinking…'

  return (
    <aside
      id="agent-panel"
      aria-labelledby="agent-panel-title"
      className={cx(
        'z-30 h-dvh min-h-0 w-full flex-col border-l border-line bg-surface',
        open ? 'flex' : 'hidden',
        'fixed inset-y-0 right-0 shadow-float sm:w-96',
        'lg:sticky lg:bottom-auto lg:right-auto lg:top-0 lg:shrink-0 lg:shadow-none',
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

      <div ref={logRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3 py-4">
        {showSuggestions && (
          <Empty title={student ? 'Ask about this student.' : 'Ask about the caseload.'}>
            <div className="flex w-full flex-col gap-2">
              {prompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={thread.pending}
                  onClick={() => submit(prompt)}
                  className="min-h-11 rounded-control border border-line-strong bg-surface px-3 text-left text-sm font-medium text-heading hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </Empty>
        )}
        {thread.messages.map((message) => (
          <BubbleView key={message.id} message={message} pending={thread.pending} onRetry={(text) => submit(text, true)} />
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
          <Button type="submit" variant="primary" disabled={thread.pending || thread.draft.trim() === ''}>
            Send
          </Button>
        </div>
      </form>
    </aside>
  )
}

function BubbleView({ message, pending, onRetry }: { message: Bubble; pending: boolean; onRetry: (text: string) => void }) {
  if (message.role === 'user') {
    return (
      <div className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-card bg-primary px-3 py-2 text-sm leading-relaxed text-on-primary">
        {message.text}
      </div>
    )
  }
  if (message.role === 'notice') return <Notice message={message} pending={pending} onRetry={onRetry} />
  return (
    <div className="flex w-full flex-col items-start gap-2">
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
        <ProposalCard key={proposal.id} proposal={proposal} />
      ))}
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

function ProposalCard({ proposal }: { proposal: CardProposal }) {
  return (
    <Card className="w-full p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted">{KIND_LABEL[proposal.kind]}</p>
        <Pill tone={STATUS_TONE[proposal.status]}>{STATUS_LABEL[proposal.status]}</Pill>
      </div>
      <p className="mt-1 text-sm">{proposal.summary}</p>
      {proposal.status === 'pending' && (
        <Link to={approvalsHref(proposal.studentId)} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline">
          Review in Approvals
        </Link>
      )}
    </Card>
  )
}
