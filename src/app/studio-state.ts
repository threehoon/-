import type {
  PlatformId,
  RenderedDocument,
  RenderFailure,
  TypesetReport,
  WechatTemplateId,
} from '@/core/types'
import { DEFAULT_WECHAT_TEMPLATE_ID } from '@/platforms/wechat/theme'

/**
 * 工作台状态机：纯函数，不依赖 React 或浏览器。
 * 界面负责把用户动作翻译成事件，再读取选择器决定渲染什么。
 */

export type StudioStatus =
  | 'empty'
  | 'ready'
  | 'typesetting'
  | 'typeset'
  | 'stale'
  | 'parse-error'

export type CopyKind = 'title' | 'body'

/** 复制失败时保留的内容：用户可全选后手动粘贴，界面不报假成功。 */
export interface ManualCopy {
  readonly kind: CopyKind
  readonly platform: PlatformId
  readonly reason: string
  readonly text: string
}

export interface CopyNotice {
  readonly kind: CopyKind
  readonly platform: PlatformId
  readonly message: string
  readonly nonce: number
}

export interface ImportNotice {
  readonly tone: 'success' | 'failure'
  readonly message: string
  readonly detail: string | null
}

/** 图片配对区的独立提示，避免和导入提示串位置。 */
export interface AssetNotice {
  readonly tone: 'success' | 'failure'
  readonly message: string
}

export interface TypesetFailure {
  readonly reason: string
  readonly at: number
}

export interface TypesetBaseline {
  readonly revision: number
  readonly markdown: string
}

export interface BodyPatch {
  readonly html: string
  readonly plainText: string
  readonly baseline: Pick<RenderedDocument, 'html' | 'warnings'>
  /** Private body-only Markdown used to keep platform-degraded blocks portable on future edits. */
  readonly linkedMarkdown?: string
  /** The current source body was last committed by a successful synchronization. */
  readonly linkedSource?: true
}

export interface LiveLink {
  readonly source: PlatformId
  readonly targets: readonly PlatformId[]
  readonly error: string | null
}

export interface StudioState {
  readonly markdown: string
  readonly sourceLocked: boolean
  readonly titleOverrides: Readonly<Partial<Record<PlatformId, string>>>
  readonly platform: PlatformId
  /** 原稿或原稿图片配对的每次改动都会加一，用于判断输出是否过期。 */
  readonly revision: number
  /** 点击「一键排版」时锁定的 revision，防止迟到的结果覆盖新源稿。 */
  readonly pendingRevision: number | null
  readonly report: TypesetReport | null
  /** 每次成功安装新成稿后递增；编辑、切换布局和失败重排不改变编辑器的代际。 */
  readonly generation: number
  readonly platformTemplates: Readonly<Partial<Record<PlatformId, WechatTemplateId>>>
  readonly typesetBaselines: Readonly<Partial<Record<PlatformId, TypesetBaseline>>>
  readonly retainedDocuments: Readonly<Partial<Record<PlatformId, RenderedDocument>>>
  readonly typesetting: boolean
  readonly typesetFailure: TypesetFailure | null
  readonly copyNotice: CopyNotice | null
  readonly manualCopy: ManualCopy | null
  readonly importNotice: ImportNotice | null
  readonly assetNotice: AssetNotice | null
  readonly bodyPatches: Readonly<Partial<Record<PlatformId, BodyPatch>>>
  readonly boundAssets: Readonly<Record<string, string>>
  readonly liveLink: LiveLink | null
}

