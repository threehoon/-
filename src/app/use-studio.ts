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
import { hasLocalStyle, sameArticleContent, syncArticleSource } from '@/features/preview/source-sync'
import { rebaseSourceChanges } from '@/features/preview/source-rebase'
import { censusOf, type ContentCensus } from '@/features/preview/content-census'
import { assessExternalLinkReview, reassessWarnings } from '@/features/preview/assess'
import { stripArticleSourceMarkers } from '@/core/render/source-markers'
import { reviewPublishDocument, type PublishReviewResult } from '@/core/publish-review/review'
import {
  createInitialState,
  isEmptyDraft,
  selectActiveDocument,
  selectActiveFailure,
  selectCopyBlockReason,
  selectPlatformResult,
  selectPatchBlockReason,
  selectSyncBlockReason,
  selectStatus,
  selectSucceededPlatforms,
  selectActiveTemplate,
  selectTemplateEditConflict,
  studioReducer,
} from './studio-state'
import type { BodyPatch, CopyKind, StudioEvent, StudioState, StudioStatus } from './studio-state'
import { escapeHtml, reasonOf } from './text'

const COPY_NOTICE_MS = 2000
const NO_WARNINGS: readonly CompatWarning[] = []

export interface LocalArticleImage {
  readonly url: string
  readonly fileName: string
}

interface ParseState {
  readonly document: ParsedDocument | null
  readonly error: string | null
}

