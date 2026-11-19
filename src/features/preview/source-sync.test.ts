import { describe, expect, it } from 'vitest'
import { createAssetRegistry } from '@/core/images/assets'
import { parseDocument } from '@/core/markdown/parse'
import { stripArticleSourceMarkers } from '@/core/render/source-markers'
import type { PlatformId } from '@/core/types'
import { getPlatform } from '@/platforms/registry'
import { syncArticleSource } from './source-sync'

const dataUrl = 'data:image/png;base64,AA=='
const blobUrl = 'blob:https://app.example/inserted'

function setup(baselineMarkdown: string, platform: PlatformId = 'wechat', boundAssets: Readonly<Record<string, string>> = {}) {
  const result = getPlatform(platform).render(parseDocument(baselineMarkdown), { assets: createAssetRegistry(boundAssets), titleOverride: '手填标题' })
  if (!result.ok) throw new Error(result.failure.reason)
  const baselineHtml = result.document.html
  const template = document.createElement('template')
  template.innerHTML = baselineHtml
  const sync = (html = template.innerHTML) => syncArticleSource({ baselineMarkdown, baselineHtml, boundAssets, html })
  return { baselineHtml, template, sync }
}

function changeText(template: HTMLTemplateElement, selector: string, value: string) {
  const element = template.content.querySelector(selector)
  if (!element) throw new Error(`Missing ${selector}`)
  element.textContent = value
}

const table = '| 名称 | 数量 |\n| :--- | ---: |\n| 苹果 | 3 |'
const preserve = '\uFEFF---\r\ntitle: 标题\r\ntags: [a, b]\r\n---\r\n\r\n  # 标题\r\n\r\n普通段落。\r\n\r\n  *原样* [链接](https://example.test/)\r\n\r\n![图](<./images/示意 图.png>)\r\n\r\n[引用]: https://example.test/\r\n'

