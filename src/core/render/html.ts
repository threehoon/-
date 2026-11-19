/**
 * HTML 转义与内联样式拼装。
 *
 * 所有进入输出的动态文本都必须经过 escapeHtml：Markdown 里的原始 HTML 一旦漏过这里，
 * 就会在预览或粘贴后变成可执行元素。
 */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character)
}

/** 主题样式为空字符串时完全省略 style 属性，让保守平台拿到纯净的语义标签。 */
export function styleAttribute(style: string | undefined): string {
  if (style === undefined || style.length === 0) {
    return ''
  }
  return ` style="${escapeHtml(style)}"`
}

/** 兼容性提示里的原文片段：压平空白并截断，便于在源稿里定位。 */
export function truncateExcerpt(text: string, max = 48): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max)}…` : compact
}

/** 统一异常转文字，避免把 [object Object] 写进失败原因。 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return String(error)
}