export type StudioEvent =
  | { readonly type: 'source/changed'; readonly markdown: string }
  | { readonly type: 'title/edited'; readonly platform: PlatformId; readonly generation: number; readonly value: string }
  | { readonly type: 'platform/changed'; readonly platform: PlatformId }
  | {
      readonly type: 'body/edited'
      readonly platform: PlatformId
      readonly report: TypesetReport
      readonly revision: number
      readonly generation: number
      readonly patch: BodyPatch
    }
  | { readonly type: 'patch/discarded'; readonly platform: PlatformId }
  | {
      readonly type: 'template/applied'
      readonly platform: PlatformId
      readonly template: WechatTemplateId
      readonly baselineReport: TypesetReport
      readonly revision: number
      readonly document: RenderedDocument
      readonly bodyPatch?: BodyPatch
    }
  | { readonly type: 'typeset/started' }
  | { readonly type: 'typeset/succeeded'; readonly report: TypesetReport }
  | { readonly type: 'typeset/failed'; readonly reason: string; readonly at: number }
  | { readonly type: 'typeset/cleared' }
  | {
      readonly type: 'copy/succeeded'
      readonly kind: CopyKind
      readonly platform: PlatformId
      readonly mode: 'rich-text' | 'plain-text'
    }
  | {
      readonly type: 'copy/failed'
      readonly kind: CopyKind
      readonly platform: PlatformId
      readonly reason: string
      readonly manualText: string
    }
  | { readonly type: 'copy/cleared' }
  | { readonly type: 'copy/manual-dismissed' }
  | {
      readonly type: 'import/succeeded'
      readonly markdown: string
      readonly fileName: string
    }
  | { readonly type: 'import/failed'; readonly message: string; readonly detail: string }
  | { readonly type: 'assets/bound'; readonly raw: string; readonly url: string }
  | { readonly type: 'assets/unbound'; readonly raw: string }
  | { readonly type: 'assets/failed'; readonly message: string }
  | { readonly type: 'import/notice-cleared' }
  | { readonly type: 'assets/notice-cleared' }

export interface StudioInit {
  readonly markdown?: string
  readonly platform: PlatformId
}

export function createInitialState(init: StudioInit): StudioState {
  return {
    markdown: init.markdown ?? '',
    sourceLocked: false,
    titleOverrides: {},
    platform: init.platform,
    revision: 0,
    pendingRevision: null,
    report: null,
    generation: 0,
    platformTemplates: {},
    typesetBaselines: {},
    retainedDocuments: {},
    typesetting: false,
    typesetFailure: null,
    copyNotice: null,
    manualCopy: null,
    importNotice: null,
    assetNotice: null,
    bodyPatches: {},
    boundAssets: {},
    liveLink: null,
  }
}

/** 左侧原稿输入及其配图是排版输入，右侧排版结果的编辑不走这里。 */
function withSourceChange(state: StudioState, patch: Partial<StudioState>): StudioState {
  return { ...state, ...patch, revision: state.revision + 1, liveLink: null, manualCopy: null, copyNotice: null }
}

