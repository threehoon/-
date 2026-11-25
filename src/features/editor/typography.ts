import { DEFAULT_ARTICLE_FONT } from '@/core/render/article-font'

export const EDITOR_FONTS = [
  { id: 'yahei', label: '微软雅黑', family: DEFAULT_ARTICLE_FONT },
  { id: 'heiti', label: '黑体', family: 'SimHei, "Heiti SC", "Noto Sans CJK SC", sans-serif' },
  { id: 'songti', label: '宋体', family: 'SimSun, "Songti SC", "Noto Serif CJK SC", serif' },
  { id: 'kaiti', label: '楷体', family: 'KaiTi, "Kaiti SC", STKaiti, serif' },
] as const

const COMMON_SIZES: readonly number[] = [12, 14, 15, 16, 17, 18, 20, 22, 24, 28, 32, 36, 48, 72]
const OTHER_SIZES = Array.from({ length: 61 }, (_, index) => index + 12).filter((size) => !COMMON_SIZES.includes(size))

export const FONT_SIZE_GROUPS = [
  { label: '常用字号', values: COMMON_SIZES },
  { label: '其他字号', values: OTHER_SIZES },
] as const

export interface ActiveTypography {
  readonly fontId: string
  readonly size: string
}

function primaryFamily(value: string): string {
  return (value.split(',')[0] ?? '').trim().replace(/^['"]|['"]$/g, '').toLowerCase()
}

const FONT_IDS = new Map<string, string>(EDITOR_FONTS.map(({ id, family }) => [primaryFamily(family), id]))

/** Read the text under the caret, or the common values across all selected text runs. */
export function activeTypography(article: HTMLElement, range: Range | null): ActiveTypography {
  const owner = article.ownerDocument
  function read(node: Node): ActiveTypography {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
    const style = owner.defaultView?.getComputedStyle(element ?? article)
    return {
      fontId: FONT_IDS.get(primaryFamily(style?.fontFamily ?? '')) ?? '',
      size: style?.fontSize.endsWith('px') ? style.fontSize.slice(0, -2) : '',
    }
  }

  if (range === null) return read(article.firstElementChild ?? article)
  if (range.collapsed) return read(range.startContainer === article ? article.firstElementChild ?? article : range.startContainer)

  const root = range.commonAncestorContainer
  if (root.nodeType === Node.TEXT_NODE) return read(root)
  const walker = owner.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const examined = new Set<Element>()
  let result: ActiveTypography | undefined
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const from = node === range.startContainer ? range.startOffset : 0
    const to = node === range.endContainer ? range.endOffset : node.length
    const parent = node.parentElement
    if (!parent || examined.has(parent) || from >= to || !node.data.slice(from, to).trim() || !range.intersectsNode(node)) continue
    examined.add(parent)
    const current = read(parent)
    result = result ? {
      fontId: result.fontId === current.fontId ? current.fontId : '',
      size: result.size === current.size ? current.size : '',
    } : current
    if (!result.fontId && !result.size) break
  }
  return result ?? read(root)
}

export function runNativeTextStyle(article: HTMLElement, command: 'fontName' | 'fontSize', value: string): boolean {
  const owner = article.ownerDocument
  const cssBefore = owner.queryCommandState('styleWithCSS')
  try {
    if (!owner.execCommand('styleWithCSS', false, 'true')) return false
    return owner.execCommand(command, false, value)
  } finally {
    owner.execCommand('styleWithCSS', false, String(cssBefore))
  }
}

function sizeMarkers(article: HTMLElement): HTMLElement[] {
  return Array.from(article.querySelectorAll<HTMLElement>('[style]'))
    .filter(({ style }) => style.fontSize === 'x-small')
}

export function applyFontSize(article: HTMLElement, size: number): boolean {
  if (!Number.isInteger(size) || size < 12 || size > 72) return false
  // Convert the native font level to the actual pixel size before recording the edit.
  if (!runNativeTextStyle(article, 'fontSize', '1')) return false
  const markers = sizeMarkers(article)
  if (markers.length === 0) return false
  for (const span of markers) span.style.fontSize = `${size}px`
  return true
}
