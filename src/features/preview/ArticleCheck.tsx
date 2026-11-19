import { useLayoutEffect, useRef, useState } from 'react'
import type { CompatWarning } from '@/core/types'
import { clipExcerpt } from '@/app/text'
import { articleTextUnits, checkArticleContent, contentFindingElement, contentRange, type ContentFinding } from './content-check'
import { compatibilityTargets, locateRange, outcomeRange } from './issue-locations'
import { checkAgainstBaseline } from './content-baseline'
import { censusOf, type ContentCensus } from './content-census'
import { ARTICLE_CHECK_FORM_ID } from './panel-ids'

const CONTENT_MARK = 'studio-content-issue'
const COMPAT_MARK = 'studio-compat-issue'

function imageSelector(image: HTMLImageElement, article: Element): string {
  const levels: string[] = []
  for (let child: Element = image; child !== article && child.parentElement; child = child.parentElement) {
    const index = Array.from(child.parentElement.children).indexOf(child)
    levels.unshift(`:nth-child(${index + 1})`)
  }
  return ['#platform-article', ...levels].join(' > ')
}

export function ArticleCheck({ enabled, inEditor, warnings, baseline }: {
  readonly enabled: boolean
  readonly inEditor: boolean
  readonly warnings: readonly CompatWarning[]
  readonly baseline: ContentCensus | null
}) {
  const panel = useRef<HTMLFormElement>(null)
  const imageRules = useRef<HTMLStyleElement>(null)
  const [findings, setFindings] = useState<readonly { finding: ContentFinding; element: Element | null }[] | null>(null)
  /** 定位反馈：只落到段落、或找不到时，把原因写在对应条目的下面。 */
  const [locateNotice, setLocateNotice] = useState<{ readonly id: string; readonly text: string } | null>(null)

  function canvas() {
    return panel.current?.closest('.preview-canvas') ?? null
  }

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
    if (!registry || typeof Highlight === 'undefined') return
    const units = findings ? articleTextUnits(root) : []
    const ranges = findings?.flatMap(({ finding, element }) => {
      const outcome = contentRange(units, finding, article, element)
      return outcomeRange(outcome) ?? []
    }) ?? []
    if (targets.ranges.length) registry.set(COMPAT_MARK, new Highlight(...targets.ranges))
    if (ranges.length) {
      const highlight = new Highlight(...ranges)
      highlight.priority = 1
      registry.set(CONTENT_MARK, highlight)
    }
    return () => {
      registry.delete(COMPAT_MARK)
      registry.delete(CONTENT_MARK)
    }
  })

  return (
    <form
      ref={panel}
      id={ARTICLE_CHECK_FORM_ID}
      className="content-check"
      hidden={inEditor && findings === null}
      aria-label="内容检查"
      onSubmit={(event) => {
        event.preventDefault()
        const root = canvas()
        const article = root?.querySelector('#platform-article')
        if (!enabled || !root || !article) return
        const differences = baseline ? checkAgainstBaseline(baseline, censusOf(article.innerHTML)) : []
        setLocateNotice(null)
        const units = articleTextUnits(root)
        setFindings([...differences, ...checkArticleContent(units)].map((finding) => ({
          finding, element: contentFindingElement(units, finding, article),
        })))
        if (inEditor) requestAnimationFrame(() => panel.current?.scrollIntoView({ block: 'nearest' }))
      }}
    >
      <style ref={imageRules} />
      {inEditor ? null : <button
        className="btn btn--secondary btn--small"
        type="submit"
        disabled={!enabled}
      >
        一键检查内容
      </button>}
      {findings === null ? null : (
        <p className="content-check__summary" role="status">
          {findings.length === 0 ? '本地校对与基线差异未发现问题，不代表稿件没有遗漏或语病。' : `发现 ${findings.length} 处需要核对。`}
        </p>
      )}
      {findings?.length ? (
        <ul className="content-check__list" aria-label="内容检查结果">
          {findings.map(({ finding, element }) => (
            <li key={finding.id}>
              <div>
                <strong>{finding.title ? '标题' : '正文'} · {clipExcerpt(finding.original)}</strong>
                <p>{finding.advice}</p>
                {finding.detail ? <p>{finding.detail}</p> : null}
                {locateNotice?.id === finding.id ? (
                  <p className="content-check__notice" role="status">{locateNotice.text}</p>
                ) : null}
              </div>
              <button
                className="btn btn--ghost btn--small"
                type="button"
                onClick={() => {
                  const root = canvas()
                  const outcome = root ? contentRange(articleTextUnits(root), finding, root.querySelector('#platform-article'), element) : null
                  if (!outcome) {
                    setLocateNotice({ id: finding.id, text: '这一版成稿里没有可定位的正文。' })
                    return
                  }
                  const range = outcomeRange(outcome)
                  if (range) locateRange(range)
                  setLocateNotice({
                    id: finding.id,
                    text: outcome.status === 'unavailable'
                      ? `未能定位：${outcome.reason}`
                      : outcome.status === 'block'
                         ? finding.kind === 'shrunk' ? '已定位到疑似缩短的整个段落。' : '这段文字已经改过，已定位到它所在的段落。'
                         : '',
                  })
                }}
                aria-label={`定位${finding.title ? '标题' : '正文'}中的「${clipExcerpt(finding.original)}」`}
              >
                定位
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  )
}
