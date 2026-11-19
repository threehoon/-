import { readSourceMarker } from '@/core/render/source-markers'
import type { CompatibilityLocation, SourceSpan } from '@/core/types'

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

export function locateRange(range: Range) {
  const canvas = range.startContainer.parentElement?.closest('.preview-canvas')
  const scroll = canvas?.closest<HTMLElement>('.preview__scroll')
  const rect = range.getClientRects()[0]
  if (rect && scroll && scroll.scrollHeight > scroll.clientHeight) {
    const viewport = scroll.getBoundingClientRect()
    scroll.scrollTop += rect.top - viewport.top - scroll.clientHeight / 2
  } else if (rect) {
    window.scrollBy(0, rect.top - window.innerHeight / 2)
  }
}

/** Rebase a warning after unrelated edits only if the complete source block has a unique match. */
export function currentSourceSpan(location: CompatibilityLocation, baseline: string, current: string): SourceSpan | null {
  if (location.kind === 'image') return null
  const { span } = location
  if (span.end > baseline.length || span.start >= span.end) return null
  if (baseline === current) return span
  const block = location.kind === 'source' ? location.block : span
  const text = baseline.slice(block.start, block.end)
  if (!text) return null
  const start = current.indexOf(text)
  if (start < 0 || start !== current.lastIndexOf(text) || baseline.indexOf(text) !== baseline.lastIndexOf(text)) return null
  const shift = start - block.start
  return { start: span.start + shift, end: span.end + shift }
}
