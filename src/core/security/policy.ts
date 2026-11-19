/**
 * 链接与素材地址的安全策略。
 *
 * 首版原则（PRD 第 6 节「安全」）：预览与复制都拦截可执行脚本的链接和不安全资源地址，
 * 但保留可读文本并给出明确提示——拦截不等于静默删内容。
 */

/** 允许出现在链接目标里的协议白名单。其余协议一律拦截。 */
export const SAFE_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'] as const

/** 允许出现在正文 <img src> 里的协议：外链用 http(s)，用户显式配对的本地图用 blob:/data:image。 */
export const SAFE_IMAGE_SCHEMES = ['http:', 'https:', 'blob:', 'data:'] as const

export type UrlVerdict =
  | { readonly allowed: true; readonly url: string }
  | { readonly allowed: false; readonly reason: string }

/** 匹配 `scheme:` 前缀。 */
const SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):/

/**
 * 压平地址：去掉空白与控制字符后再判断协议。
 * `java\tscript:alert(1)` 这类混淆在浏览器里同样会被当成 javascript:，所以必须先压平再比对。
 */
export function compactUrl(raw: string): string {
  let compact = ''
  for (const character of raw.trim()) {
    const code = character.codePointAt(0) ?? 0
    if (code > 0x20 && code !== 0x7f) {
      compact += character
    }
  }
  return compact
}

function protocolOf(compact: string): string | null {
  const match = SCHEME_PATTERN.exec(compact)
  return match?.[1] ? `${match[1].toLowerCase()}:` : null
}

/**
 * 判断一个链接目标能否写进正文。
 * 相对路径、协议相对地址也被拒绝：粘贴到平台后它们指向平台自己的域名，
 * 属于「看起来能点、实际是坏链」，宁可只留文字并提示作者改成 https。
 */
export function inspectUrl(raw: string): UrlVerdict {
  const value = raw.trim()
  const compact = compactUrl(raw)
  if (compact.length === 0) {
    return { allowed: false, reason: '链接地址为空' }
  }
  const protocol = protocolOf(compact)
  if (!protocol) {
    return { allowed: false, reason: compact.startsWith('//') ? '协议相对地址' : '相对路径' }
  }
  if ((SAFE_LINK_PROTOCOLS as readonly string[]).includes(protocol)) {
    return { allowed: true, url: value }
  }
  return { allowed: false, reason: `不允许的协议 ${protocol}` }
}

/**
 * 判断配对/外链图片地址能否作为 <img src>。
 * data: 只接受 data:image/*，data:text/html 这类可执行载荷仍然拦截。
 */
export function inspectImageSource(raw: string): UrlVerdict {
  const value = raw.trim()
  const compact = compactUrl(raw)
  if (compact.length === 0) {
    return { allowed: false, reason: '图片地址为空' }
  }
  const protocol = protocolOf(compact)
  if (!protocol) {
    return { allowed: false, reason: compact.startsWith('//') ? '协议相对地址' : '相对路径' }
  }
  if (!(SAFE_IMAGE_SCHEMES as readonly string[]).includes(protocol)) {
    return { allowed: false, reason: `不允许的协议 ${protocol}` }
  }
  if (protocol === 'data:' && !/^data:image\//i.test(compact)) {
    return { allowed: false, reason: 'data: 地址不是图片类型' }
  }
  return { allowed: true, url: value }
}

/** 原始 HTML 的输出方式：首版永远是纯文本，不作为页面元素执行。 */
export const RAW_HTML_MODE = 'text' as const
