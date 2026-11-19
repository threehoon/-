import { describe, expect, it } from 'vitest'
import { createAssetRegistry } from '@/core/images/assets'
import { parseDocument } from '@/core/markdown/parse'
import { ARTICLE_SOURCE_ATTR } from '@/core/render/source-markers'
import type { WechatTemplateId } from '@/core/types'
import { createWechatPlatform } from './adapter'
import { DEFAULT_WECHAT_TEMPLATE_ID, WECHAT_TEMPLATES, WECHAT_THEME } from './theme'

const SAMPLE = '# 标题\n\n正文 **强调**、*斜体*、~~删除~~ 和 `code`。\n\n# 正文一级\n\n## 二级\n\n### 三级\n\n#### 四级\n\n##### 五级\n\n###### 六级\n\n> 引用\n\n---\n\n- 项目\n\n1. 顺序\n\n```ts\nconst value = "<safe>"\n```\n\n| 名称 | 数量 |\n| --- | ---: |\n| 苹果 | 3 |\n\n[链接](https://example.com)\n\n![图片](https://example.com/a.png)'

const UNSAFE_SAMPLE = `${SAMPLE}\n\n<script>alert("unsafe")</script>\n\n<img src=x onerror=alert(1)>\n\n[危险链接](javascript:alert(1))\n\n![危险图片](javascript:alert(1))\n\n![本地图片](images/missing.png)`

function render(markdown: string, template?: WechatTemplateId) {
  const outcome = createWechatPlatform().render(parseDocument(markdown), {
    assets: createAssetRegistry({}),
    titleOverride: null,
    template,
  })
  if (!outcome.ok) {
    throw new Error(outcome.failure.reason)
  }
  return outcome.document
}

function withoutStyles(html: string): string {
  const container = document.createElement('div')
  container.innerHTML = html
  for (const element of container.querySelectorAll('[style]')) {
    element.removeAttribute('style')
  }
  return container.innerHTML
}

describe('公众号模板目录', () => {
  it('导出 UI 可直接使用的六套名称、说明与 RenderTheme', () => {
    expect(DEFAULT_WECHAT_TEMPLATE_ID).toBe('classic')
    expect(WECHAT_TEMPLATES.map(({ id }) => id)).toEqual([
      'classic', 'airy', 'brief', 'editorial', 'warm', 'technical',
    ])
    expect(WECHAT_TEMPLATES.map(({ name }) => name)).toEqual([
      '观点蓝调', '清爽留白', '内容简报', '杂志长文', '暖纸手记', '技术专栏',
    ])
    expect(WECHAT_TEMPLATES[0].theme).toBe(WECHAT_THEME)
    expect(new Set(WECHAT_TEMPLATES.map(({ theme }) => theme.id)).size).toBe(6)
    for (const { description, theme } of WECHAT_TEMPLATES) {
      expect(description.length).toBeGreaterThan(0)
      expect(theme.wrapperTag).toBe('section')
    }
  })

  it('六版在标题、段落、引用、分隔线、代码与表格上都有独立版式', () => {
    const styles = WECHAT_TEMPLATES.map(({ theme }) => ({
      heading: theme.heading(2, false),
      paragraph: theme.paragraph,
      blockquote: theme.blockquote,
      thematicBreak: theme.thematicBreak,
      codeBlock: theme.codeBlock,
      table: theme.table,
      tableHeadCell: theme.tableHeadCell,
      tableCell: theme.tableCell,
    }))
    for (const key of Object.keys(styles[0]) as (keyof typeof styles[number])[]) {
      expect(new Set(styles.map((style) => style[key])).size, key).toBe(6)
    }
    expect(WECHAT_TEMPLATES.find(({ id }) => id === 'airy')?.theme.heading(2, false)).toContain('border-bottom:1px solid #e6e8ef')
    expect(WECHAT_TEMPLATES.find(({ id }) => id === 'brief')?.theme.heading(2, false)).toContain('background-color:#eef3fd')
    expect(WECHAT_TEMPLATES.find(({ id }) => id === 'editorial')?.theme.paragraph).toContain('text-indent:2em')
    expect(WECHAT_TEMPLATES.find(({ id }) => id === 'warm')?.theme.container).toContain('background-color:#fdfaf4')
    expect(WECHAT_TEMPLATES.find(({ id }) => id === 'technical')?.theme.codeBlock).toContain('border-top:3px solid')
  })
})

