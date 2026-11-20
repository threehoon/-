import type { ContentFinding, TextUnit } from './content-check'
import type { CheckBlock, DeepSeekIssue } from './deepseek-check'
import { sameBlockAfterEdit } from './locate-shared'

export function matchDeepSeekIssues(
  issues: readonly DeepSeekIssue[], blocks: readonly CheckBlock[], units: readonly TextUnit[],
): { readonly findings: readonly ContentFinding[]; readonly omitted: number } {
  const byId = new Map(blocks.map((block) => [block.id, block.text] as const))
  const findings = new Map<string, ContentFinding>()
  let omitted = 0
  for (const issue of issues) {
    const unit = units[issue.block]
    const sent = byId.get(issue.block)
    const start = sent?.indexOf(issue.quote) ?? -1
    const end = start + issue.quote.length
    if (!unit || start < 0 || unit.text.slice(start, end) !== issue.quote) {
      omitted++
      continue
    }
    const approximate = (sent?.indexOf(issue.quote, start + 1) ?? -1) !== -1
    const id = `ai-${issue.block}-${start}-${end}`
    if (findings.has(id)) continue
    findings.set(id, {
      id, kind: 'proofreading', approximate, detail: `建议：${issue.suggestion}`,
      unit: issue.block, start, end, context: unit.text, original: issue.quote,
      advice: issue.problem, title: unit.title,
    })
  }
  return { findings: [...findings.values()].sort((a, b) => a.unit - b.unit || a.start - b.start), omitted }
}

export function sameCheckText(before: readonly TextUnit[], after: readonly TextUnit[]): boolean {
  return before.length === after.length && before.every(({ title, text }, i) =>
    after[i]?.title === title && after[i]?.text === text)
}

export interface AiAnchor {
  readonly unit: TextUnit
  /** Current text may be empty while the author replaces it. Retain only the still-live element. */
  readonly paused?: boolean
}

export function rebaseAiAnchors(
  anchors: readonly (AiAnchor | null)[], before: readonly TextUnit[], after: readonly TextUnit[],
  article: Element, leavingEditor: boolean,
): readonly (AiAnchor | null)[] {
  const oldBody = before.filter((unit) => !unit.title)
  const body = after.filter((unit) => !unit.title)
  const title = after.find((unit) => unit.title)
  const sameLayout = oldBody.length === body.length && oldBody.every((unit, i) => unit.element === body[i]?.element)
  // Finishing editing may replace the entire HTML. Equal ordered text plus the known mode switch
  // proves correspondence even for identical paragraphs; never use an index on unrelated edits.
  const sameCommittedText = leavingEditor && sameCheckText(oldBody, body)
  return anchors.map((anchor) => {
    if (!anchor) return null
    const { unit, paused } = anchor
    if (unit.title) return title ? { unit: title } : { unit, paused: true }
    if (sameCommittedText && !paused) {
      const committed = body[oldBody.indexOf(unit)]
      if (committed) return { unit: committed }
    }
    const oldInElement = oldBody.filter((entry) => entry.element === unit.element)
    const sameElement = body.filter((entry) => entry.element === unit.element)
    if (oldInElement.length > 1 && sameCheckText(oldInElement, sameElement)) {
      const intactUnit = sameElement[oldInElement.indexOf(unit)]
      if (intactUnit) return { unit: intactUnit }
    }
    const intact = sameElement.filter((entry) => entry.text === unit.text)
    const oldIntact = oldInElement.filter((entry) => entry.text === unit.text)
    if (intact.length === 1 && oldIntact.length <= 1) return { unit: intact[0] }
    if (sameElement.length === 1 && oldInElement.length <= 1) {
      const edited = sameElement[0]
      if (sameLayout || paused || sameBlockAfterEdit(unit.text, edited.text)) return { unit: edited }
    }
    if (!sameElement.length && oldInElement.length <= 1 && article.contains(unit.element)) return { unit, paused: true }
    // A format change may swap a block element. Salvage unchanged unique text only; never move
    // the hit to an existing different paragraph, or pick a duplicate when the original disappears.
    const sameText = body.filter((entry) => entry.text === unit.text)
    if (!paused && !sameElement.length && sameText.length === 1 &&
      oldBody.filter((entry) => entry.text === unit.text).length === 1 &&
      !oldBody.some((entry) => entry.element === sameText[0].element)) return { unit: sameText[0] }
    return null
  })
}

export interface AiTarget {
  readonly unit: TextUnit
  readonly start: number
  readonly end: number
  readonly precision: 'exact' | 'repeated' | 'edited'
}

export function aiTarget(finding: ContentFinding, anchor: AiAnchor | null | undefined): AiTarget | null {
  if (!anchor || anchor.paused) return null
  const { unit } = anchor
  const start = unit.text.indexOf(finding.original)
  if (start < 0) return { unit, start: 0, end: unit.text.length, precision: 'edited' }
  if (finding.approximate || unit.text.indexOf(finding.original, start + 1) >= 0) {
    return { unit, start: 0, end: unit.text.length, precision: 'repeated' }
  }
  return { unit, start, end: start + finding.original.length, precision: 'exact' }
}
