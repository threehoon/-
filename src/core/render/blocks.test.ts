import { describe, expect, it } from 'vitest'
import type { PhrasingContent, Root } from 'mdast'
import type { AssetRegistry, CompatWarning, PlatformCapabilities } from '../types'
import { createAssetRegistry } from '../images/assets'
import { parseDocument } from '../markdown/parse'
import { renderBlocks } from './blocks'
import type { RenderBlocksOutput } from './blocks'
import { GENERIC_THEME } from './theme'

const KEEP_ALL: PlatformCapabilities = {
  tables: 'keep',
  codeBlocks: 'keep',
  inlineCode: 'keep',
  images: 'keep',
  links: 'keep',
  blockquotes: 'keep',
  maxHeadingLevel: 6,
}

const DEGRADE_ALL: PlatformCapabilities = {
  tables: 'degrade',
  codeBlocks: 'degrade',
  inlineCode: 'degrade',
  images: 'degrade',
  links: 'degrade',
  blockquotes: 'degrade',
  maxHeadingLevel: 2,
}

function render(
  markdown: string,
  capabilities: PlatformCapabilities = KEEP_ALL,
  assets: AssetRegistry = createAssetRegistry([]),
): RenderBlocksOutput {
  const parsed = parseDocument(markdown)
  return renderBlocks({ root: parsed.root, theme: GENERIC_THEME, capabilities, assets })
}

function paragraphRoot(children: PhrasingContent[]): Root {
  return { type: 'root', children: [{ type: 'paragraph', children }] }
}

function renderRoot(
  root: Root,
  capabilities: PlatformCapabilities = KEEP_ALL,
  assets: AssetRegistry = createAssetRegistry([]),
): RenderBlocksOutput {
  return renderBlocks({ root, theme: GENERIC_THEME, capabilities, assets })
}

function warningsOfKind(warnings: readonly CompatWarning[], kind: CompatWarning['kind']): readonly CompatWarning[] {
  return warnings.filter((warning) => warning.kind === kind)
}

describe('文档工具栏的行内格式', () => {
  it('生成固定标签，并从纯文本正文去除格式定界符', () => {
    const result = render('请看 ++下划线++ 和 ==高亮==。')
    expect(result.html).toMatch(/<u\b[^>]*>下划线<\/u> 和 <mark\b[^>]*>高亮<\/mark>/)
    expect(result.plainText).toBe('请看 下划线 和 高亮。')
  })

  it('保留嵌套格式、链接与行内代码的原有语义', () => {
    const result = render('- ++**粗体**及==高亮==++\n- **==[链接](https://example.test/)==** 和 ==`++源码++`==')
    expect(result.html).toMatch(/<u\b[^>]*><strong\b[^>]*>粗体<\/strong>及<mark\b[^>]*>高亮<\/mark><\/u>/)
    expect(result.html).toMatch(/<strong\b[^>]*><mark\b[^>]*><a\b[^>]*>链接<\/a><\/mark><\/strong>/)
    expect(result.html).toMatch(/<mark\b[^>]*><code\b[^>]*>\+\+源码\+\+<\/code><\/mark>/)
  })

  it('格式应用到标题和表格，一级标题提取不含标记', () => {
    const source = '# ++标题++\n\n## ==小标题==\n\n| ++名称++ |\n| --- |\n| ==内容== |'
    expect(parseDocument(source).title.value).toBe('标题')
    const result = render(source)
    expect(result.html).toMatch(/<h2\b[^>]*><mark\b[^>]*>小标题<\/mark><\/h2>/)
    expect(result.html).toMatch(/<th><u\b[^>]*>名称<\/u><\/th>/)
    expect(result.html).toMatch(/<td><mark\b[^>]*>内容<\/mark><\/td>/)
  })

  it('不把代码块和原始 HTML 当作编辑格式，也不执行 HTML', () => {
    const result = render('```txt\n++代码++ ==代码==\n```\n\n正文 ==<img src=x onerror=alert(1)>内容==。\n\n<script>++原文++</script>')
    expect(result.html).toContain('++代码++ ==代码==')
    expect(result.html).toMatch(/<mark\b[^>]*>&lt;img .*?&gt;内容<\/mark>/)
    expect(result.html).toContain('&lt;script&gt;++原文++&lt;/script&gt;')
    expect(result.html).not.toMatch(/<(img|script)\b/)
    expect(warningsOfKind(result.warnings, 'raw-html')).toHaveLength(1)
  })

  it('保留未配对、跨行、空白填充、长连串和转义后的标记文字', () => {
    const result = render(String.raw`普通 \+\+转义++、&#61;&#61;实体==；

+++连续+++ / ++ 空白 ++ / ==未配对
跨行==

再看 ++有效++。`)
    expect(result.html.match(/<u\b/g)).toHaveLength(1)
    expect(result.html).not.toContain('<mark')
    expect(result.plainText).toContain('++转义++、==实体==')
    expect(result.plainText).toContain('+++连续+++ / ++ 空白 ++ / ==未配对\n跨行==')
    expect(result.plainText).toContain('再看 有效。')
  })
})

