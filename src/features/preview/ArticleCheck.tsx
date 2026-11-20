import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CompatWarning } from '@/core/types'
import { clipExcerpt } from '@/app/text'
import { articleTextUnits, contentFindingElement, contentRange, rangeOf, type ContentFinding, type TextUnit } from './content-check'
import { compatibilityTargets, locateRange, outcomeRange, selectTitleInput } from './issue-locations'
import { checkAgainstBaseline } from './content-baseline'
import { censusOf, type ContentCensus } from './content-census'
import { ARTICLE_CHECK_FORM_ID } from './panel-ids'
import { checkBlocks, requestDeepSeek, type DeepSeekConfig } from './deepseek-check'
import { aiTarget, matchDeepSeekIssues, rebaseAiAnchors, sameCheckText, type AiAnchor, type AiTarget } from './deepseek-findings'

const CONTENT_MARK = 'studio-content-issue'
const COMPAT_MARK = 'studio-compat-issue'
const CURRENT_MARK = 'studio-content-current'

interface FindingRow {
  readonly finding: ContentFinding
  readonly element: Element | null
}

interface AiSnapshot {
  readonly units: readonly TextUnit[]
  readonly anchors: readonly (AiAnchor | null)[]
  readonly editing: boolean
}

type AiPrecision = AiTarget['precision'] | 'unavailable'

function aiNotice(finding: ContentFinding, precision?: AiPrecision): string | null {
  if (precision === 'unavailable') return finding.title ? '标题已清空，无法定位。' : '原段已删除或无法确认位置，无法定位。'
  if (precision === 'edited') return `原句已改，可回到${finding.title ? '当前标题' : '所在段落'}核对。`
  if (precision === 'repeated') return `原句重复，只能定位到整个${finding.title ? '标题' : '段落'}。`
  return null
}

function FindingItem({ finding, feedback, onLocate, ai = false, selected = false }: {
  readonly finding: ContentFinding
  readonly feedback: string | null
  readonly onLocate: () => void
  readonly ai?: boolean
  readonly selected?: boolean
}) {
  const excerpt = clipExcerpt(finding.original)
  const section = finding.title ? '标题' : '正文'
  return (
    <li aria-current={selected || undefined}>
      <div>
        <strong>{section} · {excerpt}</strong>
        <p>{finding.advice}</p>
        {finding.detail ? <p>{finding.detail}</p> : null}
        {feedback ? <p className="content-check__notice" role={ai ? undefined : 'status'}>{feedback}</p> : null}
      </div>
      <button className="btn btn--ghost btn--small" type="button" onClick={onLocate}
        aria-label={`定位${section}中的「${excerpt}」`}>定位</button>
    </li>
  )
}

function imageSelector(image: HTMLImageElement, article: Element): string {
  const levels: string[] = []
  for (let child: Element = image; child !== article && child.parentElement; child = child.parentElement) {
    const index = Array.from(child.parentElement.children).indexOf(child)
    levels.unshift(`:nth-child(${index + 1})`)
  }
  return ['#platform-article', ...levels].join(' > ')
}

