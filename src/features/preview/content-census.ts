/**
 * 成稿清单：从一份平台成稿 HTML 里读出「有什么」，不判断「有什么问题」。
 *
 * 三处共用同一份事实：兼容性提示的实时重算（assess.ts）、内容检查的基线差异
 * （content-baseline.ts），以及按平台分组的对拍测试。只数结构性事实，避免
 * 每处各写一遍 DOM 遍历、计数口径互相对不上。
 *
 * 与 `collectBodyUnits` 对齐口径：同一份 BODY_BLOCK_TAGS 切块、跳过同一组标签，
 * 所以 `units[i]` 就是发布预检里的「正文第 i 个文字块」。
 */

import { DOWNGRADED_TABLE_ATTR } from '@/core/render/source-markers'
import { collectBodyUnits } from '@/core/publish-review/units'

export interface CensusUnit {
  /** 与 collectBodyUnits 的块序号一致。 */
  readonly index: number
  /** 归一化后的文字（见 normalizeText）。 */
  readonly text: string
  readonly links: readonly string[]
  readonly images: readonly string[]
}

export interface ContentCensus {
  readonly title: string | null
  readonly units: readonly CensusUnit[]
  readonly characters: number
  readonly images: number
  readonly externalLinks: number
  readonly codeBlocks: number
  readonly inlineCodes: number
  readonly tables: number
  readonly downgradedTables: number
  /** 被降级成逐行文字的表格所在的文字块序号。 */
  readonly downgradedTableUnits: readonly number[]
  readonly blockquotes: number
}

const EMPTY_CENSUS: ContentCensus = {
  title: null,
  units: [],
  characters: 0,
  images: 0,
  externalLinks: 0,
  codeBlocks: 0,
  inlineCodes: 0,
  tables: 0,
  downgradedTables: 0,
  downgradedTableUnits: [],
  blockquotes: 0,
}

export function emptyCensus(): ContentCensus {
  return EMPTY_CENSUS
}

/** 解析成稿 HTML。用 <template> 解析：不加载图片、不执行脚本；无 DOM 的运行时返回空清单。 */
export function parseInertArticleHtml(html: string): Element | null {
  if (typeof document === 'undefined') return null
  const template = document.createElement('template')
  template.innerHTML = html
  const container = document.createElement('div')
  container.append(template.content.cloneNode(true))
  return container
}

export function censusOf(html: string, title: string | null = null): ContentCensus {
  const container = parseInertArticleHtml(html)
  if (!container) return { ...EMPTY_CENSUS, title }
  const units = collectBodyUnits(container)
  const body: CensusUnit[] = units.map((unit, index) => ({
    index,
    text: normalizeText(unit.text),
    links: [...unit.links],
    images: [...unit.element?.querySelectorAll('img[src]') ?? []].map((image) => image.getAttribute('src') ?? ''),
  }))

  const externalLinks = [...container.querySelectorAll('a[href]')]
    .map((anchor) => anchor.getAttribute('href')?.trim() ?? '')
    .filter((href) => /^https?:\/\//i.test(href)).length
  const downgraded = new Map<string, number>()
  for (const [index, unit] of units.entries()) {
    const group = unit.element?.getAttribute(DOWNGRADED_TABLE_ATTR)
    if (group != null && !downgraded.has(group)) downgraded.set(group, index)
  }

  return {
    title,
    units: body,
    characters: body.reduce((total, unit) => total + countArticleCharacters(unit.text), 0),
    images: container.querySelectorAll('img[src]').length,
    externalLinks,
    codeBlocks: container.querySelectorAll('pre').length,
    inlineCodes: container.querySelectorAll('code:not(pre code)').length,
    tables: container.querySelectorAll('table').length,
    downgradedTables: downgraded.size,
    downgradedTableUnits: [...downgraded.values()],
    blockquotes: container.querySelectorAll('blockquote').length,
  }
}

/** 比较用的归一化：全角字母数字折半角、全角空格折普通空格、压缩空白、去首尾空白。 */
export function normalizeText(text: string): string {
  return text
    .replace(/[！-～]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    // 全角空格（U+3000）是有意保留的字面量：这里就是要把中文排版里的它折成普通空格。
    // eslint-disable-next-line no-irregular-whitespace
    .replace(/　/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function countArticleCharacters(text: string): number {
  return text.match(/[\p{Script=Han}A-Za-z0-9]/gu)?.length ?? 0
}
