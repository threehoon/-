import { describe, expect, it } from 'vitest'
import type {
  PlatformId,
  RenderedDocument,
  RenderFailure,
  TypesetReport,
} from '@/core/types'
import type { StudioEvent, StudioState } from './studio-state'
import {
  createInitialState,
  isEmptyDraft,
  isStale,
  selectActiveDocument,
  selectActiveFailure,
  selectCopyBlockReason,
  selectPlatformResult,
  selectPatchBlockReason,
  selectSyncBlockReason,
  selectTemplateEditConflict,
  selectStatus,
  selectSucceededPlatforms,
  studioReducer,
} from './studio-state'

function makeDocument(
  platform: PlatformId,
  overrides: Partial<RenderedDocument> = {},
): RenderedDocument {
  return {
    platform,
    title: '一篇中文样稿',
    html: '<p>正文段落</p>',
    plainText: '正文段落',
    warnings: [],
    stats: { characters: 4, blocks: 1 },
    ...overrides,
  }
}

function makeReport(
  results: TypesetReport['results'],
  overrides: Partial<TypesetReport> = {},
): TypesetReport {
  return {
    title: '一篇中文样稿',
    typesetAt: 1_700_000_000_000,
    results,
    stats: { characters: 4, blocks: 1 },
    parseError: null,
    durationMs: 18,
    ...overrides,
  }
}

function okReport(): TypesetReport {
  return makeReport([
    { platform: 'wechat', outcome: { ok: true, document: makeDocument('wechat') } },
    {
      platform: 'toutiao',
      outcome: { ok: true, document: makeDocument('toutiao', { title: null }) },
    },
  ])
}

function failureOf(platform: PlatformId, reason: string): RenderFailure {
  return { platform, code: 'render', reason }
}

function runEvents(events: readonly StudioEvent[], from?: StudioState): StudioState {
  const start = from ?? createInitialState({ platform: 'wechat' })
  return events.reduce(studioReducer, start)
}

function typedState(): StudioState {
  return runEvents([
    { type: 'source/changed', markdown: '# 一篇中文样稿\n\n正文段落。' },
    { type: 'typeset/started' },
    { type: 'typeset/succeeded', report: okReport() },
  ])
}

describe('工作台状态机 · 空稿与就绪', () => {
  it('没有任何源稿时是空稿状态，并说明为什么不能复制', () => {
    const state = createInitialState({ platform: 'wechat' })
    expect(isEmptyDraft(state)).toBe(true)
    expect(selectStatus(state)).toBe('empty')
    expect(selectCopyBlockReason(state)).toContain('源稿还是空的')
  })

  it('只有空白字符也算空稿', () => {
    const state = runEvents([{ type: 'source/changed', markdown: '   \n\n\t  ' }])
    expect(selectStatus(state)).toBe('empty')
  })

  it('有源稿但没排版时是「源稿就绪」，复制按钮要求先排版', () => {
    const state = runEvents([{ type: 'source/changed', markdown: '# 标题\n\n正文' }])
    expect(selectStatus(state)).toBe('ready')
    expect(selectCopyBlockReason(state)).toContain('尚未排版')
  })
})

describe('工作台状态机 · 排版中与成功', () => {
  it('点一键排版后进入排版中，并保留上一版结果', () => {
    const before = typedState()
    const state = runEvents([{ type: 'typeset/started' }], before)
    expect(selectStatus(state)).toBe('typesetting')
    expect(selectActiveDocument(state)?.plainText).toBe('正文段落')
    expect(selectCopyBlockReason(state)).toContain('正在排版')
  })

  it('排版成功后记录时间并允许复制', () => {
    const state = typedState()
    expect(selectStatus(state)).toBe('typeset')
    expect(state.report?.typesetAt).toBe(1_700_000_000_000)
    expect(isStale(state)).toBe(false)
    expect(selectCopyBlockReason(state)).toBeNull()
    expect(selectActiveDocument(state)?.platform).toBe('wechat')
  })

  it('整体解析失败时状态是 parse-error，并给出解析原因', () => {
    const report = makeReport([], {
      typesetAt: null,
      parseError: '第 3 行的表格缺少分隔行',
    })
    const state = runEvents([
      { type: 'source/changed', markdown: '|a|b|' },
      { type: 'typeset/started' },
      { type: 'typeset/succeeded', report },
    ])
    expect(selectStatus(state)).toBe('parse-error')
    expect(selectCopyBlockReason(state)).toContain('源稿无法解析')
    expect(selectCopyBlockReason(state)).toContain('表格缺少分隔行')
    expect(selectActiveDocument(state)).toBeNull()
  })

  it('排版过程抛错时不算成功，并保留失败原因', () => {
    const state = runEvents([
      { type: 'source/changed', markdown: '# 标题\n\n正文' },
      { type: 'typeset/started' },
      { type: 'typeset/failed', reason: '内存不足', at: 1_700_000_000_500 },
    ])
    expect(state.typesetting).toBe(false)
    expect(state.report).toBeNull()
    expect(state.typesetFailure?.reason).toBe('内存不足')
    expect(selectCopyBlockReason(state)).toContain('尚未排版')
  })
})

