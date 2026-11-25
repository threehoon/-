import { describe, expect, it } from 'vitest'
import type { PlatformId, WechatTemplateId } from '@/core/types'
import { captureDraft, restoreDraft } from './draft-store'
import { corePorts } from './core-ports'
import { configureLiveLink, followLiveLink, projectLiveBody, renderPortableBody } from './live-link'
import {
  createInitialState,
  isSyncedBodyPatch,
  selectActiveDocument,
  selectPlatformResult,
  selectTemplateEditConflict,
  studioReducer,
  type StudioEvent,
  type StudioState,
} from './studio-state'

const markdown = '# 原标题\n\n第一段。\n\n参考[原资料][ref]。\n\n| 栏一 | 栏二 |\n| --- | --- |\n| 甲 | 乙 |\n\n[ref]: https://www.gov.cn/'
const localImage = 'data:image/png;base64,iVBORw0KGgo='

function initial(platform: PlatformId = 'baijiahao'): StudioState {
  const state = createInitialState({ platform, markdown })
  const report = corePorts.typeset({ markdown, titleOverride: null, assets: corePorts.createAssets({}) })
  return studioReducer(studioReducer(state, { type: 'typeset/started' }), { type: 'typeset/succeeded', report })
}

function read(state: StudioState, platform: PlatformId) {
  return selectActiveDocument({ ...state, platform })
}

function apply(state: StudioState, event: StudioEvent): StudioState {
  const next = studioReducer(state, event)
  return next === state ? state : followLiveLink(next, event, corePorts)
}

function edit(state: StudioState, rewrite: (html: string) => string): StudioState {
  const current = selectActiveDocument(state)
  if (!state.report || !current) throw new Error('Missing draft')
  const patch = state.bodyPatches[state.platform]
  return apply(state, { type: 'body/edited', platform: state.platform, report: state.report,
    generation: state.generation, revision: state.revision, patch: {
      ...patch, html: rewrite(current.html), plainText: current.plainText, baseline: patch?.baseline ?? current,
    } })
}

function rename(state: StudioState, value: string) {
  return apply(state, { type: 'title/edited', value, generation: state.generation, platform: state.platform })
}