const TABLE = '| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |'

describe('表格', () => {
  it('keep：输出真正的表格，不产生警告', () => {
    const result = render(TABLE)
    expect(result.html).toContain('<table>')
    expect(result.html).toContain('<th>名称</th>')
    expect(result.html).toContain('<td>苹果</td>')
    expect(result.warnings).toHaveLength(0)
  })

  it('degrade：按原行序转成「列名：值」段落并告警', () => {
    const markdown = '| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n| 香蕉 | 5 |'
    const result = render(markdown, { ...KEEP_ALL, tables: 'degrade' })

    expect(result.html).not.toContain('<table')
    expect(result.html).toContain('名称：苹果<br />数量：3')
    expect(result.html).toContain('名称：香蕉<br />数量：5')
    expect(result.html.indexOf('苹果')).toBeLessThan(result.html.indexOf('香蕉'))

    const warning = warningsOfKind(result.warnings, 'table')[0]
    expect(warning).toBeDefined()
    expect(warning?.message).toContain('2 组')
    expect(warning?.action).toContain('手动插入表格')
    expect(warning?.excerpt).toContain('名称：苹果')
    expect(warning?.severity).toBe('attention')

    // 纯文本兜底同样保留单元格内容与行序
    expect(result.plainText).toContain('名称：苹果\n数量：3')
  })

  it('degrade：多行只插入一次表头图片，并保留链接降级提示', () => {
    const result = render('| ![图][cover] | [资料](https://example.test/ref) |\n| --- | --- |\n| A | 1 |\n| B | 2 |\n\n[cover]: https://example.test/first.png\n[cover]: https://example.test/second.png', {
      ...KEEP_ALL, tables: 'degrade', links: 'degrade',
    })
    expect(result.html.match(/<img/g)).toHaveLength(1)
    expect(result.html).toContain('https://example.test/first.png')
    expect(result.html).not.toContain('second.png')
    expect(warningsOfKind(result.warnings, 'link')).toHaveLength(1)
    expect(result.plainText).toContain('图：B\n资料：2')
  })

  it('degrade：仅表头的缺图保留补插位置，空列给出可读列名', () => {
    const result = render('| ![图](images/cover.png) |  |\n| --- | --- |', { ...KEEP_ALL, tables: 'degrade' })
    expect(result.html).toContain('图片补插位')
    expect(result.html).toContain('第2列')
    expect(warningsOfKind(result.warnings, 'image')).toHaveLength(1)
  })

  it('degrade：只有表头时保留列名并告警', () => {
    const result = render('| 名称 | 数量 |\n| --- | --- |', { ...KEEP_ALL, tables: 'degrade' })
    expect(result.html).toContain('名称 ｜ 数量')
    expect(warningsOfKind(result.warnings, 'table')).toHaveLength(1)
  })
})

