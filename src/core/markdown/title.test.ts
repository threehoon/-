import { describe, expect, it } from 'vitest'
import { parseDocument } from './parse'
import { normalizeTitleText } from './title'

describe('标题提取三态（PRD F03）', () => {
  it('frontmatter.title 优先于正文一级标题', () => {
    const parsed = parseDocument('---\ntitle: 指定标题\n---\n\n# 正文大标题\n\n正文内容')
    expect(parsed.title).toEqual({ value: '指定标题', from: 'frontmatter' })
    // 首个内容块是 h1，但文本与 frontmatter 标题不一致，必须保留
    expect(parsed.root.children[0]?.type).toBe('heading')
  })

  it('没有 frontmatter 时取首个一级标题', () => {
    const parsed = parseDocument('# 文章标题\n\n正文内容')
    expect(parsed.title).toEqual({ value: '文章标题', from: 'first-heading' })
    // 首块就是与标题一致的 h1，按 F03 从正文移除
    expect(parsed.root.children).toHaveLength(1)
    expect(parsed.root.children[0]?.type).toBe('paragraph')
  })

  it('没有任何标题时给出 none，等待手动填写', () => {
    const parsed = parseDocument('只有正文。\n\n没有标题。')
    expect(parsed.title).toEqual({ value: null, from: 'none' })
  })

  it('只有二级标题时不算提取到标题', () => {
    const parsed = parseDocument('## 二级小标题\n\n正文')
    expect(parsed.title.from).toBe('none')
    expect(parsed.root.children[0]?.type).toBe('heading')
  })

  it('frontmatter 标题为空字符串时退回首个一级标题', () => {
    const parsed = parseDocument('---\ntitle: ""\n---\n\n# 正标题\n\n正文')
    expect(parsed.title).toEqual({ value: '正标题', from: 'first-heading' })
  })

  it('数值型 frontmatter 标题也能用', () => {
    const parsed = parseDocument('---\ntitle: 2026\n---\n\n正文')
    expect(parsed.title).toEqual({ value: '2026', from: 'frontmatter' })
  })
})

describe('首标题移除条件', () => {
  it('一级标题不是第一个内容块时保留', () => {
    const parsed = parseDocument('开头一段。\n\n# 文章标题\n\n正文')
    expect(parsed.title).toEqual({ value: '文章标题', from: 'first-heading' })
    expect(parsed.root.children).toHaveLength(3)
    expect(parsed.root.children[1]?.type).toBe('heading')
  })

  it('标题与正文首块文本不一致时保留首块', () => {
    const parsed = parseDocument('# 另一个标题\n\n# 文章标题\n\n正文')
    // 提取到的是第一个 h1，与它自身的文本当然一致 → 移除第一个
    expect(parsed.title.value).toBe('另一个标题')
    expect(parsed.root.children).toHaveLength(2)
  })

  it('frontmatter 标题与首个 h1 一致时移除该 h1', () => {
    const parsed = parseDocument('---\ntitle: 同名标题\n---\n\n# 同名标题\n\n正文')
    expect(parsed.title).toEqual({ value: '同名标题', from: 'frontmatter' })
    expect(parsed.root.children).toHaveLength(1)
    expect(parsed.root.children[0]?.type).toBe('paragraph')
  })

  it('链接定义排在前面时仍能认定首块为标题', () => {
    const parsed = parseDocument('[ref]: https://example.com\n\n# 文章标题\n\n正文')
    expect(parsed.title.from).toBe('first-heading')
    expect(parsed.root.children[0]?.type).toBe('definition')
    expect(parsed.root.children[1]?.type).toBe('paragraph')
  })

  it('标题文本比较时折叠空白', () => {
    const parsed = parseDocument('---\ntitle: 标题 带空格\n---\n\n#   标题   带空格\n\n正文')
    expect(parsed.root.children).toHaveLength(1)
    expect(normalizeTitleText('  a \n b ')).toBe('a b')
  })
})
