import { parseDocument } from '@/core/markdown/parse'
import { createEditSerializer, editableElement, inlineFormats, type EditSerializer } from '@/core/markdown/serialize-edit'
import { ARTICLE_SOURCE_ATTR, FORMAT_SOURCE_ATTR, readSourceMarker, type SourceMarker } from '@/core/render/source-markers'

export interface ArticleSourceSyncInput {
  /** The immutable source and rendered output from the same successful typeset. */
  readonly baselineMarkdown: string
  readonly baselineHtml: string
  readonly html: string
  readonly boundAssets: Readonly<Record<string, string>>
}

export interface ArticleSourceSyncResult {
  /** Null means boundaries could not be verified: keep the last correct source. */
  readonly markdown: string | null
  /** A recoverable issue may coexist with safe patches to independent blocks. */
  readonly issue: string | null
  readonly platformStyle: boolean
}

interface SourceBlock {
  readonly start: SourceMarker
  readonly end: SourceMarker
  readonly nodes: readonly Node[]
}

interface Patch {
  readonly start: number
  readonly end: number
  readonly value: string
}

const UNMAPPED = '无法确认修改对应的原稿范围，请在左侧编辑，或撤销这一处右侧修改。'
const NATIVE_BLOCK_WRAPPER = /^(?:p|div|h[1-6]|blockquote|ul|ol|li)$/
const EXTRACTED_TITLE = '这一处一级标题重新排版时会被用作文章标题，无法保留在正文。请改为二级标题，或在左侧编辑。'
const PROTECTED = '这一处正文包含平台已简化或无法还原的内容。请在左侧修改原块，或撤销这一处右侧修改。'

function readHtml(html: string): DocumentFragment {
  // A template parses inert DOM: no resource requests, script execution or live editor changes.
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content
}

function articleNodes(fragment: DocumentFragment): readonly Node[] {
  return Array.from(fragment.childNodes).flatMap((node) => editableElement(node)?.hasAttribute(ARTICLE_SOURCE_ATTR)
    ? Array.from(node.childNodes) : [node])
}

function readBaseline(nodes: readonly Node[], sourceLength: number): readonly SourceBlock[] | null {
  const blocks: SourceBlock[] = []
  let start: SourceMarker | null = null
  let contents: Node[] = []
  let endOffset = 0
  for (const node of nodes) {
    const marker = readSourceMarker(node)
    if (!marker) {
      if (start) contents.push(node)
      else if (node.nodeType !== 3 || node.nodeValue?.trim()) return null
    } else if (marker.edge === 's') {
      if (start || marker.start < endOffset || marker.start >= marker.end || marker.end > sourceLength) return null
      start = marker
      contents = []
    } else {
      if (!start || start.start !== marker.start || start.end !== marker.end || start.protected !== marker.protected) return null
      blocks.push({ start, end: marker, nodes: contents })
      endOffset = marker.end
      start = null
    }
  }
  return start || blocks.length === 0 ? null : blocks
}

function sameNodes(before: readonly Node[], after: readonly Node[]): boolean {
  return before.length === after.length && before.every((node, index) => node.isEqualNode(after[index]))
}

function sameProjection(before: readonly Node[], after: readonly Node[], serializer: EditSerializer): boolean {
  if (sameNodes(before, after)) return true
  try {
    return serializer.project(before) === serializer.project(after)
  } catch {
    return false
  }
}

function styleValues(element: HTMLElement): readonly string[] {
  const formats = inlineFormats(element)
  return Array.from(element.style).flatMap((property) => {
    const value = element.style.getPropertyValue(property)
    if (property === 'font-weight' && formats.has('strong')) return []
    if (property === 'font-style' && formats.has('emphasis')) return []
    if (/^text-decoration(?:-line)?$/.test(property) && value === 'line-through' && formats.has('delete')) return []
    if (element.localName === 'code' && property === 'font-family' && value === 'monospace') return []
    if (element.localName === 'img' && ['max-width:100%', 'height:auto', 'vertical-align:middle'].includes(`${property}:${value}`)) return []
    return [`${property}:${value}:${element.style.getPropertyPriority(property)}`]
  })
}

