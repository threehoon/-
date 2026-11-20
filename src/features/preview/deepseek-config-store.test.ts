// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_STORAGE_KEY, loadRememberedDeepSeekConfig, saveRememberedDeepSeekConfig } from './deepseek-config-store'

const config = { key: 'fixture-only', model: 'deepseek-v4-pro' } as const
const values = new Map<string, string>()
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value) },
  removeItem: (key: string) => { values.delete(key) },
}

describe('remembered DeepSeek configuration', () => {
  beforeEach(() => {
    values.clear()
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('location', { protocol: 'https:', hostname: 'example.test' })
    vi.stubGlobal('localStorage', storage)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns no configuration until saved, then restores the key and model', () => {
    expect(loadRememberedDeepSeekConfig()).toBeNull()
    expect(saveRememberedDeepSeekConfig(config)).toBe(true)
    expect(loadRememberedDeepSeekConfig()).toEqual(config)
  })

  it.each(['{', 'null', '[]', '{"key":"x"}', 'x'.repeat(1025),
    JSON.stringify({ ...config, key: '\n' }), JSON.stringify({ ...config, model: 'unknown' }),
  ])('ignores invalid stored data: %.24s', (raw) => {
    window.localStorage.setItem(DEEPSEEK_STORAGE_KEY, raw)
    expect(loadRememberedDeepSeekConfig()).toBeNull()
  })

  it('does not read or write configuration on insecure pages', () => {
    expect(saveRememberedDeepSeekConfig(config)).toBe(true)
    vi.stubGlobal('isSecureContext', false)
    expect(loadRememberedDeepSeekConfig()).toBeNull()
    expect(saveRememberedDeepSeekConfig(null)).toBe(false)
    expect(window.localStorage.getItem(DEEPSEEK_STORAGE_KEY)).not.toBeNull()
  })

  it('does not prevent startup if site storage cannot be read', () => {
    vi.spyOn(storage, 'getItem').mockImplementationOnce(() => { throw new DOMException('Blocked', 'SecurityError') })
    expect(loadRememberedDeepSeekConfig()).toBeNull()
  })

  it('reports write failure instead of claiming the new settings were remembered', () => {
    vi.spyOn(storage, 'setItem').mockImplementationOnce(() => { throw new DOMException('Full', 'QuotaExceededError') })
    expect(saveRememberedDeepSeekConfig(config)).toBe(false)
    expect(loadRememberedDeepSeekConfig()).toBeNull()
  })

  it('clears only the saved DeepSeek settings', () => {
    expect(saveRememberedDeepSeekConfig(config)).toBe(true)
    window.localStorage.setItem('other-feature', 'keep this')
    expect(saveRememberedDeepSeekConfig(null)).toBe(true)
    expect(loadRememberedDeepSeekConfig()).toBeNull()
    expect(window.localStorage.getItem('other-feature')).toBe('keep this')
  })
})
