import { describe, expect, it } from 'vitest'
import type { PlatformDefinition, TypesetRequest } from '../types'
import { createAssetRegistry } from '../images/assets'
import { stripArticleSourceMarkers } from '../render/source-markers'
import { getPlatform, PLATFORMS } from '@/platforms/registry'
import { resolveArticleTheme, WECHAT_TEMPLATES } from '@/platforms/wechat/theme'
import { typeset } from './typeset'

const SAMPLE = [
  '---',
  'title: 一份样稿',
  '---',
  '',
  '# 一份样稿',
  '',
  '开头一段，说明背景。',
  '',
  '## 小标题',
  '',
  '| 名称 | 数量 |',
  '| --- | --- |',
  '| 苹果 | 3 |',
  '',
  '```ts',
  'const x = 1',
  '```',
  '',
  '> 引用一句话',
  '',
  '[外链](https://example.com/a) 与 [坏链](javascript:alert(1))',
  '',
  '![示意图](images/team.png)',
].join('\n')

function request(overrides: Partial<TypesetRequest> = {}): TypesetRequest {
  return {
    markdown: SAMPLE,
    titleOverride: null,
    assets: createAssetRegistry({}),
    ...overrides,
  }
}

describe('六平台排版', () => {
  it('一次排版生成六个平台的结果，顺序与注册表一致', () => {
    const report = typeset(request())

    expect(report.parseError).toBeNull()
    expect(report.typesetAt).not.toBeNull()
    expect(report.results).toHaveLength(6)
    expect(report.results.map((result) => result.platform)).toEqual(PLATFORMS.map((p) => p.id))
    expect(report.results.every((result) => result.outcome.ok)).toBe(true)
    expect(report.title).toBe('一份样稿')
  })

  it('标题按 frontmatter 提取，且不会重复出现在正文里', () => {
    const report = typeset(request())
    const wechat = report.results[0]?.outcome
    expect(wechat?.ok).toBe(true)
    if (wechat?.ok) {
      expect(wechat.document.title).toBe('一份样稿')
      expect(wechat.document.html).not.toContain('一份样稿</h1>')
      expect(wechat.document.plainText).not.toContain('一份样稿')
    }
  })

  it('手动标题覆盖自动提取结果', () => {
    const report = typeset(request({ titleOverride: '手动写的标题' }))
    expect(report.title).toBe('手动写的标题')
    const first = report.results[0]?.outcome
    if (first?.ok) {
      expect(first.document.title).toBe('手动写的标题')
    }
  })

  it.each([
    ['wechat', 'rgb(23, 53, 95)'], ['toutiao', 'rgb(237, 243, 250)'],
    ['sohu', 'rgb(237, 243, 250)'], ['baijiahao', ''],
    ['zhihu', ''], ['qq', 'rgb(237, 243, 250)'],
  ] as const)('%s 按平台适配章节，去掉样式后仍是原生标题和列表', (platform, fill) => {
    const markdown = '## 小标题\n\n### 索引\n\n正文 **重点**。\n\n> 引用\n\n- 一级\n  - 二级\n\n3. 三号\n4. 四号'
    const result = typeset(request({ markdown })).results.find((entry) => entry.platform === platform)
    if (!result?.outcome.ok) throw new Error('未生成成稿')
    const article = document.createElement('div')
    article.innerHTML = result.outcome.document.html
    const heading = article.querySelector('h2')
    expect(heading?.style.backgroundColor).toBe(fill)
    expect(heading?.style.display).toBe(platform === 'wechat' ? 'table' : '')
    expect(heading?.getAttribute('style')?.includes('linear-gradient')).toBe(platform === 'wechat')
    expect(article.querySelector('p')?.style.fontSize).toBe(platform === 'wechat' ? '' : '17px')
    expect(article.querySelector('blockquote')?.getAttribute('style')).toBeTruthy()
    for (const element of article.querySelectorAll('[style]')) element.removeAttribute('style')
    expect(article.querySelector('h2')?.textContent).toBe('小标题')
    expect(article.querySelector('h3')?.textContent).toBe('索引')
    expect(article.querySelector('p > strong')?.textContent).toBe('重点')
    expect(article.querySelector('ul > li > ul > li')?.textContent).toBe('二级')
    expect(article.querySelector('ol')?.start).toBe(3)
  })

  it('平台差异由 capabilities 驱动：头条降级表格，知乎保留表格', () => {
    const report = typeset(request())
    const toutiao = report.results.find((result) => result.platform === 'toutiao')?.outcome
    const zhihu = report.results.find((result) => result.platform === 'zhihu')?.outcome

    expect(toutiao?.ok).toBe(true)
    expect(zhihu?.ok).toBe(true)
    if (toutiao?.ok) {
      expect(toutiao.document.html).not.toContain('<table')
      expect(toutiao.document.warnings.some((warning) => warning.kind === 'table')).toBe(true)
    }
    if (zhihu?.ok) {
      expect(stripArticleSourceMarkers(zhihu.document.html)).toContain('<table style="')
      expect(zhihu.document.warnings.some((warning) => warning.kind === 'table')).toBe(false)
    }
  })

  it('所有平台的警告都带现象、动作与原文片段', () => {
    const report = typeset(request())
    for (const result of report.results) {
      if (!result.outcome.ok) {
        continue
      }
      for (const warning of result.outcome.document.warnings) {
        expect(warning.message.length).toBeGreaterThan(0)
        expect(warning.action.length).toBeGreaterThan(0)
        expect(warning.excerpt.length).toBeGreaterThan(0)
      }
    }
  })

  it('纯文本兜底与 HTML 同源，不含标签', () => {
    const report = typeset(request())
    const wechat = report.results[0]?.outcome
    if (wechat?.ok) {
      expect(wechat.document.plainText).not.toContain('<p')
      expect(wechat.document.plainText).toContain('开头一段，说明背景。')
    }
  })
})