describe('article source synchronization', () => {
  it('preserves BOM, YAML, extracted heading, hidden definitions, original image and unrelated bytes', () => {
    const { template, sync } = setup(preserve, 'baijiahao', { 'images/示意 图.png': dataUrl })
    changeText(template, 'p', '变更后的正文。')
    expect(sync()).toEqual({ markdown: preserve.replace('普通段落。', '变更后的正文。'), issue: null, platformStyle: false })
  })

  it('ignores HTML syntax normalization on no-op and preserves exact source on undo', () => {
    const { template, sync } = setup(preserve, 'baijiahao', { 'images/示意 图.png': dataUrl })
    const initial = template.innerHTML
    expect(sync(initial).markdown).toBe(preserve)
    changeText(template, 'p', '同步新稿')
    const edited = template.innerHTML
    expect(sync(edited).markdown).toBe(preserve.replace('普通段落。', '同步新稿'))
    expect(sync(initial).markdown).toBe(preserve)
    expect(sync(edited).markdown).toBe(preserve.replace('普通段落。', '同步新稿'))
  })

  it('keeps changed lossy blocks out of Markdown but still writes independently mapped edits', () => {
    const source = `开头\n\n${table}\n\n结尾`
    const { template, sync } = setup(source, 'baijiahao')
    changeText(template, 'p:nth-of-type(2)', '已修改的降级单元格')
    expect(sync().markdown).toBe(source)
    expect(sync().issue).toContain('已简化')
    changeText(template, 'p:nth-of-type(3)', '结尾更新')
    const result = sync()
    expect(result.markdown).toBe(source.replace('结尾', '结尾更新'))
    expect(result.issue).toContain('已简化')
  })

  it('refuses ambiguous loss of source boundaries involving a degraded block', () => {
    const { template, sync } = setup(`正文\n\n${table}`, 'toutiao')
    const wrapper = template.content.firstElementChild
    if (!wrapper) throw new Error('Missing wrapper')
    wrapper.innerHTML = '<p>无法判定的修改</p>'
    const result = sync()
    expect(result.markdown).toBeNull()
    expect(result.issue).toContain('已简化')
  })

  it('does not duplicate degraded content moved into an adjacent list by a spanning browser command', () => {
    const source = `开头\n\n${table}`
    const { template, sync } = setup(source, 'toutiao')
    const [ordinary, degraded] = template.content.querySelectorAll('p')
    ordinary.innerHTML = `<ul><li>开头</li><li>${degraded.textContent ?? ''}</li></ul>`
    degraded.remove()
    const result = sync()
    expect(result.markdown).toBeNull()
    expect(result.issue).toContain('已简化')
  })

  it('refuses a cross-block join that would erase an unseen reference definition', () => {
    const { template, sync } = setup('甲\n\n[hidden]: https://example.test/\n\n乙')
    const wrapper = template.content.firstElementChild
    if (!wrapper) throw new Error('Missing wrapper')
    wrapper.innerHTML = '<p>甲乙</p>'
    expect(sync().markdown).toBeNull()
  })

  it('handles Enter splitting a paragraph, then native Delete joining adjacent paragraphs', () => {
    const { template, sync } = setup('甲\n\n乙')
    const paragraphs = template.content.querySelectorAll('p')
    const [one, two] = paragraphs
    one.insertAdjacentHTML('afterend', '<p>新段落</p>')
    expect(sync().markdown).toBe('甲\n\n新段落\n\n乙')
    const scratch = one.nextSibling
    const end = scratch?.nextSibling
    const start = end?.nextSibling
    scratch?.parentNode?.removeChild(scratch)
    end?.parentNode?.removeChild(end)
    start?.parentNode?.removeChild(start)
    one.textContent = '甲乙'
    two.remove()
    expect(sync().markdown).toBe('甲乙')
  })

  it('preserves platform-only style without injecting Markdown, including style undo and redo', () => {
    const { template, sync } = setup('原一段')
    const initial = template.innerHTML
    const paragraph = template.content.querySelector('p')
    if (!paragraph) throw new Error('Missing paragraph')
    paragraph.innerHTML = '<u>原</u><span style="background-color: #ff0; color: blue; letter-spacing: 2px;">一段</span>'
    const styled = template.innerHTML
    expect(sync(styled)).toEqual({ markdown: '原一段', issue: null, platformStyle: true })
    expect(sync(initial).platformStyle).toBe(false)
    expect(sync(styled).platformStyle).toBe(true)
    paragraph.innerHTML = '<u>新</u><b>文字</b>'
    expect(sync()).toEqual({ markdown: '新**文字**', issue: null, platformStyle: true })
  })

  it('serializes supported inline formats, links, soft text and code', () => {
    const { template, sync } = setup('原一段')
    const paragraph = template.content.querySelector('p')
    if (!paragraph) throw new Error('Missing paragraph')
    paragraph.innerHTML = '<span style="font-weight: 700">粗体</span>，<i>斜体</i>、<s>删改</s>。<code style="font-family:monospace">a`b</code> <a href="https://example.test/a(b)">链接</a>'
    expect(sync()).toEqual({ markdown: '**粗体**，*斜体*、~~删改~~。``a`b`` [链接](<https://example.test/a(b)>)', issue: null, platformStyle: false })
  })

  it.each([
    ['**', 'strong', 'b'],
    ['*', 'em', 'i'],
    ['~~', 'del', 's'],
  ])('joins adjacent equivalent %s without exposing Markdown delimiters', (mark, existing, added) => {
    const { template, sync } = setup(`${mark}已格式化${mark}相邻余下`)
    const paragraph = template.content.querySelector('p')
    if (!paragraph) throw new Error('Missing paragraph')
    paragraph.innerHTML = `<${existing}>已格式化</${existing}><${added}>相邻</${added}>余下`
    expect(sync()).toEqual({ markdown: `${mark}已格式化相邻${mark}余下`, issue: null, platformStyle: false })
  })

  it('preserves source-authored underline and highlight in an edited block', () => {
    const { template, sync } = setup('++原下划线++ 与 ==原高亮==。')
    changeText(template, 'mark', '新高亮')
    expect(sync()).toEqual({ markdown: '++原下划线++ 与 ==新高亮==。', issue: null, platformStyle: false })
  })

  it('round-trips headings, ordered and nested lists, quote, rule, and code metadata within a changed range', () => {
    const { template, sync } = setup('原一段\n\n```ts title=code\nconst x = 1\n```')
    template.content.querySelector('p')?.insertAdjacentHTML('afterend', '<h2>小标题</h2><ol start="3"><li>三<ul><li>子项</li></ul></li><li>四</li></ol><blockquote><p>引用</p><p>再引用</p></blockquote><hr>')
    changeText(template, 'pre code', 'const x = `2`')
    expect(sync().markdown).toBe('原一段\n\n## 小标题\n\n3. 三\n   - 子项\n4. 四\n\n> 引用\n>\n> 再引用\n\n***\n\n```ts title=code\nconst x = `2`\n```')
  })

  it('keeps separately rendered blocks separate when replacing a tight heading with a paragraph', () => {
    const { template, sync } = setup('## 标题\n保留的正文。')
    const heading = template.content.querySelector('h2')
    if (!heading) throw new Error('Missing heading')
    heading.outerHTML = '<p>第一段</p>'
    expect(sync().markdown).toBe('第一段\n\n保留的正文。')
  })

  it('does not report a platform-only style when formatBlock copies a paragraph default to the heading', () => {
    const { template, sync } = setup('普通段。')
    const paragraph = template.content.querySelector('p')
    if (!paragraph) throw new Error('Missing paragraph')
    // Chrome 的 formatBlock 会把原段落的默认样式抄到新标题上；这个默认值必须取自当前主题。
    const paragraphStyle = paragraph.getAttribute('style') ?? ''
    paragraph.outerHTML = `<h2 style="${paragraphStyle}">正文标题</h2>`
    expect(sync()).toEqual({ markdown: '## 正文标题', issue: null, platformStyle: false })
  })

  it('does not write a first body H1 that retypesetting would hide as the extracted title', () => {
    const { template, sync } = setup('原正文。')
    const paragraph = template.content.querySelector('p')
    if (!paragraph) throw new Error('Missing paragraph')
    paragraph.outerHTML = '<h1>正文标题</h1>'
    const result = sync()
    expect(result.markdown).toBeNull()
    expect(result.issue).toContain('文章标题')
  })

  it('allows a first body H1 if the original extracted title precedes the body', () => {
    const { template, sync } = setup('# 文章标题\n\n原正文。')
    const paragraph = template.content.querySelector('p')
    if (!paragraph) throw new Error('Missing paragraph')
    paragraph.outerHTML = '<h1>正文标题</h1>'
    expect(sync()).toMatchObject({ markdown: '# 文章标题\n\n# 正文标题', issue: null })
  })

  it('updates a normal table without losing alignment or interpreting a literal pipe as another column', () => {
    const { template, sync } = setup(table)
    changeText(template, 'td', 'A | B')
    expect(sync().markdown).toBe(table.replace('苹果', 'A \\| B'))
  })

  it('keeps the original local path when a surrounding paragraph changes', () => {
    const source = '原文本 ![说明](<./images/示例 图.png> "图片标题")'
    const { template, sync } = setup(source, 'wechat', { 'images/示例 图.png': dataUrl })
    const first = template.content.querySelector('p')?.firstChild
    if (!first) throw new Error('Missing content')
    first.textContent = '新文本 '
    expect(sync().markdown).toBe(source.replace('原文本', '新文本'))
  })

  it('serializes new bound data/blob images by Markdown path and allows safe remote URLs', () => {
    const { template, sync } = setup('前文', 'wechat', { 'local.png': dataUrl, 'other.png': blobUrl })
    template.content.querySelector('p')?.insertAdjacentHTML('beforeend', `<img src="${dataUrl}" alt="本地一" style="max-width:100%;height:auto;vertical-align:middle;"><img src="${blobUrl}" alt="本地二"><img src="https://example.test/remote.png" alt="外链">`)
    expect(sync()).toEqual({ markdown: '前文![本地一](local.png)![本地二](other.png)![外链](https://example.test/remote.png)', issue: null, platformStyle: false })
  })

  it('refuses unbound local URLs and unsafe link protocols rather than corrupting prior edits', () => {
    const { template, sync } = setup('前文')
    const paragraph = template.content.querySelector('p')
    if (!paragraph) throw new Error('Missing paragraph')
    paragraph.innerHTML = `<img src="${dataUrl}" alt="未配对">`
    expect(sync().markdown).toBeNull()
    expect(sync().issue).toContain('配对')
    paragraph.innerHTML = '<a href="javascript:alert(1)">不可信地址</a>'
    expect(sync().markdown).toBeNull()
    expect(sync().issue).toContain('链接地址不可用')
  })

  it('removes an original image range without altering its source neighbors', () => {
    const { template, sync } = setup('甲\n\n![图](./keep.png)\n\n乙', 'wechat', { 'keep.png': dataUrl })
    template.content.querySelector('img')?.remove()
    expect(sync().markdown).toBe('甲\n\n\n\n乙')
  })

  it('strips only internal metadata from the exact copied markup', () => {
    const { baselineHtml } = setup('正文\n\n![图](original.png)', 'wechat', { 'original.png': dataUrl })
    expect(stripArticleSourceMarkers(baselineHtml)).not.toMatch(/uma-source|original\.png/)
    expect(stripArticleSourceMarkers(baselineHtml)).toContain(`<img src="${dataUrl}" alt="图" style=`)
    expect(stripArticleSourceMarkers('<!--other--><p data-example="x">a</p>')).toBe('<!--other--><p data-example="x">a</p>')
  })
})
