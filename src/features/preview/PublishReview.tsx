import { useRef, useState } from 'react'
import { clipExcerpt, formatClock } from '@/app/text'
import { Icon } from '@/components/Icon'
import { getPublishPolicy, PUBLISH_POLICY_CHECKED_ON, PUBLISH_RULES } from '@/core/publish-review/policies'
import { reviewPublishUnits, type PublishFinding, type PublishReviewResult } from '@/core/publish-review/review'
import { collectBodyUnits } from '@/core/publish-review/units'
import type { PlatformDefinition } from '@/core/types'
import type { StudioStatus } from '@/app/studio-state'
import { locatePublishFinding, publishFindingElement } from './issue-locations'

interface PublishReviewProps {
  readonly platform: PlatformDefinition
  readonly status: StudioStatus
  readonly result: PublishReviewResult | null
  readonly failed: boolean
}

/**
 * 手动重算的结果：只代表点按钮那一刻屏幕上的正文。
 * 同时记下当时的正文摘要，正文一变这份结果就自动失效，不用副作用清状态。
 */
interface ManualScan {
  readonly status: 'reviewed' | 'unavailable'
  readonly findings: readonly PublishFinding[]
  readonly at: number
  readonly signature: string
}

function reviewStatus(result: PublishReviewResult | null, status: StudioStatus, failed: boolean) {
  const previous = failed ? '重排失败 · 上次成稿：' : ''
  if (result?.status === 'reviewed') {
    const summary = result.findings.length ? `发现 ${result.findings.length} 项疑似风险` : '本地未发现疑似风险'
    return `${previous}${summary}`
  }
  if (result?.status === 'unavailable') return `${previous}检查未完成，请人工核对`
  if (status === 'typesetting') return '排版完成后自动检查'
  if (status === 'stale') return '结果已过期，请重新排版'
  if (status === 'parse-error' || failed) return '未生成可检查的成稿'
  return '等待一键排版'
}

function scanStatus(scan: ManualScan, failed: boolean): string {
  const previous = failed ? '重排失败 · 上次成稿：' : ''
  if (scan.status === 'unavailable') return `${previous}重新检测未完成，请人工核对`
  return scan.findings.length > 0
    ? `${previous}重新检测 · 发现 ${scan.findings.length} 项疑似风险`
    : `${previous}重新检测 · 本地未发现疑似风险`
}

/** 组件内不能直接读时钟：把它包一层，渲染期与事件回调都保持纯。 */
function checkedAt(): number {
  return Date.now()
}

/** 一条提示的唯一标识：规则、位置和命中起点足以区分同一块里的不同提示。 */
function findingKey(finding: PublishFinding): string {
  return `${finding.rule}-${finding.location}-${finding.start}`
}

