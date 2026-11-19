import { describe, expect, it } from 'vitest'
import { fingerprint } from './hash'

describe('fingerprint', () => {
  it('同样的输入得到同样的值', () => {
    expect(fingerprint(['正文', 3, true as unknown as string])).toBe(fingerprint(['正文', 3, 'true']))
  })

  it('长度前缀让相邻拼接互不碰撞', () => {
    expect(fingerprint(['ab', 'c'])).not.toBe(fingerprint(['a', 'bc']))
  })

  it('空值与空串等价，且顺序敏感', () => {
    expect(fingerprint([null, '甲'])).toBe(fingerprint(['', '甲']))
    expect(fingerprint(['甲', '乙'])).not.toBe(fingerprint(['乙', '甲']))
  })
})