describe('代码', () => {
  const CODE = '```js\nconst a = 1 < 2 && "x"\n```'

  it('keep：保留 <pre><code>，尖括号与引号被转义', () => {
    const result = render(CODE)
    expect(result.html).toContain('<pre><code>')
    expect(result.html).toContain('&lt;')
    expect(result.html).toContain('&amp;&amp;')
    expect(result.html).not.toContain('<script')
    expect(result.warnings).toHaveLength(0)
    expect(result.plainText).toBe('const a = 1 < 2 && "x"')
  })

  it('degrade：转为保留换行的等宽文本块并告警', () => {
    const markdown = '```\n第一行\n第二行\n```'
    const result = render(markdown, { ...KEEP_ALL, codeBlocks: 'degrade' })

    expect(result.html).toContain('<pre>')
    expect(result.html).not.toContain('<code>')
    expect(result.html).toContain('第一行\n第二行')

    const warning = warningsOfKind(result.warnings, 'code')[0]
    expect(warning?.message).toContain('等宽文本块')
    expect(warning?.action).toContain('代码内容与换行')
    expect(warning?.excerpt).toContain('第一行')
  })

  it('代码块里的 HTML 不会执行', () => {
    const result = render('```\n<script>alert(1)</script>\n```')
    expect(result.html).not.toContain('<script')
    expect(result.html).toContain('&lt;script&gt;')
  })

  it('行内代码降级合并成一条警告', () => {
    const markdown = '用 `npm run build` 与 `npm test` 构建。'
    const keep = render(markdown)
    expect(keep.html).toContain('<code>npm run build</code>')

    const degrade = render(markdown, { ...KEEP_ALL, inlineCode: 'degrade' })
    expect(degrade.html).toContain('npm run build')
    expect(degrade.plainText).toContain('npm test')

    const warnings = warningsOfKind(degrade.warnings, 'code')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toContain('2 处行内代码')
    expect(warnings[0]?.excerpt).toBe('npm run build')
  })
})

describe('引用块', () => {
  it('keep：保留 blockquote', () => {
    const result = render('> 引用一句话')
    expect(result.html).toContain('<blockquote>')
    expect(result.warnings).toHaveLength(0)
  })

  it('degrade：退化为普通段落并告警', () => {
    const result = render('> 引用一句话', { ...KEEP_ALL, blockquotes: 'degrade' })
    expect(result.html).not.toContain('<blockquote')
    expect(result.html).toContain('引用一句话')
    expect(result.plainText).toBe('引用一句话')

    const warning = warningsOfKind(result.warnings, 'blockquote')[0]
    expect(warning?.message).toContain('引用块')
    expect(warning?.action).toContain('手动')
    expect(warning?.excerpt).toBe('引用一句话')
  })
})

describe('标题层级', () => {
  it('超出层级时转为加粗小标题并告警', () => {
    const result = render('## 二级\n\n#### 四级', { ...KEEP_ALL, maxHeadingLevel: 3 })
    expect(result.html).toContain('<h2>二级</h2>')
    expect(result.html).toContain('<p><strong>四级</strong></p>')
    expect(result.html).not.toContain('<h4')

    const warning = warningsOfKind(result.warnings, 'heading')[0]
    expect(warning?.message).toContain('H4')
    expect(warning?.message).toContain('H3')
    expect(warning?.excerpt).toBe('四级')
    expect(warning?.severity).toBe('info')
  })

  it('层级在上限内不告警', () => {
    const result = render('## 二级\n\n### 三级', { ...KEEP_ALL, maxHeadingLevel: 3 })
    expect(result.html).toContain('<h3>三级</h3>')
    expect(result.warnings).toHaveLength(0)
  })
})

