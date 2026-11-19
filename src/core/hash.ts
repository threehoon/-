/**
 * 稳定、便宜的字符串指纹。
 *
 * 用来判断「这一份平台成稿的排版基线是否变过」以及给派生计算做缓存键：
 * 每次输入都会算一次，所以用 FNV-1a 而不是加密散列，也不做序列化。
 * 每段先写入长度前缀，避免 ['ab','c'] 与 ['a','bc'] 拼成同一个串。
 */

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

export function fingerprint(parts: readonly (string | number | null | undefined)[]): string {
  let hash = FNV_OFFSET
  for (const part of parts) {
    const text = part === null || part === undefined ? '' : String(part)
    hash = mix(hash, `${text.length}:`)
    hash = mix(hash, text)
  }
  return (hash >>> 0).toString(36)
}

function mix(seed: number, text: string): number {
  let hash = seed
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}