function localStyles(baseline: DocumentFragment, edited: DocumentFragment): boolean {
  const theme = new Map<string, Set<string>>()
  const nativeBlockStyles = new Set<string>()
  for (const node of baseline.querySelectorAll('[style]')) {
    const element = editableElement(node)
    if (!element) continue
    const declarations = theme.get(element.localName) ?? new Set<string>()
    const values = styleValues(element)
    for (const value of values) declarations.add(value)
    if (NATIVE_BLOCK_WRAPPER.test(element.localName)) nativeBlockStyles.add([...values].sort().join(';'))
    theme.set(element.localName, declarations)
  }
  for (const node of edited.querySelectorAll('[style],u,mark,font,[class],[align]')) {
    const element = editableElement(node)
    if (!element) continue
    const { localName: tag } = element
    if ((tag === 'u' || tag === 'mark') && !element.hasAttribute(FORMAT_SOURCE_ATTR)) return true
    if (tag === 'font' || element.hasAttribute('class') || element.hasAttribute('align')) return true
    const values = styleValues(element)
    // Chrome formatBlock copies the previous paragraph's complete default style.
    if (NATIVE_BLOCK_WRAPPER.test(tag) && nativeBlockStyles.has([...values].sort().join(';'))) continue
    if (values.some((value) => !theme.get(tag)?.has(value))) return true
  }
  return false
}

function sourceFormats(nodes: readonly Node[]): string {
  return nodes.flatMap((node) => {
    const element = editableElement(node)
    if (!element) return []
    return [element, ...element.querySelectorAll(`[${FORMAT_SOURCE_ATTR}]`)].flatMap((child) => {
      const value = child.getAttribute(FORMAT_SOURCE_ATTR)
      return value ? [value] : []
    })
  }).join(',')
}

function separatorNeeded(gap: string, newline: string): string {
  const lineBreaks = gap.trim() === '' ? (gap.match(/\r\n|\n|\r/g)?.length ?? 0) : 0
  return newline.repeat(Math.max(0, 2 - lineBreaks))
}

function insertion(source: string, next: SourceBlock | undefined, prev: SourceBlock | undefined, value: string, newline: string): Patch {
  if (prev) {
    const offset = prev.end.end
    const gap = source.slice(offset, next?.start.start ?? source.length).match(/^[\t \r\n]*/)?.[0] ?? ''
    const suffix = offset === source.length ? '' : separatorNeeded(gap, newline)
    return { start: offset, end: offset, value: newline + newline + value + suffix }
  }
  const until = source.slice(0, next?.start.start ?? source.length)
  // Insert before the next block's existing indentation, without moving or replacing it.
  const before = until.replace(/[\t ]+$/, '')
  const gap = before.match(/[\t \r\n]*$/)?.[0] ?? ''
  const prefix = before === '' || before === '\uFEFF' ? '' : separatorNeeded(gap, newline)
  return { start: before.length, end: before.length, value: prefix + value + newline + newline }
}

function separatedReplacement(source: string, start: number, end: number, value: string, newline: string): Patch {
  if (value === '') return { start, end, value }
  const before = source.slice(0, start)
  const after = source.slice(end)
  const leadingGap = before.match(/[\t \r\n]*$/)?.[0] ?? ''
  const trailingGap = after.match(/^[\t \r\n]*/)?.[0] ?? ''
  const prefix = before.replace(/^\uFEFF/, '').trim() ? separatorNeeded(leadingGap, newline) : ''
  const suffix = after.trim() ? separatorNeeded(trailingGap, newline) : ''
  return { start, end, value: prefix + value + suffix }
}

function applyPatches(source: string, patches: readonly Patch[]): string {
  let position = 0
  let value = ''
  for (const patch of patches) {
    value += source.slice(position, patch.start) + patch.value
    position = patch.end
  }
  return value + source.slice(position)
}

function unchangedPrefix(
  block: SourceBlock, nodes: readonly Node[], serializer: EditSerializer, reverse = false,
): number {
  const length = block.nodes.length
  if (length === 0 || nodes.length < length) return 0
  return sameProjection(block.nodes, reverse ? nodes.slice(-length) : nodes.slice(0, length), serializer) ? length : 0
}

