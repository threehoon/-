import { DEFAULT_ARTICLE_FONT } from './article-font'

/**
 * 渲染主题：把「标签」和「内联样式」分开。
 * 平台适配器选择主题；渲染器仍按能力声明决定保留或降级哪些语义标签。
 */
export interface RenderTheme {
  readonly id: string
  /** 正文容器标签：公众号用 section（后台编辑器更认），其余用 div。 */
  readonly wrapperTag: 'section' | 'div'
  readonly container: string
  readonly paragraph: string
  /** 正文顶层独占一段的纯文字加粗；普通行内加粗仍用 strong。 */
  readonly standaloneStrong?: string
  /** Rich inline content may need a heading treatment with a lighter background. */
  readonly heading: (level: number, degraded: boolean, hasInlineFormatting?: boolean) => string
  readonly blockquote: string
  /** 引用卡片内的段落版式；声明后卡片末段会自动去掉底部外边距。 */
  readonly blockquoteParagraph?: string
  readonly unorderedList: string
  readonly orderedList: string
  readonly listItem: string
  readonly codeBlock: string
  /** 代码块降级：保留等宽与换行，但不要底色/高亮。 */
  readonly codeBlockDegraded: string
  readonly inlineCode: string
  /** 行内代码降级：去掉底色，只留等宽。 */
  readonly inlineCodeDegraded: string
  readonly table: string
  readonly tableHeadCell: string
  readonly tableCell: string
  readonly image: string
  readonly link: string
  readonly strong: string
  readonly emphasis: string
  readonly strike: string
  /** 高亮（`==文字==`）：缺省时沿用原有的黄色底。 */

  readonly highlight?: string
  readonly thematicBreak: string
  /** 图片补插标记：虚线框，提示用户在这里补图。 */
  readonly imageMarker: string
  /** 原始 HTML 按纯文本输出时的样式。 */
  readonly rawHtml: string
}

/** 五个通用平台只在容器内联默认字体，其余保持语义标签。 */
export const GENERIC_THEME: RenderTheme = {
  id: 'generic',
  wrapperTag: 'div',
  container: `font-family:${DEFAULT_ARTICLE_FONT};`,
  paragraph: '',
  heading: () => '',
  blockquote: '',
  unorderedList: '',
  orderedList: '',
  listItem: '',
  codeBlock: '',
  codeBlockDegraded: '',
  inlineCode: '',
  inlineCodeDegraded: '',
  table: '',
  tableHeadCell: '',
  tableCell: '',
  image: '',
  link: '',
  strong: '',
  emphasis: '',
  strike: '',
  thematicBreak: '',
  imageMarker: '',
  rawHtml: '',
}
