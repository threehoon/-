import { toString as mdastToString } from 'mdast-util-to-string'
import type { Root } from 'mdast'
import type { TitleCandidate } from '../types'

/**
 * 标题提取与「首标题移除」规则（PRD F03）。
 *
 * 三条边界：
 * 1. frontmatter.title 有效时优先；
 * 2. 否则取正文里第一个一级标题；
 * 3. 只有正文第一个内容块就是与提取标题一致的一级标题时，才从复制正文里移除它——
 *    其余任何情况都保留，避免把正文里真正的小标题吃掉。
 */

/** frontmatter 与标题比较都用同一套归一化：折叠空白、去首尾空白。 */
export function normalizeTitleText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function extractTitle(
  root: Root,
  frontmatter: Readonly<Record<string, unknown>> | null,
): TitleCandidate {
  const raw = frontmatter?.title
  if (typeof raw === 'string' || typeof raw === 'number') {
    const value = normalizeTitleText(String(raw))
    if (value.length > 0) {
      return { value, from: 'frontmatter' }
    }
  }

  for (const child of root.children) {
    if (child.type === 'heading' && child.depth === 1) {
      const value = normalizeTitleText(mdastToString(child))
      if (value.length > 0) {
        return { value, from: 'first-heading' }
      }
    }
  }

  return { value: null, from: 'none' }
}

/** 第一个「内容块」的下标：链接定义、YAML 块不算内容。 */
export function findLeadingContentIndex(root: Root): number {
  return root.children.findIndex(
    (child) => child.type !== 'definition' && child.type !== 'yaml',
  )
}

/**
 * 需要移除的首标题块下标；不移除时返回 null。
 * 判定条件同时要求：位置是第一个内容块、是一级标题、文本与提取标题一致。
 */
export function findLeadingTitleIndex(root: Root, title: TitleCandidate): number | null {
  if (title.value === null) {
    return null
  }
  const index = findLeadingContentIndex(root)
  if (index < 0) {
    return null
  }
  const block = root.children[index]
  if (block === undefined || block.type !== 'heading' || block.depth !== 1) {
    return null
  }
  const value = normalizeTitleText(mdastToString(block))
  return value === normalizeTitleText(title.value) ? index : null
}

/** 返回去掉指定块的新树；不修改传入的 root（平台适配器只读遍历）。 */
export function removeBlockAt(root: Root, index: number | null): Root {
  if (index === null) {
    return root
  }
  return { ...root, children: root.children.filter((_, position) => position !== index) }
}