describe('链接', () => {
  it('keep：输出可点击链接', () => {
    const result = render('[示例](https://example.com/a)')
    expect(result.html).toContain('<a href="https://example.com/a">示例</a>')
    expect(result.warnings).toHaveLength(0)
  })

  it('degrade：只留文字，警告里给出原地址', () => {
    const result = render('[示例](https://example.com/a)', { ...KEEP_ALL, links: 'degrade' })
    expect(result.html).not.toContain('<a ')
    expect(result.html).toContain('示例')

    const warning = warningsOfKind(result.warnings, 'link')[0]
    expect(warning?.message).toContain('只保留链接文字')
    expect(warning?.action).toContain('https://example.com/a')
    expect(warning?.excerpt).toContain('https://example.com/a')
  })

  it.each([
    ['信源：<https://example.com/a>', 'https://example.com/a'],
    ['信源： www.example.com/a', 'www.example.com/a'],
  ])('degrade：网址本来就是链接文字时，明确提示明文网址仍在正文 (%s)', (markdown, url) => {
    const result = render(markdown, { ...KEEP_ALL, links: 'degrade' })
    expect(result.html).not.toContain('<a ')
    expect(result.plainText).toContain(url)
    expect(warningsOfKind(result.warnings, 'link')[0]?.message).toContain('网址仍在正文')
  })

  it('javascript: 链接被拦截，只保留文字且地址不进正文', () => {
    const result = render('[点我](javascript:alert(1))')
    expect(result.html).not.toContain('<a ')
    expect(result.html).not.toContain('javascript:')
    expect(result.html).toContain('点我')

    const warning = warningsOfKind(result.warnings, 'link')[0]
    expect(warning?.message).toContain('拦截')
    expect(warning?.message).toContain('javascript:')
    expect(warning?.excerpt).toContain('javascript:alert(1)')
  })

  it('相对链接被拦截并提示改成 https', () => {
    const result = render('[关于](/about)')
    expect(result.html).not.toContain('href')
    const warning = warningsOfKind(result.warnings, 'link')[0]
    expect(warning?.message).toContain('相对路径')
    expect(warning?.action).toContain('https')
  })

  it('未定义的引用式链接保持原文文字，不会生成链接', () => {
    // remark 对「找不到定义的 [文字][id]」按 CommonMark 输出字面文本，内容不会丢
    const result = render('[文字][unknown]')
    expect(result.html).not.toContain('<a ')
    expect(result.html).toContain('[文字][unknown]')
  })

  it('外部构造的 linkReference 没有定义时保留文字并告警', () => {
    const root = paragraphRoot([
      {
        type: 'linkReference',
        identifier: 'nope',
        label: 'nope',
        referenceType: 'full',
        children: [{ type: 'text', value: '文字' }],
      },
    ])
    const result = renderRoot(root, KEEP_ALL)
    expect(result.html).toContain('文字')
    expect(result.html).not.toContain('<a ')
    expect(warningsOfKind(result.warnings, 'link')[0]?.message).toContain('引用式链接')
  })
})

describe('图片', () => {
  it('https 外链在 keep 平台输出 <img>', () => {
    const result = render('![示意图](https://cdn.example.com/a.png)')
    expect(result.html).toContain('<img src="https://cdn.example.com/a.png" alt="示意图" />')
    expect(result.warnings).toHaveLength(0)
    expect(result.plainText).toContain('［图片：示意图］')
  })

  it('本地图片未配对：插入补插标记并给出 blocker 警告', () => {
    const result = render('![团队合影](images/team.png)')
    expect(result.html).toContain('［图片补插位：团队合影（images/team.png）］')
    expect(result.html).not.toContain('<img')

    const warning = warningsOfKind(result.warnings, 'image')[0]
    expect(warning?.severity).toBe('blocker')
    expect(warning?.message).toContain('配对')
    expect(warning?.action).toContain('选择本地文件')
    expect(warning?.excerpt).toContain('images/team.png')
    // 纯文本兜底也要看得见补插位
    expect(result.plainText).toContain('［图片补插位')
  })

  it('已配对本地图片输出绑定后的地址', () => {
    const assets = createAssetRegistry({ 'images/team.png': 'blob:https://app.local/1' })
    const result = render('![团队](images/team.png)', KEEP_ALL, assets)
    expect(result.html).toContain('<img src="blob:https://app.local/1" alt="团队" />')
    expect(result.warnings).toHaveLength(0)
  })

  it('平台不保留图片时即使已配对照样给补插标记', () => {
    const assets = createAssetRegistry({ 'images/team.png': 'blob:https://app.local/1' })
    const result = render('![团队](images/team.png)', { ...KEEP_ALL, images: 'degrade' }, assets)
    expect(result.html).not.toContain('<img')
    expect(result.html).toContain('［图片补插位')
    expect(warningsOfKind(result.warnings, 'image')[0]?.severity).toBe('blocker')
  })

  it('data: 图片地址被拦截并说明原因', () => {
    const result = render('![内联](data:image/png;base64,AAAA)')
    expect(result.html).not.toContain('<img')
    const warning = warningsOfKind(result.warnings, 'image')[0]
    expect(warning?.message).toContain('data:')
    expect(warning?.action).toContain('https')
  })

  it('引用式图片按定义输出', () => {
    const result = render('![图][pic]\n\n[pic]: https://cdn.example.com/c.png')
    expect(result.html).toContain('src="https://cdn.example.com/c.png"')
  })

  it('未定义的引用式图片保持原文文字，不丢内容', () => {
    const result = render('![图][missing]')
    expect(result.html).not.toContain('<img')
    expect(result.html).toContain('![图][missing]')
  })

  it('外部构造的 imageReference 没有定义时给补插标记与警告', () => {
    const root = paragraphRoot([
      {
        type: 'imageReference',
        identifier: 'gone',
        label: 'gone',
        referenceType: 'full',
        alt: '示意图',
      },
    ])
    const result = renderRoot(root, KEEP_ALL)
    expect(result.html).toContain('［图片补插位：示意图］')
    expect(warningsOfKind(result.warnings, 'image')[0]?.message).toContain('引用式图片')
  })
})