export function studioReducer(state: StudioState, event: StudioEvent): StudioState {
  switch (event.type) {
    case 'source/changed': {
      if (state.sourceLocked || event.markdown === state.markdown) {
        return state
      }
      return withSourceChange(state, { markdown: event.markdown })
    }
    case 'title/edited': {
      const { platform, generation, value } = event
      const baseline = selectPlatformResult(state, platform)?.outcome
      if (state.platform !== platform || state.generation !== generation || selectPatchBlockReason(state) !== null || !baseline?.ok) return state
      const initial = baseline.document.title ?? ''
      if (value === (state.titleOverrides[platform] ?? initial)) return state
      const titleOverrides = { ...state.titleOverrides }
      if (value === initial) delete titleOverrides[platform]
      else titleOverrides[platform] = value
      return { ...state, titleOverrides, copyNotice: null, manualCopy: null }
    }
    case 'platform/changed': {
      if (event.platform === state.platform) {
        return state
      }
      // 切换平台只换显示的成稿，不动源稿、不动排版时间戳。
      return { ...state, platform: event.platform, copyNotice: null, manualCopy: null }
    }
    case 'body/edited': {
      const { platform, report, revision, generation, patch } = event
      if (state.platform !== platform || state.report !== report || state.revision !== revision ||
        state.generation !== generation || selectPatchBlockReason(state) !== null) return state
      const result = selectPlatformResult(state, platform)
      if (!result?.outcome.ok) return state
      const previous = state.bodyPatches[platform] ?? result.outcome.document
      if (previous.html === patch.html) return state
      const bodyPatches = { ...state.bodyPatches }
      if (patch.linkedMarkdown === undefined && result.outcome.document.html === patch.html) delete bodyPatches[platform]
      else bodyPatches[platform] = { ...patch, linkedSource: undefined }
      return { ...state, bodyPatches, copyNotice: null, manualCopy: null }
    }
    case 'patch/discarded': {
      const { platform } = event
      if (state.platform !== platform || state.typesetting || !hasPlatformEdits(state)) return state
      const bodyPatches = { ...state.bodyPatches }
      const titleOverrides = { ...state.titleOverrides }
      delete bodyPatches[platform]
      delete titleOverrides[platform]
      return { ...state, bodyPatches, titleOverrides, generation: state.generation + 1, copyNotice: null, manualCopy: null }
    }
    case 'template/applied': {
      const { platform } = event
      const report = state.report
      if (state.platform !== platform || report !== event.baselineReport || state.revision !== event.revision ||
        selectActiveTemplate(state) === event.template || state.typesetFailure || selectCopyBlockReason(state) !== null ||
        event.document.platform !== platform || !selectPlatformResult(state, platform)?.outcome.ok ||
        selectTemplateEditConflict(state) ||
        (state.bodyPatches[platform] !== undefined && event.bodyPatch === undefined)) return state
      const bodyPatches = event.bodyPatch
        ? { ...state.bodyPatches, [platform]: event.bodyPatch }
        : state.bodyPatches
      return {
        ...state,
        platformTemplates: { ...state.platformTemplates, [platform]: event.template },
        bodyPatches,
        report: {
          ...report,
          results: report.results.map((entry) => entry.platform === platform
            ? { platform: entry.platform, outcome: { ok: true, document: event.document } }
            : entry),
        },
        copyNotice: null,
        manualCopy: null,
      }
    }
    case 'typeset/started': {
      return {
        ...state,
        typesetting: true,
        pendingRevision: state.revision,
        liveLink: null,
        typesetFailure: null,
        copyNotice: null,
        manualCopy: null,
      }
    }
    case 'typeset/succeeded': {
      if (!state.typesetting) return state
      if (state.pendingRevision !== state.revision) return { ...state, typesetting: false, pendingRevision: null }
      const { report } = event
      if (Object.keys(state.typesetBaselines).length > 0 && (report.parseError !== null || !report.results.some(({ outcome }) => outcome.ok))) {
        return studioReducer(state, {
          type: 'typeset/failed',
          reason: report.parseError ?? '六个平台均未生成新成稿，已保留上一版。',
          at: report.typesetAt ?? 0,
        })
      }
      // Partial success replaces only completed outputs. Keep failed platforms' previous previews
      // and loss warnings, but fail their copy/edit gate against the new report.
      const retainedDocuments: Partial<Record<PlatformId, RenderedDocument>> = {}
      const typesetBaselines = { ...state.typesetBaselines }
      for (const { platform, outcome } of report.results) {
        if (outcome.ok) {
          typesetBaselines[platform] = { revision: state.revision, markdown: state.markdown }
        } else {
          const previous = selectBaseDocument(state, platform)
          if (previous) retainedDocuments[platform] = previous
        }
      }
      return {
        ...state,
        typesetting: false,
        pendingRevision: null,
        report,
        sourceLocked: state.sourceLocked || report.results.some(({ outcome }) => outcome.ok),
        retainedDocuments,
        typesetBaselines,
        generation: state.generation + 1,
        manualCopy: null,
        copyNotice: null,
      }
    }
    case 'typeset/failed': {
      return {
        ...state,
        typesetting: false,
        pendingRevision: null,
        typesetFailure: { reason: event.reason, at: event.at },
      }
    }
    case 'typeset/cleared': {
      return { ...state, typesetFailure: null }
    }
    case 'copy/succeeded': {
      const target = event.kind === 'title' ? '标题' : '正文'
      const mode = event.mode === 'rich-text' ? '富文本' : '纯文本'
      return {
        ...state,
        manualCopy: null,
        copyNotice: {
          kind: event.kind,
          platform: event.platform,
          message: `${target}已复制为${mode}，到平台编辑器里粘贴即可。`,
          nonce: (state.copyNotice?.nonce ?? 0) + 1,
        },
      }
    }
    case 'copy/failed': {
      return {
        ...state,
        copyNotice: null,
        manualCopy: {
          kind: event.kind,
          platform: event.platform,
          reason: event.reason,
          text: event.manualText,
        },
      }
    }
    case 'copy/cleared': {
      return { ...state, copyNotice: null }
    }
    case 'copy/manual-dismissed': {
      return { ...state, manualCopy: null }
    }
    case 'import/succeeded': {
      if (event.markdown.trim() === '') {
        return {
          ...state,
          importNotice: {
            tone: 'failure',
            message: '没有导入：文件里没有可排版的内容。',
            detail: '当前源稿保持原样。请确认文件不是只有空行，或直接粘贴 Markdown。',
          },
        }
      }
      return {
        ...withSourceChange(state, {
          markdown: event.markdown,
          sourceLocked: true,
          titleOverrides: {},
          boundAssets: {},
          report: null,
          bodyPatches: {},
          typesetBaselines: {},
          retainedDocuments: {},
          generation: state.generation + 1,
          pendingRevision: null,
          typesetting: false,
          typesetFailure: null,
          assetNotice: null,
        }),
        importNotice: {
          tone: 'success',
          message: `已导入 ${event.fileName}，点「一键排版」生成六个版本。`,
          detail: null,
        },
      }
    }
    case 'import/notice-cleared': {
      return { ...state, importNotice: null }
    }
    case 'import/failed': {
      // 导入失败只留提示，源稿一个字都不动。
      return {
        ...state,
        importNotice: { tone: 'failure', message: event.message, detail: event.detail },
      }
    }
    case 'assets/bound': {
      return {
        ...withSourceChange(state, {
          boundAssets: { ...state.boundAssets, [event.raw]: event.url },
        }),
        assetNotice: {
          tone: 'success',
          message: `已配对 ${event.raw}；重新排版后，未手动编辑的正文将使用这张图。`,
        },
      }
    }
    case 'assets/unbound': {
      if (!(event.raw in state.boundAssets)) {
        return state
      }
      const boundAssets = { ...state.boundAssets }
      delete boundAssets[event.raw]
      return {
        ...withSourceChange(state, { boundAssets }),
        assetNotice: {
          tone: 'success',
          message: `已取消 ${event.raw} 的配对；重新排版后，未手动编辑的正文将恢复该位置的补插标记。`,
        },
      }
    }
    case 'assets/failed': {
      return { ...state, assetNotice: { tone: 'failure', message: event.message } }
    }
    case 'assets/notice-cleared': {
      return { ...state, assetNotice: null }
    }
    default: {
      return state
    }
  }
}

