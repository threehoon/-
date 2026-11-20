import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CompatWarning,
  DocumentStats,
  ParsedDocument,
  PlatformDefinition,
  PlatformId,
  RenderFailure,
  RenderedDocument,
  TitleCandidate,
  TypesetRequest,
  WechatTemplateId,
} from '@/core/types'
import { DEFAULT_PLATFORM_ID, PLATFORMS } from '@/platforms/registry'
import type { StudioPorts } from './ports'
import { readMarkdownFile } from '@/features/source/import-markdown'
import { censusOf, type ContentCensus } from '@/features/preview/content-census'
import { assessExternalLinkReview, reassessWarnings } from '@/features/preview/assess'
import { stripArticleSourceMarkers } from '@/core/render/source-markers'
import { reviewPublishDocument, type PublishReviewResult } from '@/core/publish-review/review'
import {
  createInitialState,
  hasPlatformEdits,
  isEmptyDraft,
  selectActiveDocument,
  selectActiveFailure,
  selectCopyBlockReason,
  selectPlatformResult,
  selectPatchBlockReason,
  selectStatus,
  selectSucceededPlatforms,
  selectActiveTemplate,
  selectTemplateEditConflict,
  studioReducer,
} from './studio-state'
import type { BodyPatch, CopyKind, StudioEvent, StudioState, StudioStatus } from './studio-state'
import { escapeHtml, reasonOf } from './text'
import { draftChanged, restoreDraft, type DraftStore } from './draft-store'
import { useDraftPersistence, type DraftStatus } from './use-draft-persistence'
import { configureLiveLink, followLiveLink } from './live-link'

const COPY_NOTICE_MS = 2000
const NO_WARNINGS: readonly CompatWarning[] = []

interface ParseState {
  readonly document: ParsedDocument | null
  readonly error: string | null
}

export interface StudioApi {
  readonly state: StudioState
  readonly status: StudioStatus
  readonly draftStatus: DraftStatus
  readonly platforms: readonly PlatformDefinition[]
  readonly platform: PlatformDefinition
  readonly parsed: ParsedDocument | null
  readonly parseErrorMessage: string | null
  readonly stats: DocumentStats | null
  readonly titleCandidate: TitleCandidate | null
  readonly imageSources: readonly string[]
  readonly remoteImages: readonly string[]
  readonly warnings: readonly CompatWarning[]
  readonly publishReview: PublishReviewResult | null
  readonly contentBaseline: ContentCensus | null
  readonly document: RenderedDocument | null
  readonly failure: RenderFailure | null
  readonly succeededPlatforms: readonly PlatformId[]
  readonly copyBlockReason: string | null
  readonly titleBlockReason: string | null
  readonly setMarkdown: (markdown: string) => void
  readonly editTitle: (value: string) => void
  readonly titleInput: string
  readonly selectPlatform: (platform: StudioState['platform']) => void
  readonly selectTemplate: (template: WechatTemplateId) => string | null
  readonly editBody: (html: string, plainText: string) => void
  readonly hasPlatformEdits: boolean
  readonly patchBlockReason: string | null
  readonly discardPatch: () => void
  readonly setLiveLinkTargets: (targets: readonly PlatformId[]) => string | null
  readonly runTypeset: () => void
  readonly importFiles: (files: readonly File[]) => Promise<void>
  readonly copy: (kind: CopyKind, previewWarnings: readonly CompatWarning[], focused: boolean) => Promise<void>
  readonly bindAsset: (raw: string, file: File) => void
  readonly unbindAsset: (raw: string) => void
  readonly toggleWarnings: () => void
  readonly dismissManualCopy: () => void
  readonly dismissImportNotice: () => void
}

function platformOf(id: StudioState['platform']): PlatformDefinition {
  return PLATFORMS.find((candidate) => candidate.id === id) ?? PLATFORMS[0]
}

function isRemoteSource(raw: string): boolean {
  return /^https?:\/\//i.test(raw.trim())
}

export function hasCopyableBody(document: RenderedDocument): boolean {
  // 空标签不算正文；分隔线等无文本节点仍是有效的富文本内容。
  return document.plainText.trim() !== '' || /<(?:hr|img)\b/.test(document.html)
}

function revokeObjectUrl(url: string): void {
  if (url.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url)
  }
}

function typesetInput(ports: StudioPorts, state: StudioState, platformTemplates = state.platformTemplates): TypesetRequest {
  return {
    markdown: state.markdown,
    titleOverride: null,
    assets: ports.createAssets(state.boundAssets),
    platformTemplates,
  }
}

