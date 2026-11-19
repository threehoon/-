import type { RenderedDocument } from '@/core/types'
import { getPublishPolicy, PUBLISH_RULES, type PublishRuleId } from './policies'

export interface PublishFinding {
  readonly rule: PublishRuleId
  readonly location: string
  readonly excerpt: string
}

export type PublishReviewResult =
  | { readonly status: 'reviewed'; readonly findings: readonly PublishFinding[] }
  | { readonly status: 'unavailable' }

interface TextUnit {
  readonly kind: 'title' | 'body'
  readonly text: string
  readonly location: string
}

const BODY_BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'LI', 'TD', 'TH', 'DIV', 'FIGCAPTION'])
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'PRE', 'HR'])

/** Read inert HTML from the exact platform version without appending it to the page or loading resources. */
function bodyUnits(html: string): TextUnit[] {
  const fragment = document.createElement('template')
  fragment.innerHTML = html
  const units: TextUnit[] = []
  let text = ''
  function flush() {
    const content = text.trim()
    if (content) units.push({ kind: 'body', location: `正文第 ${units.length + 1} 个文字块`, text: content })
    text = ''
  }
  function read(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
      return
    }
    if (!(node instanceof Element)) return
    if (SKIPPED_TAGS.has(node.tagName)) {
      flush()
      return
    }
    if (node.tagName === 'BR') {
      text += '\n'
      return
    }
    const block = BODY_BLOCKS.has(node.tagName)
    if (block) flush()
    for (const child of node.childNodes) read(child)
    if (block) flush()
  }
  for (const child of fragment.content.childNodes) read(child)
  flush()
  return units
}

function excerptAround(text: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 22)
  const end = Math.min(text.length, match.index + Math.min(match[0].length, 48) + 22)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/gu, ' ')}${end < text.length ? '…' : ''}`
}

/** Finds cues for manual review, not actual violations. All matching stays in the browser. */
export function reviewPublishDocument(article: RenderedDocument): PublishReviewResult {
  try {
    const { rules } = getPublishPolicy(article.platform)
    const title: TextUnit[] = article.title ? [{ kind: 'title', text: article.title, location: '标题' }] : []
    const findings: PublishFinding[] = []
    for (const unit of [...title, ...bodyUnits(article.html)]) {
      for (const rule of rules) {
        const { pattern, scope } = PUBLISH_RULES[rule]
        if (scope !== 'both' && scope !== unit.kind) continue
        const match = pattern.exec(unit.text)
        if (match) findings.push({ rule, location: unit.location, excerpt: excerptAround(unit.text, match) })
      }
    }
    return { status: 'reviewed', findings }
  } catch {
    // A failed scan must never look like zero findings, especially at the clipboard gate.
    return { status: 'unavailable' }
  }
}
