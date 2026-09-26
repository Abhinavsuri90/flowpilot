import type { ModelStatus } from '../../lib/types'

export type Provider = 'anthropic' | 'openai' | 'openrouter'

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5',
  // Any OpenRouter model id that supports structured outputs works; see README.
  // gpt-6-luna: correct on the whole eval set, fastest and cheapest of those tested.
  openrouter: 'openai/gpt-6-luna',
}

const KEY_VARS: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
}

const BASE_URL_VARS: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_BASE_URL',
  openai: 'OPENAI_BASE_URL',
  openrouter: 'OPENROUTER_BASE_URL',
}

export type ModelConfig = { provider: Provider; model: string; apiKey: string; baseUrl: string }

const DEFAULT_BASE_URLS: Record<Provider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
}

const PROVIDERS: Provider[] = ['anthropic', 'openai', 'openrouter']

/**
 * Reads the model configuration from the environment on every call, so a key
 * added to the environment is picked up without code changes. Keys never leave
 * the server: callers only ever see `modelStatus()`.
 */
export function modelConfig(): ModelConfig | null {
  const keyFor = (provider: Provider) => process.env[KEY_VARS[provider]]?.trim() || ''
  const requested = process.env.MODEL_PROVIDER?.trim().toLowerCase()

  // An explicit MODEL_PROVIDER wins; otherwise the first provider with a key.
  const provider: Provider | undefined = PROVIDERS.includes(requested as Provider)
    ? (requested as Provider)
    : PROVIDERS.find((p) => keyFor(p))
  if (!provider) return null

  const apiKey = keyFor(provider)
  if (!apiKey) return null
  const model = process.env.MODEL_NAME?.trim() || DEFAULT_MODELS[provider]
  // Optional override (same convention as the official SDKs), e.g. a proxy or a local mock in e2e tests.
  const override = process.env[BASE_URL_VARS[provider]]?.trim()
  const baseUrl = (override || DEFAULT_BASE_URLS[provider]).replace(/\/+$/, '')
  return { provider, model, apiKey, baseUrl }
}

export function modelStatus(): ModelStatus {
  const config = modelConfig()
  return config
    ? { available: true, provider: config.provider, model: config.model }
    : { available: false, provider: null, model: null }
}
