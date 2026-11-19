import { readSourceMarker } from '@/core/render/source-markers'
import type { PublishFinding } from '@/core/publish-review/review'
import { collectBodyUnits, type BodyTextUnit } from '@/core/publish-review/units'
import type { CompatibilityLocation, SourceSpan } from '@/core/types'
import { located, outcomeRange, sameBlockAfterEdit, unavailable, type LocateOutcome } from './locate-shared'

export type { LocateOutcome } from './locate-shared'
export { outcomeRange } from './locate-shared'

interface CompatibilityTargets {
  readonly ranges: readonly Range[]
  readonly images: readonly HTMLImageElement[]
}

export function compatibilityTargets(article: Element, locations: readonly CompatibilityLocation[]): CompatibilityTargets {
  const ranges: Range[] = []
  const images: HTMLImageElement[] = []
  const imageNodes = article.querySelectorAll<HTMLImageElement>('img[src]')
  const spans = new Set(locations.flatMap((location) =>
    location.kind === 'block' ? [`${location.span.start}:${location.span.end}`] : []))
  for (const location of locations) {
    if (location.kind !== 'image') continue
    const image = imageNodes[location.index]
    if (image) images.push(image)
  }
  if (spans.size === 0) return { ranges, images }
  const walker = article.ownerDocument.createTreeWalker(article, NodeFilter.SHOW_COMMENT)
  const starts = new Map<string, Node>()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const marker = readSourceMarker(node)
    if (!marker) continue
    const key = `${marker.start}:${marker.end}`
    if (!spans.has(key)) continue
    if (marker.edge === 's') {
      starts.set(key, node)
      continue
    }
    const start = starts.get(key)
    if (!start || start.parentNode !== node.parentNode) continue
    const range = article.ownerDocument.createRange()
    range.setStartAfter(start)
    range.setEndBefore(node)
    if (!range.collapsed) ranges.push(range)
    spans.delete(key)
  }
  return { ranges, images }
}

export function locateRange(range: Range, inset = 0) {
  const canvas = range.startContainer.parentElement?.closest('.preview-canvas')
  const scroll = canvas?.closest<HTMLElement>('.preview__scroll')
  // 没有排版引擎的实现（例如测试环境）拿不到矩形，此时只高亮不滚动。
  const rect = typeof range.getClientRects === 'function' ? range.getClientRects()[0] : undefined
  if (rect && scroll && scroll.scrollHeight > scroll.clientHeight) {
    const viewport = scroll.getBoundingClientRect()
    // 顶部可能有钉住的预检条：只在它下面剩下的可视区里居中。
    const covered = Math.min(Math.max(inset, 0), scroll.clientHeight / 2)
    scroll.scrollTop += rect.top - viewport.top - covered - (scroll.clientHeight - covered) / 2
  } else if (rect) {
    // 窄屏时滚动的是整个页面，预检条同样可能压在顶部。
    const covered = Math.min(Math.max(inset, 0), window.innerHeight / 2)
    window.scrollBy(0, rect.top - covered - (window.innerHeight - covered) / 2)
  }
}

const REVIEW_HIGHLIGHT = 'studio-review-issue'
const REVIEW_HIGHLIGHT_MS = 2400
let reviewHighlightTimer: number | null = null

/** Range covering [start, end) of an element's text, walking its text nodes. */
function rangeWithin(element: Element, start: number, end: number): Range | null {
  const owner = element.ownerDocument
  const walker = owner.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let offset = 0
  let from: Text | null = null
  let fromOffset = 0
  let to: Text | null = null
  let toOffset = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (from === null && start <= offset + length) {
      from = node as Text
      fromOffset = Math.max(0, start - offset)
    }
    if (to === null && end <= offset + length) {
      to = node as Text
      toOffset = Math.max(0, end - offset)
    }
    offset += length
    if (from && to) break
  }
  if (!from || !to) return null
  const range = owner.createRange()
  range.setStart(from, fromOffset)
  range.setEnd(to, toOffset)
  return range
}