export function useStudio(ports: StudioPorts): StudioApi {
  const [state, setState] = useState(() => createInitialState({ platform: DEFAULT_PLATFORM_ID }))
  // Commit in event order even before React renders: an immediate copy or typeset must see
  // the last confirmed composition/input; late work must never write to a newer source.
  const stateRef = useRef(state)
  const ownedObjectUrls = useRef(new Map<string, Blob>())
  const restore = useCallback((store: DraftStore) => {
    if (!store.snapshot) return
    const restored = restoreDraft(store.snapshot, stateRef.current, ownedObjectUrls.current)
    stateRef.current = restored
    setState(restored)
  }, [])
  const { status: draftStatus, save } = useDraftPersistence(restore)
  const commit = useCallback((next: StudioState, previous: StudioState) => {
    if (next === previous) return
    stateRef.current = next
    setState(next)
    if (draftChanged(previous, next)) save(next, ownedObjectUrls.current)
  }, [save])
  const dispatch = useCallback((event: StudioEvent) => {
    const previous = stateRef.current
    const next = studioReducer(previous, event)
    if (next !== previous) commit(followLiveLink(next, event, ports), previous)
  }, [commit, ports])
  const setLiveLinkTargets = useCallback((targets: readonly PlatformId[]): string | null => {
    const snapshot = stateRef.current
    try {
      commit(configureLiveLink(snapshot, targets, ports), snapshot)
      return null
    } catch (error) {
      return `未更新联动，目标平台草稿保持原样。${reasonOf(error)}`
    }
  }, [commit, ports])
  const typesetTimer = useRef<number | null>(null)
  const noticeTimer = useRef<number | null>(null)
  const importRequest = useRef(0)
  const copyRequest = useRef(0)

  useEffect(() => {
    const bound = new Set(Object.values(state.boundAssets))
    const patchHtml = Object.values(state.bodyPatches).flatMap(({ html, baseline }) => [html, baseline.html])
    const retainedHtml = [...patchHtml, ...Object.values(state.retainedDocuments).map((document) => document.html)]
    for (const { outcome } of state.report?.results ?? []) {
      if (outcome.ok) retainedHtml.push(outcome.document.html)
    }
    // Old previews remain visible until replaced or explicitly discarded.
    for (const url of ownedObjectUrls.current.keys()) {
      if (bound.has(url) || retainedHtml.some((html) => html.includes(`src="${url}"`))) continue
      revokeObjectUrl(url)
      ownedObjectUrls.current.delete(url)
    }
  }, [state.bodyPatches, state.boundAssets, state.report, state.retainedDocuments])

  useEffect(() => {
    const objectUrls = ownedObjectUrls.current
    return () => {
      if (typesetTimer.current !== null) {
        window.clearTimeout(typesetTimer.current)
      }
      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current)
      }
      for (const url of objectUrls.keys()) revokeObjectUrl(url)
      objectUrls.clear()
    }
  }, [])

  const parsed = useMemo<ParseState>(() => {
    if (state.markdown.trim() === '') {
      return { document: null, error: null }
    }
    try {
      return { document: ports.parse(state.markdown), error: null }
    } catch (error) {
      return { document: null, error: reasonOf(error) }
    }
  }, [ports, state.markdown])

  const imageSources = useMemo<readonly string[]>(() => {
    if (!parsed.document) {
      return []
    }
    try {
      return ports.collectImages(parsed.document)
    } catch {
      // 取不到图片清单不影响排版与复制，配对区退化为空清单。
      return []
    }
  }, [ports, parsed.document])

  const setMarkdown = useCallback((markdown: string) => {
    dispatch({ type: 'source/changed', markdown })
  }, [dispatch])

  const editTitle = useCallback((value: string) => {
    dispatch({ type: 'title/edited', platform: state.platform, generation: state.generation, value })
  }, [dispatch, state.generation, state.platform])

  const selectPlatform = useCallback((platform: StudioState['platform']) => {
    dispatch({ type: 'platform/changed', platform })
  }, [dispatch])

  const runTypeset = useCallback(() => {
    const snapshot = stateRef.current
    if (snapshot.typesetting || isEmptyDraft(snapshot)) {
      return
    }
    dispatch({ type: 'typeset/started' })
    // 让「排版中」先渲染一帧：10k 字稿件的同步排版不该把状态提示吞掉。
    typesetTimer.current = window.setTimeout(() => {
      typesetTimer.current = null
      try {
        const report = ports.typeset(typesetInput(ports, snapshot))
        dispatch({ type: 'typeset/succeeded', report })
      } catch (error) {
        dispatch({ type: 'typeset/failed', reason: reasonOf(error), at: Date.now() })
      }
    }, 0)
  }, [dispatch, ports])

  const selectTemplate = useCallback((template: WechatTemplateId): string | null => {
    const snapshot = stateRef.current
    if (template === selectActiveTemplate(snapshot)) return null
    const { platform } = snapshot
    const current = selectActiveDocument(snapshot)
    if (!snapshot.report || snapshot.typesetFailure || selectCopyBlockReason(snapshot) ||
      !current || !hasCopyableBody(current)) return '当前成稿不能换版。请先生成当前平台可复制的正文。'
    const conflict = selectTemplateEditConflict(snapshot)
    if (conflict) return conflict
    try {
      const templates = { ...snapshot.platformTemplates, [platform]: template }
      const report = ports.typeset(typesetInput(ports, snapshot, templates), platformOf(platform))
      const outcome = report.results.find((entry) => entry.platform === platform)?.outcome
      if (report.parseError) throw new Error(report.parseError)
      if (!outcome) throw new Error('没有生成新成稿。')
      if (!outcome.ok) throw new Error(outcome.failure.reason)
      if (!hasCopyableBody(outcome.document)) throw new Error('没有生成可复制正文。')
      const previous = selectPlatformResult(snapshot, platform)?.outcome
      if (previous?.ok && previous.document.plainText !== outcome.document.plainText) {
        return '换版会改变正文文字，已保留当前成稿。请核对源稿后再试。'
      }
      dispatch({ type: 'template/applied', platform, template, baselineReport: snapshot.report, revision: snapshot.revision, document: outcome.document })
      if (stateRef.current.platformTemplates[platform] !== template) return '稿件已变化，未切换模板。请检查当前成稿后重试。'
      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current)
        noticeTimer.current = null
      }
      return null
    } catch (error) {
      return `未切换模板，当前成稿已保留。请重试：${reasonOf(error)}`
    }
  }, [dispatch, ports])

  const originalBody = selectPlatformResult(state, state.platform)?.outcome
  const originalDocument = originalBody?.ok ? originalBody.document : null
  const originalHtml = originalDocument?.html ?? null
  const normalizedOriginalHtml = useMemo(() => {
    if (originalHtml === null) return null
    const template = window.document.createElement('template')
    template.innerHTML = originalHtml
    return template.innerHTML
  }, [originalHtml])
  const editBody = useCallback((html: string, plainText: string) => {
    const snapshot = stateRef.current
    // Delayed image reads must not install an edit into a replaced or discarded editor.
    if (!snapshot.report || snapshot.report !== state.report || snapshot.generation !== state.generation ||
      snapshot.platform !== state.platform || !originalDocument || selectPatchBlockReason(snapshot)) return
    const previous = snapshot.bodyPatches[snapshot.platform]
    const baseline = previous?.baseline ?? { html: originalDocument.html, warnings: originalDocument.warnings }
    const patch: BodyPatch = { ...previous, html: html === normalizedOriginalHtml ? originalDocument.html : html, plainText, baseline }
    dispatch({
      type: 'body/edited', platform: snapshot.platform, report: snapshot.report,
      revision: snapshot.revision, generation: snapshot.generation, patch,
    })
  }, [dispatch, normalizedOriginalHtml, originalDocument, state.generation, state.platform, state.report])

  const discardPatch = useCallback(() => {
    dispatch({ type: 'patch/discarded', platform: stateRef.current.platform })
  }, [dispatch])

  const importFiles = useCallback(async (files: readonly File[]) => {
    if (files.length === 0) return
    const request = ++importRequest.current
    if (files.length !== 1) {
      dispatch({
        type: 'import/failed',
        message: '一次只能导入一份稿件。',
        detail: '请单独拖入一份 Markdown 或 TXT 文件，当前稿件已保留。',
      })
      return
    }
    const [file] = files
    const { revision, bodyPatches, titleOverrides } = stateRef.current
    const outcome = await readMarkdownFile(file)
    if (request !== importRequest.current) return
    const current = stateRef.current
    if (revision !== current.revision || bodyPatches !== current.bodyPatches || titleOverrides !== current.titleOverrides) {
      dispatch({
        type: 'import/failed',
        message: `未导入「${file.name}」：读取期间稿件有改动。`,
        detail: '当前源稿保持原样。如需替换，请重新选择文件。',
      })
      return
    }
    if (outcome.ok) {
      if (!isEmptyDraft(current) && !window.confirm(`导入「${outcome.fileName}」会替换左侧原稿，并清空右侧六个平台的成稿、手动改动和原稿图片配对。是否替换？`)) return
      if (current !== stateRef.current) return
      if (typesetTimer.current !== null) {
        window.clearTimeout(typesetTimer.current)
        typesetTimer.current = null
      }
      dispatch({
        type: 'import/succeeded',
        markdown: outcome.markdown,
        fileName: outcome.fileName,
      })
      return
    }
    dispatch({ type: 'import/failed', message: outcome.message, detail: outcome.detail })
  }, [dispatch])

  const copy = useCallback(
    async (kind: CopyKind, previewWarnings: readonly CompatWarning[], focused: boolean) => {
      const snapshot = stateRef.current
      const document = selectActiveDocument(snapshot)
      if (!document || selectCopyBlockReason(snapshot) !== null) return
      const platform = snapshot.platform
      const payload = kind === 'title'
        ? document.title === null ? null : { html: `<p>${escapeHtml(document.title)}</p>`, plainText: document.title }
        : hasCopyableBody(document) ? { html: stripArticleSourceMarkers(document.html), plainText: document.plainText } : null
      if (!payload) return

      const review = reviewPublishDocument(document)
      const { capabilities, name } = platformOf(platform)
      const warnings = [...previewWarnings, ...reassessWarnings(document.warnings, document.html, capabilities), ...assessExternalLinkReview(review)]
      const notices: string[] = []
      if (warnings.length > 0) {
        const examples = [...new Set(warnings.map(({ message }) => message))].slice(0, 2)
        const nextStep = focused ? '可退出专注编辑，查看完整兼容性清单。' : '详情请查看兼容性清单。'
        notices.push(`${name}兼容性提示（${warnings.length} 项）：\n${examples.join('\n')}\n${nextStep}`)
      }
      if (review.status === 'unavailable') {
        notices.push(`当前成稿未能完成${name}发布预检，请先人工核对平台规则。`)
      } else if (review.findings.length > 0) {
        notices.push(`当前成稿发现 ${review.findings.length} 项疑似风险，可能不符合${name}的发布规则。请先查看「发布预检」并核对。`)
      }
      if (notices.length > 0) {
        const label = kind === 'title' ? '标题' : '正文'
        if (!window.confirm(`${notices.join('\n\n')}\n\n仍要复制${label}吗？本提示不代表平台审核结论。`)) return
        if (snapshot !== stateRef.current) return
      }

      const request = ++copyRequest.current
      const isCurrent = () => {
        const current = stateRef.current
        return request === copyRequest.current && current.revision === snapshot.revision &&
          current.report === snapshot.report && current.bodyPatches === snapshot.bodyPatches &&
          current.titleOverrides === snapshot.titleOverrides && current.platform === platform && !current.typesetting
      }
      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current)
        noticeTimer.current = null
      }
      dispatch({ type: 'copy/cleared' })
      dispatch({ type: 'copy/manual-dismissed' })

      try {
        const result = await ports.copyRichText(payload)
        if (!isCurrent()) return
        if (result.ok) {
          dispatch({ type: 'copy/succeeded', kind, platform, mode: result.mode })
          noticeTimer.current = window.setTimeout(() => {
            noticeTimer.current = null
            dispatch({ type: 'copy/cleared' })
          }, COPY_NOTICE_MS)
          return
        }
        dispatch({ type: 'copy/failed', kind, platform, reason: result.reason, manualText: result.manualText })
      } catch (error) {
        if (!isCurrent()) return
        dispatch({
          type: 'copy/failed',
          kind,
          platform,
          reason: `浏览器没有完成复制：${reasonOf(error)}`,
          manualText: payload.plainText,
        })
      }
    },
    [dispatch, ports],
  )

  const bindAsset = useCallback((raw: string, file: File) => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      dispatch({
        type: 'assets/failed',
        message: `当前浏览器不支持本地预览地址，无法配对 ${raw}；可以改用 HTTPS 外链，或排版后在平台编辑器里手动补插。`,
      })
      return
    }
    const url = URL.createObjectURL(file)
    ownedObjectUrls.current.set(url, file)
    dispatch({ type: 'assets/bound', raw, url })
  }, [dispatch])

  const unbindAsset = useCallback((raw: string) => {
    dispatch({ type: 'assets/unbound', raw })
  }, [dispatch])

  const toggleWarnings = useCallback(() => {
    dispatch({ type: 'warnings/toggled' })
  }, [dispatch])

  const dismissManualCopy = useCallback(() => {
    dispatch({ type: 'copy/manual-dismissed' })
  }, [dispatch])

  const dismissImportNotice = useCallback(() => {
    dispatch({ type: 'import/notice-cleared' })
  }, [dispatch])

  // Ctrl/Cmd + Enter：任何位置都能触发一键排版。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Some Chromium IME confirmation keydowns report 229 before isComposing flips.
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented || event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) ||
        window.document.querySelector('dialog[open]')) return
      event.preventDefault()
      runTypeset()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [runTypeset])

  const platform = platformOf(state.platform)
  const document = selectActiveDocument(state)
  const activeCapabilities = platform.capabilities
  // 兼容性提示跟着当前成稿实时重算：编辑后删掉的链接、表格不只留在旧快照里。
  // 成稿文字用字符串比较即可，计算只在 html、警告或平台变化时发生。
  const baseWarnings = document?.warnings ?? NO_WARNINGS
  const warnings = useMemo(
    () => document ? reassessWarnings(baseWarnings, document.html, activeCapabilities) : NO_WARNINGS,
    [activeCapabilities, baseWarnings, document],
  )
  const failure = selectActiveFailure(state)
  const titleCandidate = parsed.document?.title ?? null
  const sharedCopyBlockReason = selectCopyBlockReason(state)
  const baselineReviews = useMemo(() => {
    const reviews = new Map<PlatformId, PublishReviewResult>()
    for (const { platform: id, outcome } of state.report?.results ?? []) {
      if (outcome.ok) reviews.set(id, reviewPublishDocument(outcome.document))
    }
    return reviews
  }, [state.report])
  const bodyPatch = state.bodyPatches[state.platform]
  const baselineHtml = bodyPatch?.baseline.html ?? originalHtml
  const contentBaseline = useMemo(() => baselineHtml === null ? null : censusOf(baselineHtml), [baselineHtml])
  const titleOverride = state.titleOverrides[state.platform]
  const publishReview = useMemo(() => {
    if (sharedCopyBlockReason !== null || !originalBody?.ok) return null
    if (!bodyPatch && titleOverride === undefined) return baselineReviews.get(state.platform) ?? null
    return reviewPublishDocument({
      ...originalBody.document,
      html: bodyPatch?.html ?? originalBody.document.html,
      plainText: bodyPatch?.plainText ?? originalBody.document.plainText,
      title: titleOverride === undefined ? originalBody.document.title : titleOverride.trim() || null,
    })
  }, [baselineReviews, bodyPatch, originalBody, sharedCopyBlockReason, state.platform, titleOverride])
  const copyBlockReason = sharedCopyBlockReason ?? (document && !hasCopyableBody(document)
    ? '这篇稿子没有可复制的正文；请在当前成稿中补充正文。'
    : null)
  const titleBlockReason = sharedCopyBlockReason ?? (document?.title === null
    ? '这篇稿子没有标题；请在当前成稿中填写标题。'
    : null)
  const remoteImages = imageSources.filter(isRemoteSource)

  return {
    state,
    status: selectStatus(state),
    draftStatus,
    platforms: PLATFORMS,
    platform,
    parsed: parsed.document,
    parseErrorMessage: parsed.error,
    stats: parsed.document?.stats ?? state.report?.stats ?? null,
    titleCandidate,
    imageSources,
    remoteImages,
    warnings: [...warnings, ...assessExternalLinkReview(publishReview)],
    publishReview,
    contentBaseline: sharedCopyBlockReason === null && state.typesetFailure === null ? contentBaseline : null,
    document,
    failure,
    succeededPlatforms: selectSucceededPlatforms(state),
    copyBlockReason,
    titleBlockReason,
    setMarkdown,
    editTitle,
    titleInput: titleOverride ?? document?.title ?? '',
    selectPlatform,
    selectTemplate,
    editBody,
    hasPlatformEdits: hasPlatformEdits(state),
    patchBlockReason: selectPatchBlockReason(state),
    discardPatch,
    setLiveLinkTargets,
    runTypeset,
    importFiles,
    copy,
    bindAsset,
    unbindAsset,
    toggleWarnings,
    dismissManualCopy,
    dismissImportNotice,
  }
}
