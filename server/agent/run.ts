// The counselor-facing assistant: one thread per student (plus general), tool
// rounds, proposals only, history + cost guard. Nothing is written or sent
// except pending proposals and message rows.

import Anthropic from '@anthropic-ai/sdk'
import type { AgentProposalOut, AgentTiming, AgentTurnSource } from '../../shared/agent.js'
import { modelName } from '../claude.js'
import { agentSystemPrompt } from '../prompts.js'
import type { Json } from '../../src/lib/database.types.js'
import { clearProgress, setProgress, stepFor } from './progress.js'
import { dedupeSources, sourcesFromTool } from './sources.js'
import { buildStudentHeader } from './summary.js'
import { formatAnswer } from './format.js'
import { joinAssistantText } from './text.js'
import { AGENT_TOOLS, runTool } from './tools.js'
import type { AgentContext, CreatedProposal, Db } from './types.js'

export class AgentHttpError extends Error {
  status: number
  code: string
  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

/** What the browser is told when the server fails. The real error is logged here only. */
export const AGENT_SERVER_MESSAGE = 'Something went wrong. Try again.'

/** Logs what failed and returns the fixed error for the browser. Database text never reaches the caller. */
export function agentServerError(doing: string, error?: { message?: string } | null): AgentHttpError {
  console.error(`[agent] ${doing}:`, error?.message ?? 'unknown')
  return new AgentHttpError('server', AGENT_SERVER_MESSAGE, 500)
}

const maxRounds = () => {
  const n = Number(process.env.AGENT_MAX_ROUNDS)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8
}

/** Model calls per firm per UTC day. */
const dailyLimit = () => {
  const n = Number(process.env.AGENT_DAILY_LIMIT)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200
}

/** Takes one model call from the firm's daily budget. False when the budget is spent. */
async function reserveCall(service: Db, firmId: string): Promise<boolean> {
  const { data, error } = await service.rpc('reserve_agent_call', { firm: firmId, day_limit: dailyLimit() })
  if (error) throw agentServerError('reserving a model call', error)
  return data === true
}

async function loadCounselorName(user: Db, userId: string): Promise<{ name: string; firstName: string }> {
  const { data } = await user.from('firm_members').select('display_name').eq('user_id', userId).maybeSingle()
  const name = data?.display_name?.trim() || 'Counselor'
  const firstName = name.split(/\s+/)[0] || name
  return { name, firstName }
}

async function loadFirmName(user: Db, firmId: string): Promise<string> {
  const { data } = await user.from('firms').select('name').eq('id', firmId).maybeSingle()
  return data?.name?.trim() || ''
}

async function loadStudent(user: Db, firmId: string, studentId: string) {
  const { data, error } = await user.from('students').select('id, first_name, last_name, grad_year, onboarded_on').eq('id', studentId).eq('firm_id', firmId).maybeSingle()
  if (error) throw agentServerError('loading the student', error)
  if (!data) throw new AgentHttpError('not_found', 'Student not found.', 404)
  return data
}

async function ensureThread(service: Db, firmId: string, counselorId: string, studentId: string | null): Promise<string> {
  let q = service.from('agent_threads').select('id').eq('firm_id', firmId).eq('counselor_id', counselorId)
  q = studentId ? q.eq('student_id', studentId) : q.is('student_id', null)
  const existing = await q.maybeSingle()
  if (existing.error) throw agentServerError('finding the thread', existing.error)
  if (existing.data?.id) return existing.data.id
  const title = studentId ? null : 'General'
  const { data, error } = await service
    .from('agent_threads')
    .insert({ firm_id: firmId, counselor_id: counselorId, student_id: studentId, title })
    .select('id')
    .single()
  if (error || !data) throw agentServerError('opening the thread', error)
  return data.id
}

async function loadHistory(service: Db, threadId: string): Promise<Anthropic.MessageParam[]> {
  const { data, error } = await service
    .from('agent_messages')
    .select('role, content')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(80)
  if (error) throw agentServerError('loading the history', error)
  const messages: Anthropic.MessageParam[] = []
  for (const row of data ?? []) {
    const content = row.content as Anthropic.MessageParam['content']
    // Tool rows are stored separately. The API expects them as the next user message.
    if (row.role === 'tool') messages.push({ role: 'user', content })
    else if (row.role === 'user') messages.push({ role: 'user', content })
    else if (row.role === 'assistant') {
      const kept = withoutThinking(content)
      if (typeof kept === 'string' ? kept : kept.length > 0) messages.push({ role: 'assistant', content: kept })
    }
  }
  return messages
}

/**
 * An assistant turn without its thinking blocks. A thinking block is signed
 * against the system prompt it was made under, and that prompt carries a live
 * summary of the student, so a finished turn's thinking cannot be replayed
 * once the record changes. Only the request that made it may send it back,
 * while its own tool loop continues.
 */
function withoutThinking<C extends Anthropic.MessageParam['content'] | Anthropic.ContentBlock[]>(content: C): C {
  if (!Array.isArray(content)) return content
  return content.filter((block) => block.type !== 'thinking' && block.type !== 'redacted_thinking') as C
}

async function saveMessage(
  service: Db,
  args: {
    threadId: string
    firmId: string
    role: 'user' | 'assistant' | 'tool'
    content: unknown
    inputTokens?: number
    outputTokens?: number
  },
): Promise<void> {
  const { error } = await service.from('agent_messages').insert({
    thread_id: args.threadId,
    firm_id: args.firmId,
    role: args.role,
    content: args.content as Json,
    input_tokens: args.inputTokens ?? null,
    output_tokens: args.outputTokens ?? null,
  })
  if (error) throw agentServerError('saving a message', error)
}

function textFrom(content: Anthropic.ContentBlock[]): string {
  return joinAssistantText(content.filter((block): block is Anthropic.TextBlock => block.type === 'text').map((block) => block.text))
}

export interface AgentRunResult {
  threadId: string
  reply: string
  proposals: AgentProposalOut[]
  /** Records the tools returned this turn. Not taken from the model's text. */
  sources: AgentTurnSource[]
  timing: AgentTiming
}

export async function runAgent(args: {
  user: Db
  service: Db
  firmId: string
  counselorId: string
  studentId: string | null
  message: string
  requestId?: string
}): Promise<AgentRunResult> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new AgentHttpError('no_key', 'ANTHROPIC_API_KEY is not set on the server.', 503)
  }

  // The first model call is taken before anything is written. Every later round takes its own.
  if (!(await reserveCall(args.service, args.firmId))) {
    throw new AgentHttpError('rate_limited', 'Daily assistant limit reached.', 429)
  }

  const note = (step: string) => {
    if (args.requestId) setProgress(args.requestId, args.counselorId, step)
  }

  const [counselor, firmName, header] = await Promise.all([
    loadCounselorName(args.user, args.counselorId),
    loadFirmName(args.user, args.firmId),
    args.studentId ? buildStudentHeader(args.user, args.firmId, args.counselorId, args.studentId) : Promise.resolve(''),
  ])
  let studentName: string | undefined
  let studentGradYear: number | undefined
  let studentOnboarded: string | undefined
  if (args.studentId) {
    const s = await loadStudent(args.user, args.firmId, args.studentId)
    studentName = `${s.first_name} ${s.last_name}`
    studentGradYear = s.grad_year
    studentOnboarded = s.onboarded_on
  }

  const threadId = await ensureThread(args.service, args.firmId, args.counselorId, args.studentId)
  const history = await loadHistory(args.service, threadId)

  const ctx: AgentContext = {
    firmId: args.firmId,
    counselorId: args.counselorId,
    counselorName: counselor.name,
    counselorFirstName: counselor.firstName,
    firmName,
    studentId: args.studentId,
    studentName,
    studentGradYear,
    threadId,
    user: args.user,
    service: args.service,
    createdProposals: [],
  }

  await saveMessage(args.service, {
    threadId,
    firmId: args.firmId,
    role: 'user',
    content: [{ type: 'text', text: args.message }],
  })

  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: args.message }]
  const system = agentSystemPrompt({
    counselorName: counselor.name,
    counselorFirstName: counselor.firstName,
    student: args.studentId
      ? { name: studentName!, gradYear: studentGradYear!, onboardedOn: studentOnboarded, header }
      : null,
  })

  const client = new Anthropic()
  const model = modelName()
  const rounds = maxRounds()
  let reply = ''
  let hitRoundCap = false
  let outOfBudget = false
  const turnSources: AgentTurnSource[] = []
  const timing: AgentTiming = { rounds: 0, models: [], tools: [] }

  try {
  for (let round = 0; round < rounds; round++) {
    if (round > 0 && !(await reserveCall(args.service, args.firmId))) {
      outOfBudget = true
      break
    }
    note('Writing a reply…')
    let response: Anthropic.Message
    const modelStarted = Date.now()
    try {
      response = await client.messages.create({
        model,
        // After a proposal, the reply is one or two sentences. A long cap is what
        // made the model restate the message and translate it.
        max_tokens: ctx.createdProposals.length > 0 ? 200 : 4_000,
        // The loop picks tools and writes short drafts. Thinking made a 50-word
        // draft cost over 1,000 output tokens and most of the wait. On this model
        // "between_tools" is thinking off: no thinking before a reply, only short
        // notes between tool calls, which come back as thinking blocks.
        thinking: { type: 'between_tools' },
        system,
        tools: AGENT_TOOLS,
        messages,
      })
    } catch (error) {
      console.error('[agent] Claude error', error instanceof Error ? error.message : error)
      throw new AgentHttpError('upstream', 'The assistant could not reach Claude. Please try again.', 502)
    }
    const modelMs = Date.now() - modelStarted
    timing.rounds += 1
    timing.models.push({
      ms: modelMs,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    })
    console.debug(`[agent] model round=${round + 1} ms=${modelMs} in=${response.usage.input_tokens} out=${response.usage.output_tokens}`)

    // Thinking is never saved: a later turn could not send it back (see withoutThinking).
    await saveMessage(args.service, {
      threadId,
      firmId: args.firmId,
      role: 'assistant',
      content: withoutThinking(response.content),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    })

    messages.push({ role: 'assistant', content: response.content })
    reply = textFrom(response.content) || reply

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (toolUses.length === 0 || response.stop_reason === 'end_turn') break

    if (round === rounds - 1) {
      hitRoundCap = true
      break
    }

    note(stepFor(toolUses.map((use) => use.name)))
    const settled = await Promise.all(
      toolUses.map(async (use) => {
        const started = Date.now()
        const result = await runTool(ctx, use.name, use.input)
        const ms = Date.now() - started
        return { use, result, ms }
      }),
    )
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const { use, result, ms } of settled) {
      timing.tools.push({ name: use.name, ms })
      console.debug(`[agent] tool name=${use.name} ms=${ms}${result.ok ? '' : ` error=${result.error}`}`)
      if (result.ok) turnSources.push(...sourcesFromTool(use.name, result.data))
      const body = result.ok ? result.data : { error: result.error }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(body),
        is_error: !result.ok,
      })
    }

    await saveMessage(args.service, {
      threadId,
      firmId: args.firmId,
      role: 'tool',
      content: toolResults,
    })
    messages.push({ role: 'user', content: toolResults })

    // A brief, a brainstorm or a drafted message's confirmation is the reply. Skip the model call that would restate it.
    if (settled.length === 1 && settled[0].result.ok) {
      const formatted = formatAnswer(settled[0].use.name, settled[0].result.data)
      if (formatted) {
        reply = formatted
        await saveMessage(args.service, {
          threadId,
          firmId: args.firmId,
          role: 'assistant',
          content: [{ type: 'text', text: formatted }],
        })
        messages.push({ role: 'assistant', content: formatted })
        break
      }
    }
  }

  if (hitRoundCap || outOfBudget) {
    const note = outOfBudget
      ? 'The firm reached its daily assistant limit before I could finish. Check Approvals for anything I drafted.'
      : 'I hit the tool-round limit for this turn before I could finish. Ask me to continue, or narrow the question.'
    reply = reply ? `${reply}\n\n${note}` : note
    // A tool call that was not run still has to be closed, or the next turn is rejected.
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant' && Array.isArray(last.content)) {
      const pending = last.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
      if (pending.length > 0) {
        const closed: Anthropic.ToolResultBlockParam[] = pending.map((use) => ({
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify({ error: 'Stopped: tool-round limit for this turn.' }),
          is_error: true,
        }))
        await saveMessage(args.service, { threadId, firmId: args.firmId, role: 'tool', content: closed })
      }
    }
    await saveMessage(args.service, {
      threadId,
      firmId: args.firmId,
      role: 'assistant',
      content: [{ type: 'text', text: note }],
    })
  }

  if (!reply) reply = 'I have nothing further to add. Check Approvals if I drafted anything.'

  const modelMs = timing.models.reduce((sum, row) => sum + row.ms, 0)
  const toolMs = timing.tools.reduce((sum, row) => sum + row.ms, 0)
  console.debug(`[agent] timing rounds=${timing.rounds} modelMs=${modelMs} toolMs=${toolMs} tools=${timing.tools.map((row) => row.name).join(',')}`)

  await args.service.from('agent_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId)

  return {
    threadId,
    reply,
    proposals: ctx.createdProposals.map(toOut),
    sources: dedupeSources(turnSources),
    timing,
  }
  } finally {
    if (args.requestId) clearProgress(args.requestId)
  }
}

function toOut(p: CreatedProposal): AgentProposalOut {
  return {
    id: p.id,
    kind: p.kind,
    studentId: p.studentId,
    rationale: p.rationale,
    sources: p.sources,
    payload: p.payload,
  }
}