function unitRange(unit: BodyTextUnit, start: number, end: number): Range | null {
  const first = unit.pieces[0]
  const from = unit.trimStart + start
  const to = unit.trimStart + end
  if (!first || to <= from) return null
  // 命中可能从 <br> 这类没有文本节点的空档开始：落到下一个文本节点，并把偏移夹进节点长度。
  const startPiece = unit.pieces.find((piece) => piece.end > from) ?? unit.pieces.at(-1)
  const endPiece = [...unit.pieces].reverse().find((piece) => piece.start < to) ?? startPiece
  if (!startPiece || !endPiece) return null
  const startOffset = Math.min(Math.max(from - startPiece.start, 0), startPiece.node.data.length)
  const endOffset = Math.min(Math.max(to - endPiece.start, 0), endPiece.node.data.length)
  const range = first.node.ownerDocument.createRange()
  range.setStart(startPiece.node, startOffset)
  range.setEnd(endPiece.node, endOffset)
  return range.collapsed ? null : range
}

/**
 * 预检条压住滚动区顶部多少。读稿时它钉住不动，编辑时随正文滚动，
 * 两种情况都按当前矩形算，避免把目标居中到被面板盖住的位置。
 */
function pinnedInset(canvas: Element): number {
  const scroll = canvas.closest('.preview__scroll')
  const panel = scroll?.querySelector<HTMLElement>('.publish-review')
  if (!scroll || !panel) return 0
  const viewport = scroll.getBoundingClientRect()
  const bottom = Math.min(panel.getBoundingClientRect().bottom, viewport.bottom)
  return Math.max(0, bottom - viewport.top)
}

function wholeBlock(unit: BodyTextUnit): Range | null {
  if (!unit.element) return null
  const range = unit.element.ownerDocument.createRange()
  range.selectNodeContents(unit.element)
  return range.collapsed ? null : range
}

export function articleTitleElement(canvas: Element): Element | null {
  return canvas.querySelector('#platform-article-title, .article-title')
}

export function selectTitleInput(input: HTMLInputElement, start: number, end: number) {
  input.scrollIntoView?.({ block: 'center' })
  input.focus({ preventScroll: true })
  const offset = input.value.length - input.value.trimStart().length
  input.setSelectionRange(offset + start, offset + end)
}

export function publishFindingElement(canvas: Element, finding: PublishFinding): Element | null {
  if (finding.unit < 0) return articleTitleElement(canvas)
  const article = canvas.querySelector('#platform-article')
  return article ? collectBodyUnits(article)[finding.unit]?.element ?? null : null
}

/** 把预检提示映射到原字句、仍是同一段的整块，或给出无法定位的原因。 */
export function publishTargetOutcome(canvas: Element, finding: PublishFinding, previousElement?: Element | null): LocateOutcome {
  if (finding.unit < 0) {
    const title = articleTitleElement(canvas)
    if (!title) return unavailable('这一版成稿里没有可确认的原标题。')
    const text = title.textContent ?? ''
    if (text !== finding.context) return unavailable('标题的文字已经改过，这条提示不再对应得上。')
    const start = text.slice(finding.start, finding.end) === finding.original
      ? finding.start
      : finding.original === '' ? -1 : text.indexOf(finding.original)
    const range = start >= 0 ? rangeWithin(title, start, start + finding.original.length) : null
    if (range) return located(range)
    // 标题被改过就整块高亮也帮不上忙：宁可报未能定位，也不要圈错整行标题。
    return unavailable('标题的文字已经改过，这条提示不再对应得上。')
  }
  const article = canvas.querySelector('#platform-article')
  if (!article) return unavailable('这一版成稿里没有正文。')
  const units = collectBodyUnits(article)
  const unit = previousElement === undefined ? units[finding.unit]
    : previousElement && article.contains(previousElement)
      ? units.find((entry) => entry.element === previousElement)
      : undefined
  if (!unit) return unavailable('正文的段落数量已变化，这条提示指向的段落不存在了。')
  const sameBlock = unit.text === finding.context || sameBlockAfterEdit(finding.context, unit.text)
  if (!sameBlock) return unavailable('这段文字在当前成稿里已经找不到，请点「一键检测」更新结果。')
  const exact = finding.original !== '' && unit.text.slice(finding.start, finding.end) === finding.original
  const start = exact ? finding.start : finding.original === '' ? -1 : unit.text.indexOf(finding.original)
  if (start >= 0) {
    const range = unitRange(unit, start, start + finding.original.length)
    if (range) return located(range)
  }
  // 站外网址挂锚文本或图片上时命中片段的原文为空：确认这一块确实带链接，才退回到整块。
  if (finding.original === '') {
    if (unit.links.size === 0) return unavailable('这一块已经不再含链接，提示可能已经过时。')
    const range = wholeBlock(unit)
    return range ? { status: 'block', range } : unavailable('找不到这一块的正文位置。')
  }
  if (sameBlock) {
    const range = wholeBlock(unit)
    if (range) return { status: 'block', range }
  }
  return unavailable('这段文字在当前成稿里已经找不到，请点「一键检测」更新结果。')
}