describe('工作台状态机 · 输出过期', () => {
  it('排版后改源稿即过期，复制被禁用并说明原因', () => {
    const state = runEvents(
      [{ type: 'source/changed', markdown: '# 一篇中文样稿\n\n正文段落，追加一句。' }],
      typedState(),
    )
    expect(selectStatus(state)).toBe('stale')
    expect(isStale(state)).toBe(true)
    expect(selectCopyBlockReason(state)).toContain('重新排版')
    expect(selectActiveDocument(state)?.plainText).toBe('正文段落')
  })

  it('改标题也会让输出过期', () => {
    const state = runEvents([{ type: 'title/changed', value: '我手填的标题' }], typedState())
    expect(selectStatus(state)).toBe('stale')
  })

  it('本地图片配对变化后同样要求重新排版', () => {
    const bound = runEvents(
      [{ type: 'assets/bound', raw: 'images/a.png', url: 'blob:mock-a' }],
      typedState(),
    )
    expect(selectStatus(bound)).toBe('stale')
    const unbound = runEvents([{ type: 'assets/unbound', raw: 'images/a.png' }], bound)
    expect(selectStatus(unbound)).toBe('stale')
  })

  it('重新排版后恢复为可复制', () => {
    const stale = runEvents(
      [{ type: 'source/changed', markdown: '# 一篇中文样稿\n\n改过的正文' }],
      typedState(),
    )
    const refreshed = runEvents(
      [
        { type: 'typeset/started' },
        { type: 'typeset/succeeded', report: okReport() },
      ],
      stale,
    )
    expect(selectStatus(refreshed)).toBe('typeset')
    expect(selectCopyBlockReason(refreshed)).toBeNull()
  })

  it('同样的源稿再次触发 changed 不会误判为过期', () => {
    const state = typedState()
    const same = runEvents(
      [{ type: 'source/changed', markdown: state.markdown }],
      state,
    )
    expect(same).toBe(state)
    expect(selectStatus(same)).toBe('typeset')
  })
})

