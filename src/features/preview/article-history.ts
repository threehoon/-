type Point = { readonly path: readonly number[]; readonly offset: number }
type Bookmark = { readonly anchor: Point; readonly focus: Point }
type Snapshot = { readonly html: string; readonly selection: Bookmark | null }
export type HistoryAction = 'undo' | 'redo'

const MAX_ENTRIES = 60
const MIN_ENTRIES = 5
// Keep several steps even when embedded images exceed this budget.
const HTML_BUDGET = 4 * 1024 * 1024
const TYPING_INTERVAL = 800

function pointIn(article: HTMLElement, node: Node, offset: number): Point | null {
  const path: number[] = []
  while (node !== article) {
    const parent = node.parentNode
    if (!parent) return null
    let index = 0
    for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) index += 1
    path.push(index)
    node = parent
  }
  return { path: path.reverse(), offset }
}

export function bookmarkArticle(article: HTMLElement): Bookmark | null {
  const selection = article.ownerDocument.getSelection()
  if (!selection?.anchorNode || !selection.focusNode) return null
  const anchor = pointIn(article, selection.anchorNode, selection.anchorOffset)
  const focus = pointIn(article, selection.focusNode, selection.focusOffset)
  return anchor && focus ? { anchor, focus } : null
}

function resolvePoint(article: HTMLElement, point: Point): [Node, number] | null {
  let node: Node = article
  for (const index of point.path) {
    const child = node.childNodes.item(index)
    if (!child) return null
    node = child
  }
  return [node, Math.min(point.offset, node.nodeType === Node.TEXT_NODE ? (node.nodeValue?.length ?? 0) : node.childNodes.length)]
}

export function restoreArticleBookmark(article: HTMLElement, bookmark: Bookmark | null): boolean {
  if (!bookmark) return false
  const anchor = resolvePoint(article, bookmark.anchor)
  const focus = resolvePoint(article, bookmark.focus)
  const selection = article.ownerDocument.getSelection()
  if (!anchor || !focus || !selection) return false
  article.focus({ preventScroll: true })
  selection.setBaseAndExtent(...anchor, ...focus)
  return true
}

function samePoint(a: Point, b: Point): boolean {
  return a.offset === b.offset && a.path.length === b.path.length && a.path.every((index, i) => index === b.path[i])
}

export class ArticleHistory {
  private readonly past: Snapshot[] = []
  private readonly future: Snapshot[] = []
  private previousTyping: { kind: string; at: number; point: Point } | null = null

  clear(): void {
    this.past.length = 0
    this.future.length = 0
    this.previousTyping = null
  }

  available(action: HistoryAction): boolean {
    return (action === 'undo' ? this.past : this.future).length > 0
  }

  record(before: Snapshot, after: Bookmark | null, kind: string): void {
    const at = Date.now()
    const typing = kind === 'insertText' || kind === 'deleteContentBackward' || kind === 'deleteContentForward'
    const previous = this.previousTyping
    const start = before.selection
    const merge = typing && previous?.kind === kind && at - previous.at <= TYPING_INTERVAL &&
      start && samePoint(start.anchor, start.focus) && samePoint(start.anchor, previous.point)
    if (!merge) this.push(this.past, before)
    this.future.length = 0
    this.previousTyping = typing && after && samePoint(after.focus, after.anchor) ? { kind, at, point: after.focus } : null
  }

  restore(action: HistoryAction, current: Snapshot): Snapshot | undefined {
    const from = action === 'undo' ? this.past : this.future
    const to = action === 'undo' ? this.future : this.past
    const next = from.pop()
    if (next) {
      this.previousTyping = null
      this.push(to, current)
    }
    return next
  }

  private push(stack: Snapshot[], snapshot: Snapshot): void {
    stack.push(snapshot)
    let total = snapshot.html.length
    let start = stack.length - 1
    while (start > 0 && stack.length - start < MAX_ENTRIES) {
      total += stack[start - 1].html.length
      if (total > HTML_BUDGET && stack.length - start >= MIN_ENTRIES) break
      start -= 1
    }
    if (start > 0) stack.splice(0, start)
  }
}