describe('公众号模板兼容保护', () => {
  it('省略参数与显式 classic 产出同一份成稿', () => {
    expect(render(SAMPLE, undefined)).toEqual(render(SAMPLE, 'classic'))
  })

  it('观点蓝调在二级标题上内联墨蓝章节签，并保留实色托底', () => {
    const container = document.createElement('div')
    container.innerHTML = render('## 自查章节', 'classic').html

    const heading = container.querySelector('h2')
    expect(heading?.textContent).toBe('自查章节')
    const style = heading?.getAttribute('style') ?? ''
    expect(style).toContain('border-bottom:2px solid #77b7c5')
    expect(style).toContain('background-color:#17355f')
    expect(style).toContain('linear-gradient(96deg,#17355f,#20596c)')
    expect(style).not.toContain('border-radius:999px')
  })

  it('带链接、高亮和删除线的章节标题用浅底，保留链接及行内语义', () => {
    const container = document.createElement('div')
    container.innerHTML = render('## [街区地图](https://example.com) ==慢慢走== ~~旧路线~~').html
    const heading = container.querySelector('h2')
    expect(heading?.textContent).toBe('街区地图 慢慢走 旧路线')
    expect(heading?.getAttribute('style')).toContain('background-color:#edf3fa')
    expect(heading?.getAttribute('style')).toContain('color:#17355f')
    expect(heading?.getAttribute('style')).not.toContain('linear-gradient')
    expect(heading?.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
    expect(heading?.querySelector('mark')?.textContent).toBe('慢慢走')
    expect(heading?.querySelector('del')?.textContent).toBe('旧路线')
  })

  it('只在正文顶层的纯文字独立加粗和三级标题上用浅蓝标签', () => {
    const container = document.createElement('div')
    const markdown = '### 三级标题\n\n**独立加粗**\n\n句中 **普通加粗**。\n\n**含有 *斜体* 的加粗**\n\n> **引文加粗**\n\n- **列表加粗**\n\n##### 超深标题'
    container.innerHTML = render(markdown, 'classic').html

    const labels = [...container.querySelectorAll('h3, strong')].filter((el) => el.getAttribute('style')?.includes('background-color:#edf3fa'))
    expect(labels.map((el) => [el.tagName, el.textContent])).toEqual([['H3', '三级标题'], ['STRONG', '独立加粗']])
    expect(labels[1]?.parentElement?.tagName).toBe('P')
  })

  it('空心列表保留无序列表语义、嵌套与有序编号', () => {
    const container = document.createElement('div')
    const output = render('- 清单一\n  - 子项\n- 清单二\n\n3. 接着来\n4. 仍有顺序', 'classic')
    container.innerHTML = output.html

    const ul = container.querySelector('ul')
    expect(ul?.getAttribute('style')).toContain('list-style-type:circle')
    expect(ul?.querySelector(':scope > li > ul > li')?.textContent).toBe('子项')
    expect(container.querySelector('ol')?.getAttribute('start')).toBe('3')
    expect(container.querySelector('ol')?.getAttribute('style')).not.toContain('list-style-type:circle')
    expect(output.plainText).toContain('3. 接着来\n4. 仍有顺序')
  })

  it.each(WECHAT_TEMPLATES.filter(({ id }) => id !== 'classic'))('$name 不继承观点蓝调的组件样式', ({ id }) => {
    const { html } = render('## 章节\n\n### 三级标题\n\n**独立加粗**\n\n- 条目', id)
    expect(html).not.toMatch(/#17355f|#edf3fa|list-style-type:circle/)
  })

  it('保留淡蓝引用卡片与两种原有行内重点底色', () => {
    const container = document.createElement('div')
    container.innerHTML = render('正文 **重点句** 与 ==高亮==。\n\n> 引用一句。', 'classic').html

    const quote = container.querySelector('blockquote')?.getAttribute('style') ?? ''
    expect(quote).toContain('background-color:#f5f7ff')
    expect(quote).toContain('border-left:4px solid #0a5cf6')

    // 重点句靠底色强调，且斜体容器里的重点句仍是正体。
    const strong = container.querySelector('strong')?.getAttribute('style') ?? ''
    expect(strong).toContain('background-color:#e8efff')
    expect(strong).toContain('font-style:normal')

    const mark = container.querySelector('mark')?.getAttribute('style') ?? ''
    expect(mark).toContain('background-color:#d6e2ff')
    expect(render('==高亮==', 'warm').html).toContain('background-color:#f2dcb8')
    expect(render('==高亮==', 'classic').html).not.toContain('#fff2ab')
  })

  it.each(WECHAT_TEMPLATES)('$name 只换内联样式，不改标签、属性、文字和兼容提示', ({ id }) => {
    const classic = render(UNSAFE_SAMPLE, 'classic')
    const selected = render(UNSAFE_SAMPLE, id)
    expect(withoutStyles(selected.html)).toBe(withoutStyles(classic.html))
    expect({ ...selected, html: '' }).toEqual({ ...classic, html: '' })
    expect(selected.warnings.map(({ kind }) => kind)).toEqual(expect.arrayContaining([
      'heading', 'link', 'image', 'raw-html',
    ]))

    const container = document.createElement('div')
    container.innerHTML = selected.html
    expect(container.querySelector('script, style, iframe, h5, h6, [onerror], [onclick]')).toBeNull()
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('pre code')).not.toBeNull()
    expect(container.querySelector('blockquote')).not.toBeNull()
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
    for (const element of container.querySelectorAll('[href], [src]')) {
      expect(element.getAttribute('href') ?? element.getAttribute('src')).not.toMatch(/^javascript:/i)
    }
    for (const element of container.querySelectorAll('[style]')) {
      expect(element.getAttribute('style')).not.toMatch(/url\s*\(|expression\s*\(|@import/i)
    }
    expect(container.textContent).toContain('<script>alert("unsafe")</script>')
    expect(container.querySelector(`[${ARTICLE_SOURCE_ATTR}]`)).not.toBeNull()
  })

  it.each(WECHAT_TEMPLATES.filter(({ id }) => id !== 'classic'))('$name 的所有标题字体通过内联样式盖过预览 CSS', ({ id, theme }) => {
    const stylesheet = document.createElement('style')
    stylesheet.textContent = '.article h1,.article h2,.article h3,.article h4 { font-family: fantasy; }'
    const container = document.createElement('div')
    container.className = 'article'
    container.innerHTML = render(SAMPLE, id).html
    document.head.append(stylesheet)
    document.body.append(container)
    try {
      for (const heading of container.querySelectorAll<HTMLElement>('h1,h2,h3,h4')) {
        expect(heading.style.fontFamily).not.toBe('')
        expect(getComputedStyle(heading).fontFamily).toBe(heading.style.fontFamily)
      }
      for (const level of [1, 2, 3, 4, 5, 6]) {
        expect(theme.heading(level, false)).toContain('font-family:')
        expect(theme.heading(level, true)).toContain('font-family:')
      }
    } finally {
      container.remove()
      stylesheet.remove()
    }
  })

  it.each(['unknown', '__proto__', 'constructor', 'classic; background:url(javascript:alert(1))'])('运行时非法模板 %s 安全回退到经典版', (invalid) => {
    expect(render(SAMPLE, invalid as WechatTemplateId)).toEqual(render(SAMPLE))
  })

  it('切换主题不修改解析树，且默认主题不会残留上次选择', () => {
    const parsed = parseDocument(UNSAFE_SAMPLE)
    const original = JSON.stringify(parsed)
    const platform = createWechatPlatform()
    const context = { assets: createAssetRegistry({}), titleOverride: '手动标题' }
    const classic = platform.render(parsed, context)
    for (const { id } of WECHAT_TEMPLATES) {
      const outcome = platform.render(parsed, { ...context, template: id })
      expect(outcome.ok).toBe(true)
      if (outcome.ok) expect(outcome.document.title).toBe('手动标题')
      expect(JSON.stringify(parsed)).toBe(original)
    }
    expect(platform.render(parsed, context)).toEqual(classic)
  })
})
