import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 设计令牌的对比度守卫。令牌被改动时，这组断言会立刻失败，
 * 避免「看起来还行」的暖色被逐步调浅到不可读。
 */
const tokensPath = resolve(process.cwd(), 'src/styles/tokens.css')
const tokenSource = readFileSync(tokensPath, 'utf8')

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokenSource)
  if (!match?.[1]) {
    throw new Error(`令牌 --${name} 未在 tokens.css 中定义为十六进制颜色`)
  }
  return match[1]
}

function channel(value: number): number {
  const srgb = value / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const red = parseInt(hex.slice(1, 3), 16)
  const green = parseInt(hex.slice(3, 5), 16)
  const blue = parseInt(hex.slice(5, 7), 16)
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  const [light, dark] = a > b ? [a, b] : [b, a]
  return (light + 0.05) / (dark + 0.05)
}

describe('设计令牌对比度', () => {
  const bodyPairs: Array<[string, string, number]> = [
    ['fg', 'bg', 7],
    ['fg', 'surface', 7],
    ['fg-2', 'surface', 4.5],
    ['muted', 'bg', 4.5],
    ['meta', 'bg', 4.5],
    ['meta', 'surface-sunken', 4.5],
    ['accent', 'bg', 4.5],
    ['accent', 'accent-soft', 4.5],
    ['accent-on', 'accent', 4.5],
    ['danger', 'danger-soft', 4.5],
    ['warn', 'warn-soft', 4.5],
    ['success', 'success-soft', 4.5],
  ]

  it.each(bodyPairs)('%s 在 %s 上达到 %s:1', (foreground, background, minimum) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(minimum)
  })

  it('输入框描边在页面底色上达到非文本 3:1', () => {
    expect(contrast(token('border-strong'), token('bg'))).toBeGreaterThanOrEqual(3)
    expect(contrast(token('border-strong'), token('surface'))).toBeGreaterThanOrEqual(3)
  })

  it('焦点环在页面底色与象牙底色上都达到非文本 3:1', () => {
    expect(contrast(token('accent-strong'), token('bg'))).toBeGreaterThanOrEqual(3)
    expect(contrast(token('accent-strong'), token('surface'))).toBeGreaterThanOrEqual(3)
  })
})
