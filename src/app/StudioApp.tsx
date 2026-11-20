import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { WorkspaceDivider } from '@/app/WorkspaceDivider'
import type { CompatibilityLocation, CompatWarning, PlatformId, RenderedDocument } from '@/core/types'
import type { StudioApi } from '@/app/use-studio'
import { selectActiveTemplate, selectPlatformResult, selectTemplateEditConflict } from '@/app/studio-state'
import { formatClock } from '@/app/text'
import { Icon } from '@/components/Icon'
import { CopyActions } from '@/features/actions/CopyActions'
import { LiveLinkControl } from '@/features/actions/LiveLinkControl'
import { PlatformTabs } from '@/features/preview/PlatformTabs'
import { WechatTemplatePicker } from '@/features/preview/WechatTemplatePicker'
import { platformTabId } from '@/features/preview/panel-ids'
import { PublishReview } from '@/features/preview/PublishReview'
import { PreviewPanel } from '@/features/preview/PreviewPanel'
import { currentSourceSpan } from '@/features/preview/issue-locations'
import { SourcePanel } from '@/features/source/SourcePanel'
import { DeepSeekSettings } from '@/features/preview/DeepSeekSettings'
import type { DeepSeekConfig } from '@/features/preview/deepseek-check'
import { DEEPSEEK_STORAGE_KEY, loadRememberedDeepSeekConfig } from '@/features/preview/deepseek-config-store'

const PANEL_ID = 'platform-panel'
const DRAFT_LABELS: Readonly<Record<StudioApi['draftStatus'], string>> = {
  loading: '正在读取本机草稿…',
  ready: '',
  saving: '正在保存到本机…',
  saved: '草稿已保存到本机',
  'load-error': '无法读取本机草稿，自动保存未启用。离开前请复制备份。',
  'save-error': '草稿未能保存。继续编辑可重试，离开前请复制备份。',
  conflict: '另一标签页已更新草稿。本页改动未保存，请先复制备份，再刷新获取已保存的草稿。',
}

function statusLabel(api: StudioApi): string {
  const typesetAt = api.state.report?.typesetAt ?? null
  switch (api.status) {
    case 'empty': {
      return '未开始 · 等待源稿'
    }
    case 'ready': {
      return '源稿就绪 · 尚未排版'
    }
    case 'typesetting': {
      return '正在排版…'
    }
    case 'typeset': {
      return typesetAt === null ? '已排版' : `已排版 · ${formatClock(typesetAt)}`
    }
    case 'stale': {
      return '原稿配图已更新 · 需重新排版'
    }
    case 'parse-error': {
      return '源稿无法解析'
    }
    default: {
      return '状态未知'
    }
  }
}

function failedPlatformIds(api: StudioApi): readonly PlatformId[] {
  const report = api.state.report
  if (!report || report.parseError !== null) {
    return []
  }
  return report.results
    .filter((result) => !result.outcome.ok)
    .map((result) => result.platform)
}

function platformName(api: StudioApi, id: PlatformId): string {
  return api.platforms.find((candidate) => candidate.id === id)?.name ?? id
}

