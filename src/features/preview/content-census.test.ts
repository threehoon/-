import { describe, expect, it } from 'vitest'
import { censusOf, normalizeText } from './content-census'
import { createAssetRegistry } from '@/core/images/assets'
import { parseDocument } from '@/core/markdown/parse'
import { stripArticleSourceMarkers } from '@/core/render/source-markers'
import { getPlatform } from '@/platforms/registry'

describe('成稿清单', () => {
  it('数出段落、图片、外链、表格与代码块', () => {
    const census = censusOf(`<h2>标题行</h2>
      <p>第一段 <a href="https://example.test/a">报道</a>。</p>
      <p><img src="/a.png"><img src="/b.png"></p>
      <table><tr><td>甲</td><td>乙</td></tr></table>
      <pre><code>const a = 1</code></pre>
      <p>行内 <code>x</code> 代码。</p>`)
    expect(census.images).toBe(2)
    expect(census.externalLinks).toBe(1)
    expect(census.tables).toBe(1)
    expect(census.downgradedTables).toBe(0)
    expect(census.codeBlocks).toBe(1)
    expect(census.inlineCodes).toBe(1)
    expect(census.units.length).toBeGreaterThanOrEqual(4)
  })

  it('按真实降级渲染分组，不把单列表格误判成降级表格', () => {
    const markdown = '| 单列 |\n| --- |\n| 甲 |\n| 乙 |\n\n| 单列 |\n| --- |\n| 丙 |'
    const render = (platform: 'wechat' | 'baijiahao') => {
      const outcome = getPlatform(platform).render(parseDocument(markdown), { assets: createAssetRegistry({}), titleOverride: null })
      if (!outcome.ok) throw new Error('排版失败')
      return outcome.document.html
    }
    expect(censusOf(render('wechat'))).toMatchObject({ tables: 2, downgradedTables: 0 })
    const degraded = render('baijiahao')
    expect(censusOf(degraded)).toMatchObject({ tables: 0, downgradedTables: 2, downgradedTableUnits: [0, 2] })
    expect(stripArticleSourceMarkers(degraded)).not.toContain('data-uma-source-table')
  })

  it('文字块序号与 collectBodyUnits 对齐', () => {
    const census = censusOf('<p>甲段。</p><p>乙段。</p>')
    expect(census.units.map((unit) => unit.text)).toEqual(['甲段。', '乙段。'])
    expect(census.units.map((unit) => unit.index)).toEqual([0, 1])
  })

  it('归一化全角字母数字与多余空白', () => {
    expect(normalizeText('  ＡＢＣ　１２３  多　空白 ')).toBe('ABC 123 多 空白')
  })
})
