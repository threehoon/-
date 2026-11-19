/**
 * 兼容性提示的实时重算。
 *
 * 排版时的警告是那一份成稿的快照：右侧删掉链接以后，旧提示仍挂在界面上，
 * 用户会以为没删掉。这里以当前成稿 HTML 为准重新对一遍——
 *
 * - 能从成稿直接看出来的（表格、代码块、图片、链接、引用），按当前 DOM 判定：
 *   已经处理掉的消失，新出现的问题补上。
 * - 只有源稿能判断的（被拦截的链接、展开掉的引用式链接、原始 HTML、标题层级），
 *   标记 `source: 'source'`，界面提示「可能已修复 · 重新排版确认」。
 *
 * 只读 DOM，不依赖 React，方便单测与复制前的兜底重算复用。
 */

import { PUBLISH_RULES } from '@/core/publish-review/policies'
import type { PublishReviewResult } from '@/core/publish-review/review'
import type { CompatWarning, PlatformCapabilities, WarningKind, WarningSeverity } from '@/core/types'

import { parseInertArticleHtml } from './content-census'
import { compatibilityTargets } from './issue-locations'

export interface AssessedWarning extends CompatWarning {
  readonly source: 'live' | 'source'
}

/** 一条规则在当前成稿上的结果：还在、已解决、或看不出来。 */
type RuleVerdict = 'present' | 'resolved' | 'unverifiable'

interface Introduce {
  readonly severity: WarningSeverity
  readonly message: string
  readonly action: string
}

interface Rule {
  /** 排版快照没有时，发现这类问题要新加的提示。 */
  readonly introduce: Introduce | null
  readonly evaluate: (document: Element) => RuleVerdict
  readonly introduces?: (document: Element) => boolean
}

const IMAGE_MARKER = '［图片补插位'

const INTRODUCE: Partial<Record<WarningKind, Introduce>> = {
  table: {
    severity: 'attention',
    message: '正文里有表格，该平台不支持富文本表格，按「列名：值」逐行保留。',
    action: '如需表格外观，请在平台编辑器里手动插入表格；文字与行序会保留。',
  },
  image: {
    severity: 'blocker',
    message: '正文里有图片，该平台不保证保留图片。',
    action: '复制正文后，在平台编辑器里按原位置逐张插入图片，再预览确认。',
  },
  code: {
    severity: 'attention',
    message: '正文里有等宽文本块，该平台不保留语法高亮和底色。',
    action: '如需代码边框或高亮，请在平台编辑器里手动设置；文字与换行会保留。',
  },
  blockquote: {
    severity: 'info',
    message: '正文里有引用块，该平台不保留引用样式。',
    action: '如需引用样式，请在平台编辑器里手动缩进，内容无需重写。',
  },
}

/** 降级后仍留在正文里的链接：`<a href>` 一定还在（保留链接的平台），
 *  降级成纯文字的平台则只剩可见的明文网址。 */
function liveLinkHrefs(document: Element): string[] {
  return [...document.querySelectorAll('a[href]')]
    .map((anchor) => anchor.getAttribute('href')?.trim() ?? '')
    .filter((href) => href !== '')
}

function plainTextOf(document: Element): string {
  return document.textContent ?? ''
}

