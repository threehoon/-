import type { PlatformId, RenderedDocument } from '@/core/types'
import { findPhone, findSohuExternalAddress, isSohuExternalAddress } from './contacts'
import { getPublishPolicy, PUBLISH_RULES, type PublishRuleId } from './policies'
import { collectBodyUnits, type BodyTextUnit } from './units'

export interface PublishFinding {
  readonly rule: PublishRuleId
  readonly location: string
  readonly excerpt: string
  /** 正文文字块序号（从 0 开始）；标题为 -1。 */
  readonly unit: number
  /** 命中片段在文字块文字中的起止位置，界面据此跳转。 */
  readonly start: number
  readonly end: number
  /** 命中处的原文；没有文字可指的错误（例如只含图片的站外链接）为空。 */
  readonly original: string
  readonly context: string
}

export type PublishReviewResult =
  | { readonly status: 'reviewed'; readonly findings: readonly PublishFinding[] }
  | { readonly status: 'unavailable' }

interface ReviewUnit {
  readonly kind: 'title' | 'body'
  readonly text: string
  readonly location: string
  readonly unit: number
  readonly links?: ReadonlySet<string>
}

function excerptAround(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 22)
  const end = Math.min(text.length, match.index + Math.min(match[0].length, 48) + 22)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/gu, ' ')}${end < text.length ? '…' : ''}`
}

/** 命中位置带上原文，界面既能显示也能在正文里重新找到它。 */
function finding(unit: ReviewUnit, rule: PublishRuleId, match: RegExpExecArray): PublishFinding {
  const start = match.index
  const end = start + match[0].length
  return {
    rule,
    location: unit.location,
    excerpt: excerptAround(unit.text, match),
    unit: unit.unit,
    start,
    end,
    // 电话号码会先把全角数字折成半角再匹配，这里回读原文，保证定位用的片段与正文一致。
    original: unit.text.slice(start, end),
    context: unit.text,
  }
}

/**
 * 对已经切分好的文字块套用平台规则。文字块既可以来自成稿 HTML，
 * 也可以来自屏幕上正在编辑的正文，两边共用同一份规则和序号。
 */
export function reviewPublishUnits(
  platform: PlatformId,
  title: string | null,
  units: readonly BodyTextUnit[],
): PublishReviewResult {
  try {
    const { rules } = getPublishPolicy(platform)
    const all: ReviewUnit[] = []
    if (title) all.push({ kind: 'title', text: title, location: '标题', unit: -1 })
    units.forEach((unit, index) => {
      all.push({ kind: 'body', text: unit.text, location: unit.location, unit: index, links: unit.links })
    })
    const findings: PublishFinding[] = []
    for (const unit of all) {
      for (const rule of rules) {
        const definition = PUBLISH_RULES[rule]
        if (definition.scope !== 'both' && definition.scope !== unit.kind) continue
        const matcher = definition.match
        const match = matcher === 'contact-phone' ? findPhone(unit.text, platform === 'sohu')
          : matcher === 'sohu-external-link' ? findSohuExternalAddress(unit.text) : matcher.exec(unit.text)
        if (match) {
          findings.push(finding(unit, rule, match))
        } else if (matcher === 'sohu-external-link' && unit.links) {
          const external = Array.from(unit.links).find(isSohuExternalAddress)
          if (external) {
            const label = unit.text ? unit.text.slice(0, 72) + (unit.text.length > 72 ? '…' : '') : '图片链接'
            findings.push({
              rule,
              location: unit.location,
              excerpt: `${label}（${external}）`,
              unit: unit.unit,
              start: 0,
              end: 0,
              original: '',
              context: unit.text,
            })
          }
        }
      }
    }
    return { status: 'reviewed', findings }
  } catch {
    // A failed scan must never look like zero findings, especially at the clipboard gate.
    return { status: 'unavailable' }
  }
}

/** Read inert HTML from the exact platform version without appending it to the page or loading resources. */
export function reviewPublishDocument(article: RenderedDocument): PublishReviewResult {
  try {
    const template = document.createElement('template')
    template.innerHTML = article.html
    return reviewPublishUnits(article.platform, article.title, collectBodyUnits(template.content))
  } catch {
    // A failed scan must never look like zero findings, especially at the clipboard gate.
    return { status: 'unavailable' }
  }
}
