import { Icon } from '@/components/Icon'
import { getPublishPolicy, PUBLISH_POLICY_CHECKED_ON, PUBLISH_RULES } from '@/core/publish-review/policies'
import type { PublishReviewResult } from '@/core/publish-review/review'
import type { PlatformDefinition } from '@/core/types'
import type { StudioStatus } from '@/app/studio-state'

interface PublishReviewProps {
  readonly platform: PlatformDefinition
  readonly status: StudioStatus
  readonly result: PublishReviewResult | null
  readonly failed: boolean
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

export function PublishReview({ platform, status, result, failed }: PublishReviewProps) {
  const policy = getPublishPolicy(platform.id)
  const findings = result?.status === 'reviewed' ? result.findings : []
  const hasFindings = findings.length > 0
  const needsAttention = hasFindings || result?.status === 'unavailable'

  return (
    <details className="publish-review" data-tone={needsAttention ? 'warn' : 'quiet'} open={needsAttention}>
      <summary className="publish-review__summary">
        <Icon name={needsAttention ? 'alert' : 'file'} />
        <span>发布预检</span>
        <span className="publish-review__status" role="status">{reviewStatus(result, status, failed)}</span>
        <Icon name="chevron" className="publish-review__chevron" />
      </summary>
      <div className="publish-review__content">
        <p className="publish-review__note">
          仅在本机检查标题和成稿文字，不上传稿件。未提示不等于平台审核通过；图片、代码块、链接目标、事实真伪与实际授权须人工核对。
          {hasFindings ? '每个文字块的同类提示只列首处。' : null}
        </p>
        {hasFindings ? (
          <ol className="publish-review__findings" tabIndex={0} aria-label="疑似风险位置，可滚动">
            {findings.map(({ rule, location, excerpt }) => (
              <li key={`${rule}-${location}`}>
                <p className="publish-review__finding-title"><strong>{PUBLISH_RULES[rule].title}</strong><span>{location}</span></p>
                <p className="publish-review__excerpt">「{excerpt}」</p>
                <p>{PUBLISH_RULES[rule].action}</p>
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
    </details>
  )
}
