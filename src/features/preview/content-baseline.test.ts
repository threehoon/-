import { describe, expect, it } from 'vitest'
import { checkAgainstBaseline } from './content-baseline'
import { censusOf } from './content-census'
import { contentRange } from './content-check'

function compare(before: string, after: string) {
  return checkAgainstBaseline(censusOf(before), censusOf(after))
}

const block = (text: string) => `<p>${text}</p>`
const retained = '山'.repeat(180)

describe('内容与排版基线对比', () => {
  it('整段删除报原文摘录；原段已经不存在，不拿顺移后的邻段定位', () => {
    const findings = compare('<p>要删除的第一段。</p><p>完全不同的第二段。</p>', '<p>完全不同的第二段。</p>')
    expect(findings).toMatchObject([{ kind: 'missing', original: '要删除的第一段。', detail: '基线第 1 段 · 以下为原文摘录' }])
    expect(contentRange([], findings[0]).status).toBe('unavailable')
  })

  it('删除 30 字报段落缩水；定位到仍存在的整段', () => {
    const current = block(retained)
    const findings = compare(block(retained + '水'.repeat(30)), current)
    expect(findings).toMatchObject([{ kind: 'shrunk', detail: '基线第 1 段：210→180 字' }])
    const article = document.createElement('article')
    article.innerHTML = current
    expect(contentRange([], findings[0], article).status).toBe('block')
    article.innerHTML += current
    expect(contentRange([], findings[0], article).status).toBe('unavailable')
  })

  it.each([
    [60, 15, []], [171, 19, []], [181, 20, []], [180, 20, ['shrunk']],
  ] as const)('保留 %i 字、减少 %i 字按 20 字和 10%% 双门槛处理', (kept, lost, kinds) => {
    const remainder = '山'.repeat(kept)
    expect(compare(block(remainder + '水'.repeat(lost)), block(remainder)).map(({ kind }) => kind)).toEqual(kinds)
  })

  it('Dice 恰为 0.5 算同段；低于门槛算缺失', () => {
    expect(compare(block('abcde'), block('abcXY'))).toEqual([])
    expect(compare(block('abcde'), block('abXYZ'))).toMatchObject([{ kind: 'missing' }])
  })

  it('仅移除外链而保留锚文字，只报结构变化', () => {
    const findings = compare('<p>阅读<a href="https://example.com">公开报道</a>。</p>', '<p>阅读公开报道。</p>')
    expect(findings).toMatchObject([{ kind: 'structure', detail: '外链 1→0' }])
    expect(contentRange([], findings[0]).status).toBe('unavailable')
  })

  it('计数减少单独列出，并单独报告逐行文字表格', () => {
    const image = '<img src="https://example.com/image.png">'
    const table = '<table><tr><td>列名：文字</td></tr></table>'
    const downgraded = '<p data-uma-source-table="3">另一张逐行表格</p>'
    expect(compare(image.repeat(3) + table + downgraded + '<pre>代码</pre>', image + block('列名：文字') + block('另一张逐行表格')))
      .toMatchObject([
        { kind: 'structure', detail: '图片 3→1' }, { kind: 'structure', detail: '表格 1→0' },
        { kind: 'structure', detail: '代码块 1→0' }, { kind: 'structure', detail: '降级表格 1→0' },
      ])
  })

  it('段落换顺序不报缺失，重复段落数减少则只报缺失的一段', () => {
    const a = block('海边活动。')
    const b = block('山里活动。')
    expect(compare(a + b, b + a)).toEqual([])
    expect(compare(a + b + a, b + a)).toMatchObject([{ kind: 'missing', original: '海边活动。' }])
  })
})
