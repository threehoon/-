import { useId, useRef, useState } from 'react'
import type { CompatWarning, WarningSeverity } from '@/core/types'
import { Icon } from '@/components/Icon'
import { clipExcerpt } from '@/app/text'
import { InspectionPopover } from './InspectionPopover'

const SEVERITY_LABEL: Record<WarningSeverity, string> = {
  blocker: '必须处理',
  attention: '注意',
  info: '提示',
}

export interface CompatibilityListProps {
  readonly platformName: string
  readonly warnings: readonly CompatWarning[]
  /** 定位结果：命中原文、只落到段落、或找不到；界面按三种情况给出不同反馈。 */
  readonly onLocate?: (warning: CompatWarning) => LocateFeedback
}

export interface LocateFeedback {
  readonly status: 'located' | 'block' | 'unavailable'
  readonly message?: string
}

const LOCATE_NOTICE: Record<LocateFeedback['status'], string | null> = {
  located: null,
  block: '这段文字已经改过，已定位到它所在的段落。',
  unavailable: '当前无法可靠定位，请按原文片段查找。',
}

/**
 * 复制按钮旁保留风险摘要，详情只在主动打开侧栏后显示。
 * blocker 前置实心标记，并同时写出文字等级，不靠颜色单独传达。
 */
export function CompatibilityList({
  platformName,
  warnings,
  onLocate,
}: CompatibilityListProps) {
  const id = useId()
  const panel = useRef<HTMLElement>(null)
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null)
  const blockers = warnings.filter((warning) => warning.severity === 'blocker').length
  const rest = warnings.length - blockers
  const summary = blockers > 0
    ? rest > 0
      ? `${blockers} 项需处理，另有 ${rest} 项提示 · 复制前需确认`
      : `${blockers} 项需处理 · 复制前需确认`
    : `${warnings.length} 项兼容性提示 · 复制前需确认`

  return (
    <section className="compat" aria-label={`${platformName}兼容性检查`}>
      <button className="compat__toggle" type="button" popoverTarget={id} aria-describedby={`${id}-summary`}>
        <Icon name="alert" />
        {platformName}兼容性
      </button>
      <p className="compat__summary" id={`${id}-summary`}>{summary}</p>
      <InspectionPopover id={id} heading={`${platformName}兼容性清单`} panelRef={panel}>
        <ul className="compat__list">
          {warnings.map((warning) => (
            <li
              key={warning.id}
              className="compat__item"
              data-severity={warning.severity}
            >
              <span className="compat__marker" aria-hidden="true" />
              <div className="compat__content">
                <p className="compat__line">
                  <span className="compat__severity">{SEVERITY_LABEL[warning.severity]}</span>
                  <span className="compat__message">{warning.message}</span>
                </p>
                <p className="compat__action">{warning.action}</p>
                {onLocate && warning.locations?.length ? (
                  <button
                    className="btn btn--ghost btn--small"
                    type="button"
                    aria-label={`定位 ${warning.message}`}
                    onClick={() => {
                      const feedback = onLocate(warning)
                      if (feedback.status === 'located') panel.current?.hidePopover?.()
                      const text = feedback.message ?? LOCATE_NOTICE[feedback.status]
                      setNotice(text ? { id: warning.id, text } : null)
                    }}
                  >
                    定位
                  </button>
                ) : null}
                {notice?.id === warning.id ? <p className="compat__action" role="status">{notice.text}</p> : null}
                {warning.source === 'source' ? (
                  // 成稿里看不出原文的项：可能已经在编辑时改掉了，提示用户重新排版确认。
                  <p className="compat__action" data-tone="quiet">可能已修复 · 重新排版确认</p>
                ) : null}
                {warning.excerpt.trim() === '' ? null : (
                  <p className="compat__excerpt">
                    <span className="compat__excerpt-label">原文片段</span>
                    <code>{clipExcerpt(warning.excerpt)}</code>
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </InspectionPopover>
    </section>
  )
}
