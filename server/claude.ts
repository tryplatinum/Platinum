// The one place that calls Claude. Server-side only: the API key is read from
// the environment by the SDK and never leaves this process.

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { OUTPUTS, type AiErrorCode, type Feature, type FeatureInput, type FeatureOutput } from '../shared/contract.js'
import { PROMPTS } from './prompts.js'

export const DEFAULT_MODEL = 'claude-sonnet-5-5'

/** Set ANTHROPIC_MODEL to change the model for a deployment without a code change. */
export const modelName = () => process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL

/** Room for the longest draft (a meeting with two bilingual parent updates) plus the model's thinking. */
const MAX_TOKENS = 16_000

/** A failure the browser can show to the counselor. */
export class AiError extends Error {
  code: AiErrorCode
  status: number
  constructor(code: AiErrorCode, message: string, status = 502) {
    super(message)
    this.code = code
    this.status = status
  }
}

// When Claude declines a request on safety grounds, the API can re-run it on
// another model inside the same call. On by default for the models that
// support it; set AI_REFUSAL_FALLBACK=off to disable. If the whole chain
// declines, we still surface a refusal error below.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'
const FALLBACK_MODELS = /^claude-(sonnet-5-5|opus-5-5|opus-5|fable-5)/
const fallbackOn = (model: string) => process.env.AI_REFUSAL_FALLBACK !== 'off' && FALLBACK_MODELS.test(model)

let client: Anthropic | undefined

export async function runFeature<F extends Feature>(
  feature: F,
  input: FeatureInput<F>,
  limits?: { maxTokens?: number },
): Promise<{ draft: FeatureOutput<F>; model: string }> {
  client ??= new Anthropic()
  const prompt = PROMPTS[feature]
  const model = modelName()

  // Thinking is left at the model's default (adaptive). Effort is set explicitly per feature.
  const request = {
    model,
    max_tokens: limits?.maxTokens ?? MAX_TOKENS,
    system: prompt.system,
    messages: [{ role: 'user' as const, content: prompt.user(input) }],
    output_config: { effort: prompt.effort, format: zodOutputFormat(OUTPUTS[feature]) },
  }

  try {
    let response
    if (fallbackOn(model)) {
      try {
        response = await client.beta.messages.parse({ ...request, betas: [FALLBACK_BETA], fallbacks: 'default' })
      } catch (error) {
        // If this model or account does not accept the fallback option, carry on without it.
        if (!(error instanceof Anthropic.BadRequestError)) throw error
        response = await client.messages.parse(request)
      }
    } else {
      response = await client.messages.parse(request)
    }

    // Check why the model stopped before trusting the content.
    if (response.stop_reason === 'refusal') {
      throw new AiError('refusal', 'Claude declined to write this draft. Nothing was produced. You can edit the notes and try again, or write it yourself.', 422)
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AiError('max_tokens', 'The draft was cut off before it was finished, so it was discarded. Try again with shorter notes.', 422)
    }
    if (!response.parsed_output) {
      throw new AiError('upstream', 'Claude returned a draft that did not match the expected shape. Please try again.')
    }
    return { draft: response.parsed_output as FeatureOutput<F>, model: response.model }
  } catch (error) {
    throw toAiError(error, model, 'ANTHROPIC_MODEL')
  }
}

/** Turns anything a Claude call threw into an AiError the caller can show. Shared by every call in this file. */
function toAiError(error: unknown, model: string, setting: string): AiError {
  if (error instanceof AiError) return error
  // Most specific first. Never pass the upstream message through: it can contain request details.
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiError('no_key', 'The server’s Anthropic API key was rejected. Check ANTHROPIC_API_KEY.', 503)
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AiError('upstream', `The model “${model}” was not found. Check ${setting}.`)
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiError('rate_limited', 'Claude is rate-limiting this account. Wait a moment and try again.', 429)
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiError('upstream', 'The server could not reach Claude. Please try again.')
  }
  if (error instanceof Anthropic.APIError) {
    console.error('[ai] Claude API error', error.status, error.message)
    return new AiError('upstream', `Claude returned an error (${error.status ?? 'unknown'}). Please try again.`)
  }
  console.error('[ai] unexpected error', error instanceof Error ? error.message : 'unknown')
  return new AiError('server', 'Something went wrong while drafting. Please try again.', 500)
}

// ── A call with a file ──────────────────────────────────────────────────────
// Used to sort an uploaded file into a folder (server/documentSorting.ts). The
// file goes inline in the request as a document or image block, never through
// the Files API, so nothing is left stored at Anthropic.

/** The cheapest current model that reads PDFs and images. Sorting is a small, frequent job. */
export const DEFAULT_SORT_MODEL = 'claude-haiku-5-5'

/** Set ANTHROPIC_SORT_MODEL to sort files with another model. */
export const sortModelName = () => process.env.ANTHROPIC_SORT_MODEL?.trim() || DEFAULT_SORT_MODEL

export const hasAnthropicKey = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim())

/** A file as the model takes it: base64, with no line breaks. */
export type FileContent = { kind: 'pdf'; base64: string } | { kind: 'image'; mediaType: 'image/jpeg' | 'image/png'; base64: string }

/** Enough for a short structured answer and the little thinking a low-effort call does. */
const FILE_MAX_TOKENS = 4_000
/** An upload never waits long on this: past it, the file is settled without the model. */
const FILE_TIMEOUT_MS = 40_000

export async function runWithFile<Schema extends import('zod').ZodType>(request: {
  system: string
  text: string
  file?: FileContent
  schema: Schema
  effort: 'low' | 'medium' | 'high'
}): Promise<{ output: import('zod').infer<Schema>; model: string }> {
  client ??= new Anthropic()
  const model = sortModelName()
  const file: Anthropic.ContentBlockParam[] = !request.file
    ? []
    : request.file.kind === 'pdf'
      ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: request.file.base64 } }]
      : [{ type: 'image', source: { type: 'base64', media_type: request.file.mediaType, data: request.file.base64 } }]
  try {
    // The file comes before the text, as the API recommends. Thinking is left at the model's default.
    const response = await client.messages.parse(
      {
        model,
        max_tokens: FILE_MAX_TOKENS,
        system: request.system,
        messages: [{ role: 'user', content: [...file, { type: 'text', text: request.text }] }],
        output_config: { effort: request.effort, format: zodOutputFormat(request.schema) },
      },
      { timeout: FILE_TIMEOUT_MS, maxRetries: 0 },
    )
    if (response.stop_reason === 'refusal') throw new AiError('refusal', 'Claude declined to read this file.', 422)
    if (response.stop_reason === 'max_tokens') throw new AiError('max_tokens', 'The answer was cut off before it was finished.', 422)
    if (!response.parsed_output) throw new AiError('upstream', 'Claude returned an answer that did not match the expected shape.')
    return { output: response.parsed_output, model: response.model }
  } catch (error) {
    throw toAiError(error, model, 'ANTHROPIC_SORT_MODEL')
  }
}