export function selectActiveTemplate(state: StudioState): WechatTemplateId {
  return state.platformTemplates[state.platform] ?? DEFAULT_WECHAT_TEMPLATE_ID
}

export function hasPlatformEdits(state: StudioState): boolean {
  return state.bodyPatches[state.platform] !== undefined || state.titleOverrides[state.platform] !== undefined
}

export function isSyncedBodyPatch(
  patch: BodyPatch | undefined,
): patch is BodyPatch & { readonly linkedMarkdown: string } {
  return patch !== undefined && patch.linkedMarkdown !== undefined && patch.html === patch.baseline.html
}

export function selectTemplateEditConflict(state: StudioState): string | null {
  const patch = state.bodyPatches[state.platform]
  if (!patch || isSyncedBodyPatch(patch)) {
    return null
  }
  if (state.liveLink?.source === state.platform) {
    return state.liveLink.error !== null
      ? '当前联动来源包含无法无损转换的改动，暂不能换版；请先修复或撤销该改动后再试。'
      : null
  }
  if (patch.linkedSource) return null
  return '当前成稿有手动正文改动。为保留文字和样式，暂不能换版；如需换版，可先另存成稿，再撤销当前平台的改动。'
}

/** 空稿判定与「是否已排版」无关，只看源稿本身。 */
export function isEmptyDraft(state: StudioState): boolean {
  return state.markdown.trim() === ''
}