export function PublishReview({ platform, status, result, failed }: PublishReviewProps) {
  const policy = getPublishPolicy(platform.id)
  const panel = useRef<HTMLElement>(null)
  // 手动折叠只对当前这份结果有效：结果一变（改稿、重检、换风险）就作废，回到默认展开。
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const [openSignature, setOpenSignature] = useState('')
  const [lastLocated, setLastLocated] = useState<{ finding: PublishFinding; element: Element | null } | null>(null)
  const [scan, setScan] = useState<ManualScan | null>(null)
  const [feedback, setFeedback] = useState<{
    readonly key: string
    readonly signature: string
    readonly tone: 'warn' | 'muted'
    readonly text: string
  } | null>(null)

  const derived = result?.status === 'reviewed' ? result.findings : []
  // 成稿文字一变，上一次手动检测的结论就不再代表当前正文，自动退回自动检测结果。
  const signature = `${result?.status ?? 'none'}|${derived
    .map((finding) => `${findingKey(finding)}:${finding.end}:${finding.context}`)
    .join(',')}`
  const activeScan = scan !== null && scan.signature === signature ? scan : null
  const findings = activeScan ? activeScan.findings : derived
  const unavailable = Boolean(activeScan ? activeScan.status === 'unavailable' : result?.status === 'unavailable')
  const needsAttention = findings.length > 0 || unavailable
  // 渲染期按前值调整状态：结果签名一变就丢掉手动折叠，不必等到副作用里再清。
  if (openSignature !== signature) {
    setOpenSignature(signature)
    setManualOpen(null)
  }
  const previousTarget = status === 'typeset' && result !== null && lastLocated !== null && !findings.some((item) =>
    findingKey(item) === findingKey(lastLocated.finding) && item.context === lastLocated.finding.context) ? lastLocated : null
  const open = manualOpen ?? (needsAttention || activeScan !== null || previousTarget !== null)
  const feedbackFor = feedback !== null && feedback.signature === signature ? feedback : null
  const blockReason = (() => {
    if (status === 'stale') return '源稿已更新，当前是上一版成稿；重新排版后再检测。'
    if (status === 'typesetting') return '正在排版，完成后可检测。'
    if (status === 'parse-error') return '源稿无法解析，没有可检测的成稿。'
    if (status === 'empty' || status === 'ready') return '先点「一键排版」生成成稿，再检测。'
    if (result === null) return '当前平台这次没有生成成稿；切到其它平台或重新排版后再检测。'
    return null
  })()

  function canvas(): Element | null {
    return panel.current?.closest('.preview__scroll')?.querySelector('.preview-canvas') ?? null
  }

  function recheck() {
    setFeedback(null)
    setLastLocated(null)
    const root = canvas()
    const article = root?.querySelector('#platform-article')
    if (!root || !article) {
      setScan({ status: 'unavailable', findings: [], at: checkedAt(), signature })
      return
    }
    const title = root.querySelector('.article-title')?.textContent?.trim() ?? ''
    const outcome = reviewPublishUnits(platform.id, title === '' ? null : title, collectBodyUnits(article))
    setScan(outcome.status === 'reviewed'
      ? { status: 'reviewed', findings: outcome.findings, at: checkedAt(), signature }
      : { status: 'unavailable', findings: [], at: checkedAt(), signature })
  }

  function locate(finding: PublishFinding, previousElement?: Element | null) {
    const root = canvas()
    if (!root) return setFeedback({ key: findingKey(finding), signature, tone: 'warn', text: '当前没有可定位的正文。' })
    if (previousElement === undefined) setLastLocated({ finding, element: publishFindingElement(root, finding) })
    const outcome = locatePublishFinding(root, finding, previousElement)
    if (outcome.status === 'unavailable') {
      setFeedback({
        key: findingKey(finding),
        signature,
        tone: 'warn',
        text: `未能定位：${outcome.message ?? '正文已变化'} 点「一键检测」更新结果后再试。`,
      })
      return
    }
    setFeedback(outcome.message === null ? null : {
      key: findingKey(finding),
      signature,
      tone: 'muted',
      text: outcome.message,
    })
  }

  return (
    <section className="publish-review" data-tone={needsAttention ? 'warn' : 'quiet'} ref={panel} aria-label="发布预检">
      <div className="publish-review__header">
        <button
          className="publish-review__summary"
          type="button"
          aria-expanded={open}
          aria-controls="publish-review-body"
          onClick={() => setManualOpen(!open)}
        >
          <Icon name={needsAttention ? 'alert' : 'file'} />
          <span>发布预检</span>
          <Icon name="chevron" className="publish-review__chevron" data-open={open} />
        </button>
        <p className="publish-review__status" role="status">
          {activeScan ? scanStatus(activeScan, failed) : reviewStatus(result, status, failed)}
        </p>
        <button
          className="btn btn--ghost btn--small publish-review__action"
          type="button"
          onClick={recheck}
          disabled={blockReason !== null}
          aria-describedby={blockReason === null ? undefined : 'publish-review-block'}
          title={blockReason ?? '按当前正文重新检测一次'}
        >
          <Icon name="refresh" />
          一键检测
        </button>
      </div>
      {blockReason === null ? null : (
        <p className="publish-review__check publish-review__check--bar" data-tone="warn" id="publish-review-block">{blockReason}</p>
      )}
      <div className="publish-review__content" id="publish-review-body" hidden={!open}>
        <p className="publish-review__note">
          仅在本机检查标题和成稿文字，不上传稿件；未提示不等于平台审核通过，图片、代码块、外部内容和事实真伪仍须人工核对。
          {findings.length > 0 ? '每个文字块的同类提示只列首处。' : null}
        </p>
        {activeScan === null ? null : (
          <p className="publish-review__check" role="status">已按当前正文检测 · {formatClock(activeScan.at)}</p>
        )}
        {previousTarget ? (
          <div className="publish-review__check">
            <span>上一次定位的提示已变化；以当前检测结果为准。</span>{' '}
            <button className="btn btn--ghost btn--small" type="button" onClick={() => locate(previousTarget.finding, previousTarget.element)}>
              定位上次提示所在段落
            </button>
            {feedbackFor?.key === findingKey(previousTarget.finding) ? (
              <p className="publish-review__check" data-tone={feedbackFor.tone} role="status">{feedbackFor.text}</p>
            ) : null}
          </div>
        ) : null}
        {findings.length > 0 ? (
          <ol className="publish-review__findings" tabIndex={0} aria-label="疑似风险位置，可滚动">
            {findings.map((finding) => (
              <li key={findingKey(finding)}>
                <p className="publish-review__finding-title">
                  <strong>{PUBLISH_RULES[finding.rule].title}</strong>
                  <span>{finding.location}</span>
                </p>
                <p className="publish-review__excerpt">「{finding.excerpt}」</p>
                <p>{PUBLISH_RULES[finding.rule].action}</p>
                <button
                  className="btn btn--ghost btn--small"
                  type="button"
                  aria-label={`定位${finding.location}的「${clipExcerpt(finding.excerpt, 24)}」`}
                  onClick={() => locate(finding)}
                >
                  定位
                </button>
                {feedbackFor?.key === findingKey(finding) ? (
                  <p className="publish-review__check" data-tone={feedbackFor.tone} role="status">{feedbackFor.text}</p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
        <details className="publish-review__sources">
          <summary>{platform.name}发布规则与来源</summary>
          <ul className="publish-review__source-list">
            {policy.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer">{source.label}<Icon name="external" size={12} /></a>
                <span className="publish-review__source-type">{source.access === 'public-text' ? '公开正文' : '官方入口'}</span>
                <p>{source.detail}</p>
              </li>
            ))}
          </ul>
          <p><strong>本地检查：</strong>{policy.rules.map((id) => PUBLISH_RULES[id].title).join('、')}。</p>
          <p><strong>发布前人工核对：</strong></p>
          <ul className="publish-review__manual">
            {policy.manualChecks.map((check) => <li key={check}>{check}</li>)}
          </ul>
          <p className="publish-review__note">规则资料查阅于 <time dateTime={PUBLISH_POLICY_CHECKED_ON}>{PUBLISH_POLICY_CHECKED_ON}</time>，以平台当前公告和审核为准。</p>
        </details>
      </div>
    </section>
  )
}