describe('原始 HTML', () => {
  it('块级 HTML 以纯文本输出并告警', () => {
    const result = render('正文一段。\n\n<script>alert(1)</script>')
    expect(result.html).not.toContain('<script')
    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')

    const warning = warningsOfKind(result.warnings, 'raw-html')[0]
    expect(warning?.message).toContain('纯文本')
    expect(warning?.message).toContain('不会作为页面元素执行')
    expect(warning?.action).toContain('手动')
    expect(warning?.excerpt).toContain('<script>')
    expect(warning?.severity).toBe('attention')
  })

  it('行内 HTML 同样转义，绝不输出事件属性', () => {
    const result = render('文字 <span onclick="steal()">A</span> 文字')
    expect(result.html).not.toContain('<span')
    // 只作为可见文字出现：所有尖括号与引号都已转义，不可能成为属性
    expect(result.html).toContain('&lt;span onclick=&quot;steal()&quot;&gt;')
    expect(result.html).toContain('文字')
  })
})

describe('列表与其它块', () => {
  it('有序列表保留起始序号', () => {
    const result = render('3. 三\n4. 四')
    expect(result.html).toContain('<ol start="3">')
    expect(result.plainText).toBe('3. 三\n4. 四')
  })

  it('无序列表与任务列表', () => {
    const result = render('- 第一项\n- [x] 已完成\n- [ ] 未完成')
    expect(result.html).toContain('<ul>')
    expect(result.html).toContain('[x] 已完成')
    expect(result.html).toContain('[ ] 未完成')
  })

  it('列表项里的引用与嵌套列表都保留', () => {
    const result = render('- 外层\n\n  > 引用\n\n  - 内层')
    expect(result.html).toContain('外层')
    expect(result.html).toContain('<blockquote>')
    expect(result.html).toContain('内层')
  })

  it('分隔线输出 <hr />', () => {
    expect(render('上文\n\n---\n\n下文').html).toContain('<hr />')
  })

  it('加粗与斜体', () => {
    const result = render('**粗体**与*斜体*')
    expect(result.html).toContain('<strong>粗体</strong>')
    expect(result.html).toContain('<em>斜体</em>')
  })
})

