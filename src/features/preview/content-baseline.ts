import { countArticleCharacters, type CensusUnit, type ContentCensus } from './content-census'
import type { ContentFinding } from './content-check'

const MIN_DICE = 0.5
const MIN_LOST_CHARACTERS = 20
const MIN_LOST_FRACTION = 0.1

function bigrams(text: string): Map<string, number> {
  const characters = Array.from(text)
  const counts = new Map<string, number>()
  for (let i = 1; i < characters.length; i += 1) {
    const gram = characters[i - 1] + characters[i]
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  return counts
}

function dice(a: ReturnType<typeof bigrams>, b: ReturnType<typeof bigrams>, total: number): number {
  if (total <= 0) return 0
  let common = 0
  for (const [gram, count] of a.size <= b.size ? a : b) {
    common += Math.min(count, (a.size <= b.size ? b : a).get(gram) ?? 0)
  }
  return 2 * common / total
}

function pairUnits(before: readonly CensusUnit[], after: readonly CensusUnit[]): Map<number, CensusUnit> {
  const paired = new Map<number, CensusUnit>()
  const used = new Set<number>()
  const exact = new Map<string, CensusUnit[]>()
  for (const unit of [...after].reverse()) {
    const queue = exact.get(unit.text)
    if (queue) queue.push(unit)
    else exact.set(unit.text, [unit])
  }
  for (const unit of before) {
    const match = exact.get(unit.text)?.pop()
    if (match) {
      paired.set(unit.index, match)
      used.add(match.index)
    }
  }
  const unmatched = (units: readonly CensusUnit[], assigned: { has: (index: number) => boolean }) => units
    .filter(({ index }) => !assigned.has(index))
    .map((unit) => ({ unit, grams: bigrams(unit.text), size: Math.max(0, Array.from(unit.text).length - 1) }))
  const remainingAfter = unmatched(after, used)
  const candidates = unmatched(before, paired).flatMap(({ unit, grams, size }) => remainingAfter.flatMap((other) => {
    const score = dice(grams, other.grams, size + other.size)
    return score >= MIN_DICE ? [{ unit, other: other.unit, score }] : []
  }))
  candidates.sort((a, b) => b.score - a.score || Math.abs(a.unit.index - a.other.index) - Math.abs(b.unit.index - b.other.index))
  // A current paragraph can account for only one baseline paragraph, including duplicates.
  for (const { unit, other } of candidates) {
    if (paired.has(unit.index) || used.has(other.index)) continue
    paired.set(unit.index, other)
    used.add(other.index)
  }
  return paired
}

const structures = [
  ['images', '图片'], ['externalLinks', '外链'], ['tables', '表格'], ['codeBlocks', '代码块'],
] as const satisfies readonly [keyof ContentCensus, string][]

export function checkAgainstBaseline(baseline: ContentCensus, current: ContentCensus): ContentFinding[] {
  const original = baseline.units.filter(({ text }) => text !== '')
  const now = current.units.filter(({ text }) => text !== '')
  const matches = pairUnits(original, now)
  const findings: ContentFinding[] = []
  for (const { index, text } of original) {
    const match = matches.get(index)
    const from = countArticleCharacters(text)
    const to = match ? countArticleCharacters(match.text) : 0
    const loss = from - to
    if (!match || (loss >= MIN_LOST_CHARACTERS && loss / from >= MIN_LOST_FRACTION)) {
      findings.push({
        id: `baseline-paragraph-${index}`,
        kind: match ? 'shrunk' : 'missing',
        unit: match?.index ?? index, start: 0, end: match?.text.length ?? 0, title: false,
        context: match?.text ?? text, original: text, approximate: true,
        advice: match ? '段落明显缩短，请核对是否删掉了需要保留的内容。' : '疑似缺失段落，请与排版基线核对。',
        detail: match ? `基线第 ${index + 1} 段：${from}→${to} 字` : `基线第 ${index + 1} 段 · 以下为原文摘录`,
      })
    }
  }
  function structure(id: string, label: string, from: number, to: number, message: string) {
    findings.push({
      id: `baseline-${id}`, kind: 'structure', unit: -1, start: 0, end: 0, title: false,
      context: '', original: label, approximate: false, advice: message, detail: `${label} ${from}→${to}`,
    })
  }
  for (const [key, label] of structures) {
    if (baseline[key] > current[key]) structure(key, label, baseline[key], current[key], `成稿的${label}数量比排版时少，请核对。`)
  }
  const oldDowngraded = baseline.downgradedTableUnits.length
  const newDowngraded = current.downgradedTableUnits.length
  if (oldDowngraded !== newDowngraded) {
    structure('downgraded-tables', '降级表格', oldDowngraded, newDowngraded, '逐行文字形式的表格数量有变化，请单独核对。')
  }
  return findings
}
