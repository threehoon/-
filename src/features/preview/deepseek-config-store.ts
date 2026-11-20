import { DEEPSEEK_MODELS, deepSeekPageAllowed, validDeepSeekKey, type DeepSeekConfig } from './deepseek-check'

export const DEEPSEEK_STORAGE_KEY = 'typeset-studio:deepseek-config:v1'

export function loadRememberedDeepSeekConfig(): DeepSeekConfig | null {
  if (!deepSeekPageAllowed()) return null
  try {
    const raw = window.localStorage.getItem(DEEPSEEK_STORAGE_KEY)
    if (!raw || raw.length > 1024) return null
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || !('key' in value) || !('model' in value)) return null
    const model = DEEPSEEK_MODELS.find((entry) => entry === value.model)
    return typeof value.key === 'string' && validDeepSeekKey(value.key) && model ? { key: value.key, model } : null
  } catch {
    return null
  }
}

export function saveRememberedDeepSeekConfig(config: DeepSeekConfig | null): boolean {
  if (!deepSeekPageAllowed()) return false
  try {
    if (config) window.localStorage.setItem(DEEPSEEK_STORAGE_KEY, JSON.stringify(config))
    else window.localStorage.removeItem(DEEPSEEK_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
