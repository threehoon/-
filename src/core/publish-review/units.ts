/**
 * 发布预检的文字块切分。
 *
 * 同一套切分规则同时服务两件事：从成稿 HTML 上扫描风险，和从屏幕上的正文 DOM
 * 上把命中位置映射回去。两边共用这里的算法，块序号才能对上；改规则时两处同时生效。
 */

export interface UnitPiece {
  readonly node: Text
  readonly start: number
  readonly end: number
}

export interface BodyTextUnit {
  readonly location: string
  /** 去掉首尾空白后的文字；风险命中的偏移量按它计算。 */
  readonly text: string
  readonly links: ReadonlySet<string>
  /** 文字块内各文本节点在未裁剪文字中的区间。 */
  readonly pieces: readonly UnitPiece[]
  /** 被裁掉的开头空白数：把 text 的偏移量换回 pieces 的区间时加上它。 */
  readonly trimStart: number
  /** 产生该文字块的块元素；只含图片链接、没有文字时用它定位。 */
  readonly element: Element | null
}

/** 正文文字块的边界标签；成稿清单（content-census）也用同一份定义，块序号才对得上。 */
export const BODY_BLOCK_TAGS: ReadonlySet<string> = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'LI', 'TD', 'TH', 'DIV', 'FIGCAPTION'])
const BODY_BLOCKS = BODY_BLOCK_TAGS
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'PRE', 'HR'])

/**
 * 按段切分正文文字块：块级元素和换行处断开，跨行内标签的句子合成一块，
 * 代码块和脚本整块跳过。`root` 可以是 `<template>` 的内容，也可以是屏幕上的正文元素。
 * `onUnit` 让调用方在同一次遍历里顺便记录每个文字块对应的 DOM 位置（例如成稿清单）。
 */
export function collectBodyUnits(root: ParentNode, onUnit?: (unit: BodyTextUnit, index: number) => void): BodyTextUnit[] {
  const units: BodyTextUnit[] = []
  let text = ''
  let pieces: UnitPiece[] = []
  let links = new Set<string>()
  let element: Element | null = null
  let textBlocks = 0
  let imageLinkBlocks = 0

  function flush() {
    const content = text.trim()
    if (content || links.size > 0) {
      const location = content ? `正文第 ${++textBlocks} 个文字块` : `正文图片链接第 ${++imageLinkBlocks} 处`
      const unit: BodyTextUnit = {
        location,
        text: content,
        links,
        pieces,
        trimStart: text.length - text.trimStart().length,
        element,
      }
      units.push(unit)
      onUnit?.(unit, units.length - 1)
    }
    text = ''
    pieces = []
    links = new Set()
    element = null
  }

  function read(node: Node, href?: string) {
    if (node.nodeType === Node.TEXT_NODE) {
      const part = node.textContent ?? ''
      const start = text.length
      text += part
      if (start < text.length && node instanceof Text) pieces.push({ node, start, end: text.length })
      if (href && part.trim()) links.add(href)
      return
    }
    if (!(node instanceof Element)) return
    if (SKIPPED_TAGS.has(node.tagName)) {
      flush()
      return
    }
    if (node.tagName === 'BR') {
      text += '\n'
      return
    }
    if (node.tagName === 'IMG' && href) links.add(href)
    const activeLink = node.tagName === 'A' ? node.getAttribute('href')?.trim() : href
    // 锚点里的图片没有自己的 href，但整块仍算「含链接」，定位时据此退回整块。
    if (activeLink) links.add(activeLink)
    const block = BODY_BLOCKS.has(node.tagName)
    if (block) {
      flush()
      element = node
    }
    for (const child of node.childNodes) read(child, activeLink)
    if (block) flush()
  }

  for (const child of root.childNodes) read(child)
  flush()
  return units
}

/**
 * 任意节点属于第几个正文文字块；-1 表示不在正文文字块里。与 collectBodyUnits 同一次遍历得出。
 * 表格这类本身不是文字块的节点取「它里面的第一个文字块」（单元格），
 * 因为切块时表格会被拆成一行一块。
 */
export function unitIndexOf(root: ParentNode, node: Node): number {
  let containing = -1
  let inside = -1
  collectBodyUnits(root, (unit, index) => {
    const element = unit.element
    if (!element) return
    if (containing < 0 && (element === node || element.contains(node))) containing = index
    if (inside < 0 && node.contains(element)) inside = index
  })
  return containing >= 0 ? containing : inside
}
