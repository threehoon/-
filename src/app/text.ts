/**
 * 界面层的小工具：只做文本度量与转义，不承担排版逻辑。
 */

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** 拼接纯文本片段为安全 HTML，用于「复制标题」这类只有一个文本节点的场景。 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)
}

/** 24 小时制的本地时间戳，例如 `09:41:07`；排版完成时间用它展示。 */
export function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 中文稿件的字数展示：过万时折成「1.2 万」，避免顶栏被撑开。 */
export function formatCount(count: number): string {
  if (count < 10_000) {
    return String(count)
  }
  const wan = count / 10_000
  return `${wan.toFixed(wan >= 10 ? 0 : 1)} 万`
}

/** 兼容性清单里的原文片段只做展示，过长时在中间截断。 */
export function clipExcerpt(text: string, limit = 90): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, limit)}…`
}

/** 把未知异常转成可读原因，避免界面出现 `[object Object]`。 */
export function reasonOf(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message
  }
  if (typeof error === 'string' && error.trim() !== '') {
    return error
  }
  return '原因未知，可能是浏览器拒绝访问或核心层没有返回细节。'
}
