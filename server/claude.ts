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
const useFallback = (model: string) => process.env.AI_REFUSAL_FALLBACK !== 'off' && FALLBACK_MODELS.test(model)

let client: Anthropic | undefined

export async function runFeature<F extends Feature>(feature: F, input: FeatureInput<F>): Promise<{ draft: FeatureOutput<F>; model: string }> {
  client ??= new Anthropic()
  const prompt = PROMPTS[feature]
  const model = modelName()

  // Thinking is left at the model's default (adaptive). Effort is set explicitly per feature.
  const request = {
    model,
    max_tokens: MAX_TOKENS,
    system: prompt.system,
    messages: [{ role: 'user' as const, content: prompt.user(input) }],
    output_config: { effort: prompt.effort, format: zodOutputFormat(OUTPUTS[feature]) },
  }

  try {
    let response
    if (useFallback(model)) {
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
    if (error instanceof AiError) throw error
    // Most specific first. Never pass the upstream message through: it can contain request details.
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new AiError('no_key', 'The server’s Anthropic API key was rejected. Check ANTHROPIC_API_KEY.', 503)
    }
    if (error instanceof Anthropic.NotFoundError) {
      throw new AiError('upstream', `The model “${model}” was not found. Check ANTHROPIC_MODEL.`)
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AiError('rate_limited', 'Claude is rate-limiting this account. Wait a moment and try again.', 429)
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new AiError('upstream', 'The server could not reach Claude. Please try again.')
    }
    if (error instanceof Anthropic.APIError) {
      console.error('[ai] Claude API error', error.status, error.message)
      throw new AiError('upstream', `Claude returned an error (${error.status ?? 'unknown'}). Please try again.`)
    }
    console.error('[ai] unexpected error', error)
    throw new AiError('server', 'Something went wrong while drafting. Please try again.', 500)
  }
}
