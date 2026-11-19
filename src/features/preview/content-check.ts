const BLOCKS = 'article,section,p,div,h1,h2,h3,h4,h5,h6,blockquote,li,td,th,figcaption,br,hr'
const SKIPPED = 'pre,code,script,style,template'
const ADDRESS = /(?:https?:\/\/|mailto:|www\.)[^\s<>，。！？；：“”‘’（）【】《》]+/giu

interface TextPiece {
  readonly node: Text
  readonly start: number
  readonly end: number
}

export interface TextUnit {
  readonly title: boolean
  readonly text: string
  readonly pieces: readonly TextPiece[]
}

export interface ContentFinding {
  readonly id: string
  readonly unit: number
  readonly start: number
  readonly end: number
  readonly original: string
  readonly advice: string
  readonly title: boolean
}

/** Keep the text-node boundaries so a hit can span inline formatting. */
export function articleTextUnits(canvas: Element): readonly TextUnit[] {
  const units: TextUnit[] = []
  function collect(root: Element, title: boolean) {
    let text = ''
    let pieces: TextPiece[] = []
    function flush() {
      if (text.trim()) units.push({ title, text, pieces })
      text = ''
      pieces = []
    }
    function walk(node: Node) {
      if (node instanceof Text) {
        const start = text.length
        text += node.data
        if (start < text.length) pieces.push({ node, start, end: text.length })
      }
      if (!(node instanceof Element)) return
      if (node.matches(SKIPPED)) {
        flush()
        return
      }
      const boundary = node.matches(BLOCKS)
      if (boundary) flush()
      for (const child of node.childNodes) walk(child)
      if (boundary) flush()
    }
    walk(root)
    flush()
  }
  const title = canvas.querySelector('.article-title')
  const body = canvas.querySelector('#platform-article')
  if (title) collect(title, true)
  if (body) collect(body, false)
  return units
}

const WORDS: Readonly<Record<string, string>> = {
  按装: '安装',
  既使: '即使',
  再接再励: '再接再厉',
  一愁莫展: '一筹莫展',
  一如继往: '一如既往',
  震憾: '震撼',
}

export function checkArticleContent(units: readonly TextUnit[]): readonly ContentFinding[] {
  const findings: ContentFinding[] = []
  units.forEach((unit, index) => {
    function add(start: number, original: string, advice: string, rule: string) {
      findings.push({
        id: `${index}-${start}-${rule}`,
        unit: index,
        start,
        end: start + original.length,
        original,
        advice,
        title: unit.title,
      })
    }
    // Keep offsets intact while excluding addresses and breaking sentences at those boundaries.
    const text = unit.text.replace(ADDRESS, (address) => '\n'.repeat(address.length))
    for (const match of text.matchAll(/按装|既使|再接再励|一愁莫展|一如继往|震憾/gu)) {
      add(match.index, match[0], `核对是否应写作「${WORDS[match[0]]}」。`, 'word')
    }
    for (const match of text.matchAll(/(的{2,}|已经(?:已经)+|但是(?:但是)+|因此(?:因此)+)/gu)) {
      add(match.index, match[0], '这里有重复用词，请核对是否应删掉重复部分。', 'repeat')
    }
    for (const match of text.matchAll(/([，。、；：])\1+/gu)) {
      add(match.index, match[0], '这里有重复标点，请核对是否只需保留一个。', 'punctuation')
    }
    for (const match of text.matchAll(/[^。！？!?；;\r\n]+/gu)) {
      const sentence = match[0].trim()
      if ((sentence.match(/\p{Script=Han}/gu)?.length ?? 0) <= 80) continue
      add(match.index + match[0].indexOf(sentence), sentence, '这句话超过 80 个汉字，建议复读，看看能否拆成短句。', 'length')
    }
  })
  return findings.sort((a, b) => a.unit - b.unit || a.start - b.start)
}

export function contentRange(units: readonly TextUnit[], finding: ContentFinding): Range | null {
  const unit = units[finding.unit]
  if (!unit || unit.text.slice(finding.start, finding.end) !== finding.original) return null
  const first = unit.pieces.find((part) => part.end > finding.start)
  const last = unit.pieces.find((part) => part.end >= finding.end)
  if (!first || !last) return null
  const range = first.node.ownerDocument.createRange()
  range.setStart(first.node, finding.start - first.start)
  range.setEnd(last.node, finding.end - last.start)
  return range
}