describe('工作台状态机 · 平台隔离', () => {
  function bodyEdit(state: StudioState, platformStyle = false): StudioEvent {
    const baseline = state.typesetBaselines[state.platform]
    if (!state.report || !baseline) throw new Error('测试需要先排版')
    return {
      type: 'body/edited', report: state.report, platform: state.platform, revision: state.revision,
      patch: {
        html: '<p>右侧改过</p>', plainText: '右侧改过', state: 'diverged', reason: null, platformStyle,
        base: baseline, mapping: { html: '<p>正文段落</p>', markdown: baseline.markdown, warnings: [] },
        syncedHtml: '<p>正文段落</p>', syncedMarkdown: baseline.markdown, assets: {},
      },
    }
  }

  it('编辑不改源稿或 revision，不影响其它平台，并仅拦有手动样式的换版', () => {
    const before = typedState()
    const next = studioReducer(before, bodyEdit(before))
    expect(next.markdown).toBe(before.markdown)
    expect(next.revision).toBe(before.revision)
    expect(selectActiveDocument(next)?.plainText).toBe('右侧改过')
    expect(selectCopyBlockReason(next)).toBeNull()
    expect(selectSyncBlockReason(next)).toBeNull()
    expect(selectTemplateEditConflict(next)).toBeNull()
    expect(selectTemplateEditConflict(studioReducer(before, bodyEdit(before, true)))).toContain('手动样式')
    expect(next.bodyPatches.wechat?.state).toBe('diverged')
    const switched = studioReducer(next, { type: 'platform/changed', platform: 'toutiao' })
    expect(selectCopyBlockReason(switched)).toBeNull()
    expect(selectActiveDocument(switched)?.plainText).toBe('正文段落')
  })

  it.each<StudioEvent>([
    { type: 'source/changed', markdown: '左侧较新稿' },
    { type: 'import/succeeded', markdown: '另一个文件', fileName: '新稿.md' },
    { type: 'platform/changed', platform: 'toutiao' },
    { type: 'typeset/started' },
  ])('拒绝落在 %s 之后的旧编辑事务', (intervening) => {
    const before = typedState()
    const after = studioReducer(before, intervening)
    expect(studioReducer(after, bodyEdit(before))).toBe(after)
  })

  it('同基线重排保留补丁；改变基线后仍可查看，必须撤销才能使用新成稿', () => {
    const before = typedState()
    const dirty = studioReducer(before, bodyEdit(before))
    const rerender = (state: StudioState) => runEvents([
      { type: 'typeset/started' }, { type: 'typeset/succeeded', report: okReport() },
    ], state)
    expect(rerender(dirty).bodyPatches.wechat?.state).toBe('diverged')
    const stale = studioReducer(dirty, { type: 'title/changed', value: '新标题' })
    expect(stale.bodyPatches.wechat?.state).toBe('superseded')
    const refreshed = rerender(stale)
    expect(selectActiveDocument(refreshed)?.plainText).toBe('右侧改过')
    expect(selectPatchBlockReason(refreshed)).toContain('基线已变')
    expect(selectSyncBlockReason(refreshed)).toContain('基线已变')
    const reverted = studioReducer(refreshed, { type: 'patch/discarded', platform: 'wechat' })
    expect(selectActiveDocument(reverted)?.plainText).toBe('正文段落')
    expect(selectPatchBlockReason(reverted)).toBeNull()
  })

  it('恢复相同源稿后重排可重新绑定原平台补丁', () => {
    const before = typedState()
    const dirty = studioReducer(before, bodyEdit(before))
    const refreshed = runEvents([
      { type: 'source/changed', markdown: '另外的草稿' },
      { type: 'source/changed', markdown: before.markdown },
      { type: 'typeset/started' }, { type: 'typeset/succeeded', report: okReport() },
    ], dirty)
    expect(refreshed.bodyPatches.wechat?.state).toBe('diverged')
    expect(refreshed.bodyPatches.wechat?.base.revision).toBe(refreshed.revision)
  })

  it('只有显式同步推进共享基线，当前平台关联，已有的其它补丁保留为过期', () => {
    const before = typedState()
    const switched = studioReducer(before, { type: 'platform/changed', platform: 'toutiao' })
    const edited = studioReducer(switched, bodyEdit(switched))
    const current = studioReducer(edited, { type: 'platform/changed', platform: 'wechat' })
    const dirty = studioReducer(current, bodyEdit(current))
    const patch = dirty.bodyPatches.wechat
    if (!patch) throw new Error('缺少补丁')
    const markdown = before.markdown.replace('正文段落。', '右侧改过')
    const next = studioReducer(dirty, {
      type: 'sync/to-source', platform: 'wechat', markdown, projectedMarkdown: markdown, assets: {}, patch,
      document: makeDocument('wechat', { html: patch.html, plainText: patch.plainText }),
    })
    expect(next.markdown).toBe(markdown)
    expect(next.revision).toBe(before.revision + 1)
    expect(next.typesetBaselines.wechat?.markdown).toBe(markdown)
    expect(next.bodyPatches.wechat?.state).toBe('linked')
    expect(next.bodyPatches.toutiao?.state).toBe('superseded')
    expect(isStale(next)).toBe(false)
    const stale = studioReducer(next, { type: 'platform/changed', platform: 'toutiao' })
    expect(isStale(stale)).toBe(true)
    expect(selectCopyBlockReason(stale)).toContain('重新排版')
  })

  it('失败重排不丢掉上一版的未同步成稿，也不改变源稿', () => {
    const before = typedState()
    const dirty = studioReducer(before, bodyEdit(before, true))
    const failed = runEvents([
      { type: 'typeset/started' },
      { type: 'typeset/succeeded', report: makeReport([], { typesetAt: null, parseError: '无法重新解析' }) },
    ], dirty)
    expect(failed.report).toBe(dirty.report)
    expect(failed.generation).toBe(dirty.generation)
    expect(failed.markdown).toBe(dirty.markdown)
    expect(failed.typesetFailure?.reason).toBe('无法重新解析')
    expect(selectActiveDocument(failed)?.plainText).toBe('右侧改过')
    expect(selectCopyBlockReason(failed)).toBeNull()
    expect(selectSyncBlockReason(failed)).toContain('排版失败')
  })

  it('在排版开始后修改左侧时不安装根据旧稿生成的结果', () => {
    const before = typedState()
    const next = runEvents([
      { type: 'typeset/started' },
      { type: 'source/changed', markdown: '左侧刚提交的源稿' },
      { type: 'typeset/succeeded', report: okReport() },
    ], before)
    expect(next.report).toBe(before.report)
    expect(next.typesetting).toBe(false)
    expect(next.markdown).toBe('左侧刚提交的源稿')
    expect(selectStatus(next)).toBe('stale')
  })
})

