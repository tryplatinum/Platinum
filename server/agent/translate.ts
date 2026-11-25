// English for the counselor, generated only when they ask. Parent-facing drafts
// stay on the main model. The fast model is never used here.

import Anthropic from '@anthropic-ai/sdk'
import { modelName } from '../claude.js'
import { joinAssistantText } from './text.js'

let client: Anthropic | undefined

export async function translateForCounselor(body: string, language: string): Promise<string> {
  client ??= new Anthropic()
  const response = await client.messages.create({
    model: modelName(),
    max_tokens: 800,
    system:
      'Translate this message into natural English so a college counselor can review it. Keep every fact, name, date, and the sign-off. Do not add anything. Return only the English message.',
    messages: [{ role: 'user', content: `The message is in ${language}.\n\n${body}` }],
  })
  const text = joinAssistantText(
    response.content.filter((block): block is Anthropic.TextBlock => block.type === 'text').map((block) => block.text),
  )
  if (!text) throw new Error('The translation was empty.')
  return text
}
