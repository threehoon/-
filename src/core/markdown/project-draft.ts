import { ARTICLE_SOURCE_ATTR, readSourceMarker, type SourceMarker } from '../render/source-markers'
import { parseDocument } from './parse'
import { createEditSerializer, editableElement } from './serialize-edit'

function fragment(html: string): DocumentFragment {
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content
}

function bodyNodes(fragment: DocumentFragment): Node[] {
  return Array.from(fragment.childNodes).flatMap((node) => editableElement(node)?.hasAttribute(ARTICLE_SOURCE_ATTR)
    ? Array.from(node.childNodes) : [node])
}

interface MarkedBlock {
  readonly marker: SourceMarker
  readonly nodes: readonly Node[]
}

type Part = Node | MarkedBlock
const blockKey = ({ start, end }: SourceMarker) => `${start}:${end}`

function partsOf(content: DocumentFragment): Part[] {
  const parts: Part[] = []
  let open: { readonly marker: SourceMarker; readonly nodes: Node[] } | null = null
  for (const node of bodyNodes(content)) {
    const marker = readSourceMarker(node)
    if (!marker) {
      if (open) open.nodes.push(node)
      else parts.push(node)
      continue
    }
    if (marker.edge === 's') {
      if (open) parts.push(...open.nodes)
      open = { marker, nodes: [] }
    } else if (open && blockKey(open.marker) === blockKey(marker)) {
      parts.push(open)
      open = null
    }
  }
  if (open) parts.push(...open.nodes)
  return parts
}

/** Compare the edited body with its projection without treating template CSS as article content. */
export function canRestyleProjectedBody(currentHtml: string, projectedHtml: string, originalHtml: string, assets: Readonly<Record<string, string>>): boolean {
  const current = fragment(currentHtml)
  const projected = fragment(projectedHtml)
  const serializer = createEditSerializer(projected, assets)
  if (serializer.serialize(bodyNodes(current)) !== serializer.serialize(bodyNodes(projected))) return false

  // Font controls create explicit overrides that Markdown cannot carry. Native block
  // commands may also copy the old paragraph defaults onto a new block or image.
  const fontProperties = ['font-family', 'font-size'] as const
  const paragraphStyles = new Set(Array.from(fragment(originalHtml).querySelectorAll<HTMLElement>('p[style]'),
    (paragraph) => paragraph.style.cssText))
  const defaults = new Set<string>()
  for (const element of projected.querySelectorAll<HTMLElement>('[style]')) {
    for (const property of fontProperties) {
      defaults.add(`${element.localName}:${property}:${element.style.getPropertyValue(property)}`)
    }
  }
  for (const element of current.querySelectorAll<HTMLElement>('[style],font')) {
    if (element.hasAttribute('face') || element.hasAttribute('size')) return false
    const inheritsParagraphStyle = /^(blockquote|h[1-3])$/.test(element.localName) &&
      paragraphStyles.has(element.style.cssText)
    if (inheritsParagraphStyle) continue
    for (const property of fontProperties) {
      const value = element.style.getPropertyValue(property)
      if (!value) continue
      if (defaults.has(`${element.localName}:${property}:${value}`)) continue
      const parentStyle = element.parentElement?.closest<HTMLElement>('[style]')?.style
      if (parentStyle?.getPropertyValue(property) === value) continue
      if (element.localName === 'img' && property === 'font-size' && value === '16px') continue
      if (element.localName === 'code' && property === 'font-family' && value === 'monospace') continue
      return false
    }
  }
  return true
}

export const UNSAFE_DRAFT_PROJECTION = '当前版本里有已降级的表格、链接或其他结构，无法无损转换此处改动。请撤销这处改动，或从保留原结构的平台发起联动。'

/** Rebuild a portable body without turning unedited, platform-degraded HTML into source. */
export function projectDraftBody({ markdown, bodyOnly, originalHtml, editedHtml, assets }: {
  readonly markdown: string
  readonly bodyOnly: boolean
  readonly originalHtml: string
  readonly editedHtml: string
  readonly assets: Readonly<Record<string, string>>
}): string {
  if (bodyOnly && originalHtml === editedHtml) return markdown
  const parsed = parseDocument(markdown, bodyOnly)
  const markdownOf = ({ start, end }: { readonly start: number; readonly end: number }) => markdown.slice(start, end)
  const markdownOfNode = ({ position }: typeof parsed.root.children[number]) => {
    if (position?.start.offset === undefined || position.end.offset === undefined) return ''
    const offset = parsed.bodyOffset ?? 0
    return markdownOf({ start: position.start.offset + offset, end: position.end.offset + offset })
  }
  if (originalHtml === editedHtml) return parsed.root.children.map(markdownOfNode).filter(Boolean).join('\n\n')

  const baseline = fragment(originalHtml)
  const edited = fragment(editedHtml)
  const mapped = new Map(partsOf(baseline).flatMap((part) => 'marker' in part ? [[blockKey(part.marker), part] as const] : []))
  const parts = partsOf(edited)
  const intact = new Set(parts.flatMap((part) => 'marker' in part ? [blockKey(part.marker)] : []))
  const comments = document.createTreeWalker(edited, NodeFilter.SHOW_COMMENT)
  for (let node = comments.nextNode(); node; node = comments.nextNode()) {
    const marker = readSourceMarker(node)
    if (marker && mapped.get(blockKey(marker))?.marker.protected && !intact.has(blockKey(marker))) {
      throw new Error(UNSAFE_DRAFT_PROJECTION)
    }
  }

  const serializer = createEditSerializer(baseline, assets)
  const blocks: string[] = []
  let pending: Node[] = []
  const flush = () => {
    if (pending.length) blocks.push(serializer.serialize(pending))
    pending = []
  }
  for (const part of parts) {
    if (!('marker' in part)) {
      pending.push(part)
      continue
    }
    const original = mapped.get(blockKey(part.marker))
    if (!original || part.nodes.length === 0) {
      pending.push(...part.nodes)
      continue
    }
    // The browser may insert a new block just before the previous block's end marker.
    const match = part.nodes.findIndex((_, index) => original.nodes.every((node, offset) => node.isEqualNode(part.nodes[index + offset] ?? null)))
    if (match === -1) {
      if (original.marker.protected) throw new Error(UNSAFE_DRAFT_PROJECTION)
      pending.push(...part.nodes)
      continue
    }
    pending.push(...part.nodes.slice(0, match))
    flush()
    blocks.push(markdownOf(original.marker))
    pending.push(...part.nodes.slice(match + original.nodes.length))
  }
  flush()
  // Reference definitions are not rendered but unchanged source blocks can still depend on them.
  blocks.push(...parsed.root.children.filter(({ type }) => type === 'definition').map(markdownOfNode))
  return blocks.filter(Boolean).join('\n\n')
}
