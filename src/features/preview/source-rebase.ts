import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { readFrontmatter } from '@/core/markdown/parse'

interface Block {
  readonly start: number
  readonly end: number
  readonly key: string
}

interface Match {
  readonly before: number
  readonly after: number
}

interface Replay {
  readonly start: number
  readonly end: number
  readonly value: string
  readonly firstBlock: number
  readonly pastBlock: number
  readonly replacement: readonly Block[]
}

const parser = unified().use(remarkParse).use(remarkGfm)
const whitespace = /^[ \t\r\n]*$/

function sourceBlocks(markdown: string): Block[] | null {
  const blocks: Block[] = []
  const bomEnd = markdown.startsWith('\uFEFF') ? 1 : 0
  const { body } = readFrontmatter(markdown.slice(bomEnd))
  const bodyStart = markdown.length - body.length
  const add = (type: string, start: number, end: number) => {
    blocks.push({ start, end, key: `${type}:${markdown.slice(start, end)}` })
  }
  if (bomEnd) add('bom', 0, bomEnd)
  if (bodyStart > bomEnd) add('frontmatter', bomEnd, bodyStart)

  let nodes: ReturnType<typeof parser.parse>['children']
  try {
    nodes = parser.parse(body).children
  } catch {
    // Pathologically deep Markdown can exceed the parser's stack limit.
    return null
  }
  let previousEnd = bodyStart
  for (const node of nodes) {
    const startOffset = node.position?.start.offset
    const endOffset = node.position?.end.offset
    if (startOffset === undefined || endOffset === undefined) return null
    let start = bodyStart + startOffset
    const end = bodyStart + endOffset
    if (start < previousEnd || end <= start || end > markdown.length) return null
    // mdast omits indentation before some nodes; it still belongs to the whole source block.
    while (start > previousEnd && (markdown[start - 1] === ' ' || markdown[start - 1] === '\t')) start -= 1
    if (!whitespace.test(markdown.slice(previousEnd, start))) return null
    add(node.type, start, end)
    previousEnd = end
  }
  return whitespace.test(markdown.slice(previousEnd)) ? blocks : null
}

function indexBlocks(blocks: readonly Block[], start = 0, end = blocks.length): Map<string, number[]> {
  const indices = new Map<string, number[]>()
  for (let i = start; i < end; i += 1) {
    const key = blocks[i].key
    const positions = indices.get(key)
    if (positions) positions.push(i)
    else indices.set(key, [i])
  }
  return indices
}

function uniqueIndex(indices: ReadonlyMap<string, readonly number[]>, key: string): number {
  const positions = indices.get(key)
  return positions?.length === 1 ? positions[0] : -1
}

/** Match a range only inside the same unique, unchanged top-level Markdown block. */
export function relocateSourceSpan(baseline: string, current: string, span: { start: number; end: number }) {
  const before = sourceBlocks(baseline)
  const after = sourceBlocks(current)
  if (!before || !after) return null
  const original = before.find(({ start, end }) => start <= span.start && end >= span.end)
  if (!original || uniqueIndex(indexBlocks(before), original.key) < 0) return null
  const match = after[uniqueIndex(indexBlocks(after), original.key)]
  if (!match) return null
  const shift = match.start - original.start
  return { start: span.start + shift, end: span.end + shift }
}

/** Fence each diff window with unique anchors before considering repeated, unchanged blocks. */
function alignBlocks(before: readonly Block[], after: readonly Block[], beforeIndex: ReadonlyMap<string, readonly number[]>): Match[] | null {
  const afterIndex = indexBlocks(after)
  const anchors: Match[] = before.flatMap(({ key }, i) => {
    const match = uniqueIndex(afterIndex, key)
    return match >= 0 && uniqueIndex(beforeIndex, key) === i ? [{ before: i, after: match }] : []
  })
  anchors.push({ before: before.length, after: after.length })

  const matches: Match[] = [{ before: -1, after: -1 }]
  for (const anchor of anchors) {
    const left = matches[matches.length - 1]
    if (anchor.after <= left.after) return null
    if (anchor.before > left.before + 1 && anchor.after > left.after + 1) {
      const repeatedBefore = indexBlocks(before, left.before + 1, anchor.before)
      const repeatedAfter = indexBlocks(after, left.after + 1, anchor.after)
      const mapped = new Map<number, number>()
      for (const [key, positions] of repeatedBefore) {
        const candidates = repeatedAfter.get(key)
        if (!candidates) continue
        if (positions.length !== candidates.length) return null
        positions.forEach((position, i) => mapped.set(position, candidates[i]))
      }
      let previousAfter = left.after
      for (let i = left.before + 1; i < anchor.before; i += 1) {
        const match = mapped.get(i)
        if (match === undefined) continue
        if (match <= previousAfter) return null
        matches.push({ before: i, after: match })
        previousAfter = match
      }
    }
    matches.push(anchor)
  }
  return matches
}

function sharedEdge(before: string, after: string, limit: number, fromEnd = false): number {
  let length = 0
  while (length < limit && (fromEnd ? before.at(-length - 1) === after.at(-length - 1) : before[length] === after[length])) {
    length += 1
  }
  return length
}