export interface StudioApi {
  readonly state: StudioState
  readonly status: StudioStatus
  readonly platforms: readonly PlatformDefinition[]
  readonly platform: PlatformDefinition
  readonly parsed: ParsedDocument | null
  readonly parseErrorMessage: string | null
  readonly stats: DocumentStats | null
  readonly titleCandidate: TitleCandidate | null
  readonly effectiveTitle: string | null
  readonly imageSources: readonly string[]
  readonly unpairedImages: readonly string[]
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
  readonly setTitle: (value: string) => void
  readonly selectPlatform: (platform: StudioState['platform']) => void
  readonly selectTemplate: (template: WechatTemplateId) => string | null
  readonly editBody: (html: string, plainText: string, localImage?: LocalArticleImage) => void
  readonly bodyPatch: BodyPatch | null
  readonly patchBlockReason: string | null
  readonly syncBlockReason: string | null
  readonly syncToSource: () => void
  readonly discardPatch: () => void
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

function newImageAsset(ports: StudioPorts, state: StudioState, image: LocalArticleImage) {
  const activeAssets = state.bodyPatches[state.platform]?.assets ?? {}
  if (Object.values(state.boundAssets).includes(image.url) || Object.values(activeAssets).includes(image.url)) return undefined
  const pendingPaths = Object.values(state.bodyPatches).flatMap((patch) => Object.keys(patch.assets))
  const mime = /^data:image\/(png|jpeg|webp|gif|avif);base64,/.exec(image.url)?.[1]
  if (!mime) return undefined
  const usedPaths = new Set([
    ...Object.keys(state.boundAssets),
    ...pendingPaths,
    ...ports.collectImages(ports.parse(state.markdown)),
  ].map((path) => path.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').split(/[?#]/, 1)[0]))
  const extension = mime === 'jpeg' ? 'jpg' : mime
  let number = 1
  while (usedPaths.has(`paste-${number}.${extension}`)) number += 1
  return { path: `paste-${number}.${extension}`, url: image.url }
}

function typesetInput(ports: StudioPorts, state: StudioState, platformTemplates = state.platformTemplates): TypesetRequest {
  return {
    markdown: state.markdown,
    titleOverride: state.titleOverride.trim() || null,
    assets: ports.createAssets(state.boundAssets),
    platformTemplates,
  }
}

export function useStudio(ports: StudioPorts): StudioApi {
  const [state, setState] = useState(() => createInitialState({ platform: DEFAULT_PLATFORM_ID }))
  // Commit in event order even before React renders: an immediate copy or typeset must see
  // the last confirmed composition/input; late work must never write to a newer source.
  const stateRef = useRef(state)
  const dispatch = useCallback((event: StudioEvent) => {
    const previous = stateRef.current
    const next = studioReducer(previous, event)
    if (next === previous) return
    stateRef.current = next
    setState(next)
  }, [])
  const typesetTimer = useRef<number | null>(null)
  const noticeTimer = useRef<number | null>(null)
  const ownedObjectUrls = useRef(new Set<string>())
  const importRequest = useRef(0)
  const copyRequest = useRef(0)

  useEffect(() => {
    const bound = new Set(Object.values(state.boundAssets))
    const patchHtml = Object.values(state.bodyPatches).flatMap(({ html, mapping, syncedHtml }) => [html, mapping.html, syncedHtml])
    const retainedHtml = [...patchHtml, ...Object.values(state.retainedDocuments).map((document) => document.html)]
    for (const { outcome } of state.report?.results ?? []) {
      if (outcome.ok) retainedHtml.push(outcome.document.html)
    }
    // Old previews remain visible until replaced or explicitly discarded.
    for (const url of ownedObjectUrls.current) {
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
      for (const url of objectUrls) revokeObjectUrl(url)
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

  const setTitle = useCallback((value: string) => {
    dispatch({ type: 'title/changed', value })
  }, [dispatch])

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
  const originalHtml = originalBody?.ok ? originalBody.document.html : null
  const normalizedOriginalHtml = useMemo(() => {
    if (originalHtml === null) return null
    const template = window.document.createElement('template')
    template.innerHTML = originalHtml
    return template.innerHTML
  }, [originalHtml])
  const editBody = useCallback((html: string, plainText: string, localImage?: LocalArticleImage) => {
    const snapshot = stateRef.current
    // Delayed image reads must not install an edit into a replaced or discarded editor.
    if (!snapshot.report || snapshot.report !== state.report || snapshot.generation !== state.generation ||
      snapshot.platform !== state.platform || originalHtml === null || selectPatchBlockReason(snapshot)) return
    const baseline = snapshot.typesetBaselines[snapshot.platform]
    if (!baseline || !originalBody?.ok) return
    const normalized = html === normalizedOriginalHtml ? originalHtml : html
    const previous = snapshot.bodyPatches[snapshot.platform]
    if (normalized === (previous?.html ?? originalHtml)) return

    const mapping = previous?.mapping ?? { html: originalHtml, markdown: baseline.markdown, warnings: originalBody.document.warnings }
    const syncedHtml = previous?.syncedHtml ?? originalHtml
    const syncedMarkdown = previous?.syncedMarkdown ?? baseline.markdown
    const asset = localImage ? newImageAsset(ports, snapshot, localImage) : undefined
    const assets = asset ? { ...previous?.assets, [asset.path]: asset.url } : previous?.assets ?? {}
    const platformStyle = hasLocalStyle(mapping.html, normalized)
    const linked = sameArticleContent(syncedHtml, normalized, { ...snapshot.boundAssets, ...assets })
    dispatch({
      type: 'body/edited',
      platform: snapshot.platform,
      report: snapshot.report,
      revision: snapshot.revision,
      patch: {
        html: normalized, plainText, state: linked ? 'linked' : 'diverged', platformStyle,
        base: { revision: baseline.revision, fingerprint: baseline.fingerprint },
        reason: null, mapping, syncedHtml, syncedMarkdown, assets,
      },
    })
  }, [dispatch, normalizedOriginalHtml, originalBody, originalHtml, ports, state.generation, state.platform, state.report])

  const syncToSource = useCallback(() => {
    const snapshot = stateRef.current
    const { platform } = snapshot
    const patch = snapshot.bodyPatches[platform]
    if (!patch || selectSyncBlockReason(snapshot)) return
    if (!window.confirm('同步到源稿会把当前平台的正文改动写入左侧 Markdown，可能覆盖左侧同段改动；其它平台需重新排版。是否继续？')) return
    if (snapshot !== stateRef.current) return
    const reject = (reason: string) => dispatch({ type: 'sync/rejected', platform, patch, reason })
    try {
      const boundAssets = { ...snapshot.boundAssets, ...patch.assets }
      const result = syncArticleSource({
        baselineMarkdown: patch.mapping.markdown, baselineHtml: patch.mapping.html, html: patch.html, boundAssets,
      })
      if (result.markdown === null || result.issue !== null) {
        reject(`未同步：${result.issue ?? '无法确认改动对应的源稿范围。'}`)
        return
      }
      const markdown = rebaseSourceChanges(patch.syncedMarkdown, result.markdown, snapshot.markdown)
      if (markdown === null) {
        reject('未同步：无法在当前源稿中唯一定位改动，左侧保持原样。请在左侧修改对应段落。')
        return
      }
      const usedPaths = new Set(ports.collectImages(ports.parse(markdown)))
      const assets = Object.fromEntries(Object.entries(patch.assets).filter(([path]) => usedPaths.has(path)))
      let document: RenderedDocument | null = null
      if (markdown !== snapshot.markdown) {
        const report = ports.typeset(typesetInput(ports, { ...snapshot, markdown, boundAssets: { ...snapshot.boundAssets, ...assets } }), platformOf(platform))
        const outcome = report.results.find((entry) => entry.platform === platform)?.outcome
        if (report.parseError || !outcome?.ok) {
          reject('未同步：修改后的源稿无法生成当前平台的成稿，左侧保持原样。请在左侧修改或撤销右侧改动。')
          return
        }
        document = outcome.document
      }
      dispatch({ type: 'sync/to-source', platform, patch, markdown, projectedMarkdown: result.markdown, document, assets })
    } catch (error) {
      reject(`未同步，左侧源稿保持原样：${reasonOf(error)}`)
    }
  }, [dispatch, ports])

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
    const { revision, bodyPatches } = stateRef.current
    const outcome = await readMarkdownFile(file)
    if (request !== importRequest.current) return
    if (revision !== stateRef.current.revision || bodyPatches !== stateRef.current.bodyPatches) {
      dispatch({
        type: 'import/failed',
        message: `未导入「${file.name}」：读取期间稿件有改动。`,
        detail: '当前源稿保持原样。如需替换，请重新选择文件。',
      })
      return
    }
    if (outcome.ok) {
      const current = stateRef.current
      const hasDraft = !isEmptyDraft(current) || current.titleOverride.trim() !== '' ||
        Object.keys(current.boundAssets).length > 0 || Object.keys(current.bodyPatches).length > 0
      if (hasDraft && !window.confirm(`导入「${outcome.fileName}」会替换当前稿件，并清空手填标题和图片配对。是否替换？`)) return
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
          current.report === snapshot.report && current.bodyPatches === snapshot.bodyPatches && current.platform === platform && !current.typesetting
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
    ownedObjectUrls.current.add(url)
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
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented || event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
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
  const manualTitle = state.titleOverride.trim()
  const effectiveTitle = manualTitle !== '' ? manualTitle : titleCandidate?.value ?? null
  const sharedCopyBlockReason = selectCopyBlockReason(state)
  const baselineReviews = useMemo(() => {
    const reviews = new Map<PlatformId, PublishReviewResult>()
    for (const { platform: id, outcome } of state.report?.results ?? []) {
      if (outcome.ok) reviews.set(id, reviewPublishDocument(outcome.document))
    }
    return reviews
  }, [state.report])
  const contentBaseline = useMemo(() => {
    const outcome = state.report?.results.find((entry) => entry.platform === state.platform)?.outcome
    return outcome?.ok ? censusOf(outcome.document.html) : null
  }, [state.platform, state.report])
  const bodyPatch = state.bodyPatches[state.platform]
  const publishReview = useMemo(() => {
    if (sharedCopyBlockReason !== null || !originalBody?.ok) return null
    return bodyPatch
      ? reviewPublishDocument({ ...originalBody.document, html: bodyPatch.html, plainText: bodyPatch.plainText })
      : baselineReviews.get(state.platform) ?? null
  }, [baselineReviews, bodyPatch, originalBody, sharedCopyBlockReason, state.platform])
  const copyBlockReason = sharedCopyBlockReason ?? (document && !hasCopyableBody(document)
    ? '这篇稿子没有可复制的正文；补充正文后重新排版。'
    : null)
  const titleBlockReason = sharedCopyBlockReason ?? (document?.title === null
    ? '这篇稿子没有可提取的标题；填写标题后重新排版。'
    : null)
  const unpairedImages = imageSources.filter(
    (raw) => !isRemoteSource(raw) && !(raw in state.boundAssets),
  )
  const remoteImages = imageSources.filter(isRemoteSource)

  return {
    state,
    status: selectStatus(state),
    platforms: PLATFORMS,
    platform,
    parsed: parsed.document,
    parseErrorMessage: parsed.error,
    stats: parsed.document?.stats ?? state.report?.stats ?? null,
    titleCandidate,
    effectiveTitle,
    imageSources,
    unpairedImages,
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
    setTitle,
    selectPlatform,
    selectTemplate,
    editBody,
    bodyPatch: bodyPatch ?? null,
    patchBlockReason: selectPatchBlockReason(state),
    syncBlockReason: selectSyncBlockReason(state),
    syncToSource,
    discardPatch,
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
