import { expect, it } from 'vitest'
import { createAssetRegistry } from '@/core/images/assets'
import { typeset } from '@/core/pipeline/typeset'
import { getPlatform, PLATFORMS } from '@/platforms/registry'
import { reassessWarnings } from './assess'

const markdown = [
  '# 标题', '###### 深层标题', '| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |',
  '行内 `代码` 与 [外链](https://example.com) 和 [拦截链接](javascript:alert(1))。',
  '```ts\nconst amount = 3\n```', '> 引用段落', '![图片](local.png)', '<em>原始标签</em>',
].join('\n\n')

it('未编辑的六份成稿重算后保持排版警告种类一致', () => {
  const report = typeset({ markdown, titleOverride: null, assets: createAssetRegistry({}) })
  expect(report.results.map(({ platform }) => platform)).toEqual(PLATFORMS.map(({ id }) => id))
  for (const { platform, outcome } of report.results) {
    if (!outcome.ok) throw new Error(`${platform} 排版失败`)
    const { warnings, html } = outcome.document
    const assessed = reassessWarnings(warnings, html, getPlatform(platform).capabilities)
    expect(warnings.length, platform).toBeGreaterThan(0)
    expect(new Set(assessed.map(({ kind }) => kind)), platform).toEqual(new Set(warnings.map(({ kind }) => kind)))
  }
})

it('仅有行内代码时也保留降级提醒，不误判成已解决', () => {
  const platform = PLATFORMS.find(({ capabilities }) => capabilities.inlineCode === 'degrade')
  if (!platform) throw new Error('未找到行内代码降级平台')
  const [result] = typeset({ markdown: '正文 `代码`', titleOverride: null, assets: createAssetRegistry({}) }, { platforms: [platform] }).results
  if (!result?.outcome.ok) throw new Error('排版失败')
  const { warnings, html } = result.outcome.document
  expect(reassessWarnings(warnings, html, platform.capabilities)).toMatchObject([{ kind: 'code', source: 'source' }])
})

it('移除缺图标记后不以仍存在的另一张正常图片保留其提示', () => {
  const platform = getPlatform('wechat')
  const [result] = typeset({
    markdown: '![缺图](local.png)\n\n![正常图](https://example.com/normal.png)', titleOverride: null, assets: createAssetRegistry({}),
  }, { platforms: [platform] }).results
  if (!result?.outcome.ok) throw new Error('排版失败')
  const { warnings, html } = result.outcome.document
  const after = html.replace(/［图片补插位[^］]*］/u, '')
  expect(after).toContain('normal.png')
  expect(reassessWarnings(warnings, after, platform.capabilities)).toEqual([])
})