/** Replay the edited snapshot from the immutable baseline, touching only verified source ranges. */
export function syncArticleSource(input: ArticleSourceSyncInput): ArticleSourceSyncResult {
  const { baselineMarkdown, baselineHtml, html, boundAssets } = input
  if (html === baselineHtml) return { markdown: baselineMarkdown, issue: null, platformStyle: false }
  const baseline = readHtml(baselineHtml)
  const edited = readHtml(html)
  if (baseline.isEqualNode(edited)) return { markdown: baselineMarkdown, issue: null, platformStyle: false }

  const blocks = readBaseline(articleNodes(baseline), baselineMarkdown.length)
  let platformStyle = localStyles(baseline, edited)
  let issue: string | null = null
  const fail = (): ArticleSourceSyncResult => ({ markdown: null, issue: issue ?? UNMAPPED, platformStyle })
  if (!blocks) return fail()
  const sourceBlocks = blocks
  const boundaryIds = new Map(blocks.flatMap(({ start, end }, index) => [[start.key, index * 2], [end.key, index * 2 + 1]]))
  const serializer = createEditSerializer(baseline, boundAssets)
  const patches: Patch[] = []
  const newline = baselineMarkdown.match(/\r\n|\n|\r/)?.[0] ?? '\n'

  function processWindow(left: number, right: number, nodes: readonly Node[]): boolean {
    let first = Math.floor((left + 1) / 2)
    let end = Math.floor((right + 1) / 2)
    const old = sourceBlocks.slice(first, end).flatMap((block) => block.nodes)
    if (sameProjection(old, nodes, serializer)) {
      platformStyle ||= sourceFormats(old) !== sourceFormats(nodes)
      return true
    }

    // Cross-block browser edits can remove or nest markers. Reuse intact edge blocks;
    // the remaining window may be replaced only when it has no invisible source gap.
    let changed = nodes
    if (first + 1 < end) {
      while (first < end) {
        const block = sourceBlocks[first]
        const count = block ? unchangedPrefix(block, changed, serializer) : 0
        if (!count) break
        first += 1
        changed = changed.slice(count)
      }
      while (first < end) {
        const block = sourceBlocks[end - 1]
        const count = block ? unchangedPrefix(block, changed, serializer, true) : 0
        if (!count) break
        end -= 1
        changed = changed.slice(0, -count)
      }
    }
    const affected = sourceBlocks.slice(first, end)
    if (affected.some((block) => block.start.protected)) {
      issue ??= PROTECTED
      // A spanning list command may move a whole rendered block into its neighbor
      // and leave both original markers together, so an emptied protected block
      // cannot be treated as an independent edit to its contents.
      return affected.length === 1 && left % 2 === 0 && right === left + 1
        && changed.some((node) => node.textContent?.trim() || editableElement(node)?.matches('img,hr'))
    }
    if (affected.some((block, i) => i > 0 && baselineMarkdown.slice(affected[i - 1].end.end, block.start.start).trim() !== '')) return false

    let replacement: string
    try {
      replacement = serializer.serialize(changed).replace(/\r\n|\n|\r/g, newline)
    } catch (error) {
      issue ??= error instanceof Error ? error.message : UNMAPPED
      // This was recoverable on the previous input; replaying baseline here could
      // silently revert that previously synced version of the same block.
      return false
    }
    if (affected.length === 0) {
      if (replacement) patches.push(insertion(baselineMarkdown, sourceBlocks[first], sourceBlocks[first - 1], replacement, newline))
    } else {
      patches.push(separatedReplacement(baselineMarkdown, affected[0].start.start, affected[affected.length - 1].end.end, replacement, newline))
    }
    return true
  }

  let left = -1
  let window: Node[] = []
  for (const node of articleNodes(edited)) {
    const marker = readSourceMarker(node)
    if (!marker) {
      window.push(node)
      continue
    }
    const right = boundaryIds.get(marker.key)
    if (right === undefined || right <= left || !processWindow(left, right, window)) return fail()
    left = right
    window = []
  }
  if (!processWindow(left, blocks.length * 2, window)) return fail()
  const ordered = patches.sort((a, b) => a.start - b.start || a.end - b.end)
  if (ordered.some((patch, index) => index > 0 && patch.start < ordered[index - 1].end)) return fail()
  const markdown = applyPatches(baselineMarkdown, ordered)
  if (ordered.length > 0 && ordered[0].start <= blocks[0].start.start
    && /^ {0,3}(?:#(?=\s|$)|=+[ \t]*$)/m.test(markdown)
    && parseDocument(baselineMarkdown).leadingTitleOffset === undefined
    && parseDocument(markdown).leadingTitleOffset !== undefined) {
    return { markdown: null, issue: EXTRACTED_TITLE, platformStyle }
  }
  return { markdown, issue, platformStyle }
}
