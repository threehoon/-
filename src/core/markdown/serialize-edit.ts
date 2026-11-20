import { compactUrl, inspectImageSource, inspectUrl } from '../security/policy'
import {
  CODE_SOURCE_ATTR, FORMAT_SOURCE_ATTR, IMAGE_SOURCE_ATTR, TABLE_SOURCE_ATTR, TITLE_SOURCE_ATTR,
} from '../render/source-markers'

const BLOCKS = new Set(['p', 'div', 'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'pre', 'hr', 'table'])
const INLINE = new Set(['a', 'b', 'strong', 'i', 'em', 's', 'strike', 'del', 'u', 'mark', 'span', 'font', 'code', 'br', 'img'])
const LOCAL_URL = /^(?:data|blob):/i
const INDENT_LIMIT = 40

export function editableElement(node: Node): HTMLElement | null {
  return node.nodeType === 1 && (node as Element).namespaceURI === 'http://www.w3.org/1999/xhtml'
    ? node as HTMLElement : null
}

export function inlineFormats(element: HTMLElement): ReadonlySet<string> {
  const tag = element.localName
  const weight = element.style.fontWeight
  const italic = element.style.fontStyle
  const decoration = `${element.style.textDecorationLine} ${element.style.textDecoration}`
  // Block-level styles often come from the platform theme (e.g. h2 is already bold).
  const inline = INLINE.has(tag)
  const formats = new Set<string>()
  if (tag === 'b' || tag === 'strong' || (inline && (weight === 'bold' || Number(weight) >= 600))) formats.add('strong')
  if (tag === 'i' || tag === 'em' || (inline && /^(italic|oblique)$/.test(italic))) formats.add('emphasis')
  if (tag === 's' || tag === 'strike' || tag === 'del' || (inline && decoration.includes('line-through'))) formats.add('delete')
  return formats
}

function text(value: string): string {
  return value.replace(/\u00a0/g, ' ')
    .replace(/([\\`*_~[\]<>])/g, '\\$1')
    .replace(/&(?=(?:#[\da-fxX]+|[a-z]{2,32});)/gi, '&amp;')
    .replace(/([+=])(?=\1)/g, '\\$1')
}

function escapeBlockPrefix(value: string): string {
  return value.replace(/^( {0,3})(?:(#{1,6}|[-+])(?=\s|$)|(\d{1,9})([.)])(?=\s)|([-\s]+|[=\s]+)(?=\n|$))/gm,
    (_, indent: string, symbol?: string, number?: string, punctuation?: string, rule?: string) => {
      if (symbol) return `${indent}\\${symbol}`
      if (number && punctuation) return `${indent}${number}\\${punctuation}`
      return indent + (rule ?? '').replace(/[-=]/, '\\$&')
    })
}

function wrap(value: string, delimiter: string): string {
  if (value === '') return ''
  const boundary = /^(\s*)([\s\S]*?)(\s*)$/.exec(value)
  if (!boundary?.[2]) return value
  const [, before, content, after] = boundary
  return `${before}${delimiter}${content}${delimiter}${after}`
}

function delimiters(element: HTMLElement, preserve: boolean): string[] {
  const formats = inlineFormats(element)
  const markers: string[] = []
  if (formats.has('delete')) markers.push('~~')
  if (formats.has('emphasis')) markers.push('*')
  if (formats.has('strong')) markers.push('**')
  const sourceFormat = element.getAttribute(FORMAT_SOURCE_ATTR)
  if (preserve && (sourceFormat === 'underline' || element.localName === 'u' || element.style.textDecoration.includes('underline'))) markers.push('++')
  if (preserve && (sourceFormat === 'highlight' || element.localName === 'mark' || (element.localName === 'span' && element.style.backgroundColor !== ''))) markers.push('==')
  return markers
}

function inlineRunMarkers(node: Node, preserve: boolean): string[] {
  const element = editableElement(node)
  return element && INLINE.has(element.localName) && !element.matches('a,code,br,img') ? delimiters(element, preserve) : []
}

function fenceFor(value: string, minimum: number, marker: '`' | '~' = '`'): string {
  let length = minimum
  for (const match of value.matchAll(marker === '`' ? /`+/g : /~+/g)) length = Math.max(length, match[0].length + 1)
  return marker.repeat(length)
}

function destination(url: string, title: string | null): string {
  if (/[\r\n]/.test(url)) throw new Error('地址包含换行，请在左侧编辑该地址。')
  const escaped = url.replace(/[\\<>]/g, '\\$&').replace(/&(?=(?:#[\da-fxX]+|[a-z]{2,32});)/gi, '&amp;')
  const address = /[\s()<>]/.test(url) ? `<${escaped}>` : escaped
  return title && !/[\r\n]/.test(title) ? `${address} "${title.replace(/[\\"]/g, '\\$&')}"` : address
}

function codeText(element: HTMLElement): string {
  const flatten = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent ?? ''
    const child = editableElement(node)
    if (!child) return ''
    if (child.localName === 'br') return '\n'
    const content = Array.from(child.childNodes, flatten).join('')
    return child.localName === 'div' && child.previousSibling ? `\n${content}` : content
  }
  return Array.from(element.childNodes, flatten).join('')
}

export interface EditSerializer {
  readonly project: (nodes: readonly Node[]) => string
  readonly serialize: (nodes: readonly Node[]) => string
}

export function isLinkedInlineImage(src: string): boolean {
  return /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+=*$/i.test(src)
}

/** Serialize edited ranges; unchanged Markdown is recovered separately from its source markers. */
export function createEditSerializer(baseline: DocumentFragment, assets: Readonly<Record<string, string>>): EditSerializer {
  const boundPaths = new Map(Object.entries(assets)
    .filter(([path]) => path !== '' && !/^[\p{L}\d+.-]+:|^\/\//u.test(compactUrl(path)))
    .map(([path, url]) => [url, path]))
  const originalImages = new Map(Array.from(baseline.querySelectorAll(`img[${IMAGE_SOURCE_ATTR}]`), (image) => [
    image.getAttribute(IMAGE_SOURCE_ATTR), image.getAttribute('src'),
  ]))

  function imageMarkdown(element: HTMLElement): string {
    const src = element.getAttribute('src') ?? ''
    const original = element.getAttribute(IMAGE_SOURCE_ATTR)
    let path: string
    if (original && originalImages.get(original) === src && !LOCAL_URL.test(compactUrl(original))) {
      path = original
    } else if (isLinkedInlineImage(src)) {
      path = src
    } else if (LOCAL_URL.test(compactUrl(src))) {
      const bound = boundPaths.get(src)
      if (!bound) throw new Error('有图片未与本地路径配对，请重新插入图片或撤销该修改。')
      path = bound
    } else {
      const verdict = inspectImageSource(src)
      if (!verdict.allowed || !/^https?:/i.test(compactUrl(src))) throw new Error('有图片的外链地址不可用，请在左侧编辑或撤销该修改。')
      path = verdict.url
    }
    return `![${text(element.getAttribute('alt') ?? '').replace(/\r?\n/g, ' ')}](${destination(path, element.getAttribute(TITLE_SOURCE_ATTR))})`
  }

  function render(nodes: readonly Node[], preserveSourceFormats: boolean, depth = 0): string {
    if (depth > INDENT_LIMIT) throw new Error('修改的正文结构嵌套太深，请在左侧编辑。')
    const blocks: string[] = []
    let inline: Node[] = []
    const flush = () => {
      const paragraph = renderInlineRun(inline, preserveSourceFormats, depth + 1).trim()
      if (paragraph) blocks.push(escapeBlockPrefix(paragraph))
      inline = []
    }
    for (const node of nodes) {
      const element = editableElement(node)
      if (element && BLOCKS.has(element.localName)) {
        flush()
        const block = renderBlock(element, preserveSourceFormats, depth + 1)
        if (block) blocks.push(block)
      } else {
        inline.push(node)
      }
    }
    flush()
    return blocks.join('\n\n')
  }

  function renderInlineRun(nodes: readonly Node[], preserve: boolean, depth: number): string {
    if (depth > INDENT_LIMIT && nodes.length > 0) throw new Error('修改的正文结构嵌套太深，请在左侧编辑。')
    let result = ''
    for (let index = 0; index < nodes.length; ) {
      const node = nodes[index]
      const markers = inlineRunMarkers(node, preserve)
      let next = index + 1
      if (markers.length) {
        const key = markers.join(',')
        while (next < nodes.length && inlineRunMarkers(nodes[next], preserve).join(',') === key) next += 1
      }
      if (next === index + 1) result += renderInline(node, preserve, depth)
      else {
        // Browser formatting often emits siblings like <strong>甲</strong><b>乙</b>.
        // One delimiter pair avoids a literal run of adjacent Markdown markers.
        const children = nodes.slice(index, next).flatMap((part) => Array.from(part.childNodes))
        result += markers.reduce(wrap, renderInlineRun(children, preserve, depth + 1))
      }
      index = next
    }
    return result
  }

  function renderInline(node: Node, preserve: boolean, depth: number): string {
    if (depth > INDENT_LIMIT) throw new Error('修改的正文结构嵌套太深，请在左侧编辑。')
    if (node.nodeType === 3) return text(node.nodeValue ?? '')
    const element = editableElement(node)
    if (!element) {
      if (node.nodeType === 8) return ''
      throw new Error('有 Markdown 无法表示的正文元素，请在左侧编辑或撤销该修改。')
    }
    const tag = element.localName
    if (!INLINE.has(tag)) throw new Error('有 Markdown 无法表示的正文元素，请在左侧编辑或撤销该修改。')
    if (tag === 'img') return imageMarkdown(element)
    if (tag === 'br') return '  \n'
    if (tag === 'code') {
      const value = codeText(element).replace(/\r?\n/g, ' ')
      if (!value) return ''
      const fence = fenceFor(value, 1)
      const padding = /^`|`$|^ .* $/.test(value) && /\S/.test(value) ? ' ' : ''
      return `${fence}${padding}${value}${padding}${fence}`
    }
    const value = delimiters(element, preserve).reduce(wrap, renderInlineRun(Array.from(element.childNodes), preserve, depth + 1))
    if (tag !== 'a' || !value.trim()) return value
    const verdict = inspectUrl(element.getAttribute('href') ?? '')
    if (!verdict.allowed) throw new Error('有链接地址不可用，请在左侧编辑或撤销该修改。')
    return `[${value}](${destination(verdict.url, element.getAttribute(TITLE_SOURCE_ATTR))})`
  }

  function renderList(element: HTMLElement, preserve: boolean, depth: number): string {
    const items = Array.from(element.children)
    if (items.some((item) => !item.matches('li'))) throw new Error('列表结构已变化，请在左侧编辑这一处列表。')
    const ordered = element.localName === 'ol'
    const rawStart = element.getAttribute('start') ?? '1'
    const start = /^\d{1,9}$/.test(rawStart) ? Number(rawStart) : 1
    return items.map((item, index) => {
      const marker = ordered ? `${start + index}. ` : '- '
      const children = Array.from(item.childNodes)
      const nested = children.findIndex((node) => editableElement(node)?.matches('ol,ul'))
      const direct = render(nested < 0 ? children : children.slice(0, nested), preserve, depth)
        .replace(/^\\\[([xX ])\\\](?=\s)/, '[$1]')
      const rest = nested < 0 ? '' : render(children.slice(nested), preserve, depth)
      const content = [direct, rest].filter(Boolean).join('\n')
      const [first = '', ...lines] = content.split('\n')
      return marker + first + (lines.length > 0 ? `\n${lines.map((line) => line ? ' '.repeat(marker.length) + line : '').join('\n')}` : '')
    }).join('\n')
  }

  function renderTable(element: HTMLTableElement, preserve: boolean, depth: number): string {
    const [header, ...rows] = Array.from(element.rows)
    if (!header) return ''
    const width = header.cells.length
    if (width === 0 || element.caption || [header, ...rows].some((row) => row.cells.length !== width
      || Array.from(row.cells).some((cell) => cell.rowSpan !== 1 || cell.colSpan !== 1))) {
      throw new Error('表格有合并或不齐的单元格，请在左侧编辑这一处表格。')
    }
    const alignments = element.getAttribute(TABLE_SOURCE_ATTR)?.split(',') ?? []
    const line = (row: HTMLTableRowElement) => `| ${Array.from(row.cells, (cell) => {
      const value = render(Array.from(cell.childNodes), preserve, depth)
      if (value.includes('\n')) throw new Error('表格单元格包含多行，请在左侧编辑这一处表格。')
      return value.replace(/\|/g, '\\|')
    }).join(' | ')} |`
    const separator = Array.from({ length: width }, (_, i) => ({ left: ':---', right: '---:', center: ':---:' })[alignments[i] as 'left' | 'right' | 'center'] ?? '---')
    return [line(header), `| ${separator.join(' | ')} |`, ...rows.map(line)].join('\n')
  }

  function renderBlock(element: HTMLElement, preserve: boolean, depth: number): string {
    const tag = element.localName
    // `---` at the start of the source can be interpreted as YAML on retypeset.
    if (tag === 'hr') return '***'
    if (tag === 'ul' || tag === 'ol') return renderList(element, preserve, depth)
    if (tag === 'table' && element instanceof HTMLTableElement) return renderTable(element, preserve, depth)
    if (tag === 'pre') {
      const value = codeText(element)
      const info = element.getAttribute(CODE_SOURCE_ATTR) ?? ''
      const fence = fenceFor(value, 3, info.includes('`') ? '~' : '`')
      return `${fence}${info}\n${value}${value ? '\n' : ''}${fence}`
    }
    const content = render(Array.from(element.childNodes), preserve, depth)
    if (!content) return ''
    if (tag === 'blockquote') return content.split('\n').map((line) => line ? `> ${line}` : '>').join('\n')
    if (/^h[1-6]$/.test(tag)) {
      if (element.querySelector('br')) {
        throw new Error('Markdown 小标题无法保留手动换行。换行已保留在成稿，请撤销后再切换模板。')
      }
      return `${'#'.repeat(Number(tag[1]))} ${content.replace(/\s*\n\s*/g, ' ')}`
    }
    return content
  }

  return {
    project: (nodes) => render(nodes, false),
    serialize: (nodes) => render(nodes, true),
  }
}