describe('工作台状态机 · 单平台失败', () => {
  const mixedReport = makeReport([
    {
      platform: 'wechat',
      outcome: { ok: false, failure: failureOf('wechat', '公众号主题样式表读取失败') },
    },
    { platform: 'toutiao', outcome: { ok: true, document: makeDocument('toutiao') } },
  ])

  function mixedState(): StudioState {
    return runEvents([
      { type: 'source/changed', markdown: '# 一篇中文样稿\n\n正文段落。' },
      { type: 'typeset/started' },
      { type: 'typeset/succeeded', report: mixedReport },
    ])
  }

  it('失败平台不可复制，并说明其它平台仍可用', () => {
    const state = mixedState()
    expect(selectStatus(state)).toBe('typeset')
    expect(selectActiveFailure(state)?.reason).toBe('公众号主题样式表读取失败')
    expect(selectActiveDocument(state)).toBeNull()
    expect(selectCopyBlockReason(state)).toContain('该平台本次排版失败')
    expect(selectSucceededPlatforms(state)).toEqual(['toutiao'])
    expect(selectPlatformResult(state, 'toutiao')?.outcome.ok).toBe(true)
  })

  it('重排只有部分平台成功时，失败的平台仍可查看上一版正文', () => {
    const before = typedState()
    const after = runEvents([{ type: 'typeset/started' }, { type: 'typeset/succeeded', report: mixedReport }], before)
    expect(selectActiveDocument(after)?.plainText).toBe('正文段落')
    expect(selectActiveFailure(after)).not.toBeNull()
    expect(selectCopyBlockReason(after)).toContain('该平台本次排版失败')
  })

  it('切到成功平台后照常可复制，且不改动源稿与版本号', () => {
    const state = mixedState()
    const switched = runEvents([{ type: 'platform/changed', platform: 'toutiao' }], state)
    expect(switched.markdown).toBe(state.markdown)
    expect(switched.revision).toBe(state.revision)
    expect(selectCopyBlockReason(switched)).toBeNull()
    expect(selectActiveDocument(switched)?.platform).toBe('toutiao')
    expect(selectActiveFailure(switched)).toBeNull()
  })
})