/** Replay the proposal only if every affected block or insertion gap can be proven intact. */
export function rebaseSourceChanges(baseline: string, proposed: string, current: string): string | null {
  if (current === baseline) return proposed
  if (proposed === baseline) return current

  const before = sourceBlocks(baseline)
  const after = sourceBlocks(proposed)
  const live = sourceBlocks(current)
  if (!before || !after || !live) return null
  const beforeIndex = indexBlocks(before)
  const liveIndex = indexBlocks(live)
  const aligned = alignBlocks(before, after, beforeIndex)
  if (!aligned) return null
  const liveMatches = before.map(({ key }, i) => uniqueIndex(beforeIndex, key) === i ? uniqueIndex(liveIndex, key) : -1)
  // A match may shift with edits, but must not cross any other surviving unique block.
  const maximumBefore = [-1]
  const minimumAfter = new Array<number>(before.length + 1)
  minimumAfter[before.length] = live.length
  for (let i = 0; i < before.length; i += 1) maximumBefore.push(Math.max(maximumBefore[i], liveMatches[i]))
  for (let i = before.length - 1; i >= 0; i -= 1) {
    minimumAfter[i] = liveMatches[i] < 0 ? minimumAfter[i + 1] : Math.min(minimumAfter[i + 1], liveMatches[i])
  }

  const patches: Replay[] = []
  for (let i = 1; i < aligned.length; i += 1) {
    const left = aligned[i - 1]
    const right = aligned[i]
    const first = left.before + 1
    const past = right.before
    const replacement = after.slice(left.after + 1, right.after)
    const from = before[left.before]?.end ?? 0
    const until = before[past]?.start ?? baseline.length
    const newFrom = after[left.after]?.end ?? 0
    const oldValue = baseline.slice(from, until)
    const newValue = proposed.slice(newFrom, after[right.after]?.start ?? proposed.length)
    if (first === past && replacement.length === 0 && oldValue === newValue) continue

    // Trim shared separators, never the old or new block itself. Changes to a separator
    // are replayed only when those bytes still border the affected location in current.
    const oldLeading = first < past ? before[first].start - from : oldValue.length
    const oldTrailing = first < past ? until - before[past - 1].end : oldValue.length
    const newLeading = replacement.length ? replacement[0].start - newFrom : newValue.length
    const newTrailing = replacement.length ? newFrom + newValue.length - replacement[replacement.length - 1].end : newValue.length
    const prefix = sharedEdge(oldValue, newValue, Math.min(oldLeading, newLeading))
    const suffix = sharedEdge(oldValue, newValue, Math.min(oldTrailing, newTrailing, oldValue.length - prefix, newValue.length - prefix), true)
    const removed = oldValue.slice(prefix, oldValue.length - suffix)
    const value = newValue.slice(prefix, newValue.length - suffix)

    let firstBlock: number
    let pastBlock: number
    let start: number
    let end: number
    if (first === past) {
      const liveLeft = left.before < 0 ? -1 : liveMatches[left.before]
      const liveRight = past === before.length ? live.length : liveMatches[past]
      if ((left.before >= 0 && liveLeft < 0) || liveRight !== liveLeft + 1) return null
      const gapStart = live[liveLeft]?.end ?? 0
      const gapEnd = live[liveRight]?.start ?? current.length
      if (current.slice(gapStart, gapEnd) !== oldValue) return null
      firstBlock = pastBlock = liveRight
      start = gapStart + prefix
      end = gapEnd - suffix
    } else {
      firstBlock = liveMatches[first]
      if (firstBlock < 0) return null
      pastBlock = firstBlock + past - first
      for (let block = first + 1; block < past; block += 1) {
        if (liveMatches[block] !== firstBlock + block - first) return null
      }
      start = live[firstBlock].start - (oldLeading - prefix)
      end = live[pastBlock - 1].end + oldTrailing - suffix
      if (start < (live[firstBlock - 1]?.end ?? 0) || end > (live[pastBlock]?.start ?? current.length)) return null
      if (current.slice(start, end) !== removed) return null
    }
    if (maximumBefore[first] >= firstBlock || minimumAfter[past] < pastBlock) return null
    patches.push({ start, end, value, firstBlock, pastBlock, replacement })
  }

  const output: string[] = []
  const expectedBlocks: Block[] = []
  let offset = 0
  let block = 0
  for (const patch of patches) {
    if (patch.start < offset || patch.firstBlock < block) return null
    output.push(current.slice(offset, patch.start), patch.value)
    for (; block < patch.firstBlock; block += 1) expectedBlocks.push(live[block])
    for (const replacement of patch.replacement) expectedBlocks.push(replacement)
    offset = patch.end
    block = patch.pastBlock
  }
  output.push(current.slice(offset))
  for (; block < live.length; block += 1) expectedBlocks.push(live[block])
  const result = output.join('')
  // A byte splice must not absorb adjacent content into a fence, list, paragraph, etc.
  const resultBlocks = sourceBlocks(result)
  return resultBlocks?.length === expectedBlocks.length && resultBlocks.every(({ key }, i) => key === expectedBlocks[i].key) ? result : null
}
