import { collectBodyUnits } from '@/core/publish-review/units'
import { normalizeText } from './content-census'
import { block, located, sameBlockAfterEdit, unavailable, type LocateOutcome } from './locate-shared'

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
  readonly element: Element
  readonly text: string
  readonly pieces: readonly TextPiece[]
}

export interface ContentFinding {
  readonly id: string
  readonly kind: 'proofreading' | 'missing' | 'shrunk' | 'structure'
  readonly approximate: boolean
  readonly detail: string | null
  readonly unit: number
  readonly start: number
  readonly end: number
  readonly original: string
  /** 扫描时这一段的整段文字；命中文字被改后用它判断「还是不是同一段」。 */
  readonly context: string
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
      const element = title ? root : pieces[0]?.node.parentElement?.closest(BLOCKS)
      if (element && text.trim()) units.push({ element, title, text, pieces })
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

// Only high-confidence written forms. Avoid single-character substitutions and proper names.
const TYPOS: Readonly<Record<string, string>> = {
  按装: '安装',
  既使: '即使',
  再接再励: '再接再厉',
  再接再利: '再接再厉',
  一愁莫展: '一筹莫展',
  一如继往: '一如既往',
  震憾: '震撼',
  自已: '自己',
  己经: '已经',
  必竞: '毕竟',
  迫不急待: '迫不及待',
  不径而走: '不胫而走',
  按步就班: '按部就班',
  一拍既合: '一拍即合',
  如火如茶: '如火如荼',
  张冠李带: '张冠李戴',
  变本加利: '变本加厉',
  责无旁代: '责无旁贷',
  人才倍出: '人才辈出',
  穿流不息: '川流不息',
  名列前矛: '名列前茅',
  挺而走险: '铤而走险',
  走头无路: '走投无路',
  蛛丝蚂迹: '蛛丝马迹',
  世外桃园: '世外桃源',
  相形见拙: '相形见绌',
  滥竽冲数: '滥竽充数',
  悬梁刺骨: '悬梁刺股',
  草管人命: '草菅人命',
  美仑美奂: '美轮美奂',
  默守成规: '墨守成规',
  循序渐近: '循序渐进',
} as const
const TYPO_PATTERN = new RegExp(Object.keys(TYPOS).map((word) => word === '按装' ? `${word}(?!配)` : word).join('|'), 'gu')
const AWKWARD_PATTERN = /[看听]起来像不(?:太)?对(?:劲)?(?=$|[\s。！？!?；;，,、：:“”‘’"'（）()])/gu

export function checkArticleContent(units: readonly TextUnit[]): readonly ContentFinding[] {
  const findings: ContentFinding[] = []
  units.forEach((unit, index) => {
    function add(start: number, original: string, advice: string, rule: string) {
      findings.push({
        id: `${index}-${start}-${rule}`,
        kind: 'proofreading',
        approximate: false,
        detail: null,
        unit: index,
        start,
        end: start + original.length,
        original,
        context: unit.text,
        advice,
        title: unit.title,
      })
    }
    // Keep offsets intact while excluding addresses and breaking sentences at those boundaries.
    const text = unit.text.replace(ADDRESS, (address) => '\n'.repeat(address.length))
    for (const match of text.matchAll(TYPO_PATTERN)) {
      add(match.index, match[0], `疑似错别字，核对是否应写作「${TYPOS[match[0]]}」。`, 'word')
    }
    for (const match of text.matchAll(AWKWARD_PATTERN)) {
      const suggestion = match[0].replace('像', '')
      add(match.index, match[0], `这句读起来不顺，建议改为「${suggestion}」。`, 'phrasing')
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

export function contentFindingElement(units: readonly TextUnit[], finding: ContentFinding, article: Element): Element | null {
  if (finding.kind === 'proofreading') return units[finding.unit]?.element ?? null
  if (finding.kind === 'shrunk') return collectBodyUnits(article)[finding.unit]?.element ?? null
  return null
}

export function contentRange(units: readonly TextUnit[], finding: ContentFinding, article?: Element | null, previousElement?: Element | null): LocateOutcome {
  if (finding.kind === 'missing') return unavailable('该段已经不在当前成稿，请按基线段落序号和原文摘录核对。')
  if (finding.kind === 'structure') return unavailable('这是全篇数量变化，无法可靠指向某个位置，请按提示核对。')
  if (finding.kind === 'shrunk') {
    const matches = article ? collectBodyUnits(article).filter((unit) => (previousElement === undefined || unit.element === previousElement) && normalizeText(unit.text) === finding.context) : []
    const unit = matches.length === 1 ? matches[0] : undefined
    const range = unit ? wholeUnit(unit) : null
    return range ? block(range) : unavailable('段落已变化或有多处相同文字，请重新点「一键检查内容」。')
  }
  const candidates = previousElement === undefined ? [units[finding.unit]] : units.filter((unit) => unit.element === previousElement)
  const unit = candidates.length === 1 ? candidates[0] : undefined
  if (!unit) return unavailable('这段文字所在的段落已经不存在了。')
  if (unit.title !== finding.title) return unavailable('正文块已变化，请重新点「一键检查内容」。')
  const sameBlock = unit.text === finding.context || (!finding.title && sameBlockAfterEdit(finding.context, unit.text))
  if (sameBlock && unit.text.slice(finding.start, finding.end) === finding.original) {
    const range = rangeOf(unit, finding.start, finding.end)
    return range ? located(range) : unavailable('找不到这段文字的准确位置。')
  }
  // 精确区间对不上：先试着找同一段原文，再退到「就是这一段」的整块定位。
  const start = !sameBlock || finding.original === '' ? -1 : unit.text.indexOf(finding.original)
  if (start >= 0) {
    const range = rangeOf(unit, start, start + finding.original.length)
    if (range) return located(range)
  }
  // 判断「同一段」要和扫描时的整段文字比：只比对命中片段的话，改过之后再无公共前后缀。
  if (!finding.title && sameBlock) {
    const whole = wholeUnit(unit)
    if (whole) return block(whole)
  }
  return unavailable('这段文字在当前成稿里已经找不到，请在左侧源稿里核对，或重新点「一键检查内容」。')
}

/** 整段的范围：取覆盖全部文本节点的父元素；父元素跨了多段时退回首尾文本节点之间。 */
function wholeUnit(unit: Pick<TextUnit, 'pieces'>): Range | null {
  const first = unit.pieces[0]
  if (!first) return null
  const range = first.node.ownerDocument.createRange()
  range.setStart(first.node, 0)
  const last = unit.pieces[unit.pieces.length - 1] ?? first
  range.setEnd(last.node, last.node.data.length)
  return range.collapsed ? null : range
}

function rangeOf(unit: TextUnit, start: number, end: number): Range | null {
  const first = unit.pieces.find((part) => part.end > start)
  const last = unit.pieces.find((part) => part.end >= end)
  if (!first || !last) return null
  const range = first.node.ownerDocument.createRange()
  range.setStart(first.node, start - first.start)
  range.setEnd(last.node, end - last.start)
  return range
}
