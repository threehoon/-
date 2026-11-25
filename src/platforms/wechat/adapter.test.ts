import { describe, expect, it } from 'vitest'
import { parseDocument } from '@/core/markdown/parse'
import { createAssetRegistry } from '@/core/images/assets'
import { createWechatPlatform } from './adapter'

const platform = createWechatPlatform()

function render(markdown: string): { html: string; plainText: string; title: string | null; warnings: readonly { kind: string }[] } {
  const outcome = platform.render(parseDocument(markdown), {
    assets: createAssetRegistry({}),
    titleOverride: null,
  })
  if (!outcome.ok) {
    throw new Error(`公众号渲染失败：${outcome.failure.reason}`)
  }
  return {
    html: outcome.document.html,
    plainText: outcome.document.plainText,
    title: outcome.document.title,
    warnings: outcome.document.warnings,
  }
}

describe('公众号适配器', () => {
  it('元信息与能力声明保守：最深 4 级标题，证据为待用户试用', () => {
    expect(platform.id).toBe('wechat')
    expect(platform.name).toBe('微信公众号')
    expect(platform.articleLabel).toBe('图文正文')
    expect(platform.entryUrl).toBe('https://mp.weixin.qq.com/')
    expect(platform.capabilities.maxHeadingLevel).toBe(4)
    expect(platform.capabilityEvidence).toBe('pending-user-trial')
  })

  it('正文样式内联：无衬线 16px / 行高 2 / 墨色', () => {
    const { html } = render('正文一段。')
    expect(html.startsWith('<section style="')).toBe(true)
    expect(html).toMatch(/^<section style="font-family:&quot;Microsoft YaHei&quot;/)
    expect(html).toContain('max-width:576px')
    expect(html).toContain('font-size:16px')
    expect(html).toContain('line-height:2;')
    expect(html).toContain('color:#1f2023')
    expect(html).toContain('<p style="margin:0 0 20px;">正文一段。</p>')
  })

  it('默认排版保留二级与三级标题的语义和顺序', () => {
    const { html } = render('## 二级标题\n\n### 三级标题')
    expect(html).toMatch(/<h2 style="[^"]+">二级标题<\/h2>.*<h3 style="[^"]+">三级标题<\/h3>/)
  })

  it('引用是淡蓝卡片：四像素左条、圆角与斜体', () => {
    const { html } = render('> 引用首段\n>\n> 引用末段\n\n后续正文')
    expect(html).toContain('<blockquote style="')
    expect(html).toContain('border-left:4px solid #0a5cf6')
    expect(html).toContain('background-color:#f5f7ff')
    expect(html).toContain('font-style:italic')
    expect(html).toContain('<p style="margin:0 0 20px;">引用首段</p>')
    expect(html).toContain('<p style="margin:0 0 20px;margin-bottom:0;">引用末段</p>')
    expect(html).toContain('<p style="margin:0 0 20px;">后续正文</p>')
  })

  it('超过 4 级的标题降级为加粗小标题并告警', () => {
    const { html, warnings } = render('##### 五级标题')
    expect(html).not.toContain('<h5')
    expect(html).toContain('<strong>五级标题</strong>')
    expect(html).toContain('font-weight:700')
    expect(warnings.some((warning) => warning.kind === 'heading')).toBe(true)
  })

  it('代码块带浅底与等宽字体，表格只用横线分组', () => {
    const { html } = render('```\nconst x = 1\n```\n\n| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |')
    expect(html).toContain('<pre style="')
    expect(html).toContain('background-color:#f7f8fb')
    expect(html).toContain('<table style="')
    expect(html).toContain('border-bottom:2px solid #0a5cf6')
  })

  it('标题取首块一级标题并从正文移除', () => {
    const { title, html } = render('# 文章标题\n\n正文。')
    expect(title).toBe('文章标题')
    expect(html).not.toContain('文章标题')
  })
})
