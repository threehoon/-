import type {
  PlatformId,
  RenderedDocument,
  RenderFailure,
  TypesetReport,
  WechatTemplateId,
} from '@/core/types'
import { fingerprint } from '@/core/hash'
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
  readonly template: WechatTemplateId
  readonly fingerprint: string
}

export type PatchState = 'linked' | 'diverged' | 'superseded'

export interface BodyPatch {
  readonly html: string
  readonly plainText: string
  readonly state: PatchState
  readonly platformStyle: boolean
  readonly base: Pick<TypesetBaseline, 'revision' | 'fingerprint'>
  readonly reason: string | null
  readonly supersededFrom?: Exclude<PatchState, 'superseded'>
  /** HTML 源码标记仍使用最初那次排版的字节偏移；同步不重写正在编辑的 DOM。 */
  readonly mapping: { readonly html: string; readonly markdown: string; readonly warnings: RenderedDocument['warnings'] }
  readonly syncedHtml: string
  readonly syncedMarkdown: string
  readonly assets: Readonly<Record<string, string>>
}

interface SyncNotice {
  readonly platform: PlatformId
  readonly tone: 'success' | 'failure'
  readonly message: string
}

const SUPERSEDED = '排版基线已变。右侧改动仍可查看；撤销右侧改动后使用最新成稿。'

export interface StudioState {
  readonly markdown: string
  readonly titleOverride: string
  readonly platform: PlatformId
  /** 源稿、标题或图片配对的每次改动都会加一，用于判断输出是否过期。 */
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
  readonly warningsExpanded: boolean
  readonly bodyPatches: Readonly<Partial<Record<PlatformId, BodyPatch>>>
  readonly syncNotice: SyncNotice | null
  readonly boundAssets: Readonly<Record<string, string>>
}

