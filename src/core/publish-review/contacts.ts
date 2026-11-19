// Units never span distinct paragraphs. Allow a soft line break between number groups.
const horizontal = '[ \\t\\u00a0\\u202f\\u3000]'
const gap = `${horizontal}*(?:[-\\n]${horizontal}*)?`
const mobile = `(?:\\+86${gap})?1[3-9]\\d${gap}\\d{4}${gap}\\d{4}`
const landline = `(?:(?:\\(0\\d{2,3}\\)|0\\d{2,3})${gap}\\d{7,8}|[48]00${gap}\\d{3}${gap}\\d{4})`
const label = '(?:私人电话|个人手机号|联系方式|手机号码|手机号|联系电话|咨询热线|服务热线|座机|电话|手机|热线)'
const phoneAfterLabel = new RegExp(`${label}${horizontal}*(?::${horizontal}*)?(?:\\n${horizontal}*)?(?:${mobile}|${landline})(?![\\w-])`, 'u')
// A bare number is ambiguous inside prose (orders, budgets, IDs); prompt only on a standalone number.
const bareMobile = new RegExp(`^${mobile}[。！!；;]?$`, 'u')

const webAddress = /(?:(?:https?:\/\/|www\.)[^\s<>"'，。！？；：“”‘’（）【】《》]+|(?<![\w@./-])(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+(?:com|cn|net|org|edu|gov|io|co|info|me|tv)(?![\w.-])(?:[/?#][^\s<>"'，。！？；：“”‘’（）【】《》]*)?)/giu

function narrowPhoneCharacters(text: string): string {
  return text.replace(/[０-９＋：－（）]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
}

export function findPhone(text: string, allowBare: boolean): RegExpExecArray | null {
  const searchable = narrowPhoneCharacters(text).replace(webAddress, (url) => '\u0000'.repeat(url.length))
  return phoneAfterLabel.exec(searchable) ?? (allowBare ? bareMobile.exec(searchable) : null)
}

export function isSohuExternalAddress(address: string): boolean {
  try {
    const url = new URL(address.startsWith('//') ? `https:${address}` : address)
    const host = url.hostname.replace(/\.$/u, '')
    return /^https?:$/u.test(url.protocol) && host !== 'sohu.com' && !host.endsWith('.sohu.com')
  } catch {
    return false
  }
}

export function findSohuExternalAddress(text: string): RegExpExecArray | null {
  for (const match of text.matchAll(webAddress)) {
    const address = /^https?:\/\//iu.test(match[0]) ? match[0] : `https://${match[0]}`
    if (isSohuExternalAddress(address)) return match
  }
  return null
}
