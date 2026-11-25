import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { EssayBrainstormSchema } from '../../shared/agent.js'
import { AiError, modelName } from '../claude.js'
import type { ToolResult } from './types.js'

let client: Anthropic | undefined

const SYSTEM = `You help a college counselor brainstorm an essay with a student. You never write essay text, paragraphs, openings, or sample sentences that could be pasted into the essay.

Return only structured brainstorming: questions to ask the student, angles to explore, gaps in the story, and materials to gather. Each item is at most 200 characters. Stay with what the counselor told you; do not invent biography.`

/** Structured brainstorm only — no free-form essay draft. */
export async function essayBrainstorm(input: { prompt: string; notes?: string; studentFirstName?: string }): Promise<ToolResult> {
  client ??= new Anthropic()
  const model = modelName()
  const user = [
    input.studentFirstName ? `Student first name: ${input.studentFirstName}` : '',
    `Essay prompt:\n${input.prompt}`,
    input.notes ? `Counselor notes:\n${input.notes}` : '',
    'Brainstorm only. Do not write any essay text.',
  ]
    .filter(Boolean)
    .join('\n\n')

  try {
    const response = await client.messages.parse({
      model,
      max_tokens: 4_000,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
      output_config: { format: zodOutputFormat(EssayBrainstormSchema) },
    })
    if (response.stop_reason === 'refusal') {
      return { ok: false, error: 'Claude declined this brainstorming request.' }
    }
    if (!response.parsed_output) {
      return { ok: false, error: 'Brainstorming returned an unexpected shape.' }
    }
    return { ok: true, data: response.parsed_output }
  } catch (error) {
    if (error instanceof AiError) return { ok: false, error: error.message }
    return { ok: false, error: error instanceof Error ? error.message : 'Brainstorming failed.' }
  }
}