export type StudioEvent =
  | { readonly type: 'source/changed'; readonly markdown: string }
  | { readonly type: 'title/changed'; readonly value: string }
  | { readonly type: 'platform/changed'; readonly platform: PlatformId }
  | {
      readonly type: 'body/edited'
      readonly platform: PlatformId
      readonly report: TypesetReport
      readonly revision: number
      readonly patch: BodyPatch
    }
  | {
      readonly type: 'sync/to-source'
      readonly platform: PlatformId
      readonly patch: BodyPatch
      readonly markdown: string
      readonly projectedMarkdown: string
      readonly document: RenderedDocument | null
      readonly assets: Readonly<Record<string, string>>
    }
  | { readonly type: 'sync/rejected'; readonly platform: PlatformId; readonly patch: BodyPatch; readonly reason: string }
  | { readonly type: 'patch/discarded'; readonly platform: PlatformId }
  | {
      readonly type: 'template/applied'
      readonly platform: PlatformId
      readonly template: WechatTemplateId
      readonly baselineReport: TypesetReport
      readonly revision: number
      readonly document: RenderedDocument
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
  | { readonly type: 'warnings/toggled' }
  | { readonly type: 'assets/notice-cleared' }

export interface StudioInit {
  readonly markdown?: string
  readonly titleOverride?: string
  readonly platform: PlatformId
}

export function createInitialState(init: StudioInit): StudioState {
  return {
    markdown: init.markdown ?? '',
    titleOverride: init.titleOverride ?? '',
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
    warningsExpanded: true,
    bodyPatches: {},
    syncNotice: null,
    boundAssets: {},
  }
}

function baselineFor(state: StudioState, platform: PlatformId): TypesetBaseline {
  const { revision, markdown, titleOverride, boundAssets } = state
  const template = state.platformTemplates[platform] ?? DEFAULT_WECHAT_TEMPLATE_ID
  const assets = Object.keys(boundAssets).sort().flatMap((path) => [path, boundAssets[path]])
  return { revision, markdown, template, fingerprint: fingerprint([markdown, titleOverride.trim(), template, ...assets]) }
}

function supersede(patch: BodyPatch): BodyPatch {
  return patch.state === 'superseded' ? patch : {
    ...patch, state: 'superseded', supersededFrom: patch.state, reason: SUPERSEDED,
  }
}

function rebind(patch: BodyPatch, baseline: TypesetBaseline): BodyPatch {
  if (patch.base.fingerprint !== baseline.fingerprint) return supersede(patch)
  return {
    ...patch,
    base: { revision: baseline.revision, fingerprint: baseline.fingerprint },
    state: patch.supersededFrom ?? patch.state,
    supersededFrom: undefined,
    reason: patch.state === 'superseded' ? null : patch.reason,
  }
}

/** 源稿、标题、图片配对的改动共用这一条通路。 */
function withContentChange(state: StudioState, patch: Partial<StudioState>): StudioState {
  const bodyPatches = { ...state.bodyPatches }
  for (const platform of Object.keys(bodyPatches) as PlatformId[]) {
    const body = bodyPatches[platform]
    if (body) bodyPatches[platform] = supersede(body)
  }
  return {
    ...state,
    ...patch,
    revision: state.revision + 1,
    bodyPatches,
    syncNotice: null,
    manualCopy: null,
    copyNotice: null,
  }
}

export function studioReducer(state: StudioState, event: StudioEvent): StudioState {
  switch (event.type) {
    case 'source/changed': {
      if (event.markdown === state.markdown) {
        return state
      }
      return withContentChange(state, { markdown: event.markdown })
    }
    case 'title/changed': {
      if (event.value === state.titleOverride) {
        return state
      }
      return withContentChange(state, { titleOverride: event.value })
    }
    case 'platform/changed': {
      if (event.platform === state.platform) {
        return state
      }
      // 切换平台只换显示的成稿，不动源稿、不动排版时间戳。
      return { ...state, platform: event.platform, copyNotice: null, manualCopy: null }
    }
    case 'body/edited': {
      const { platform, report, revision, patch } = event
      if (state.platform !== platform || state.report !== report || state.revision !== revision || selectPatchBlockReason(state)) return state
      const baseline = state.typesetBaselines[platform]
      const result = selectPlatformResult(state, platform)
      if (!result?.outcome.ok || !baseline || patch.base.fingerprint !== baseline.fingerprint || patch.base.revision !== baseline.revision) return state
      const previous = state.bodyPatches[platform] ?? result.outcome.document
      if (previous.html === patch.html) return state
      const bodyPatches = { ...state.bodyPatches }
      if (result.outcome.document.html === patch.html && patch.state === 'linked' && !patch.platformStyle) delete bodyPatches[platform]
      else bodyPatches[platform] = patch
      return { ...state, bodyPatches, syncNotice: null, copyNotice: null, manualCopy: null }
    }
    case 'sync/to-source': {
      const { platform, patch, markdown } = event
      if (state.platform !== platform || state.bodyPatches[platform] !== patch || selectSyncBlockReason(state)) return state
      const changed = markdown !== state.markdown
      const { report } = state
      const document = event.document
      if (!report || (changed && document?.platform !== platform)) return state
      const next = changed ? withContentChange(state, { markdown, boundAssets: { ...state.boundAssets, ...event.assets } }) : state
      const baseline = baselineFor(next, platform)
      return {
        ...next,
        report: document ? {
          ...report,
          results: report.results.map((entry) => entry.platform === platform
            ? { platform, outcome: { ok: true, document } } : entry),
        } : report,
        typesetBaselines: { ...next.typesetBaselines, [platform]: baseline },
        bodyPatches: {
          ...next.bodyPatches,
          [platform]: {
            ...patch, state: 'linked', reason: null, syncedHtml: patch.html, syncedMarkdown: event.projectedMarkdown,
            base: { revision: baseline.revision, fingerprint: baseline.fingerprint },
          },
        },
        syncNotice: {
          platform, tone: 'success',
          message: changed ? '正文已同步到 Markdown。其它平台的成稿已过期。' : '源稿文字没有变化；平台专属样式仍只保留在当前成稿。',
        },
      }
    }
    case 'sync/rejected': {
      if (state.platform !== event.platform || state.bodyPatches[event.platform] !== event.patch) return state
      return {
        ...state,
        bodyPatches: { ...state.bodyPatches, [event.platform]: { ...event.patch, reason: event.reason } },
        syncNotice: { platform: event.platform, tone: 'failure', message: event.reason },
      }
    }
    case 'patch/discarded': {
      if (state.platform !== event.platform || state.typesetting || !state.bodyPatches[event.platform]) return state
      const bodyPatches = { ...state.bodyPatches }
      delete bodyPatches[event.platform]
      return { ...state, bodyPatches, generation: state.generation + 1, syncNotice: null, copyNotice: null, manualCopy: null }
    }
    case 'template/applied': {
      const { platform } = event
      const report = state.report
      if (state.platform !== platform || report !== event.baselineReport || state.revision !== event.revision ||
        selectActiveTemplate(state) === event.template || state.typesetFailure || selectCopyBlockReason(state) !== null ||
        event.document.platform !== platform || !selectPlatformResult(state, platform)?.outcome.ok ||
        selectTemplateEditConflict(state)) return state
      const next = {
        ...state,
        platformTemplates: { ...state.platformTemplates, [platform]: event.template },
      }
      const baseline = baselineFor(next, platform)
      const bodyPatches = { ...state.bodyPatches }
      const patch = bodyPatches[platform]
      if (patch?.state === 'linked') delete bodyPatches[platform]
      else if (patch) bodyPatches[platform] = rebind(patch, baseline)
      return {
        ...next,
        typesetBaselines: { ...state.typesetBaselines, [platform]: baseline },
        report: {
          ...report,
          results: report.results.map((entry) => entry.platform === platform
            ? { platform: entry.platform, outcome: { ok: true, document: event.document } }
            : entry),
        },
        bodyPatches,
        syncNotice: null,
        copyNotice: null,
        manualCopy: null,
      }
    }
    case 'typeset/started': {
      return {
        ...state,
        typesetting: true,
        pendingRevision: state.revision,
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
      const bodyPatches = { ...state.bodyPatches }
      const typesetBaselines = { ...state.typesetBaselines }
      for (const { platform, outcome } of report.results) {
        if (outcome.ok) {
          const baseline = baselineFor(state, platform)
          typesetBaselines[platform] = baseline
          const patch = bodyPatches[platform]
          if (patch) bodyPatches[platform] = rebind(patch, baseline)
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
        bodyPatches,
        retainedDocuments,
        typesetBaselines,
        generation: state.generation + 1,
        syncNotice: null,
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
        ...withContentChange(state, {
          markdown: event.markdown,
          titleOverride: '',
          boundAssets: {},
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
        ...withContentChange(state, {
          boundAssets: { ...state.boundAssets, [event.raw]: event.url },
        }),
        assetNotice: {
          tone: 'success',
          message: `已配对 ${event.raw}；重新排版后预览和复制内容里会替换成这张图。`,
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
        ...withContentChange(state, { boundAssets }),
        assetNotice: {
          tone: 'success',
          message: `已取消 ${event.raw} 的配对；重新排版后会恢复为该位置的补插标记。`,
        },
      }
    }
    case 'assets/failed': {
      return { ...state, assetNotice: { tone: 'failure', message: event.message } }
    }
    case 'assets/notice-cleared': {
      return { ...state, assetNotice: null }
    }
    case 'warnings/toggled': {
      return { ...state, warningsExpanded: !state.warningsExpanded }
    }
    default: {
      return state
    }
  }
}

export function selectActiveTemplate(state: StudioState): WechatTemplateId {
  return state.platformTemplates[state.platform] ?? DEFAULT_WECHAT_TEMPLATE_ID
}

export function selectTemplateEditConflict(state: StudioState): string | null {
  if (state.bodyPatches[state.platform]?.platformStyle) return '成稿有手动样式（如高亮或下划线）。请先撤销这些样式，再切换模板。'
  return null
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

/** 输出过期：排版之后源稿、标题或图片配对又变了。 */
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
  const patch = state.bodyPatches[state.platform]
  if (isStale(state) && patch?.state !== 'diverged') {
    return '源稿已更新 · 重新排版后可复制。当前显示的是上一版成稿。'
  }
  if (patch?.state === 'superseded') return SUPERSEDED
  return null
}

export function selectPatchBlockReason(state: StudioState): string | null {
  if (state.typesetFailure) return '上次排版失败，请重新排版后编辑。'
  if (isStale(state) && !state.typesetting) return '源稿已更新，请重新排版后编辑。'
  return selectCopyBlockReason(state)
}

export function selectSyncBlockReason(state: StudioState): string | null {
  const blocked = selectPatchBlockReason(state)
  if (blocked) return blocked
  return state.bodyPatches[state.platform]?.state === 'diverged' ? null : '当前平台没有未同步到源稿的正文改动。'
}

/** 新一轮只部分成功时，失败平台可看旧稿，但不允许复制或编辑。 */
function selectBaseDocument(state: StudioState, platform: PlatformId): RenderedDocument | null {
  const result = selectPlatformResult(state, platform)
  return result?.outcome.ok ? result.outcome.document : state.retainedDocuments[platform] ?? null
}

function selectDocument(state: StudioState, platform: PlatformId): RenderedDocument | null {
  const original = selectBaseDocument(state, platform)
  const patch = state.bodyPatches[platform]
  return original && patch ? { ...original, html: patch.html, plainText: patch.plainText, warnings: patch.mapping.warnings } : original
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
