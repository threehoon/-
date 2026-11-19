// Only renderer-owned metadata uses this namespace. The editor never writes these
// boundaries back into the live DOM, so native selection and undo stay browser-owned.
export const ARTICLE_SOURCE_ATTR = 'data-uma-source-article'
export const IMAGE_SOURCE_ATTR = 'data-uma-source-image'
export const CODE_SOURCE_ATTR = 'data-uma-source-code'
export const TABLE_SOURCE_ATTR = 'data-uma-source-align'
export const DOWNGRADED_TABLE_ATTR = 'data-uma-source-table'
export const FORMAT_SOURCE_ATTR = 'data-uma-source-format'
export const TITLE_SOURCE_ATTR = 'data-uma-source-title'

const SOURCE_MARKER = /^uma-source:([se]):(\d+):(\d+):([01])$/

export interface SourceMarker {
  readonly key: string
  readonly edge: 's' | 'e'
  readonly start: number
  readonly end: number
  readonly protected: boolean
}

export function sourceMarker(edge: SourceMarker['edge'], start: number, end: number, protectedBlock: boolean): string {
  return `<!--uma-source:${edge}:${start}:${end}:${Number(protectedBlock)}-->`
}

export function readSourceMarker(node: Node): SourceMarker | null {
  if (node.nodeType !== 8) return null
  const match = SOURCE_MARKER.exec(node.nodeValue ?? '')
  if (!match) return null
  return { key: match[0], edge: match[1] === 's' ? 's' : 'e', start: Number(match[2]), end: Number(match[3]), protected: match[4] === '1' }
}

/** Strip internal mapping metadata without altering platform markup, styles or image URLs. */
export function stripArticleSourceMarkers(html: string): string {
  return html
    .replace(/<!--uma-source:[se]:\d+:\d+:[01]-->/g, '')
    .replace(/<[a-z][^<>]*>/gi, (tag) => tag.replace(/\sdata-uma-source-(?:article|image|code|align|table|format|title)="[^"]*"/gi, ''))
}

export function sourceAttribute(name: string, escapedValue: string): string {
  return ` ${name}="${escapedValue}"`
}
