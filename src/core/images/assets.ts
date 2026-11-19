import { visit } from 'unist-util-visit'
import { collectDefinitions } from '../markdown/definitions'
import type { AssetRegistry, ParsedDocument, ResolvedAsset } from '../types'
import { compactUrl, inspectImageSource } from '../security/policy'

/**
 * 图片素材登记表。
 *
 * 浏览器读不到本地目录，所以本地图片只能由用户显式配对：界面拿到 collectImageSources 的
 * 原始路径列表，让用户逐个选择文件，再把「原始路径 → 可用地址」交给这里。
 * 这里不猜测目录、不按文件名模糊匹配——猜错会把别的图贴进正文。
 */
export interface AssetEntry {
  /** 源稿里写的原始路径，例如 `images/team.png`。 */
  readonly path: string
  /** 用户配对后可直接用于 <img src> 的地址（object URL / data URL / https 地址）。 */
  readonly url: string
}

/** 配对时允许的写法差异：`./a.png` 与 `a.png`、`a\b.png` 与 `a/b.png` 视为同一路径。 */
function normalizePath(raw: string): string {
  let value = raw.trim().replace(/\\/g, '/')
  while (value.startsWith('./')) {
    value = value.slice(2)
  }
  const suffixIndex = value.search(/[?#]/)
  if (suffixIndex >= 0) {
    value = value.slice(0, suffixIndex)
  }
  return value
}

function isLocalPath(raw: string): boolean {
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(compactUrl(raw))
}

/** 取协议（含冒号、小写）；没有协议时返回 null。 */
function schemeOf(raw: string): string | null {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compactUrl(raw))
  return match?.[1] ? `${match[1].toLowerCase()}:` : null
}

/** 界面既可能传「路径 → 地址」的字典（配对结果），也可能传显式条目列表。 */
export type AssetEntries = readonly AssetEntry[] | Readonly<Record<string, string>>

function toEntries(input: AssetEntries): readonly AssetEntry[] {
  if (Array.isArray(input)) {
    return input as readonly AssetEntry[]
  }
  const record: Record<string, string> = { ...(input as Record<string, string>) }
  return Object.entries(record).map(([path, url]): AssetEntry => ({ path, url }))
}

export function createAssetRegistry(input: AssetEntries = []): AssetRegistry {
  const byPath = new Map<string, string>()

  for (const entry of toEntries(input)) {
    const path = entry.path.trim()
    const url = entry.url.trim()
    if (path.length === 0 || url.length === 0) {
      continue
    }
    byPath.set(normalizePath(path), url)
    byPath.set(path, url)
  }

  return {
    resolve(rawPath: string): ResolvedAsset {
      const raw = rawPath.trim()
      if (raw.length === 0) {
        return { kind: 'missing' }
      }

      if (!isLocalPath(raw)) {
        // 源稿里直接写的地址：只有 http(s) 外链浏览器自己能取到。
        // data:/blob:/javascript: 这类既不可移植也不安全，转成补插标记由用户决定。
        const scheme = schemeOf(raw)
        if (scheme === 'http:' || scheme === 'https:') {
          return { kind: 'remote', url: raw }
        }
        return { kind: 'blocked', reason: `不允许的图片协议 ${scheme ?? '未知'}` }
      }

      // 本地路径只认用户显式配对过的条目，不按文件名或目录猜测。
      const url = byPath.get(raw) ?? byPath.get(normalizePath(raw))
      if (url === undefined) {
        return { kind: 'missing' }
      }
      const verdict = inspectImageSource(url)
      if (!verdict.allowed) {
        return { kind: 'blocked', reason: `配对的图片地址不可用（${verdict.reason}）` }
      }
      return { kind: 'bound', url: verdict.url }
    },
  }
}

/** 收集正文里出现过的图片地址（去重、保持首次出现顺序），供界面逐个配对。 */
export function collectImageSources(parsed: ParsedDocument): readonly string[] {
  const definitions = collectDefinitions(parsed.root)

  const sources: string[] = []
  const seen = new Set<string>()

  const push = (source: string): void => {
    const value = source.trim()
    if (value.length === 0 || seen.has(value)) {
      return
    }
    seen.add(value)
    sources.push(value)
  }

  visit(parsed.root, (node) => {
    if (node.type === 'image') push(node.url)
    if (node.type === 'imageReference') {
      const url = definitions.get(node.identifier)?.url
      if (url !== undefined) push(url)
    }
  })

  return sources
}
