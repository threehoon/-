import type { ReactNode } from 'react'
import type { PlatformDefinition } from '@/core/types'
import { Icon } from '@/components/Icon'
import type { CopyKind, CopyNotice, ManualCopy } from '@/app/studio-state'
import { PublishLinks } from './PublishLinks'

const COPY_BLOCK_REASON_ID = 'copy-block-reason'

const KIND_LABEL: Record<CopyKind, string> = {
  title: '标题',
  body: '正文',
}

export interface ManualCopyFallbackProps {
  readonly manualCopy: ManualCopy
  readonly onDismiss: () => void
}

/** 复制失败时的兜底：把要粘贴的内容原样交回用户，不假装已经复制。 */
export function ManualCopyFallback({ manualCopy, onDismiss }: ManualCopyFallbackProps) {
  const hasText = manualCopy.text.trim() !== ''
  return (
    <div className="manual-copy" role="group" aria-labelledby="manual-copy-title">
      <p className="manual-copy__title" id="manual-copy-title">
        手动复制{KIND_LABEL[manualCopy.kind]}：浏览器没有完成自动复制
      </p>
      <p className="manual-copy__reason">原因：{manualCopy.reason}</p>
      <p className="manual-copy__hint">
        {hasText
          ? '点下方文本框自动全选，按 Ctrl / ⌘ + C 复制。这里仅提供纯文本；如果有图片，请在平台编辑器内手动上传补插。'
          : '当前没有可手动复制的纯文本。请允许剪贴板访问后重试，或在平台编辑器中补插非文本内容。'}
        {manualCopy.kind === 'body' ? ' 想保留格式，可在下方成稿预览里选中正文，按 Ctrl / ⌘ + C，再到平台编辑器正常粘贴。' : null}
      </p>
      {hasText ? <textarea
        className="manual-copy__textarea"
        aria-label={`手动复制${KIND_LABEL[manualCopy.kind]}的内容`}
        readOnly
        rows={6}
        value={manualCopy.text}
        onFocus={(event) => {
          event.currentTarget.select()
        }}
      /> : null}
      <button className="btn btn--secondary manual-copy__dismiss" type="button" onClick={onDismiss}>
        关闭手动复制
      </button>
    </div>
  )
}

export interface CopyActionsProps {
  readonly platform: PlatformDefinition
  /** 正文不可复制时的原因，可能与标题共享。 */
  readonly copyBlockReason: string | null
  /** 只有标题不可复制时（例如源稿没有标题）的原因。 */
  readonly titleBlockReason: string | null
  readonly copyNotice: CopyNotice | null
  readonly manualCopy: ManualCopy | null
  readonly onCopyTitle: () => void
  readonly onCopyBody: () => void
  readonly editAction?: ReactNode
  readonly focusAction?: ReactNode
  readonly templateAction?: ReactNode
  readonly focused?: boolean
  readonly draftStatus?: ReactNode
  readonly onDismissManual: () => void
}

export function CopyActions({
  platform,
  copyBlockReason,
  titleBlockReason,
  copyNotice,
  manualCopy,
  onCopyTitle,
  onCopyBody,
  editAction,
  focusAction,
  templateAction,
  focused = false,
  draftStatus,
  onDismissManual,
}: CopyActionsProps) {
  const reason = copyBlockReason ?? titleBlockReason
  const separateTitleReason = copyBlockReason !== null && titleBlockReason !== null && copyBlockReason !== titleBlockReason
  return (
    <div className="action-bar">
      <div className="action-bar__buttons">
        {focused ? (
          <div className="action-bar__identity">
            <h1 id="focused-platform-name" className="action-bar__platform">{platform.name}</h1>
            {draftStatus}
          </div>
        ) : null}
        <button
          hidden={focused}
          className="btn btn--secondary"
          type="button"
          onClick={onCopyTitle}
          disabled={titleBlockReason !== null}
          aria-describedby={titleBlockReason === null ? undefined : separateTitleReason ? 'title-copy-block-reason' : COPY_BLOCK_REASON_ID}
        >
          复制标题
        </button>
        <button
          className="btn btn--primary"
          type="button"
          onClick={onCopyBody}
          disabled={copyBlockReason !== null}
          aria-describedby={copyBlockReason === null ? undefined : COPY_BLOCK_REASON_ID}
        >
          <Icon name="copy" />
          复制正文
        </button>
        {focused ? null : editAction}
        {focusAction}
        {templateAction}
        <a
          hidden={focused}
          className="btn btn--ghost"
          href={platform.entryUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={platform.id === 'sohu'
            ? '在新窗口打开搜狐号创作中心（需登录）'
            : `在新窗口打开${platform.name}的${platform.articleLabel}编辑器（需要登录后粘贴）`}
        >
          {platform.id === 'sohu' ? '打开创作中心' : '打开平台'}
          <Icon name="external" />
        </a>
        {focused ? null : <PublishLinks />}
      </div>

      <p className="copy-status" role="status" aria-live="polite">
        {copyNotice?.message ?? ''}
      </p>

      {reason === null ? null : (
        <p className="action-bar__reason" id={COPY_BLOCK_REASON_ID}>
          <Icon name="info" className="action-bar__reason-icon" />
          复制已禁用：{reason}
        </p>
      )}

      {separateTitleReason ? (
        <p className="action-bar__reason" id="title-copy-block-reason">复制标题已禁用：{titleBlockReason}</p>
      ) : null}

      {manualCopy === null ? null : (
        <ManualCopyFallback manualCopy={manualCopy} onDismiss={onDismissManual} />
      )}
    </div>
  )
}