describe('成稿实时联动', () => {
  it('确认前不写入其他草稿，开启后只更新目标并固定来源', () => {
    const independent = edit(initial(), (html) => html.replace('第一段。', '手改第一段。'))
    expect(read(independent, 'qq')?.html).not.toContain('手改第一段。')
    const linked = configureLiveLink(independent, ['baijiahao', 'zhihu', 'toutiao', 'zhihu'], corePorts)
    expect(linked.liveLink?.targets).toEqual(['toutiao', 'zhihu'])
    expect(read(linked, 'zhihu')?.html).toContain('手改第一段。')
    const titled = rename(linked, '同步标题')
    expect(read(titled, 'toutiao')?.title).toBe('同步标题')
    expect(read(titled, 'baijiahao')?.title).toBe('同步标题')
    expect(read(titled, 'qq')).toBe(read(independent, 'qq'))
    expect(titled.markdown).toBe(markdown)
  })

  it('保留未改的链接定义及表格，根据各平台分别保留或降级', () => {
    const linked = configureLiveLink(initial(), ['zhihu', 'toutiao'], corePorts)
    const edited = edit(linked, (html) => html.replace('第一段。', '改字。'))
    expect(read(edited, 'zhihu')?.html).toMatch(/href="https:\/\/www\.gov\.cn\/"/)
    expect(read(edited, 'zhihu')?.html).toContain('<table')
    expect(read(edited, 'toutiao')?.html).not.toContain('<table')
    expect(read(edited, 'toutiao')?.warnings.some(({ kind }) => kind === 'table')).toBe(true)
    expect(edited.bodyPatches.zhihu?.html).not.toBe(edited.bodyPatches.toutiao?.html)
  })

  it('保留目标自己的模板，字体字号不直接照搬来源 DOM', () => {
    const state = { ...initial('zhihu'), platformTemplates: { qq: 'warm' as const } }
    const edited = edit(state, (html) => html.replace('第一段。', '<span style="font-size:70px"><u>插入文字</u></span>'))
    const linked = configureLiveLink(edited, ['qq', 'wechat'], corePorts)
    expect(read(linked, 'qq')?.html).toContain('<u')
    expect(read(linked, 'qq')?.html).not.toContain('70px')
    expect(read(linked, 'qq')?.html).not.toBe(read(linked, 'wechat')?.html)
    expect(linked.platformTemplates).toBe(state.platformTemplates)
  })

  it('同步编辑中插入的常规本地图片和正文一级标题，不当作文章标题提走', () => {
    const active = configureLiveLink(initial('zhihu'), ['qq'], corePorts)
    const edited = edit(active, () => `<h1>正文一级标题</h1><p><img src="${localImage}" alt="配图"></p>`)
    expect(read(edited, 'qq')?.html).toContain('<h1')
    expect(read(edited, 'qq')?.html).toContain(`src="${localImage}"`)
    expect(read(edited, 'qq')?.title).toBe('原标题')
  })

  it('安全转换失败时保留目标上一个版本，修正源后自动恢复', () => {
    const linked = configureLiveLink(initial(), ['zhihu'], corePorts)
    const edited = edit(linked, (html) => html.replace('原资料', '改过的链接文字'))
    expect(read(edited, 'baijiahao')?.html).toContain('改过的链接文字')
    expect(edited.liveLink?.error).toContain('无法无损转换')
    expect(edited.bodyPatches.zhihu).toBe(linked.bodyPatches.zhihu)
    const fixed = edit(edited, (html) => html.replace('改过的链接文字', '原资料').replace('第一段。', '可转换的改动。'))
    expect(fixed.liveLink?.error).toBeNull()
    expect(read(fixed, 'zhihu')?.html).toContain('可转换的改动。')
  })

  it('遇到不安全的图片地址时不把成稿覆盖成空白或不安全的 HTML', () => {
    const linked = configureLiveLink(initial('zhihu'), ['qq'], corePorts)
    const unsafe = edit(linked, () => '<p><img src="data:image/svg+xml;base64,AAAA"></p>')
    expect(unsafe.liveLink?.error).not.toBeNull()
    expect(unsafe.bodyPatches.qq).toBe(linked.bodyPatches.qq)
  })

  it('保留原先被拒绝的 Markdown 内嵌地址的补插提示，不放宽原稿图片策略', () => {
    const sourceMarkdown = `# 原标题\n\n![原始地址](${localImage})`
    const draft = createInitialState({ platform: 'zhihu', markdown: sourceMarkdown })
    const report = corePorts.typeset({ markdown: sourceMarkdown, titleOverride: null, assets: corePorts.createAssets({}) })
    const state = studioReducer(studioReducer(draft, { type: 'typeset/started' }), { type: 'typeset/succeeded', report })
    const linked = configureLiveLink(state, ['qq'], corePorts)
    expect(read(linked, 'qq')?.html).toContain('图片补插位')
    expect(read(linked, 'qq')?.html).not.toContain('<img')
  })

  it('从目标继续转发可恢复 Markdown 表格，且持久化只保存已同步成稿', () => {
    const linked = configureLiveLink(initial('zhihu'), ['baijiahao'], corePorts)
    const restored = restoreDraft(captureDraft(linked, new Map()), createInitialState({ platform: 'wechat' }), new Map())
    expect(restored.liveLink).toBeNull()
    expect(read(restored, 'baijiahao')?.html).not.toContain('<table')
    const target = apply(restored, { type: 'platform/changed', platform: 'baijiahao' })
    const next = configureLiveLink(target, ['sohu'], corePorts)
    expect(read(next, 'sohu')?.html).toContain('<table')
  })

  it('目标独立编辑会脱离；取消选择或停止保留最后的内容', () => {
    let state = configureLiveLink(initial('wechat'), ['qq', 'zhihu', 'sohu'], corePorts)
    const lastSohu = state.bodyPatches.sohu
    state = apply(state, { type: 'platform/changed', platform: 'qq' })
    state = rename(state, '腾讯独立标题')
    expect(state.liveLink?.source).toBe('wechat')
    expect(state.liveLink?.targets).not.toContain('qq')
    state = configureLiveLink(state, ['zhihu'], corePorts)
    nowTitleOnWechat('仅同步知乎')
    expect(read(state, 'qq')?.title).toBe('腾讯独立标题')
    expect(state.bodyPatches.sohu).toBe(lastSohu)
    expect(read(state, 'zhihu')?.title).toBe('仅同步知乎')
    state = configureLiveLink(state, [], corePorts)
    nowTitleOnWechat('停止后的标题')
    expect(read(state, 'zhihu')?.title).toBe('仅同步知乎')
    function nowTitleOnWechat(value: string) {
      state = rename(apply(state, { type: 'platform/changed', platform: 'wechat' }), value)
    }
  })

  it('重排关闭联动但不清空已同步的成稿；清空正文可同步', () => {
    const linked = configureLiveLink(initial('wechat'), ['qq'], corePorts)
    const cleared = edit(linked, () => '<br>')
    expect(read(cleared, 'qq')?.html).toBe('')
    const retypeset = apply(cleared, { type: 'typeset/started' })
    expect(retypeset.liveLink).toBeNull()
    expect(retypeset.bodyPatches.qq).toBe(cleared.bodyPatches.qq)
  })

  it('联动目标换版后保留同步正文、标题与配图，且后续源端编辑继续沿用目标新模板', () => {
    function switchTemplate(state: StudioState, template: WechatTemplateId): StudioState {
      const { platform } = state
      const current = selectActiveDocument(state)
      const previous = selectPlatformResult(state, platform)?.outcome
      if (!state.report || !current || !previous?.ok) throw new Error('Missing draft')
      expect(selectTemplateEditConflict(state)).toBeNull()
      const patch = state.bodyPatches[platform]
      const portableBody = isSyncedBodyPatch(patch) ? patch.linkedMarkdown : projectLiveBody(state, platform)
      const templates = { ...state.platformTemplates, [platform]: template }
      const rendered = renderPortableBody({
        state,
        platforms: [platform],
        markdown: portableBody,
        currentHtml: current.html,
        platformTemplates: templates,
        ports: corePorts,
      })
      const styled = rendered.results[0]?.outcome
      if (!styled?.ok) throw new Error('Template render failed')
      return apply(state, {
        type: 'template/applied',
        platform,
        template,
        baselineReport: state.report,
        revision: state.revision,
        document: previous.document,
        bodyPatch: {
          html: styled.document.html,
          plainText: styled.document.plainText,
          baseline: { html: styled.document.html, warnings: styled.document.warnings },
          linkedMarkdown: portableBody,
        },
      })
    }

    let state = configureLiveLink(initial('zhihu'), ['sohu', 'baijiahao'], corePorts)
    state = rename(state, '联动新标题')
    state = edit(state, (html) => html.replace('第一段。', `同步后的第一段。<img src="${localImage}" alt="现场图">`))

    // 切到搜狐号切换为暖纸手记
    state = apply(state, { type: 'platform/changed', platform: 'sohu' })
    state = switchTemplate(state, 'warm')
    expect(state.platformTemplates.sohu).toBe('warm')
    expect(state.liveLink?.targets).toEqual(['sohu', 'baijiahao'])
    expect(read(state, 'sohu')?.title).toBe('联动新标题')
    expect(read(state, 'sohu')?.html).toContain('#fdfaf4')
    expect(read(state, 'sohu')?.html).toContain('同步后的第一段。')
    expect(read(state, 'sohu')?.html).toContain(`src="${localImage}"`)

    // 回到知乎继续编辑，搜狐号保持暖纸手记，百家号保持默认版
    state = apply(state, { type: 'platform/changed', platform: 'zhihu' })
    state = edit(state, (html) => html.replace('同步后的第一段。', '再次联动正文。'))
    expect(read(state, 'sohu')?.html).toContain('再次联动正文。')
    expect(read(state, 'sohu')?.html).toContain('#fdfaf4')
    expect(read(state, 'baijiahao')?.html).toContain('再次联动正文。')
    expect(read(state, 'baijiahao')?.html).not.toContain('#fdfaf4')

    // 来源平台（知乎）在可无损转换时也可以切换模板，不影响目标模板且继续联动
    state = switchTemplate(state, 'ink')
    expect(state.platformTemplates.zhihu).toBe('ink')
    expect(state.platformTemplates.sohu).toBe('warm')
    expect(read(state, 'zhihu')?.html).toContain('#1d2624')
    state = edit(state, (html) => html.replace('再次联动正文。', '来源换版后再改。'))
    expect(read(state, 'sohu')?.html).toContain('来源换版后再改。')
    expect(read(state, 'sohu')?.html).toContain('#fdfaf4')

    // 停止联动并经草稿持久化恢复后，目标平台仍可继续切换模板
    const stopped = configureLiveLink(state, [], corePorts)
    const restored = restoreDraft(captureDraft(stopped, new Map()), createInitialState({ platform: 'wechat' }), new Map())
    const onSohu = apply(restored, { type: 'platform/changed', platform: 'sohu' })
    expect(selectTemplateEditConflict(onSohu)).toBeNull()
    const switchedAgain = switchTemplate(onSohu, 'forest')
    expect(switchedAgain.platformTemplates.sohu).toBe('forest')
    expect(read(switchedAgain, 'sohu')?.html).toContain('#1d2b24')
    expect(read(switchedAgain, 'sohu')?.html).toContain('来源换版后再改。')
  })

  it('不可无损转换的联动来源禁止换版，保护当前成稿', () => {
    const linked = configureLiveLink(initial('baijiahao'), ['zhihu'], corePorts)
    const lossy = edit(linked, (html) => html.replace('原资料', '改过的链接文字'))
    expect(lossy.liveLink?.error).toContain('无法无损转换')
    expect(selectTemplateEditConflict(lossy)).toContain('无法无损转换')
    expect(() => projectLiveBody(lossy, 'baijiahao')).toThrow(/无法无损转换/)
  })
})
