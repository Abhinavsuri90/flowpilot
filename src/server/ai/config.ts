import type { ModelStatus } from '../../lib/types'

export type Provider = 'anthropic' | 'openai'

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5',
}

export type ModelConfig = { provider: Provider; model: string; apiKey: string }

/**
 * Reads the model configuration from the environment on every call, so a key
 * added to the environment is picked up without code changes. Keys never leave
 * the server: callers only ever see `modelStatus()`.
 */
export function modelConfig(): ModelConfig | null {
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim()
  const openaiKey = process.env.OPENAI_API_KEY?.trim()
  const requested = process.env.MODEL_PROVIDER?.trim().toLowerCase()

  let provider: Provider | null = null
  if (requested === 'anthropic' || requested === 'openai') provider = requested
  else if (anthropicKey) provider = 'anthropic'
  else if (openaiKey) provider = 'openai'
  if (!provider) return null

  const apiKey = provider === 'anthropic' ? anthropicKey : openaiKey
  if (!apiKey) return null
  const model = process.env.MODEL_NAME?.trim() || DEFAULT_MODELS[provider]
  return { provider, model, apiKey }
}

export function modelStatus(): ModelStatus {
  const config = modelConfig()
  return config
    ? { available: true, provider: config.provider, model: config.model }
    : { available: false, provider: null, model: null }
}
