import type { Parent, PhrasingContent, Root, Text } from 'mdast'
import { visit } from 'unist-util-visit'

type Format = 'underline' | 'highlight'

interface InlineFormatNode<T extends Format> extends Parent {
  type: T
  children: PhrasingContent[]
}

declare module 'mdast' {
  interface PhrasingContentMap {
    underline: InlineFormatNode<'underline'>
    highlight: InlineFormatNode<'highlight'>
  }
  interface RootContentMap {
    underline: InlineFormatNode<'underline'>
    highlight: InlineFormatNode<'highlight'>
  }
}

type Token =
  | { kind: 'node'; node: PhrasingContent }
  | { kind: 'boundary'; node: Text }
  | { kind: 'delimiter'; value: string; format: Format }

function markerCharacter(source: string): string | undefined {
  if (source === '&plus;') return '+'
  if (source === '&equals;') return '='
  if (!source.startsWith('&#')) return source.at(-1)
  const code = source[2]?.toLowerCase() === 'x'
    ? Number.parseInt(source.slice(3, -1), 16) : Number(source.slice(2, -1))
  return code === 43 ? '+' : code === 61 ? '=' : undefined
}

function markerPositions(raw: string, value: string): Map<number, number> | null {
  // remark 已解码转义和实体。只有原 Markdown 中连续、不转义的符号才可做定界符。
  const positions = new Map<number, number>()
  const cooked = value.matchAll(/[+=]/g)
  for (const match of raw.matchAll(/\\[\\+=]|&(?:plus|equals|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});|[+=]/g)) {
    const source = match[0]
    const marker = markerCharacter(source)
    if (marker !== '+' && marker !== '=') continue
    const next = cooked.next()
    if (next.done || next.value[0] !== marker) return null
    if (source === marker) positions.set(next.value.index, match.index)
  }
  return cooked.next().done ? positions : null
}

function* textTokens(node: Text, markdown: string): Iterable<Token> {
  const { value, position } = node
  const start = position?.start.offset
  const end = position?.end.offset
  const positions = start !== undefined && end !== undefined && /\+\+|==/.test(value)
    ? markerPositions(markdown.slice(start, end), value) : null
  let offset = 0
  for (const match of value.matchAll(/\r\n|[\n\r]|\++|=+/g)) {
    const part = match[0]
    const index = match.index
    const rawIndex = positions?.get(index)
    const format = rawIndex !== undefined && positions?.get(index + 1) === rawIndex + 1
      ? part === '++' ? 'underline' : part === '==' ? 'highlight' : null
      : null
    const newline = part.startsWith('\n') || part.startsWith('\r')
    if (format === null && !newline) continue
    if (offset < index) yield { kind: 'node', node: { type: 'text', value: value.slice(offset, index) } }
    if (format) yield { kind: 'delimiter', value: part, format }
    else yield { kind: 'boundary', node: { type: 'text', value: part } }
    offset = index + part.length
  }
  if (offset === 0) yield { kind: 'node', node }
  else if (offset < value.length) yield { kind: 'node', node: { type: 'text', value: value.slice(offset) } }
}

function edgeKind(token: Token | undefined, edge: 'first' | 'last'): 'space' | 'punctuation' | 'word' {
  if (!token || token.kind === 'boundary') return 'space'
  if (token.kind === 'delimiter') return 'punctuation'
  const { node } = token
  if (node.type === 'break') return 'space'
  if (node.type !== 'text') return 'word'
  const character = edge === 'first' ? /^./u.exec(node.value)?.[0] : /.$/u.exec(node.value)?.[0]
  if (!character || /\s/u.test(character)) return 'space'
  return /[\p{P}\p{S}]/u.test(character) ? 'punctuation' : 'word'
}

function formatChildren(children: PhrasingContent[], markdown: string): PhrasingContent[] {
  const tokens = children.flatMap((node): Token[] => node.type === 'text'
    ? [...textTokens(node, markdown)] : [{ kind: 'node', node }])
  if (!tokens.some((token) => token.kind === 'delimiter')) return children

  const root: PhrasingContent[] = []
  const frames: { format: Format; delimiter: string; children: PhrasingContent[] }[] = []
  const current = () => frames.at(-1)?.children ?? root
  function flushUnclosed() {
    const frame = frames.pop()
    if (!frame) return
    const parent = current()
    parent.push({ type: 'text', value: frame.delimiter })
    for (const child of frame.children) parent.push(child)
  }

  for (const [index, token] of tokens.entries()) {
    if (token.kind !== 'delimiter') {
      if (token.kind === 'boundary' || token.node.type === 'break') {
        while (frames.length) flushUnclosed()
      }
      current().push(token.node)
      continue
    }
    const opener = frames.findIndex((frame) => frame.format === token.format)
    const left = edgeKind(tokens[index - 1], 'last')
    const right = edgeKind(tokens[index + 1], 'first')
    const canOpen = right !== 'space' && (right !== 'punctuation' || left !== 'word')
    const canClose = left !== 'space' && (left !== 'punctuation' || right !== 'word')
    if (opener >= 0 && canClose) {
      while (frames.length > opener + 1) flushUnclosed()
      const frame = frames.pop()
      if (frame) current().push({ type: frame.format, children: frame.children })
    } else if (opener < 0 && canOpen) {
      frames.push({ format: token.format, delimiter: token.value, children: [] })
    } else {
      current().push({ type: 'text', value: token.value })
    }
  }
  while (frames.length) flushUnclosed()
  return root
}

export function applyInlineFormats(root: Root, markdown: string): void {
  if (!/\+\+|==/.test(markdown)) return
  visit(root, (node) => {
    switch (node.type) {
      case 'paragraph':
      case 'heading':
      case 'tableCell':
      case 'strong':
      case 'emphasis':
      case 'delete':
      case 'link':
      case 'linkReference':
        node.children = formatChildren(node.children, markdown)
    }
  })
}