function ruleFor(kind: WarningKind, capabilities: PlatformCapabilities): Rule {
  switch (kind) {
    case 'table':
      return {
        introduce: capabilities.tables === 'degrade' ? INTRODUCE.table ?? null : null,
        evaluate: (document) => {
          if (capabilities.tables === 'keep') return 'resolved'
          return document.querySelector('table') ? 'present' : 'resolved'
        },
      }
    case 'image':
      return {
        // 保留图片的平台不会因为编辑产生图片提示；降级平台按「还有没有图片」判断。
        introduce: capabilities.images === 'degrade' ? INTRODUCE.image ?? null : null,
        evaluate: (document) =>
          document.querySelector('img[src]') || plainTextOf(document).includes(IMAGE_MARKER)
            ? 'present'
            : 'resolved',
      }
    case 'code':
      return {
        introduce: capabilities.codeBlocks === 'degrade' ? INTRODUCE.code ?? null : null,
        // 保留与降级都输出 <pre>，从成稿无法判断是哪一种：有 <pre> 就算可能仍在。
        evaluate: (document) => document.querySelector('pre, code') ? 'unverifiable' : 'resolved',
        introduces: (document) => document.querySelector('pre') !== null,
      }
    case 'blockquote':
      return {
        introduce: capabilities.blockquotes === 'degrade' ? INTRODUCE.blockquote ?? null : null,
        // 降级时引用块已变成普通段落，成稿里再也认不出来。
        evaluate: (document) => document.querySelector('blockquote') ? 'present' : 'unverifiable',
      }
    case 'link':
      return {
        introduce: null,
        // 保留外链的平台按现有 <a href> 判断；降级平台链接已变纯文字，
        // 成稿认不出这一句原本是不是链接，只能回源稿确认。
        evaluate: (document) => {
          if (capabilities.links !== 'keep') return 'unverifiable'
          return liveLinkHrefs(document).length > 0 ? 'present' : 'resolved'
        },
      }
    default:
      // heading / raw-html：降级后成稿里认不出原文，只能回源稿确认。
      return { introduce: null, evaluate: () => 'unverifiable' }
  }
}

function withSource(warning: CompatWarning, source: 'live' | 'source'): AssessedWarning {
  return { ...warning, source }
}

/**
 * 把排版时的警告对一遍当前成稿。
 *
 * 只读 `html`，不需要排版时的基线：判定为 `present` 的保留（标 `live`），
 * 在成稿里已经找不到的消失，成稿看不出来的保留并标 `source`。
 * 编辑中新出现的表格/图片/代码块也会补一条提示。
 */
export function reassessWarnings(
  warnings: readonly CompatWarning[],
  html: string,
  capabilities: PlatformCapabilities,
): readonly AssessedWarning[] {
  const root = parseInertArticleHtml(html)
  if (!root) return warnings.map((warning) => withSource(warning, warning.source ?? 'source'))
  const seen = new Set<WarningKind>()
  const next: AssessedWarning[] = []
  for (const warning of warnings) {
    seen.add(warning.kind)
    // These renderer diagnostics describe information that is no longer in the HTML.
    // An unrelated surviving link or table must not turn them into live findings.
    const sourceOnly = warning.source === 'source' ||
      warning.locations?.some((location) => location.kind === 'source') ||
      (warning.kind === 'table' && Boolean(warning.locations?.length))
    const markerLocations = warning.kind === 'image' ? warning.locations?.filter((location) => location.kind === 'block') : undefined
    const verdict = sourceOnly ? 'unverifiable' : markerLocations?.length
      ? (compatibilityTargets(root, markerLocations).ranges.some((range) => range.toString().includes(IMAGE_MARKER)) ? 'present' : 'resolved')
      : ruleFor(warning.kind, capabilities).evaluate(root)
    if (verdict === 'present') next.push(withSource(warning, 'live'))
    else if (verdict === 'unverifiable') next.push(withSource(warning, 'source'))
  }
  for (const kind of Object.keys(INTRODUCE) as WarningKind[]) {
    if (seen.has(kind)) continue
    const rule = ruleFor(kind, capabilities)
    if (!rule.introduce) continue
    if (!(rule.introduces ? rule.introduces(root) : rule.evaluate(root) === 'present')) continue
    next.push({
      id: `${kind}-live`,
      kind,
      severity: rule.introduce.severity,
      message: rule.introduce.message,
      action: rule.introduce.action,
      excerpt: '（编辑后新增）',
      source: 'live',
    })
  }
  return next
}

/** Reuse the current body-only policy hit, not a saved source warning or a second policy scan. */
export function assessExternalLinkReview(review: PublishReviewResult | null): AssessedWarning[] {
  if (review?.status !== 'reviewed') return []
  const first = review.findings.find(({ rule, unit }) => rule === 'sohuExternalLink' && unit >= 0)
  return first ? [{
    id: 'sohu-external-link-live', kind: 'link', severity: 'attention', source: 'live',
    message: '正文仍有站外链接或明文网址。', action: PUBLISH_RULES.sohuExternalLink.action, excerpt: first.excerpt,
  }] : []
}