export function ArticleCheck({ enabled, inEditor, warnings, baseline, config, onOpenSettings, locatorHost, bodyHtml, titleText }: {
  readonly enabled: boolean
  readonly inEditor: boolean
  readonly warnings: readonly CompatWarning[]
  readonly baseline: ContentCensus | null
  readonly config?: DeepSeekConfig | null
  readonly onOpenSettings?: () => void
  readonly locatorHost: HTMLElement | null
  readonly bodyHtml: string
  readonly titleText: string | null
}) {
  const panel = useRef<HTMLFormElement>(null)
  const imageRules = useRef<HTMLStyleElement>(null)
  const returnButton = useRef<HTMLButtonElement>(null)
  const pending = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [aiStatus, setAiStatus] = useState('')
  const [aiRows, setAiRows] = useState<readonly ContentFinding[]>([])
  const [aiPrecision, setAiPrecision] = useState<readonly AiPrecision[]>([])
  const [aiIndex, setAiIndex] = useState(-1)
  const anchors = useRef<AiSnapshot | null>(null)
  const [localCheck, setLocalCheck] = useState<{
    readonly rows: readonly FindingRow[]
    readonly html: string
    readonly title: string | null
  } | null>(null)
  if (localCheck && (localCheck.html !== bodyHtml || localCheck.title !== titleText)) setLocalCheck(null)
  const localRows = localCheck?.rows ?? null
  const [locateNotice, setLocateNotice] = useState<{ readonly id: string; readonly text: string } | null>(null)
  const current = aiRows[aiIndex]
  const notice = current ? aiNotice(current, aiPrecision[aiIndex]) : null

  function canvas() {
    return panel.current?.closest('.preview-canvas') ?? null
  }

  function currentAiTargets(article: Element, units: readonly TextUnit[]) {
    const previous = anchors.current
    if (!previous) return []
    const editing = article.getAttribute('contenteditable') === 'true'
    const next = rebaseAiAnchors(previous.anchors, previous.units, units, article, previous.editing && !editing)
    anchors.current = { units, anchors: next, editing }
    return aiRows.map((finding, index) => aiTarget(finding, next[index]))
  }

  useLayoutEffect(() => () => pending.current?.abort(), [])

  // Draw over the original text without mutating selection, undo or rich-text copy.
  useLayoutEffect(() => {
    const root = canvas()
    const article = root?.querySelector('#platform-article')
    if (!root || !article) return
    const registry = globalThis.CSS?.highlights
    const targets = compatibilityTargets(article, warnings.flatMap((warning) => warning.locations ?? []))
    if (imageRules.current) {
      const selectors = [...new Set(targets.images.map((image) => imageSelector(image, article)))]
      imageRules.current.textContent = selectors.length
        ? `${selectors.join(', ')} { outline: 2px solid var(--danger); outline-offset: 2px; }`
        : ''
    }
    const units = aiRows.length || localRows?.length ? articleTextUnits(root) : []
    const locations = aiRows.length ? currentAiTargets(article, units) : []
    const precision = locations.map((target) => target?.precision ?? 'unavailable')
    // Location depends on the browser-owned editable DOM. Publish the measured status after
    // this commit and discard it if a newer layout takes over before the microtask runs.
    let activeLayout = true
    if (precision.length !== aiPrecision.length || precision.some((value, index) => value !== aiPrecision[index])) {
      queueMicrotask(() => { if (activeLayout) setAiPrecision(precision) })
    }
    if (!registry || typeof Highlight === 'undefined') return () => { activeLayout = false }
    const active = locations[aiIndex]
    const currentRange = active ? rangeOf(active.unit, active.start, active.end) : null
    const ranges = locations.flatMap((target, index) => {
      if (index === aiIndex || target?.precision !== 'exact') return []
      const range = rangeOf(target.unit, target.start, target.end)
      return range ? [range] : []
    })
    for (const { finding, element } of localRows ?? []) {
      const range = outcomeRange(contentRange(units, finding, article, element))
      if (range) ranges.push(range)
    }
    if (currentRange) {
      const highlight = new Highlight(currentRange)
      highlight.priority = 3
      registry.set(CURRENT_MARK, highlight)
    }
    if (targets.ranges.length) registry.set(COMPAT_MARK, new Highlight(...targets.ranges))
    if (ranges.length) {
      const highlight = new Highlight(...ranges)
      highlight.priority = 1
      registry.set(CONTENT_MARK, highlight)
    }
    return () => {
      activeLayout = false
      registry.delete(COMPAT_MARK)
      registry.delete(CONTENT_MARK)
      registry.delete(CURRENT_MARK)
    }
  })

  async function runAiCheck() {
    const root = canvas()
    if (!enabled || !root || pending.current) return
    if (!config) {
      onOpenSettings?.()
      return
    }
    const units = articleTextUnits(root)
    const blocks = checkBlocks(units)
    anchors.current = null
    setAiRows([])
    setAiPrecision([])
    setAiIndex(-1)
    if (!blocks.length) {
      setAiStatus('当前成稿没有可检查的标题或正文文字。')
      return
    }
    const request = new AbortController()
    pending.current = request
    setBusy(true)
    setAiStatus('DeepSeek 正在检查当前成稿…')
    if (inEditor) requestAnimationFrame(() => panel.current?.scrollIntoView?.({ block: 'nearest' }))
    try {
      const issues = await requestDeepSeek(config, blocks, request.signal)
      if (request.signal.aborted) return
      const current = canvas()
      const article = current?.querySelector('#platform-article')
      const liveUnits = current ? articleTextUnits(current) : []
      if (!article || !sameCheckText(units, liveUnits)) {
        setAiStatus('成稿已变化，请重新检查。')
        return
      }
      const { findings, omitted } = matchDeepSeekIssues(issues, blocks, liveUnits)
      anchors.current = {
        units: liveUnits,
        editing: article.getAttribute('contenteditable') === 'true',
        anchors: findings.map(({ unit }) => ({ unit: liveUnits[unit] })),
      }
      setAiRows(findings)
      setAiStatus(omitted
        ? `DeepSeek 给出 ${findings.length} 条可核对建议；另有 ${omitted} 条无法与原文核对，未列出。`
        : findings.length ? `DeepSeek 给出 ${findings.length} 条建议，原稿和成稿未被改动。` : 'DeepSeek 未发现明显问题，仍请人工核对。')
    } catch (error) {
      if (!request.signal.aborted) setAiStatus(error instanceof Error ? error.message : 'AI 检查未完成，请重试。')
    } finally {
      if (pending.current === request) {
        pending.current = null
        setBusy(false)
      }
    }
  }

  function cancelAiCheck() {
    pending.current?.abort()
    pending.current = null
    setBusy(false)
    setAiStatus('已取消，未显示检查结果。')
  }

  function runLocalCheck() {
    const root = canvas()
    const article = root?.querySelector('#platform-article')
    if (!enabled || !root || !article || !baseline) return
    const units = articleTextUnits(root)
    setLocateNotice(null)
    setLocalCheck({
      html: bodyHtml,
      title: titleText,
      rows: checkAgainstBaseline(baseline, censusOf(article.innerHTML)).map((finding) => ({
        finding, element: contentFindingElement(units, finding, article),
      })),
    })
  }

  function locateLocal({ finding, element }: FindingRow) {
    const root = canvas()
    if (!root) return
    const outcome = contentRange(articleTextUnits(root), finding, root.querySelector('#platform-article'), element)
    const range = outcomeRange(outcome)
    if (range) locateRange(range)
    const text = outcome.status === 'unavailable' ? `未能定位：${outcome.reason}`
      : outcome.status === 'block' ? '已定位到疑似缩短的整个段落。' : null
    setLocateNotice(text ? { id: finding.id, text } : null)
  }

  function locateAi(index: number, fromList = false) {
    if (!aiRows[index]) return
    const root = canvas()
    const article = root?.querySelector('#platform-article')
    if (!root || !article) return
    const target = currentAiTargets(article, articleTextUnits(root))[index]
    setAiIndex(index)
    const scroll = root.closest<HTMLElement>('.preview__scroll')
    const review = scroll?.querySelector<HTMLElement>(':scope > .publish-review')
    // The locator is outside the desktop scroller; on narrow layouts it sticks to the page.
    const inset = scroll && scroll.scrollHeight > scroll.clientHeight
      ? review && getComputedStyle(review).position === 'sticky' ? review.offsetHeight : 0
      : locatorHost?.offsetHeight ?? 0
    if (target?.unit.element instanceof HTMLInputElement) {
      selectTitleInput(target.unit.element, target.start, target.end, fromList)
      return
    }
    const range = target ? rangeOf(target.unit, target.start, target.end) : null
    if (range) locateRange(range, inset)
    if (fromList && range) returnButton.current?.focus({ preventScroll: true })
  }

  return (
    <form ref={panel} id={ARTICLE_CHECK_FORM_ID} className="content-check" aria-label="内容检查"
      hidden={inEditor && !aiStatus && localRows === null} onSubmit={(event) => {
        event.preventDefault()
        const submitter = event.nativeEvent.submitter
        if (submitter instanceof HTMLButtonElement && submitter.value === 'local') runLocalCheck()
        else void runAiCheck()
      }}>
      <style ref={imageRules} />
      <div className="content-check__actions">
        {inEditor ? null : <button className="btn btn--secondary btn--small" type="submit" disabled={!enabled || !onOpenSettings || busy}>
          AI 检查内容
        </button>}
        {busy ? <button className="btn btn--ghost btn--small" type="button" onClick={cancelAiCheck}>取消 AI 检查</button> : null}
        {baseline ? <button className="btn btn--ghost btn--small" type="button" disabled={!enabled} onClick={runLocalCheck}>本地比对</button> : null}
      </div>
      {aiStatus || !inEditor && onOpenSettings ? (
        <p className="content-check__summary" role="status">
          {aiStatus || (config ? '点击后发送当前成稿纯文本给 DeepSeek。' : '首次使用请先配置 DeepSeek。')}
        </p>
      ) : null}
      {locatorHost && aiRows.length ? createPortal(
        <div className="ai-locator" role="group" aria-label="AI 定位导航"
          data-title-current={current?.title && aiPrecision[aiIndex] !== 'unavailable' ? true : undefined}>
          <div className="ai-locator__context" role="status">
            <strong>AI 定位 · {current ? `第 ${aiIndex + 1} / ${aiRows.length} 处` : `共 ${aiRows.length} 处`}</strong>
            {current ? (
              <span title={`${current.original} · ${current.detail ?? current.advice}`}>
                {current.title ? '标题' : '正文'} · {clipExcerpt(current.original)}
              </span>
            ) : null}
          </div>
          <div className="ai-locator__actions">
            <button className="btn btn--ghost btn--small" type="button" aria-disabled={aiIndex <= 0}
              onClick={() => locateAi(aiIndex - 1)}>上一处</button>
            <button className="btn btn--secondary btn--small" type="button" ref={returnButton}
              onClick={() => locateAi(Math.max(0, aiIndex))}>{current ? '回到此处' : '定位首处'}</button>
            <button className="btn btn--ghost btn--small" type="button" aria-disabled={!current || aiIndex >= aiRows.length - 1}
              onClick={() => { if (current) locateAi(aiIndex + 1) }}>下一处</button>
          </div>
          {notice ? <p className="ai-locator__notice" role="status">{notice}</p> : null}
        </div>, locatorHost,
      ) : null}
      {aiRows.length ? <>
        <p className="content-check__summary">这批建议来自上次检查。改稿后可继续定位，不会自动复检。</p>
        <ul className="content-check__list" aria-label="AI 检查结果">
          {aiRows.map((finding, index) => (
            <FindingItem key={finding.id} finding={finding} feedback={aiNotice(finding, aiPrecision[index])}
              onLocate={() => locateAi(index, true)} ai selected={index === aiIndex} />
          ))}
        </ul>
      </> : null}
      {localRows === null ? null : <p className="content-check__summary" role="status">
        {localRows.length ? `本地比对发现 ${localRows.length} 处需核对，仅比较排版前后的段落与元素。` : '本地比对未发现明显结构差异。'}
      </p>}
      {localRows?.length ? <ul className="content-check__list" aria-label="本地比对结果">
        {localRows.map((row) => (
          <FindingItem key={row.finding.id} finding={row.finding}
            feedback={locateNotice?.id === row.finding.id ? locateNotice.text : null} onLocate={() => locateLocal(row)} />
        ))}
      </ul> : null}
    </form>
  )
}
