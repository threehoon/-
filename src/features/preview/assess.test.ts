import { describe, expect, it } from 'vitest'
import type { CompatWarning } from '@/core/types'
import { getPlatform } from '@/platforms/registry'
import { reassessWarnings } from './assess'

const capabilities = getPlatform('baijiahao').capabilities
const table = '<table><tr><td>内容</td></tr></table>'
const image = '<img src="https://example.com/photo.png" alt="图片">'
const warning = (kind: CompatWarning['kind']): CompatWarning => ({
  id: kind, kind, severity: 'attention', message: '兼容提醒', action: '查看正文', excerpt: '内容',
})

describe('成稿兼容提示实时重算', () => {
  it.each([
    ['table', table], ['image', image],
  ] as const)('删除 %s 后对应提示消失', (kind, html) => {
    expect(reassessWarnings([warning(kind)], html, capabilities)).toEqual([{
      ...warning(kind), source: 'live',
    }])
    expect(reassessWarnings([warning(kind)], '<p>其余正文</p>', capabilities)).toEqual([])
  })

  it('新加表格只新增一条提示', () => {
    expect(reassessWarnings([], table + table, capabilities)).toMatchObject([{ kind: 'table', source: 'live' }])
  })

  it('链接降级平台只能将旧链接提醒标为源稿核对', () => {
    expect(capabilities.links).toBe('degrade')
    expect(reassessWarnings([warning('link')], '<p>链接已删</p>', capabilities))
      .toEqual([{ ...warning('link'), source: 'source' }])
  })

  it('保留链接的平台不把曾拦截的链接误标为实时命中', () => {
    const blocked: CompatWarning = {
      ...warning('link'), locations: [{ kind: 'source', span: { start: 5, end: 15 }, block: { start: 0, end: 26 } }],
    }
    expect(reassessWarnings([blocked], '<a href="https://example.com">无关链接</a>', getPlatform('sohu').capabilities))
      .toEqual([{ ...blocked, source: 'source' }])
  })
})
