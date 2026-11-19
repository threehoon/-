import { toString as mdastToString } from 'mdast-util-to-string'
import type {
  Blockquote,
  Code,
  FootnoteDefinition,
  FootnoteReference,
  Heading,
  Html,
  Image,
  ImageReference,
  InlineCode,
  Link,
  LinkReference,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from 'mdast'
import type {
  AssetRegistry,
  CompatWarning,
  CompatibilityLocation,
  PlatformCapabilities,
  ResolvedAsset,
  SourceSpan,
  WarningKind,
  WarningSeverity,
} from '../types'
import { collectDefinitions } from '../markdown/definitions'
import { inspectUrl } from '../security/policy'
import { escapeHtml, styleAttribute, truncateExcerpt } from './html'
import type { RenderTheme } from './theme'
import {
  CODE_SOURCE_ATTR, FORMAT_SOURCE_ATTR, IMAGE_SOURCE_ATTR, TABLE_SOURCE_ATTR, TITLE_SOURCE_ATTR,
  sourceAttribute, sourceMarker,
} from './source-markers'

/**
 * mdast 块级/行内渲染器。
 *
 * 规则由 PlatformCapabilities 驱动，任何平台适配器都不需要在这里出现名字分支。
 * 每一次「降级」都会产出一条 CompatWarning：message 写现象、action 写用户能做什么、excerpt 写原文片段。
 * 输出 HTML 全部经过 escapeHtml 拼装，原始 HTML 只以纯文本出现。
 */

export interface RenderBlocksInput {
  readonly root: Root
  readonly theme: RenderTheme
  readonly capabilities: PlatformCapabilities
  readonly assets: AssetRegistry
  readonly sourceOffset?: number
}

export interface RenderBlocksOutput {
  readonly html: string
  readonly plainText: string
  readonly warnings: readonly CompatWarning[]
}

interface Piece {
  readonly html: string
  readonly text: string
}

const EMPTY_PIECE: Piece = { html: '', text: '' }

function isImageNode(node: RootContent): node is Image | ImageReference {
  return node.type === 'image' || node.type === 'imageReference'
}

class BlockRenderer {
  private readonly root: Root
  private readonly theme: RenderTheme
  private readonly capabilities: PlatformCapabilities
  private readonly assets: AssetRegistry
  private readonly definitions: ReturnType<typeof collectDefinitions>
  private readonly warnings: CompatWarning[] = []
  private readonly inlineCodeExcerpts: string[] = []
  private readonly rawHtmlExcerpts: string[] = []
  private readonly inlineCodeLocations: CompatibilityLocation[] = []
  private readonly rawHtmlLocations: CompatibilityLocation[] = []
  private warningSeq = 0
  private readonly sourceOffset: number | undefined
  private hasUnmappedContent = false

  constructor(input: RenderBlocksInput) {
    this.sourceOffset = input.sourceOffset
    this.root = input.root
    this.theme = input.theme
    this.capabilities = input.capabilities
    this.assets = input.assets
    this.definitions = collectDefinitions(input.root)
  }

  render(): RenderBlocksOutput {
    const pieces = this.root.children.map((node) => this.renderSourceBlock(node))

    // 两类噪声大但要留痕的降级合并成一条：出现次数放在 message，首个片段放在 excerpt。
    if (this.inlineCodeExcerpts.length > 0) {
      this.warn(
        'code',
        'info',
        `${this.inlineCodeExcerpts.length} 处行内代码已去掉底色，只保留等宽文字。`,
        '如需底色，请在平台编辑器里手动给这段文字设置行内代码样式，文字内容无需改动。',
        this.inlineCodeExcerpts[0] ?? '',
        this.inlineCodeLocations,
      )
    }
    if (this.rawHtmlExcerpts.length > 0) {
      this.warn(
        'raw-html',
        'attention',
        `${this.rawHtmlExcerpts.length} 处原始 HTML 已按纯文本输出，不会作为页面元素执行。`,
        '如确需该效果，请在平台编辑器里手动设置；也可以把 HTML 改写成 Markdown 再排版。',
        this.rawHtmlExcerpts[0] ?? '',
        this.rawHtmlLocations,
      )
    }

    return {
      html: pieces.map((piece) => piece.html).join(''),
      plainText: pieces
        .map((piece) => piece.text)
        .filter((text) => text.trim().length > 0)
        .join('\n\n'),
      warnings: [...this.warnings],
    }
  }

  // ---------------------------------------------------------------- 基础设施

  private warn(
    kind: WarningKind,
    severity: WarningSeverity,
    message: string,
    action: string,
    excerpt: string,
    locations?: readonly CompatibilityLocation[],
  ): void {
    this.warningSeq += 1
    this.warnings.push({
      id: `${kind}-${this.warningSeq}`,
      kind,
      severity,
      message,
      action,
      excerpt: excerpt.trim().length > 0 ? excerpt : '（原文片段为空）',
      ...(locations?.length ? { locations } : {}),
    })
  }

  private resolveAsset(source: string): ResolvedAsset {
    try {
      return this.assets.resolve(source)
    } catch {
      return { kind: 'blocked', reason: '素材登记表读取失败' }
    }
  }

  // ---------------------------------------------------------------- 块级

  private metadata(name: string, value: string): string {
    return this.sourceOffset === undefined ? '' : sourceAttribute(name, escapeHtml(value))
  }

  private sourceSpan(node: Pick<RootContent, 'position'>): SourceSpan | null {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (this.sourceOffset === undefined || start === undefined || end === undefined) return null
    return { start: start + this.sourceOffset, end: end + this.sourceOffset }
  }

  private sourceOnly(node: Link | LinkReference): readonly CompatibilityLocation[] | undefined {
    const span = this.sourceSpan(node)
    // The containing block is assigned after rendering, alongside other warning locations.
    return span ? [{ kind: 'source', span, block: span }] : undefined
  }

  private renderSourceBlock(node: RootContent): Piece {
    this.hasUnmappedContent = false
    const warningsBefore = this.warnings.length
    const inlineCodeBefore = this.inlineCodeExcerpts.length
    const rawHtmlBefore = this.rawHtmlExcerpts.length
    const piece = node.type === 'paragraph'
      ? this.renderParagraph(node, this.theme.paragraph, this.theme.standaloneStrong)
      : this.renderBlockNode(node)
    const span = this.sourceSpan(node)
    if (!span) return piece
    const block: CompatibilityLocation = { kind: 'block', span }
    for (let index = warningsBefore; index < this.warnings.length; index += 1) {
      const warning = this.warnings[index]
      const locations = warning.locations?.map((location) => location.kind === 'source' ? { ...location, block: span } : location)
        ?? (piece.html === '' ? [{ kind: 'source', span, block: span } as const] : [block])
      this.warnings[index] = { ...warning, locations }
    }
    if (piece.html === '') return piece
    if (inlineCodeBefore !== this.inlineCodeExcerpts.length) this.inlineCodeLocations.push(block)
    if (rawHtmlBefore !== this.rawHtmlExcerpts.length) this.rawHtmlLocations.push(block)
    // A warning emitted while rendering this subtree means the conversion lost source
    // semantics. The aggregated inline-code style warning is deliberately not included.
    const protect = this.hasUnmappedContent || warningsBefore !== this.warnings.length
    const { start: from, end: to } = span
    return { ...piece, html: `${sourceMarker('s', from, to, protect)}${piece.html}${sourceMarker('e', from, to, protect)}` }
  }

  private renderBlockNodes(nodes: readonly RootContent[]): readonly Piece[] {
    return nodes.map((node) => this.renderBlockNode(node))
  }

  private renderBlockNode(node: RootContent): Piece {
    switch (node.type) {
      case 'paragraph':
        return this.renderParagraph(node)
      case 'heading':
        return this.renderHeading(node)
      case 'code':
        return this.renderCode(node)
      case 'blockquote':
        return this.renderBlockquote(node)
      case 'list':
        return this.renderList(node)
      case 'listItem':
        return this.renderLooseListItem(node)
      case 'table':
        return this.renderTable(node)
      case 'thematicBreak':
        return { html: `<hr${styleAttribute(this.theme.thematicBreak)} />`, text: '' }
      case 'html':
        return this.renderRawHtmlBlock(node)
      case 'definition':
      case 'yaml':
        return EMPTY_PIECE
      case 'footnoteDefinition':
        return this.renderFootnoteDefinition(node)
      case 'image':
      case 'imageReference':
        return this.renderImageOnly(node)
      default:
        return this.renderUnknownBlock(node)
    }
  }

  /** 极少见的「块位置出现行内节点」：退化成段落，不丢文字。 */
  private renderUnknownBlock(node: RootContent): Piece {
    this.hasUnmappedContent = true
    const text = mdastToString(node)
    if (text.trim().length === 0) {
      return EMPTY_PIECE
    }
    return {
      html: `<p${styleAttribute(this.theme.paragraph)}>${escapeHtml(text)}</p>`,
      text,
    }
  }

  private renderParagraph(node: Paragraph, style = this.theme.paragraph, standaloneStrong?: string): Piece {
    const onlyChild = node.children.length === 1 ? node.children[0] : undefined
    // 独占一段的图片不套 <p>，避免 <p><img/></p> 在平台编辑器里产生额外行距。
    if (onlyChild !== undefined && isImageNode(onlyChild)) {
      return this.renderImageOnly(onlyChild)
    }
    const inline = standaloneStrong && onlyChild?.type === 'strong' && onlyChild.children.every((child) => child.type === 'text')
      ? this.wrapInline(onlyChild.children, 'strong', standaloneStrong)
      : this.renderInline(node.children)
    if (inline.html.trim() === '') return EMPTY_PIECE
    return {
      html: `<p${styleAttribute(style)}>${inline.html}</p>`,
      text: inline.text,
    }
  }

  private renderImageOnly(node: Image | ImageReference): Piece {
    if (node.type === 'image') {
      return this.renderImage(node.url, node.alt ?? '', node.title)
    }
    const definition = this.definitions.get(node.identifier)
    if (definition) {
      return this.renderImage(definition.url, node.alt ?? '', definition.title)
    }
    const label = node.alt ?? node.label ?? node.identifier
    this.warn(
      'image',
      'blocker',
      '引用式图片没有找到对应的图片定义，已在原位置插入补插标记。',
      '请在源稿补上定义行，例如 `[图注]: https://example.com/a.png`，或直接选中本地图片重新配对。',
      `![${label}][${node.identifier}]`,
    )
    return this.imageMarker(`［图片补插位：${label}］`)
  }

  private renderHeading(node: Heading): Piece {
    const inline = this.renderInline(node.children)
    const max = this.capabilities.maxHeadingLevel
    if (node.depth > max) {
      this.warn(
        'heading',
        'info',
        `H${node.depth} 超出该平台可信赖的标题层级（最高 H${max}），已转为加粗小标题。`,
        `如需保留层级，请在平台编辑器里把它手动设为小标题；文字与顺序不会变。`,
        truncateExcerpt(inline.text),
      )
      return {
        html: `<p${styleAttribute(this.theme.heading(node.depth, true))}><strong>${inline.html}</strong></p>`,
        text: inline.text,
      }
    }
    const hasInlineFormatting = node.children.some((child) => child.type !== 'text' && child.type !== 'break')
    return {
      html: `<h${node.depth}${styleAttribute(this.theme.heading(node.depth, false, hasInlineFormatting))}>${inline.html}</h${node.depth}>`,
      text: inline.text,
    }
  }

  private renderCode(node: Code): Piece {
    if (this.capabilities.codeBlocks === 'keep') {
      return {
        html: `<pre${styleAttribute(this.theme.codeBlock)}${this.metadata(CODE_SOURCE_ATTR, [node.lang, node.meta].filter(Boolean).join(' '))}><code>${escapeHtml(node.value)}</code></pre>`,
        text: node.value,
      }
    }
    this.warn(
      'code',
      'attention',
      '代码块已转为保留换行的等宽文本块，语法高亮和底色不再保留。',
      '如需代码边框或高亮，请在平台编辑器里手动设置；代码内容与换行已经原样保留。',
      truncateExcerpt(node.value),
    )
    return {
      html: `<pre${styleAttribute(this.theme.codeBlockDegraded)}>${escapeHtml(node.value)}</pre>`,
      text: node.value,
    }
  }

  private renderBlockquote(node: Blockquote): Piece {
    const keep = this.capabilities.blockquotes === 'keep'
    const paragraph = keep ? this.theme.blockquoteParagraph : undefined
    const inner = node.children.map((child, index) => {
      if (paragraph === undefined || child.type !== 'paragraph') return this.renderBlockNode(child)
      return this.renderParagraph(child, index === node.children.length - 1 ? `${paragraph}margin-bottom:0;` : paragraph)
    })
    const content = inner.map((piece) => piece.html).join('')
    const text = inner
      .map((piece) => piece.text)
      .filter((value) => value.trim().length > 0)
      .join('\n\n')

    if (keep) {
      return { html: `<blockquote${styleAttribute(this.theme.blockquote)}>${content}</blockquote>`, text }
    }

    this.warn(
      'blockquote',
      'info',
      '该平台不保留引用块，已退化为普通段落，引用的文字和先后顺序不变。',
      '如需引用样式，请在平台编辑器里手动缩进或设置引用，内容无需重写。',
      truncateExcerpt(text),
    )
    return { html: content, text }
  }

  private renderList(node: List): Piece {
    const ordered = node.ordered === true
    const start = typeof node.start === 'number' ? node.start : 1
    const tag = ordered ? 'ol' : 'ul'
    const startAttribute = ordered && start !== 1 ? ` start="${start}"` : ''
    const style = ordered ? this.theme.orderedList : this.theme.unorderedList
    const items = node.children.map((item, index) => this.renderListItem(item, index, ordered, start))

    return {
      html: `<${tag}${startAttribute}${styleAttribute(style)}>${items
        .map((item) => item.html)
        .join('')}</${tag}>`,
      text: items.map((item) => item.text).join('\n'),
    }
  }

  private renderListItem(node: ListItem, index: number, ordered: boolean, start: number): Piece {
    const marker = ordered ? `${start + index}. ` : '- '
    const task = node.checked === true ? '[x] ' : node.checked === false ? '[ ] ' : ''
    const style = styleAttribute(this.theme.listItem)
    const first = node.children[0]

    if (node.children.length === 1 && first !== undefined && first.type === 'paragraph') {
      const inline = this.renderInline(first.children)
      return {
        html: `<li${style}>${task}${inline.html}</li>`,
        text: `${marker}${task}${inline.text}`,
      }
    }

    const pieces = this.renderBlockNodes(node.children)
    const text = pieces
      .map((piece) => piece.text)
      .filter((value) => value.trim().length > 0)
      .join('\n')
    return {
      html: `<li${style}>${task}${pieces.map((piece) => piece.html).join('')}</li>`,
      text: `${marker}${task}${text}`,
    }
  }

  /** 列表项出现在列表之外（极少见）时按普通块处理。 */
  private renderLooseListItem(node: ListItem): Piece {
    const pieces = this.renderBlockNodes(node.children)
    return {
      html: `<div>${pieces.map((piece) => piece.html).join('')}</div>`,
      text: pieces.map((piece) => piece.text).join('\n\n'),
    }
  }

  private renderTable(node: Table): Piece {
    const rows = node.children
    const header = rows[0]
    if (this.capabilities.tables === 'keep') {
      const head = header
        ? `<thead><tr>${header.children
            .map(
              (cell) =>
                `<th${styleAttribute(this.theme.tableHeadCell)}>${this.renderInline(cell.children).html}</th>`,
            )
            .join('')}</tr></thead>`
        : ''
      const bodyRows = rows.slice(1)
      const body =
        bodyRows.length > 0
          ? `<tbody>${bodyRows
              .map(
                (row) =>
                  `<tr>${row.children
                    .map(
                      (cell) =>
                        `<td${styleAttribute(this.theme.tableCell)}>${this.renderInline(cell.children).html}</td>`,
                    )
                    .join('')}</tr>`,
              )
              .join('')}</tbody>`
          : ''
      const text = rows
        .map((row) => row.children.map((cell) => mdastToString(cell).trim()).join(' ｜ '))
        .join('\n')
      return {
        html: `<table${styleAttribute(this.theme.table)}${this.metadata(TABLE_SOURCE_ATTR, node.align?.join(',') ?? '')}>${head}${body}</table>`,
        text,
      }
    }

    const columnNames = header?.children.map((cell, index) => {
      const rich = this.renderInline(cell.children)
      const label = mdastToString(cell).trim() || `第${index + 1}列`
      return { rich: rich.html === '' ? { html: escapeHtml(label), text: label } : rich, label }
    }) ?? []
    const dataRows = rows.slice(1)

    if (dataRows.length === 0) {
      const text = columnNames.map(({ rich, label }) => rich.text || label).join(' ｜ ')
      this.warn(
        'table',
        'attention',
        '表格只有表头行，没有数据行，已转为一行保留列名。',
        '如需表格样式，请在平台编辑器里手动插入表格；列名已保留。',
        truncateExcerpt(text),
      )
      return columnNames.length === 0 ? EMPTY_PIECE : {
        html: `<p${styleAttribute(this.theme.paragraph)}>${columnNames.map(({ rich }) => rich.html).join(' ｜ ')}</p>`,
        text,
      }
    }

    const pieces = dataRows.map((row, rowIndex) => {
      const cells = Array.from({ length: Math.max(row.children.length, columnNames.length) }, (_, index) => {
        const column = columnNames[index]
        const label = column?.label ?? `第${index + 1}列`
        // 首次出现保留完整表头内容；后续行只用文字列名，避免重复插入图片。
        const head = rowIndex === 0 ? column?.rich : undefined
        const value = this.renderInline(row.children[index]?.children ?? [])
        return { html: `${head?.html ?? escapeHtml(label)}：${value.html}`, text: `${head?.text || label}：${value.text}` }
      })
      return {
        html: `<p${styleAttribute(this.theme.paragraph)}>${cells.map(({ html }) => html).join('<br />')}</p>`,
        text: cells.map(({ text }) => text).join('\n'),
      }
    })
    const excerpt = pieces.map(({ text }) => text.replace(/\n/g, ' ')).join(' | ')

    this.warn(
      'table',
      'attention',
      `表格已按原行序转为 ${pieces.length} 组「列名：值」段落，表格样式不再保留。`,
      '如需表格外观，请在平台编辑器里手动插入表格；每个单元格的文字和行序已经保留。',
      truncateExcerpt(excerpt, 96),
    )

    return {
      html: pieces.map((piece) => piece.html).join(''),
      text: pieces.map((piece) => piece.text).join('\n'),
    }
  }

  private renderFootnoteDefinition(node: FootnoteDefinition): Piece {
    this.hasUnmappedContent = true
    const label = node.label ?? node.identifier
    const inner = this.renderBlockNodes(node.children)
    const text = inner
      .map((piece) => piece.text)
      .filter((value) => value.trim().length > 0)
      .join('\n')
    return {
      html: `<div${styleAttribute(this.theme.paragraph)}>${escapeHtml(`[^${label}]`)}${inner
        .map((piece) => piece.html)
        .join('')}</div>`,
      text: `[^${label}] ${text}`,
    }
  }

  private renderRawHtmlBlock(node: Html): Piece {
    // 原始 HTML 一律以纯文本出现：先转义，再把换行换成 <br />，保证可见且不可执行。
    this.hasUnmappedContent = true
    this.rawHtmlExcerpts.push(truncateExcerpt(node.value, 32))
    return {
      html: `<p${styleAttribute(this.theme.rawHtml)}>${escapeHtml(node.value).replace(/\n/g, '<br />')}</p>`,
      text: node.value,
    }
  }

  // ---------------------------------------------------------------- 行内

  private renderInline(nodes: readonly PhrasingContent[]): Piece {
    const pieces = nodes.map((node) => this.renderInlineNode(node))
    return {
      html: pieces.map((piece) => piece.html).join(''),
      text: pieces.map((piece) => piece.text).join(''),
    }
  }

  private renderInlineNode(node: PhrasingContent): Piece {
    switch (node.type) {
      case 'text':
        return { html: escapeHtml(node.value), text: node.value }
      case 'strong':
        return this.wrapInline(node.children, 'strong', this.theme.strong)
      case 'emphasis':
        return this.wrapInline(node.children, 'em', this.theme.emphasis)
      case 'delete':
        return this.wrapInline(node.children, 'del', this.theme.strike)
      case 'underline':
        return this.wrapInline(node.children, 'u', 'text-decoration: underline', 'underline')
      case 'highlight':
        return this.wrapInline(
          node.children,
          'mark',
          this.theme.highlight ?? 'background-color: #fff2ab; color: inherit',
          'highlight',
        )
      case 'inlineCode':
        return this.renderInlineCode(node)
      case 'break':
        return { html: '<br />', text: '\n' }
      case 'link':
        return this.renderLink(node, node.url)
      case 'linkReference':
        return this.renderLinkReference(node)
      case 'image':
        return this.renderImage(node.url, node.alt ?? '', node.title)
      case 'imageReference':
        return this.renderImageReference(node)
      case 'html':
        return this.renderInlineRawHtml(node)
      case 'footnoteReference':
        return this.renderFootnoteReference(node)
      default:
        return this.renderUnknownInline(node)
    }
  }

  private wrapInline(
    children: readonly PhrasingContent[],
    tag: string,
    style: string,
    sourceFormat?: string,
  ): Piece {
    const inner = this.renderInline(children)
    const marker = sourceFormat ? this.metadata(FORMAT_SOURCE_ATTR, sourceFormat) : ''
    return { html: `<${tag}${styleAttribute(style)}${marker}>${inner.html}</${tag}>`, text: inner.text }
  }

  private renderUnknownInline(node: PhrasingContent): Piece {
    this.hasUnmappedContent = true
    const text = mdastToString(node)
    return { html: escapeHtml(text), text }
  }

  private renderInlineCode(node: InlineCode): Piece {
    const degraded = this.capabilities.inlineCode === 'degrade'
    const style = degraded ? this.theme.inlineCodeDegraded : this.theme.inlineCode
    if (degraded) {
      this.inlineCodeExcerpts.push(truncateExcerpt(node.value, 24))
    }
    return { html: `<code${styleAttribute(style)}>${escapeHtml(node.value)}</code>`, text: node.value }
  }

  private renderFootnoteReference(node: FootnoteReference): Piece {
    this.hasUnmappedContent = true
    const label = node.label ?? node.identifier
    // 角标样式不可依赖，保留 [^label] 文字，定义在文末以脚注块形式出现，内容不丢。
    return { html: escapeHtml(`[^${label}]`), text: `[^${label}]` }
  }

  private renderInlineRawHtml(node: Html): Piece {
    this.hasUnmappedContent = true
    this.rawHtmlExcerpts.push(truncateExcerpt(node.value, 32))
    return { html: escapeHtml(node.value), text: node.value }
  }

  private renderLinkReference(node: LinkReference): Piece {
    const definition = this.definitions.get(node.identifier)
    if (definition) {
      return this.renderLink(node, definition.url, definition.title)
    }
    const inner = this.renderInline(node.children)
    this.warn(
      'link',
      'info',
      '引用式链接没有找到对应的链接定义，已只保留链接文字。',
      '请在源稿里补上定义行，例如 `[文字]: https://example.com`，然后重新排版。',
      truncateExcerpt(inner.text),
      this.sourceOnly(node),
    )
    return inner
  }

  private renderLink(node: Link | LinkReference, url: string, title = node.type === 'link' ? node.title : undefined): Piece {
    const inner = this.renderInline(node.children)
    const verdict = inspectUrl(url)

    if (!verdict.allowed) {
      this.warn(
        'link',
        'attention',
        `已拦截链接（${verdict.reason}），只保留可读文字，地址不会写进正文。`,
        '请把链接改成 https 地址，再在平台编辑器里手动添加；链接文字已保留。',
        truncateExcerpt(`[${inner.text}](${url})`),
        this.sourceOnly(node),
      )
      return inner
    }

    if (this.capabilities.links === 'degrade') {
      const address = /^https?:\/\/(.+)/i.exec(verdict.url)?.[1]
      const urlStillVisible = address !== undefined && (
        inner.text.includes(verdict.url) || (/^www\./i.test(address) && inner.text.includes(address))
      )
      this.warn(
        'link',
        'info',
        urlStillVisible
          ? '已取消外链的点击功能，但网址仍在正文。'
          : '已取消外链的点击功能，只保留链接文字。',
        `原地址：${verdict.url}。发布前请核对该平台是否允许外链或明文网址；如不允许，可只保留来源名称和文章标题。`,
        truncateExcerpt(`[${inner.text}](${verdict.url})`),
        this.sourceOnly(node),
      )
      return inner
    }

    if (inner.html.trim() === '') {
      this.hasUnmappedContent = true
      return EMPTY_PIECE
    }
    return {
      html: `<a href="${escapeHtml(verdict.url)}"${styleAttribute(this.theme.link)}${title ? this.metadata(TITLE_SOURCE_ATTR, title) : ''}>${inner.html}</a>`,
      text: inner.text,
    }
  }

  private renderImageReference(node: ImageReference): Piece {
    const definition = this.definitions.get(node.identifier)
    if (definition) {
      return this.renderImage(definition.url, node.alt ?? '', definition.title)
    }
    return this.renderImage(`#${node.identifier}`, node.alt ?? '')
  }

  private renderImage(source: string, alt: string, title?: string | null): Piece {
    const resolved = this.resolveAsset(source)
    const altText = alt.trim()
    const shownSource = source.trim().length > 0 ? source.trim() : '未填写地址'
    const name = altText.length > 0 ? altText : shownSource
    const markerText = `［图片补插位：${altText.length > 0 ? `${altText}（${shownSource}）` : shownSource}］`
    const excerpt = `![${altText}](${source})`

    if (resolved.kind === 'missing') {
      this.warn(
        'image',
        'blocker',
        '图片没有与本地文件配对，已在原位置插入补插标记。',
        '在图片配对区为这个路径选择本地文件后重新排版，或在平台编辑器里于标记处手动插入图片。',
        truncateExcerpt(excerpt),
      )
      return this.imageMarker(markerText)
    }

    if (resolved.kind === 'blocked') {
      this.warn(
        'image',
        'blocker',
        `图片地址不能用于正文（${resolved.reason}），已转为补插标记。`,
        '改用 https 图片外链，或为该路径选择本地图片后重新排版。',
        truncateExcerpt(excerpt),
      )
      return this.imageMarker(markerText)
    }

    if (this.capabilities.images === 'degrade') {
      this.warn(
        'image',
        'blocker',
        '该平台可能不保留图片，已在原位置插入补插标记。',
        '复制正文后，在平台编辑器里按标记位置逐张插入图片，再预览确认。',
        truncateExcerpt(excerpt),
      )
      return this.imageMarker(markerText)
    }

    return {
      html: `<img src="${escapeHtml(resolved.url)}" alt="${escapeHtml(altText)}"${styleAttribute(this.theme.image)}${this.metadata(IMAGE_SOURCE_ATTR, source)}${title ? this.metadata(TITLE_SOURCE_ATTR, title) : ''} />`,
      text: `［图片：${name}］`,
    }
  }

  private imageMarker(label: string): Piece {
    return {
      html: `<span${styleAttribute(this.theme.imageMarker)}>${escapeHtml(label)}</span>`,
      text: label,
    }
  }
}

export function renderBlocks(input: RenderBlocksInput): RenderBlocksOutput {
  return new BlockRenderer(input).render()
}
