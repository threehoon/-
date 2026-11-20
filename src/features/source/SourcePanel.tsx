import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import type { DocumentStats, TitleCandidate } from '@/core/types'
import type { AssetNotice, ImportNotice, StudioStatus } from '@/app/studio-state'
import { formatCount } from '@/app/text'
import { Icon } from '@/components/Icon'
import { AssetPairing } from '@/features/assets/AssetPairing'

export interface SourcePanelProps {
  readonly markdown: string
  readonly sourceLocked: boolean
  readonly onMarkdownChange: (value: string) => void
  readonly onImport: (files: readonly File[]) => void
  readonly importNotice: ImportNotice | null
  readonly onDismissImportNotice: () => void
  readonly status: StudioStatus
  readonly stats: DocumentStats | null
  readonly parseErrorMessage: string | null
  readonly titleCandidate: TitleCandidate | null
  readonly remoteImages: readonly string[]
  readonly localImages: readonly string[]
  readonly boundAssets: Readonly<Record<string, string>>
  readonly assetNotice: AssetNotice | null
  readonly onBindAsset: (raw: string, file: File) => void
  readonly onUnbindAsset: (raw: string) => void
}

/** 左栏接收、查看原稿，并保留原稿引用的图片配对。 */
export function SourcePanel({
  markdown,
  sourceLocked,
  onMarkdownChange,
  onImport,
  importNotice,
  onDismissImportNotice,
  status,
  stats,
  parseErrorMessage,
  titleCandidate,
  remoteImages,
  localImages,
  boundAssets,
  assetNotice,
  onBindAsset,
  onUnbindAsset,
}: SourcePanelProps) {
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      onImport([file])
    }
    // 清空 value，允许连续导入同一个文件。
    event.target.value = ''
  }

  return (
    <section
      className="panel panel--source"
      aria-labelledby="source-title"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        onImport(Array.from(event.dataTransfer.files))
      }}
    >
      <div className="panel__header">
        <h2 className="panel__title" id="source-title">
          导入源稿
        </h2>
        <button
          className="btn btn--secondary btn--small"
          type="button"
          onClick={() => {
            fileRef.current?.click()
          }}
        >
          <Icon name="upload" />
          导入 .md
        </button>
      </div>

      <div className="panel__body">
        <p className="field__hint source__import-hint">
          {sourceLocked
            ? '原稿只读，不会被右侧成稿编辑或联动改动。'
            : '拖入 Markdown 或 TXT 文件，或把 Markdown 粘贴到下方。生成成稿后，原稿将保持只读。'}
        </p>

        {importNotice === null ? null : (
          <div className="import-notice" data-tone={importNotice.tone} role="status">
            <p className="import-notice__message">{importNotice.message}</p>
            {importNotice.detail === null ? null : (
              <p className="import-notice__detail">{importNotice.detail}</p>
            )}
            <button
              className="import-notice__dismiss"
              type="button"
              onClick={onDismissImportNotice}
              aria-label="关闭导入提示"
            >
              <Icon name="close" />
            </button>
          </div>
        )}

        <div className="source__editor">
          <div className="field__label-row">
            <label className="field__label" htmlFor="source-markdown">
              Markdown 源稿
            </label>
            <span className="source__stats" id="source-stats">
              {parseErrorMessage === null ? (
                stats === null ? (
                  '暂无统计'
                ) : (
                  <>
                    <span className="source__stat">{formatCount(stats.characters)} 字</span>
                    <span className="source__stat">{stats.blocks} 块</span>
                  </>
                )
              ) : (
                <span className="source__stat source__stat--warn">解析未通过，统计暂不可用</span>
              )}
            </span>
          </div>
          <textarea
            id="source-markdown"
            className="source__textarea"
            value={markdown}
            onChange={(event) => onMarkdownChange(event.currentTarget.value)}
            readOnly={sourceLocked}
            aria-describedby="source-stats"
            spellCheck={false}
            placeholder="把 Markdown 粘贴到这里，或点击上方「导入 .md」。"
          />
          {parseErrorMessage === null ? null : (
            <p className="field__error" role="status">
              源稿暂时无法解析：{parseErrorMessage}
              。{sourceLocked ? '请修正原文件后重新导入。' : '请检查上方原稿后再排版。'}
            </p>
          )}
        </div>

        {titleCandidate?.value ? (
          <p className="field__hint">原稿标题：{titleCandidate.value}</p>
        ) : null}

        <AssetPairing
          remoteImages={remoteImages}
          localImages={localImages}
          boundAssets={boundAssets}
          notice={assetNotice}
          onBind={onBindAsset}
          onUnbind={onUnbindAsset}
        />

        <p className="source__status-line" data-status={status}>
          当前状态：
          {
            {
              empty: '还没有源稿',
              ready: '源稿就绪，尚未排版',
              typesetting: '正在排版',
              typeset: '已排版，可在右侧编辑或复制',
              stale: '原稿配图有改动，需重新排版',
              'parse-error': '源稿无法解析',
            }[status]
          }
        </p>
      </div>

      <input
        ref={fileRef}
        className="visually-hidden"
        type="file"
        accept=".md,.markdown,.mdown,.txt,text/markdown,text/plain"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFileChange}
      />
    </section>
  )
}