/** 1440×900 三段式工作台：顶栏 / 源稿 / 预览 + 平台栏。 */
export function StudioApp({ api }: { readonly api: StudioApi }) {
  const { state, platform } = api
  const typesetting = state.typesetting
  const loadingDraft = api.draftStatus === 'loading'
  const canTypeset = state.markdown.trim() !== '' && !typesetting && !loadingDraft
  const failed = failedPlatformIds(api)
  const [sourceShare, setSourceShare] = useState<number | null>(null)
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [ai, setAi] = useState<{ config: DeepSeekConfig | null; remembered: boolean; revision: number }>(() => {
    const config = loadRememberedDeepSeekConfig()
    return { config, remembered: config !== null, revision: 0 }
  })
  const openAiSettings = () => setAiSettingsOpen(true)
  useEffect(() => {
    function syncRememberedConfig(event: StorageEvent) {
      if (event.key !== null && event.key !== DEEPSEEK_STORAGE_KEY) return
      const config = loadRememberedDeepSeekConfig()
      setAi((previous) => {
        if (!previous.remembered || (config?.key === previous.config?.key && config?.model === previous.config?.model)) return previous
        return { config, remembered: config !== null, revision: previous.revision + 1 }
      })
    }
    window.addEventListener('storage', syncRememberedConfig)
    return () => window.removeEventListener('storage', syncRememberedConfig)
  }, [])
  const [focusedArticle, setFocusedArticle] = useState<{
    readonly generation: number
    readonly platform: PlatformId
  } | null>(null)
  const focused = api.document !== null && focusedArticle?.generation === state.generation && focusedArticle.platform === state.platform
  const changeFocus = useCallback((enabled: boolean) => {
    setFocusedArticle(enabled ? { generation: state.generation, platform: state.platform } : null)
  }, [state.generation, state.platform])
  const workspaceStyle = sourceShare === null ? undefined : { '--source-share': `${sourceShare * 100}%` } as CSSProperties
  const [imageFailures, setImageFailures] = useState<Readonly<Partial<Record<PlatformId, {
    readonly generation: number
    readonly document: RenderedDocument | null
    readonly sources: ReadonlySet<string>
  }>>>>({})
  const activeOutcome = selectPlatformResult(state, platform.id)?.outcome
  const baseline = activeOutcome?.ok ? activeOutcome.document : state.retainedDocuments[platform.id] ?? null
  const knownFailures = imageFailures[platform.id]
  const failedSources = knownFailures?.generation === state.generation && knownFailures.document === baseline
    ? knownFailures.sources
    : null
  const articleHtml = api.document?.html
  const previewWarnings = useMemo(() => {
    if (!failedSources || !articleHtml) return []
    // Match the current article, not the old image index: editing can remove or reorder images.
    const fragment = document.createElement('template')
    fragment.innerHTML = articleHtml
    const warnings: CompatWarning[] = []
    fragment.content.querySelectorAll('img[src]').forEach((image, index) => {
      const src = image.getAttribute('src') ?? ''
      if (!failedSources.has(src)) return
      const alt = image.getAttribute('alt') ?? ''
      const boundPath = Object.keys(state.boundAssets).find((path) => state.boundAssets[path] === src)
      const local = boundPath !== undefined || /^(?:blob:|data:)/i.test(src)
      warnings.push({
        id: `preview-image-error-${index + 1}`,
        kind: 'image',
        severity: 'blocker',
        message: `第 ${index + 1} 张预览图片${alt ? `「${alt}」` : ''}加载失败。`,
        action: local
          ? '请在本地图片配对区重选有效文件后重新排版，或在平台编辑器的原位置手动补插。'
          : '请检查图片地址是否可访问、换用有效地址后重新排版，或在平台编辑器的原位置手动补插。',
        excerpt: local ? boundPath ?? '本地配对图片' : src,
        locations: [{ kind: 'image', index }],
      })
    })
    return warnings
  }, [articleHtml, failedSources, state.boundAssets])
  const warnings = [...api.warnings, ...previewWarnings]
  const activeTemplate = selectActiveTemplate(state)
  const showTemplates = api.document !== null && api.copyBlockReason === null && state.typesetFailure === null
  const templateConflict = selectTemplateEditConflict(state)

  function locateSource(location: CompatibilityLocation): boolean {
    const baselineMarkdown = state.typesetBaselines[platform.id]?.markdown
    if (baselineMarkdown === undefined || state.bodyPatches[platform.id]?.linkedMarkdown !== undefined) return false
    const span = currentSourceSpan(location, baselineMarkdown, state.markdown)
    const field = document.querySelector<HTMLTextAreaElement>('#source-markdown')
    if (!span || !field) return false
    // The browser normalizes Windows line breaks in the textarea, but Markdown
    // locations refer to the source as imported.
    const normalizeLines = (text: string) => text.replace(/\r\n?/g, '\n')
    const value = normalizeLines(state.markdown)
    const start = normalizeLines(state.markdown.slice(0, span.start)).length
    const end = normalizeLines(state.markdown.slice(0, span.end)).length
    const select = () => {
      if (!field.isConnected || field.value !== value) return
      field.focus()
      field.setSelectionRange(start, end)
    }
    if (focused) {
      changeFocus(false)
      window.requestAnimationFrame(select)
    } else {
      select()
    }
    return true
  }

  function reportImageError(src: string) {
    if (!state.report) return
    const generation = state.generation
    setImageFailures((previous) => {
      const entry = previous[platform.id]
      const sources = entry?.generation === generation && entry.document === baseline ? entry.sources : null
      if (sources?.has(src)) return previous
      return { ...previous, [platform.id]: { generation, document: baseline, sources: new Set([...(sources ?? []), src]) } }
    })
  }

  const draftNotice = (
    <p className="draft-status" data-state={api.draftStatus} role="status" aria-atomic="true">
      {DRAFT_LABELS[api.draftStatus]}
    </p>
  )

  return (
    <div className="studio">
      <a className="skip-link" href="#source-markdown" hidden={focused}>
        跳到 Markdown 原稿区
      </a>

      <header className="topbar" hidden={focused}>
        <div className="topbar__identity">
          <span className="topbar__mark" aria-hidden="true">
            <Icon name="file" size={18} />
          </span>
          <div>
            <h1 className="topbar__title">多平台排版</h1>
            <p className="topbar__subtitle">一份 Markdown，六个平台的正文</p>
          </div>
        </div>

        <div className="topbar__state">
          <p className="status-chip" data-state={api.status}>
            <span className="status-chip__marker" aria-hidden="true" />
            <span className="status-chip__text" role="status" aria-live="polite">
              {statusLabel(api)}
            </span>
          </p>
          {focused ? null : draftNotice}
          {api.draftStatus === 'ready' ? <p className="topbar__shortcut">Ctrl / ⌘ + Enter 一键排版</p> : null}
        </div>

        <div className="topbar__actions">
          <button className="btn btn--ghost" type="button" onClick={openAiSettings}>AI 设置</button>
          <button
            className="btn btn--primary"
            type="button"
            onClick={api.runTypeset}
            disabled={!canTypeset}
            aria-busy={typesetting}
            aria-describedby={state.markdown.trim() === '' ? 'typeset-block-reason' : undefined}
          >
            <Icon name="refresh" className={typesetting ? 'icon-spin' : undefined} />
            {typesetting ? '正在排版…' : '一键排版'}
          </button>
          {state.markdown.trim() === '' ? (
            <p className="topbar__reason" id="typeset-block-reason">
              先粘贴或导入源稿
            </p>
          ) : null}
        </div>
      </header>

      <main className="workspace" data-focus={focused} style={workspaceStyle} inert={loadingDraft} aria-busy={loadingDraft}>
        <div className="workspace__source" id="workspace-source" hidden={focused}>
          <SourcePanel
            markdown={state.markdown}
            sourceLocked={state.sourceLocked}
            onMarkdownChange={api.setMarkdown}
            onImport={(files) => {
              void api.importFiles(files)
            }}
            importNotice={state.importNotice}
            onDismissImportNotice={api.dismissImportNotice}
            status={api.status}
            stats={api.stats}
            parseErrorMessage={api.parseErrorMessage}
            titleCandidate={api.titleCandidate}
            remoteImages={api.remoteImages}
            localImages={api.imageSources.filter((raw) => !api.remoteImages.includes(raw))}
            boundAssets={state.boundAssets}
            assetNotice={state.assetNotice}
            onBindAsset={api.bindAsset}
            onUnbindAsset={api.unbindAsset}
          />
        </div>
        <WorkspaceDivider preferredShare={sourceShare} onShareChange={setSourceShare} hidden={focused} />

        <section className="panel panel--preview" aria-label="成稿与复制">
          <div hidden={focused}>
            <PlatformTabs
              platforms={api.platforms}
              activeId={state.platform}
              failedIds={failed}
              panelId={PANEL_ID}
              onSelect={api.selectPlatform}
            />
          </div>

          <div
            className="panel__preview"
            id={PANEL_ID}
            role={focused ? 'region' : 'tabpanel'}
            aria-labelledby={focused ? 'focused-platform-name' : platformTabId(state.platform)}
          >
            <PreviewPanel
              renderActions={(editAction, focusAction, editing, templateBlockReason) => (
                <CopyActions
                  editAction={editAction}
                  focusAction={focusAction}
                  templateAction={showTemplates ? (
                    <WechatTemplatePicker
                      key={`${platform.id}:${focused}`}
                      platform={platform}
                      selected={activeTemplate}
                      blocked={editing && !focused ? '先点「完成编辑」，再切换模板。' : templateBlockReason ?? templateConflict}
                      onSelect={api.selectTemplate}
                    />
                  ) : null}
                  linkAction={state.liveLink || (api.patchBlockReason === null && api.succeededPlatforms.length > 1) ? (
                    <LiveLinkControl key={`${platform.id}:${state.generation}`} platform={platform} platforms={api.platforms}
                      available={api.succeededPlatforms} link={state.liveLink} onSave={api.setLiveLinkTargets} />
                  ) : null}
                  linkError={state.liveLink && (state.liveLink.source === platform.id || state.liveLink.targets.includes(platform.id))
                    ? state.liveLink.error : null}
                  focused={focused}
                  draftStatus={focused ? draftNotice : undefined}
                  platform={platform}
                  copyBlockReason={api.copyBlockReason}
                  titleBlockReason={api.titleBlockReason}
                  copyNotice={state.copyNotice}
                  manualCopy={state.manualCopy}
                  onCopyTitle={() => {
                    void api.copy('title', previewWarnings)
                  }}
                  onCopyBody={() => {
                    void api.copy('body', previewWarnings)
                  }}
                  onDismissManual={api.dismissManualCopy}
                />
              )}
              publishReview={(
                <PublishReview
                  key={`${platform.id}:${state.generation}`}
                  platform={platform}
                  status={api.status}
                  result={api.publishReview}
                  failed={api.failure !== null || state.typesetFailure !== null}
                />
              )}
              compatibilityWarnings={warnings}
              onLocateSource={locateSource}
              platform={platform}
              template={activeTemplate}
              status={api.status}
              document={api.document}
              failure={api.failure}
              report={state.report}
              generation={state.generation}
              sourceRevision={state.revision}
              parseErrorMessage={api.parseErrorMessage}
              typesetFailureReason={state.typesetFailure?.reason ?? null}
              onImageError={reportImageError}
              onBodyEdit={api.editBody}
              contentBaseline={api.contentBaseline}
              hasPlatformEdits={api.hasPlatformEdits}
              titleInput={api.titleInput}
              onTitleEdit={api.editTitle}
              patchBlockReason={api.patchBlockReason}
              onDiscard={api.discardPatch}
              deepSeekConfig={ai.config}
              aiRevision={ai.revision}
              onOpenAiSettings={openAiSettings}
              focused={focused}
              onFocusChange={changeFocus}
              availablePlatformNames={api.succeededPlatforms.map((id) =>
                platformName(api, id),
              )}
            />
          </div>
        </section>
      </main>
      {aiSettingsOpen ? <DeepSeekSettings key={ai.revision} config={ai.config} remembered={ai.remembered} onClose={() => setAiSettingsOpen(false)} onSave={(config, remembered) => {
        setAi((previous) => ({ config, remembered, revision: previous.revision + 1 }))
        setAiSettingsOpen(false)
      }} /> : null}
    </div>
  )
}
