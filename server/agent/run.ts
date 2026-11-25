// The counselor-facing assistant: one thread per student (plus general), tool
// rounds, proposals only, history + cost guard. Nothing is written or sent
// except pending proposals and message rows.

import Anthropic from '@anthropic-ai/sdk'
import type { AgentProposalOut, AgentTurnSource } from '../../shared/agent.js'
import { modelName } from '../claude.js'
import { agentSystemPrompt } from '../prompts.js'
import type { Json } from '../../src/lib/database.types.js'
import { dedupeSources, sourcesFromTool } from './sources.js'
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

const maxRounds = () => {
  const n = Number(process.env.AGENT_MAX_ROUNDS)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8
}

const dailyLimit = () => {
  const n = Number(process.env.AGENT_DAILY_LIMIT)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200
}

function startOfUtcDay(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

async function countAssistantTurns(service: Db, firmId: string): Promise<number> {
  const { count, error } = await service
    .from('agent_messages')
    .select('id', { count: 'exact', head: true })
    .eq('firm_id', firmId)
    .eq('role', 'assistant')
    .gte('created_at', startOfUtcDay())
  if (error) throw new AgentHttpError('server', 'Could not check the daily assistant limit.', 500)
  return count ?? 0
}

async function loadCounselorName(user: Db, userId: string): Promise<{ name: string; firstName: string }> {
  const { data } = await user.from('firm_members').select('display_name').eq('user_id', userId).maybeSingle()
  const name = data?.display_name?.trim() || 'Counselor'
  const firstName = name.split(/\s+/)[0] || name
  return { name, firstName }
}

async function loadStudent(user: Db, firmId: string, studentId: string) {
  const { data, error } = await user.from('students').select('id, first_name, last_name, grad_year, onboarded_on').eq('id', studentId).eq('firm_id', firmId).maybeSingle()
  if (error) throw new AgentHttpError('server', error.message, 500)
  if (!data) throw new AgentHttpError('not_found', 'Student not found.', 404)
  return data
}

async function ensureThread(service: Db, firmId: string, counselorId: string, studentId: string | null): Promise<string> {
  let q = service.from('agent_threads').select('id').eq('firm_id', firmId).eq('counselor_id', counselorId)
  q = studentId ? q.eq('student_id', studentId) : q.is('student_id', null)
  const existing = await q.maybeSingle()
  if (existing.data?.id) return existing.data.id
  const title = studentId ? null : 'General'
  const { data, error } = await service
    .from('agent_threads')
    .insert({ firm_id: firmId, counselor_id: counselorId, student_id: studentId, title })
    .select('id')
    .single()
  if (error || !data) throw new AgentHttpError('server', error?.message ?? 'Could not open the thread.', 500)
  return data.id
}

async function loadHistory(service: Db, threadId: string): Promise<Anthropic.MessageParam[]> {
  const { data, error } = await service
    .from('agent_messages')
    .select('role, content')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(80)
  if (error) throw new AgentHttpError('server', error.message, 500)
  const messages: Anthropic.MessageParam[] = []
  for (const row of data ?? []) {
    const content = row.content as Anthropic.MessageParam['content']
    // Tool rows are stored separately. The API expects them as the next user message.
    if (row.role === 'tool') messages.push({ role: 'user', content })
    else if (row.role === 'user' || row.role === 'assistant') messages.push({ role: row.role, content })
  }
  return messages
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
  if (error) throw new AgentHttpError('server', error.message, 500)
}

function textFrom(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

export interface AgentRunResult {
  threadId: string
  reply: string
  proposals: AgentProposalOut[]
  /** Records the tools returned this turn. Not taken from the model's text. */
  sources: AgentTurnSource[]
}

export async function runAgent(args: {
  user: Db
  service: Db
  firmId: string
  counselorId: string
  studentId: string | null
  message: string
}): Promise<AgentRunResult> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new AgentHttpError('no_key', 'ANTHROPIC_API_KEY is not set on the server.', 503)
  }

  const used = await countAssistantTurns(args.service, args.firmId)
  if (used >= dailyLimit()) {
    throw new AgentHttpError('rate_limited', 'Daily assistant limit reached.', 429)
  }

  const counselor = await loadCounselorName(args.user, args.counselorId)
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
      ? { name: studentName!, gradYear: studentGradYear!, onboardedOn: studentOnboarded }
      : null,
  })

  const client = new Anthropic()
  const model = modelName()
  const rounds = maxRounds()
  let reply = ''
  let hitRoundCap = false
  const turnSources: AgentTurnSource[] = []

  for (let round = 0; round < rounds; round++) {
    let response: Anthropic.Message
    try {
      response = await client.messages.create({
        model,
        max_tokens: 8_000,
        system,
        tools: AGENT_TOOLS,
        messages,
      })
    } catch (error) {
      console.error('[agent] Claude error', error instanceof Error ? error.message : error)
      throw new AgentHttpError('upstream', 'The assistant could not reach Claude. Please try again.', 502)
    }

    await saveMessage(args.service, {
      threadId,
      firmId: args.firmId,
      role: 'assistant',
      content: response.content,
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

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const use of toolUses) {
      const result = await runTool(ctx, use.name, use.input)
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
  }

  if (hitRoundCap) {
    const note =
      'I hit the tool-round limit for this turn before I could finish. Ask me to continue, or narrow the question.'
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

  await args.service.from('agent_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId)

  return {
    threadId,
    reply,
    proposals: ctx.createdProposals.map(toOut),
    sources: dedupeSources(turnSources),
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
