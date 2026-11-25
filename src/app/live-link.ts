import { projectDraftBody } from '@/core/markdown/project-draft'
import { isLinkedInlineImage } from '@/core/markdown/serialize-edit'
import type { PlatformId, TypesetReport } from '@/core/types'
import { PLATFORMS } from '@/platforms/registry'
import type { StudioPorts } from './ports'
import { selectActiveDocument, selectPatchBlockReason, selectPlatformResult, type StudioEvent, type StudioState } from './studio-state'
import { reasonOf } from './text'

export function projectLiveBody(state: StudioState, platform: PlatformId, label = '当前'): string {
  const result = selectPlatformResult(state, platform)?.outcome
  const platformState = state.platform === platform ? state : { ...state, platform }
  const current = selectActiveDocument(platformState)
  if (!result?.ok || !current) throw new Error(`请先为${label}平台生成可编辑的成稿。`)
  const patch = state.bodyPatches[platform]
  const linkedMarkdown = patch?.linkedMarkdown
  const markdown = linkedMarkdown ?? state.typesetBaselines[platform]?.markdown
  if (markdown === undefined) throw new Error(`找不到${label}平台的排版原文，请先重新排版。`)
  return projectDraftBody({
    markdown,
    bodyOnly: linkedMarkdown !== undefined,
    originalHtml: patch?.baseline.html ?? result.document.html,
    editedHtml: current.html,
    assets: state.boundAssets,
  })
}

export function renderPortableBody(options: {
  readonly state: StudioState
  readonly platforms: readonly PlatformId[]
  readonly markdown: string
  readonly currentHtml: string
  readonly platformTemplates?: StudioState['platformTemplates']
  readonly ports: StudioPorts
}): TypesetReport {
  const { state, platforms, markdown, currentHtml, platformTemplates = state.platformTemplates, ports } = options
  const registry = ports.createAssets(state.boundAssets)
  // Only images already present in the rendered editor may bypass raw Markdown's data: rule.
  const template = document.createElement('template')
  template.innerHTML = currentHtml
  const inlineImages = new Set(Array.from(template.content.querySelectorAll('img[src]'), (image) =>
    image.getAttribute('src') ?? '').filter(isLinkedInlineImage))
  return ports.typeset({
    markdown,
    bodyOnly: true,
    titleOverride: null,
    platformTemplates,
    assets: { resolve: (path) => inlineImages.has(path) ? { kind: 'bound', url: path } : registry.resolve(path) },
  }, PLATFORMS.filter(({ id }) => platforms.includes(id)))
}

function synchronize(
  state: StudioState,
  source: PlatformId,
  targets: readonly PlatformId[],
  body: boolean,
  ports: StudioPorts,
): StudioState {
  const sourceState = state.platform === source ? state : { ...state, platform: source }
  const result = selectPlatformResult(state, source)?.outcome
  const current = selectActiveDocument(sourceState)
  if (!result?.ok || !current || selectPatchBlockReason(sourceState)) throw new Error('请先为来源平台生成可编辑的成稿。')

  const titleOverrides = { ...state.titleOverrides }
  for (const target of targets) {
    const original = selectPlatformResult(state, target)?.outcome
    if (!original?.ok) throw new Error('有目标平台没有可编辑的成稿，请先重新排版。')
    if (current.title === original.document.title) delete titleOverrides[target]
    else titleOverrides[target] = current.title ?? ''
  }
  if (!body) return { ...state, titleOverrides }

  const portableBody = projectLiveBody(state, source, '来源')
  const report = renderPortableBody({
    state,
    platforms: targets,
    markdown: portableBody,
    currentHtml: current.html,
    ports,
  })
  if (report.parseError) throw new Error(report.parseError)
  const bodyPatches = { ...state.bodyPatches }
  const sourcePatch = bodyPatches[source]
  if (sourcePatch && !sourcePatch.linkedSource) bodyPatches[source] = { ...sourcePatch, linkedSource: true }
  for (const id of targets) {
    const outcome = report.results.find(({ platform }) => platform === id)?.outcome
    if (!outcome?.ok) {
      const name = PLATFORMS.find((platform) => platform.id === id)?.name ?? id
      throw new Error(`${name}转换失败：${outcome?.failure.reason ?? '排版没有返回成稿，请重新排版后再试。'}`)
    }
    const { html, plainText, warnings } = outcome.document
    bodyPatches[id] = { html, plainText, baseline: { html, warnings }, linkedMarkdown: portableBody }
  }
  return { ...state, bodyPatches, titleOverrides, copyNotice: null, manualCopy: null }
}

export function configureLiveLink(state: StudioState, selection: readonly PlatformId[], ports: StudioPorts): StudioState {
  if (selection.length === 0) return state.liveLink ? { ...state, liveLink: null } : state
  const source = state.liveLink?.source ?? state.platform
  const targets = PLATFORMS.filter(({ id }) => id !== source && selection.includes(id)).map(({ id }) => id)
  if (targets.length === 0) return state
  const added = targets.filter((id) => !state.liveLink?.targets.includes(id))
  const next = added.length ? synchronize(state, source, added, true, ports) : state
  return { ...next, liveLink: { source, targets, error: state.liveLink?.error ?? null } }
}

export function followLiveLink(state: StudioState, event: StudioEvent, ports: StudioPorts): StudioState {
  if (event.type !== 'body/edited' && event.type !== 'title/edited' && event.type !== 'patch/discarded') return state
  const link = state.liveLink
  if (!link) return state
  if (event.platform !== link.source) {
    // Editing a target deliberately detaches it so future source edits cannot erase its new changes.
    if (!link.targets.includes(event.platform)) return state
    const targets = link.targets.filter((id) => id !== event.platform)
    return { ...state, liveLink: targets.length ? { ...link, targets } : null }
  }
  const body = event.type !== 'title/edited'
  try {
    const next = synchronize(state, link.source, link.targets, body, ports)
    return body && link.error ? { ...next, liveLink: { ...link, error: null } } : next
  } catch (error) {
    const part = body ? '正文' : '标题'
    return { ...state, liveLink: { ...link, error: `本次${part}未同步，目标平台保留上一版。${reasonOf(error)}` } }
  }
}