/** 只要 Range、不要状态说明的旧调用点。 */
export function publishTargetRange(canvas: Element, finding: PublishFinding): Range | null {
  return outcomeRange(publishTargetOutcome(canvas, finding))
}

/**
 * Scroll to a finding and flash it without touching selection, undo or the stored markup.
 * `located` means the text was highlighted; `block` 只落整块（命中文字已改，或只含图片的链接）；
 * `unavailable` 表示正文已经变了，界面应提示重新检测。
 */
export type PublishLocateResult = 'located' | 'block' | 'unavailable'

export interface PublishLocate {
  readonly status: PublishLocateResult
  readonly message: string | null
}

export function locatePublishFinding(canvas: Element, finding: PublishFinding, previousElement?: Element | null): PublishLocate {
  let outcome: LocateOutcome
  try {
    const title = finding.unit < 0 ? articleTitleElement(canvas) : null
    if (title instanceof HTMLInputElement) {
      const raw = title.value
      const text = raw.trim()
      if (text === finding.context && text.slice(finding.start, finding.end) === finding.original) {
        selectTitleInput(title, finding.start, finding.end)
        return { status: 'located', message: null }
      }
    }
    outcome = publishTargetOutcome(canvas, finding, previousElement)
  } catch {
    // 定位失败不该把异常抛到 React 事件里，交给界面说明原因。
    return { status: 'unavailable', message: '定位时出错，请重新点「一键检测」后再试。' }
  }
  if (outcome.status === 'unavailable') return { status: 'unavailable', message: outcome.reason }
  locateRange(outcome.range, pinnedInset(canvas))
  highlightPublishRange(outcome.range)
  if (outcome.status === 'block') {
    return {
      status: 'block',
      message: finding.original === ''
        ? '已定位到这一块（含链接但没有可高亮的文字）。'
        : '这段文字已经改过，已定位到它所在的段落。',
    }
  }
  return { status: 'located', message: null }
}

function highlightPublishRange(range: Range) {
  const registry = globalThis.CSS?.highlights
  if (reviewHighlightTimer !== null) {
    window.clearTimeout(reviewHighlightTimer)
    reviewHighlightTimer = null
  }
  if (!registry || typeof Highlight === 'undefined') return
  const mark = new Highlight(range)
  mark.priority = 2
  registry.set(REVIEW_HIGHLIGHT, mark)
  reviewHighlightTimer = window.setTimeout(() => {
    registry.delete(REVIEW_HIGHLIGHT)
    reviewHighlightTimer = null
  }, REVIEW_HIGHLIGHT_MS)
}

/** Rebase a warning after unrelated edits only if the complete source block has a unique match. */
export function currentSourceSpan(location: CompatibilityLocation, baseline: string, current: string): SourceSpan | null {
  if (location.kind === 'image') return null
  const { span } = location
  if (span.end > baseline.length || span.start >= span.end) return null
  if (baseline === current) return span
  return null
}