describe('多平台共享排版模板', () => {
  it.each(WECHAT_TEMPLATES)('$name 可在六个平台应用，且不改变各自的正文和兼容性报告', ({ id, theme }) => {
    const original = typeset(request())
    const platformTemplates = Object.fromEntries(PLATFORMS.map((platform) => [platform.id, id]))
    const selected = typeset(request({ platformTemplates }))
    expect(selected.parseError).toBeNull()
    expect(selected.title).toBe(original.title)
    expect(selected.stats).toEqual(original.stats)
    expect(selected.results).toHaveLength(6)
    for (const [index, { outcome }] of selected.results.entries()) {
      const baseline = original.results[index].outcome
      if (!outcome.ok || !baseline.ok) throw new Error('成稿生成失败')
      const platform = selected.results[index].platform
      const selectedTheme = resolveArticleTheme(id, platform)
      if (id !== 'classic') expect(selectedTheme).toBe(theme)
      const preview = document.createElement('div')
      preview.innerHTML = outcome.document.html
      expect(preview.querySelector('section > p')?.getAttribute('style')).toBe(selectedTheme.paragraph)
      expect(outcome.document.plainText).toBe(baseline.document.plainText)
      expect(outcome.document.warnings).toEqual(baseline.document.warnings)
      const withoutStyles = (html: string) => html.replace(/ style="[^"]*"/g, '')
      expect(withoutStyles(outcome.document.html)).toBe(withoutStyles(baseline.document.html))
      if (id === 'classic') expect(outcome).toEqual(baseline)
      else expect(outcome.document.html).not.toBe(baseline.document.html)
    }
  })

  it('只把每个平台选中的主题传给相应适配器', () => {
    const original = typeset(request())
    const selected = typeset(request({ platformTemplates: { toutiao: 'warm', zhihu: 'technical' } }))
    for (const [index, result] of selected.results.entries()) {
      const baseline = original.results[index]
      if (result.platform === 'toutiao' || result.platform === 'zhihu') {
        expect(result).not.toEqual(baseline)
      } else {
        expect(result).toEqual(baseline)
      }
    }
  })
})

describe('失败隔离', () => {
  it('单平台渲染抛异常时只标记该平台失败', () => {
    const broken: PlatformDefinition = {
      ...getPlatform('zhihu'),
      render() {
        throw new Error('模拟渲染崩溃')
      },
    }

    const report = typeset(request(), { platforms: [broken, ...PLATFORMS] })
    expect(report.parseError).toBeNull()
    expect(report.results).toHaveLength(7)

    const brokenResult = report.results[0]?.outcome
    expect(brokenResult?.ok).toBe(false)
    if (brokenResult && !brokenResult.ok) {
      expect(brokenResult.failure.code).toBe('render')
      expect(brokenResult.failure.platform).toBe('zhihu')
      expect(brokenResult.failure.reason).toContain('模拟渲染崩溃')
    }

    const others = report.results.slice(1)
    expect(others.every((result) => result.outcome.ok)).toBe(true)
  })

  it('解析整体失败时 results 为空并给出 parseError', () => {
    const report = typeset(request({ markdown: null as unknown as string }))

    expect(report.parseError).toContain('无法解析源稿')
    expect(report.results).toEqual([])
    expect(report.typesetAt).toBeNull()
    expect(report.title).toBeNull()
    expect(report.stats).toEqual({ characters: 0, blocks: 0 })
  })

  it('素材登记表抛异常时也只影响图片，不让整篇失败', () => {
    const report = typeset(
      request({
        assets: {
          resolve() {
            throw new Error('素材表损坏')
          },
        },
      }),
    )

    expect(report.parseError).toBeNull()
    expect(report.results.every((result) => result.outcome.ok)).toBe(true)
    const wechat = report.results[0]?.outcome
    if (wechat?.ok) {
      const imageWarning = wechat.document.warnings.find((warning) => warning.kind === 'image')
      expect(imageWarning?.message).toContain('补插标记')
    }
  })
})

describe('性能冒烟（PRD 第 6 节）', () => {
  it('10,000 字符样稿生成六版在 2 秒内完成', () => {
    const paragraph = '这是一段用于性能验证的中文正文，包含标点、数字 123 与英文 words。'.repeat(2)
    const sections = Array.from({ length: 150 }, (_, index) => `## 小节 ${index}\n\n${paragraph}`)
    const markdown = sections.join('\n\n')

    const startedAt = performance.now()
    const report = typeset(request({ markdown }))
    const elapsed = performance.now() - startedAt

    expect(report.parseError).toBeNull()
    expect(report.stats.characters).toBeGreaterThanOrEqual(10000)
    expect(report.results).toHaveLength(6)
    expect(report.results.every((result) => result.outcome.ok)).toBe(true)
    expect(elapsed).toBeLessThan(2000)
    expect(report.durationMs).toBeLessThan(2000)
  })
})