describe('工作台状态机 · 复制反馈', () => {
  it('复制成功后给出 2 秒提示内容，并清掉旧的手动复制面板', () => {
    const failed = runEvents(
      [
        {
          type: 'copy/failed',
          kind: 'body',
          platform: 'wechat',
          reason: '剪贴板权限被拒绝',
          manualText: '正文段落',
        },
      ],
      typedState(),
    )
    expect(failed.manualCopy?.text).toBe('正文段落')

    const ok = runEvents(
      [{ type: 'copy/succeeded', kind: 'body', platform: 'wechat', mode: 'rich-text' }],
      failed,
    )
    expect(ok.manualCopy).toBeNull()
    expect(ok.copyNotice?.message).toContain('正文已复制为富文本')
    expect(ok.copyNotice?.nonce).toBe(1)

    const cleared = runEvents([{ type: 'copy/cleared' }], ok)
    expect(cleared.copyNotice).toBeNull()
  })

  it('复制失败保留原因与手动文本，不生成成功提示', () => {
    const state = runEvents(
      [
        {
          type: 'copy/failed',
          kind: 'title',
          platform: 'wechat',
          reason: '浏览器不支持富文本剪贴板',
          manualText: '一篇中文样稿',
        },
      ],
      typedState(),
    )
    expect(state.copyNotice).toBeNull()
    expect(state.manualCopy).toMatchObject({
      kind: 'title',
      platform: 'wechat',
      reason: '浏览器不支持富文本剪贴板',
      text: '一篇中文样稿',
    })
    const dismissed = runEvents([{ type: 'copy/manual-dismissed' }], state)
    expect(dismissed.manualCopy).toBeNull()
  })
})

describe('工作台状态机 · 导入', () => {
  it('导入成功会替换源稿、加一版并要求重新排版', () => {
    const state = runEvents([
      { type: 'source/changed', markdown: '# 旧稿\n\n旧正文' },
      { type: 'import/succeeded', markdown: '# 新稿\n\n新正文', fileName: '新稿.md' },
    ])
    expect(state.markdown).toBe('# 新稿\n\n新正文')
    expect(state.importNotice?.tone).toBe('success')
    expect(state.importNotice?.message).toContain('新稿.md')
  })

  it('导入新稿不复用上篇稿件的手填标题与同路径图片', () => {
    const before = runEvents([
      { type: 'title/changed', value: '旧稿手填标题' },
      { type: 'assets/bound', raw: 'images/cover.png', url: 'blob:old' },
    ], typedState())
    const state = runEvents([
      { type: 'import/succeeded', markdown: '# 新稿\n\n![新封面](images/cover.png)', fileName: '新稿.md' },
    ], before)
    expect(state.titleOverride).toBe('')
    expect(state.boundAssets).toEqual({})
    expect(state.assetNotice).toBeNull()
    expect(selectStatus(state)).toBe('stale')
  })

  it('导入失败不覆盖当前稿', () => {
    const before = typedState()
    const state = runEvents(
      [
        {
          type: 'import/failed',
          message: '无法导入「a.pdf」：工具只接收 Markdown 文件。',
          detail: '当前源稿保持原样。',
        },
      ],
      before,
    )
    expect(state.markdown).toBe(before.markdown)
    expect(state.revision).toBe(before.revision)
    expect(state.importNotice?.tone).toBe('failure')
    expect(state.importNotice?.detail).toContain('当前源稿保持原样')
    expect(selectStatus(state)).toBe('typeset')
  })

  it('导入只有空白的文件按失败处理，源稿不变', () => {
    const before = typedState()
    const state = runEvents(
      [{ type: 'import/succeeded', markdown: '   \n\n', fileName: '空.md' }],
      before,
    )
    expect(state.markdown).toBe(before.markdown)
    expect(state.importNotice?.tone).toBe('failure')
    expect(state.importNotice?.message).toContain('没有可排版的内容')
  })
})

describe('工作台状态机 · 清单与平台切换', () => {
  it('兼容性清单默认展开，可切换折叠', () => {
    const state = createInitialState({ platform: 'wechat' })
    expect(state.warningsExpanded).toBe(true)
    expect(runEvents([{ type: 'warnings/toggled' }], state).warningsExpanded).toBe(false)
  })

  it('切换平台只改当前平台，不清空成稿', () => {
    const state = typedState()
    const switched = runEvents([{ type: 'platform/changed', platform: 'zhihu' }], state)
    expect(switched.platform).toBe('zhihu')
    expect(switched.report).toBe(state.report)
    expect(switched.markdown).toBe(state.markdown)
  })

  it('选同一个平台不会产生新状态', () => {
    const state = typedState()
    const same = runEvents([{ type: 'platform/changed', platform: 'wechat' }], state)
    expect(same).toBe(state)
  })
})