export function selectStatus(state: StudioState): StudioStatus {
  if (state.typesetting) {
    return 'typesetting'
  }
  if (!state.report) {
    return isEmptyDraft(state) ? 'empty' : 'ready'
  }
  if (state.report.parseError !== null) {
    return 'parse-error'
  }
  return isStale(state) ? 'stale' : 'typeset'
}

/** 输出过期：排版之后原稿图片配对又变了。 */
export function isStale(state: StudioState): boolean {
  if (!state.report || state.report.parseError !== null) {
    return false
  }
  const baseline = state.typesetBaselines[state.platform]
  return baseline !== undefined && baseline.revision !== state.revision
}

export function selectPlatformResult(
  state: StudioState,
  platform: PlatformId,
): TypesetReport['results'][number] | null {
  return state.report?.results.find((result) => result.platform === platform) ?? null
}

/**
 * 复制前的统一闸门：任何不允许复制的情况都给出「为什么 + 下一步」，
 * 界面据此禁用按钮并把原因写在按钮旁边。
 */
export function selectCopyBlockReason(state: StudioState): string | null {
  if (!state.report && isEmptyDraft(state)) {
    return '源稿还是空的：粘贴 Markdown 或导入 .md 文件后才可复制。'
  }
  if (state.typesetting) {
    return '正在排版，完成后即可复制。'
  }
  if (!state.report) {
    return '尚未排版：先点「一键排版」生成当前平台的正文。'
  }
  if (state.report.parseError !== null) {
    return `源稿无法解析，修好后再点「一键排版」。原因：${state.report.parseError}`
  }
  const result = selectPlatformResult(state, state.platform)
  if (result && !result.outcome.ok) {
    return '该平台本次排版失败，无法复制；切换到其它平台可继续，或按预览里的原因处理后重新排版。'
  }
  if (!result?.outcome.ok) return '当前平台还没有成稿，请先排版。'
  if (isStale(state)) {
    return '源稿配图已更新 · 重新排版后可复制。当前显示的是上一版成稿。'
  }
  return null
}

export function selectPatchBlockReason(state: StudioState): string | null {
  if (state.typesetFailure) return '上次排版失败，请重新排版后编辑。'
  return selectCopyBlockReason(state)
}

/** 新一轮只部分成功时，失败平台可看旧稿，但不允许复制或编辑。 */
function selectBaseDocument(state: StudioState, platform: PlatformId): RenderedDocument | null {
  const result = selectPlatformResult(state, platform)
  return result?.outcome.ok ? result.outcome.document : state.retainedDocuments[platform] ?? null
}

function selectDocument(state: StudioState, platform: PlatformId): RenderedDocument | null {
  const original = selectBaseDocument(state, platform)
  const patch = state.bodyPatches[platform]
  const title = state.titleOverrides[platform]
  if (!original || (!patch && title === undefined)) return original
  return {
    ...original,
    html: patch?.html ?? original.html,
    plainText: patch?.plainText ?? original.plainText,
    warnings: patch?.baseline.warnings ?? original.warnings,
    title: title === undefined ? original.title : title.trim() || null,
  }
}

export function selectActiveDocument(state: StudioState): RenderedDocument | null {
  return selectDocument(state, state.platform)
}

export function selectActiveFailure(state: StudioState): RenderFailure | null {
  const result = selectPlatformResult(state, state.platform)
  return result && !result.outcome.ok ? result.outcome.failure : null
}

/** 单平台失败时，告诉用户哪些平台的成稿仍然可用。 */
export function selectSucceededPlatforms(state: StudioState): readonly PlatformId[] {
  if (!state.report) {
    return []
  }
  return state.report.results.filter((result) => result.outcome.ok).map((result) => result.platform)
}
