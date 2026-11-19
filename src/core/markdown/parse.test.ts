import { describe, expect, it } from 'vitest'
import { parseDocument, readFrontmatter } from './parse'

describe('frontmatter 解析', () => {
  it('正常 YAML 解析成键值对并从正文剥离', () => {
    const parsed = parseDocument('---\ntitle: 文章标题\ntags:\n  - 排版\n---\n\n正文第一段。')
    expect(parsed.frontmatter).toEqual({ title: '文章标题', tags: ['排版'] })
    expect(parsed.root.children).toHaveLength(1)
  })

  it('YAML 语法错误不抛异常，按无 frontmatter 处理且不吞掉原文', () => {
    const markdown = '---\ntitle: [未闭合\n---\n\n正文第一段。'
    expect(() => parseDocument(markdown)).not.toThrow()

    const parsed = parseDocument(markdown)
    expect(parsed.frontmatter).toBeNull()
    expect(parsed.title.from).toBe('none')

    const info = readFrontmatter(markdown)
    expect(info.error).toContain('合法 YAML')
    // 解析失败时原样保留，正文里的字仍在 AST 里，不存在静默丢内容
    expect(JSON.stringify(parsed.root)).toContain('未闭合')
  })

  it('frontmatter 不是键值结构时按无 frontmatter 处理并保留原文', () => {
    const markdown = '---\n只是一行文字\n---\n\n正文。'
    const parsed = parseDocument(markdown)
    expect(parsed.frontmatter).toBeNull()
    expect(readFrontmatter(markdown).error).toContain('键')
    expect(JSON.stringify(parsed.root)).toContain('只是一行文字')
  })

  it('没有 frontmatter 时返回 null 且没有错误', () => {
    const parsed = parseDocument('# 标题\n\n正文')
    expect(parsed.frontmatter).toBeNull()
    expect(readFrontmatter('# 标题\n\n正文').error).toBeNull()
  })

  it('开头 BOM 不影响 frontmatter 识别', () => {
    const parsed = parseDocument('\uFEFF---\ntitle: 带BOM\n---\n\n正文')
    expect(parsed.title).toEqual({ value: '带BOM', from: 'frontmatter' })
  })
})

describe('正文统计', () => {
  it('字符数不含 Markdown 标记与空白，也不含被移除的首标题', () => {
    const parsed = parseDocument('# 文章标题\n\n第一段。\n\n**第二段**。')
    // 「第一段。」4 字 + 「第二段。」4 字，加粗标记不算字符
    expect(parsed.stats.characters).toBe(8)
    expect(parsed.stats.blocks).toBe(2)
  })

  it('块数不含链接定义', () => {
    const parsed = parseDocument('[ref]: https://example.com\n\n正文。')
    expect(parsed.stats.blocks).toBe(1)
  })

  it('代码块内容计入字符数', () => {
    const parsed = parseDocument('```\nconst a = 1\n```')
    expect(parsed.stats.characters).toBe('consta=1'.length)
  })

  it('空稿统计为零', () => {
    const parsed = parseDocument('')
    expect(parsed.stats).toEqual({ characters: 0, blocks: 0 })
    expect(parsed.title.from).toBe('none')
  })
})

describe('解析入口防御', () => {
  it('非文本输入抛出可读的 TypeError（由 typeset 捕获）', () => {
    expect(() => parseDocument(null as unknown as string)).toThrow(TypeError)
    expect(() => parseDocument(null as unknown as string)).toThrow('源稿必须是 Markdown 文本')
  })
})
