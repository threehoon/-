import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { parse as parseYaml } from 'yaml'
import { toString as mdastToString } from 'mdast-util-to-string'
import type { Root } from 'mdast'
import type { DocumentStats, ParsedDocument } from '../types'
import { extractTitle, findLeadingTitleIndex, removeBlockAt } from './title'
import { applyInlineFormats } from './inline-format'

/**
 * Markdown 解析：YAML frontmatter + mdast 语法树 + 标题候选 + 统计。
 */

const FRONTMATTER_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

export interface FrontmatterRead {
  /** 解析出的键值对；没有 frontmatter 或结构不合法时为 null。 */
  readonly data: Readonly<Record<string, unknown>> | null
  /** 去掉 frontmatter 之后的正文；解析失败时原样保留，避免吞掉用户内容。 */
  readonly body: string
  /** YAML 解析失败或不构成键值结构时的提示；正常情况为 null。 */
  readonly error: string | null
}

/**
 * 读取 frontmatter。失败不抛错：YAML 坏掉时就当没有 frontmatter，
 * 并且**不剥离**这段文本——宁可让它在正文里可见，也不能静默丢掉。
 */
export function readFrontmatter(markdown: string): FrontmatterRead {
  const match = FRONTMATTER_PATTERN.exec(markdown)
  if (!match) {
    return { data: null, body: markdown, error: null }
  }

  const block = match[1] ?? ''
  const rest = markdown.slice(match[0].length)
  let parsed: unknown
  try {
    parsed = parseYaml(block)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      data: null,
      body: markdown,
      error: `frontmatter 不是合法 YAML，已按无 frontmatter 处理：${reason}`,
    }
  }

  if (parsed === null || parsed === undefined) {
    return { data: {}, body: rest, error: null }
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      data: null,
      body: markdown,
      error: 'frontmatter 不是「键: 值」结构，已按无 frontmatter 处理。',
    }
  }

  return { data: parsed as Record<string, unknown>, body: rest, error: null }
}

const processor = unified().use(remarkParse).use(remarkGfm)

function countCharacters(text: string): number {
  // 中文字符数按「非空白字符」计，代码块内容也计入；标点算一个字符。
  return [...text.replace(/\s+/g, '')].length
}

function computeStats(root: Root): DocumentStats {
  let characters = 0
  let blocks = 0
  for (const child of root.children) {
    if (child.type === 'definition' || child.type === 'yaml') {
      continue
    }
    blocks += 1
    characters += countCharacters(mdastToString(child))
  }
  return { characters, blocks }
}

/**
 * 把 Markdown 解析成排版层唯一需要的数据结构。
 *
 * 返回的 `root` 已经去掉 frontmatter，并且当且仅当首块就是与提取标题一致的一级标题时
 * 移除了该块（见 title.ts）；统计也基于移除后的正文。
 *
 * frontmatter 解析失败不会抛错，此时 `frontmatter` 为 null。界面若想提示原因，
 * 可以直接调用 `readFrontmatter(markdown).error`——它是独立的只读函数，不污染契约类型。
 */
export function parseDocument(markdown: string, bodyOnly = false): ParsedDocument {
  if (typeof markdown !== 'string') {
    throw new TypeError('源稿必须是 Markdown 文本')
  }

  const { data, body } = bodyOnly ? { data: null, body: markdown } : readFrontmatter(markdown.replace(/^\uFEFF/, ''))
  const root = processor.parse(body)
  applyInlineFormats(root, body)
  const title = bodyOnly ? { value: null, from: 'none' as const } : extractTitle(root, data)
  const leadingTitleIndex = findLeadingTitleIndex(root, title)
  const bodyRoot = removeBlockAt(root, leadingTitleIndex)
  const bodyOffset = markdown.length - body.length
  const leadingTitle = leadingTitleIndex === null ? undefined : root.children[leadingTitleIndex].position?.start.offset

  return {
    root: bodyRoot,
    bodyOffset,
    leadingTitleOffset: leadingTitle === undefined ? undefined : leadingTitle + bodyOffset,
    title,
    stats: computeStats(bodyRoot),
    frontmatter: data,
  }
}