describe('降级清单完整性', () => {
  const markdown = [
    '## 二级标题',
    '',
    '#### 四级标题',
    '',
    '正文带 `行内代码`、[外链](https://example.com/a) 与 [坏链](javascript:alert(1))。',
    '',
    '> 引用一段话',
    '',
    TABLE,
    '',
    '```ts',
    'const x = 1',
    '```',
    '',
    '![远程](https://cdn.example.com/a.png)',
    '',
    '![缺图](images/missing.png)',
    '',
    '<script>alert(1)</script>',
  ].join('\n')

  it('每一类降级都落到了 warnings 上', () => {
    const result = render(markdown, DEGRADE_ALL)
    const kinds = new Set(result.warnings.map((warning) => warning.kind))
    expect(kinds).toContain('table')
    expect(kinds).toContain('code')
    expect(kinds).toContain('image')
    expect(kinds).toContain('link')
    expect(kinds).toContain('raw-html')
    expect(kinds).toContain('heading')
    expect(kinds).toContain('blockquote')
  })

  it('每条警告都写清现象、动作与原文片段，且 id 唯一', () => {
    const result = render(markdown, DEGRADE_ALL)
    expect(result.warnings.length).toBeGreaterThan(5)

    for (const warning of result.warnings) {
      expect(warning.message.trim().length).toBeGreaterThan(0)
      expect(warning.action.trim().length).toBeGreaterThan(0)
      expect(warning.excerpt.trim().length).toBeGreaterThan(0)
      expect(['info', 'attention', 'blocker']).toContain(warning.severity)
    }

    const ids = result.warnings.map((warning) => warning.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('全保留时没有任何降级警告', () => {
    const result = render(markdown, KEEP_ALL)
    const realKinds = result.warnings
      .map((warning) => warning.kind)
      .filter((kind) => kind !== 'link' && kind !== 'raw-html' && kind !== 'image')
    expect(realKinds).toEqual([])
    // 坏链与原始 HTML 在 keep 平台也必须告警
    expect(warningsOfKind(result.warnings, 'link').length).toBeGreaterThan(0)
    expect(warningsOfKind(result.warnings, 'raw-html').length).toBeGreaterThan(0)
  })
})

describe('HTML 结构完整性', () => {
  const BLOCK_TAGS = [
    'p',
    'blockquote',
    'ul',
    'ol',
    'li',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'h2',
    'h3',
    'strong',
    'em',
    'pre',
    'code',
    'div',
  ]

  function countTags(html: string, tag: string): { open: number; close: number } {
    const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length
    const close = (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length
    return { open, close }
  }

  const markdown = [
    '## 小标题',
    '',
    '正文 **加粗** 与 *斜体*。',
    '',
    '> 引用一段',
    '',
    '- 列表一',
    '- 列表二',
    '',
    '| 名称 | 数量 |',
    '| --- | --- |',
    '| 苹果 | 3 |',
    '',
    '```',
    'const x = 1',
    '```',
    '',
    '---',
    '',
    '![外链图](https://cdn.example.com/a.png)',
  ].join('\n')

  it('每个开标签都有对应的闭标签（keep 与 degrade 两种能力都成立）', () => {
    for (const capabilities of [KEEP_ALL, DEGRADE_ALL]) {
      const { html } = render(markdown, capabilities)
      for (const tag of BLOCK_TAGS) {
        const { open, close } = countTags(html, tag)
        expect({ tag, open, close }).toEqual({ tag, open, close: open })
      }
      // 分隔线必须是自闭合：逐个检查真实的 <hr 出现，而不是一条永远成立的否定断言
      const hrTags = [...html.matchAll(/<hr\b[^>]*>/g)].map((match) => match[0])
      expect(hrTags.length).toBeGreaterThan(0)
      for (const tag of hrTags) {
        expect(tag.endsWith(' />')).toBe(true)
      }
      // 图片只在 keep 平台出现，出现时同样必须自闭合
      const imgTags = [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0])
      if (capabilities.images === 'keep') {
        expect(imgTags.length).toBeGreaterThan(0)
      } else {
        expect(imgTags).toHaveLength(0)
      }
      for (const tag of imgTags) {
        expect(tag.endsWith(' />')).toBe(true)
      }
    }
  })
})

describe('纯文本兜底', () => {
  it('不含任何 HTML 标签，且保留正文顺序', () => {
    const result = render('第一段 **重点**。\n\n## 小标题\n\n- 列表项')
    expect(result.plainText).not.toContain('<p>')
    expect(result.plainText).not.toContain('<strong>')
    expect(result.plainText).toContain('第一段 重点。')
    expect(result.plainText).toContain('小标题')
    expect(result.plainText).toContain('- 列表项')
  })

  it('空稿返回空 HTML 与空文本', () => {
    const result = render('')
    expect(result.html).toBe('')
    expect(result.plainText).toBe('')
    expect(result.warnings).toEqual([])
  })
})
