import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { corePorts } from '@/app/core-ports'

/**
 * 整页集成测试：真实核心层 + 真实平台注册表，只有剪贴板按 jsdom 的实际能力走失败分支。
 * 覆盖「导入原稿 → 排版 → 独立编辑 → 检查与复制」这条主链路在界面上的表现。
 */

let container: HTMLDivElement
let root: Root

function setValue(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )
  descriptor?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function queryText(selector: string): string {
  return container.querySelector(selector)?.textContent ?? ''
}

function buttonByText(label: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
  const found = buttons.find((button) => button.textContent?.includes(label))
  if (!found) {
    throw new Error(`找不到按钮：${label}`)
  }
  return found
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
}

function renderApp() {
  act(() => {
    root.render(<App />)
  })
}

function typeSource(markdown: string) {
  const textarea = container.querySelector<HTMLTextAreaElement>('#source-markdown')
  if (!textarea) {
    throw new Error('找不到源稿文本框')
  }
  act(() => {
    setValue(textarea, markdown)
  })
}

function titleField() {
  const field = container.querySelector<HTMLInputElement>('#platform-article-title')
  if (!field) throw new Error('找不到当前平台标题')
  return field
}

async function importDraft(markdown: string, name = '替换.md') {
  const panel = container.querySelector('.panel--source')
  if (!panel) throw new Error('找不到导入区')
  const file = new File([markdown], name)
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(new TextEncoder().encode(markdown).buffer) })
  const drop = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [file] } })
  await act(async () => {
    panel.dispatchEvent(drop)
    await Promise.resolve()
  })
}

async function typesetWithShortcut() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))
  })
  await flush()
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('工作台整页流程', () => {
  it('空稿时给出引导，一键排版按钮禁用', () => {
    renderApp()
    expect(container.textContent).toContain('左侧还没有源稿')
    expect(buttonByText('一键排版').disabled).toBe(true)
    expect(container.textContent).toContain('未开始 · 等待源稿')
  })

  it('空稿时也提供三个独立的官方发布页入口', () => {
    renderApp()
    const trigger = buttonByText('视频发布入口')
    const nav = container.querySelector('nav[popover="auto"]')
    expect(trigger.disabled).toBe(false)
    expect(nav?.id).toBe(trigger.getAttribute('popovertarget'))
    expect(nav?.getAttribute('aria-labelledby')).toBe(trigger.id)
    expect(nav?.closest('.action-bar__buttons')).not.toBeNull()
    const links = Array.from(nav?.querySelectorAll('a') ?? [])
    expect(links.map((link) => [link.textContent, link.href])).toEqual([
      ['微信视频号发布页（在新标签页打开）', 'https://channels.weixin.qq.com/platform/post/create'],
      ['小红书发布页（在新标签页打开）', 'https://creator.xiaohongshu.com/publish/publish'],
      ['抖音发布页（在新标签页打开）', 'https://creator.douyin.com/creator-micro/content/upload'],
    ])
    expect(links.every((link) => link.target === '_blank' && link.relList.contains('noopener') && link.relList.contains('noreferrer'))).toBe(true)
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(6)
    expect(queryText('[role="tab"][aria-selected="true"]')).toContain('公众号')
  })

  it('重新导入前后都可访问发布入口', async () => {
    renderApp()
    typeSource('# 标题\n\n原正文。')
    await typesetWithShortcut()
    expect(container.querySelectorAll('.publish-links a')).toHaveLength(3)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await importDraft('# 标题\n\n已修改的正文。')
    expect(queryText('.status-chip')).toContain('源稿就绪')
    expect(container.querySelectorAll('.publish-links a')).toHaveLength(3)
  })

  it('专注编辑隐藏发布入口，退出后恢复', async () => {
    renderApp()
    typeSource('# 标题\n\n原正文。')
    await typesetWithShortcut()
    act(() => buttonByText('专注编辑').click())
    expect(container.querySelector('.publish-links')).toBeNull()
    act(() => buttonByText('退出专注').click())
    expect(container.querySelectorAll('.publish-links a')).toHaveLength(3)
  })

  it('左侧保留导入，排版成功后只在右侧显示正文编辑工具', async () => {
    renderApp()
    expect(buttonByText('导入 .md').closest('.panel--source')).not.toBeNull()
    expect(container.querySelector('.editor-tools')).toBeNull()
    expect(queryText('.action-bar__buttons')).not.toContain('编辑正文')
    expect(queryText('.action-bar__buttons')).not.toContain('专注编辑')

    typeSource('# 标题\n\n原正文。')
    expect(queryText('.action-bar__buttons')).not.toContain('编辑正文')
    await typesetWithShortcut()
    const edit = buttonByText('编辑正文')
    expect(edit.closest('.action-bar__buttons')).toBe(buttonByText('复制正文').closest('.action-bar__buttons'))
    expect(container.querySelector('.article[contenteditable]')).toBeNull()

    act(() => edit.click())
    const tools = container.querySelector('[aria-label="成稿格式工具栏"]')
    expect(tools?.closest('.panel--preview')).not.toBeNull()
    expect(tools?.closest('.preview__scroll')).toBeNull()
    expect(document.activeElement).toBe(container.querySelector('.article[contenteditable]'))
    act(() => buttonByText('完成编辑').click())
    expect(container.querySelector('.editor-tools')).toBeNull()
    expect(container.querySelector('.article[contenteditable]')).toBeNull()
  })

  it('Ctrl/Cmd+Enter 排版后，粘贴原稿也只读且可复制成稿', async () => {
    renderApp()
    const markdown = '# 一篇中文样稿\n\n第一段正文。'
    typeSource(markdown)
    expect(queryText('.status-chip')).toContain('源稿就绪')
    await typesetWithShortcut()
    expect(queryText('.status-chip')).toContain('已排版')
    expect(container.querySelector<HTMLTextAreaElement>('#source-markdown')?.readOnly).toBe(true)
    expect(sourceDraft()).toBe(markdown)
    expect(queryText('.article')).toBe('第一段正文。')
    expect(buttonByText('复制正文').disabled).toBe(false)
  })

  it.each(['# 只有标题', '# 只有标题\n\n[](https://example.test)'])('没有可见正文时禁用正文复制 (%s)', async (markdown) => {
    renderApp()
    typeSource(markdown)
    await typesetWithShortcut()
    expect(buttonByText('复制标题').disabled).toBe(false)
    expect(buttonByText('复制正文').disabled).toBe(true)
    expect(queryText('#copy-block-reason')).toContain('没有可复制的正文')
    act(() => buttonByText('编辑正文').click())
    expect(titleField().value).toBe('只有标题')
    expect(container.querySelector('.wechat-templates')).toBeNull()
  })

  it('正文只有分隔线时仍然允许复制富文本', async () => {
    renderApp()
    typeSource('# 只有标题\n\n---')
    await typesetWithShortcut()
    expect(container.querySelector('.article hr')).not.toBeNull()
    expect(buttonByText('复制正文').disabled).toBe(false)
  })

  it('jsdom 没有剪贴板时复制失败，展示手动复制文本域而不是假成功', async () => {
    renderApp()
    typeSource('# 一篇中文样稿\n\n第一段正文。')
    await typesetWithShortcut()

    await act(async () => {
      buttonByText('复制正文').click()
      await Promise.resolve()
    })

    expect(container.querySelector('.manual-copy__title')?.textContent).toContain('手动复制')
    const manual = container.querySelector<HTMLTextAreaElement>('.manual-copy__textarea')
    expect(manual?.value).toContain('第一段正文')
    expect(container.querySelector('.copy-status')?.textContent).toBe('')
    expect(container.textContent).toContain('浏览器没有完成自动复制')
  })

  it.each(['标题', '正文'] as const)('风险稿复制%s需要逐次确认，取消不触发复制或手动兜底', async (label) => {
    const copy = vi.spyOn(corePorts, 'copyRichText').mockImplementation(async ({ plainText }) => {
      await Promise.resolve()
      return { ok: false, reason: '测试拒绝剪贴板权限', manualText: plainText }
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValueOnce(false)
    renderApp()
    typeSource('# 周末活动\n\n欢迎报名。\n\n转发后领取资料。')
    await typesetWithShortcut()
    expect(queryText('.publish-review__status')).toBe('发现 1 项疑似风险')
    expect(queryText('.publish-review__findings')).toContain('正文第 2 个文字块')
    const action = () => act(() => buttonByText(`复制${label}`).click())
    action()
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining(`仍要复制${label}吗？`))
    expect(copy).not.toHaveBeenCalled()
    expect(container.querySelector('.manual-copy')).toBeNull()

    action()
    await flush()
    expect(copy).toHaveBeenCalledTimes(1)
    const copiedText = copy.mock.calls[0]?.[0].plainText
    if (label === '标题') expect(copiedText).toBe('周末活动')
    else expect(copiedText).toContain('转发后领取资料。')
    expect(queryText('.manual-copy__title')).toContain(`手动复制${label}`)
    act(() => buttonByText('关闭手动复制').click())
    action()
    expect(confirm).toHaveBeenCalledTimes(3)
    expect(copy).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.manual-copy')).toBeNull()
  })

  it.each(['标题', '正文'] as const)('百家号有外链兼容性提示时，收起清单也须逐次确认复制%s', async (label) => {
    const copy = vi.spyOn(corePorts, 'copyRichText').mockResolvedValue({ ok: true, mode: 'rich-text' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValueOnce(false)
    renderApp()
    typeSource('# 活动报道\n\n媒体来源：<https://example.test/story>')
    await typesetWithShortcut()
    act(() => container.querySelector<HTMLButtonElement>('[id$="-baijiahao"]')?.click())
    expect(queryText('.compat__summary')).toContain('复制前需确认')
    expect(queryText('.publish-review__status')).toBe('本地未发现疑似风险')
    act(() => buttonByText('收起清单').click())
    const action = () => act(() => buttonByText(`复制${label}`).click())
    action()
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/百家号兼容性提示.*网址仍在正文/su))
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining(`仍要复制${label}吗？`))
    expect(copy).not.toHaveBeenCalled()
    expect(container.querySelector('.manual-copy')).toBeNull()
    action()
    await flush()
    expect(copy).toHaveBeenCalledOnce()
    expect(copy.mock.calls[0]?.[0].plainText).toContain(label === '正文' ? 'https://example.test/story' : '活动报道')
    action()
    expect(confirm).toHaveBeenCalledTimes(3)
    expect(copy).toHaveBeenCalledOnce()
  })

  it('图片预览失败和发布预检风险合并为一次确认，取消时不访问剪贴板', async () => {
    const copy = vi.spyOn(corePorts, 'copyRichText')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderApp()
    typeSource('# 活动通知\n\n转发后领取资料。\n\n![媒体图](https://example.test/photo.png)')
    await typesetWithShortcut()
    act(() => {
      container.querySelector('.article img')?.dispatchEvent(new Event('error'))
    })
    act(() => buttonByText('复制正文').click())
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('预览图片「媒体图」加载失败'))
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('可能不符合微信公众号的发布规则'))
    expect(copy).not.toHaveBeenCalled()
  })

  it('重排失败时明确把仍可复制的风险结果标为上次成稿', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderApp()
    typeSource('# 周末活动\n\n转发后领取资料。')
    await typesetWithShortcut()
    vi.spyOn(corePorts, 'typeset').mockImplementationOnce(() => { throw new Error('渲染中断') })
    await typesetWithShortcut()
    expect(queryText('.publish-review__status')).toBe('重排失败 · 上次成稿：发现 1 项疑似风险')
    expect(queryText('.publish-review__findings')).toContain('转发后领取资料。')
    expect(buttonByText('复制正文').disabled).toBe(false)
    act(() => buttonByText('复制正文').click())
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('可能不符合微信公众号的发布规则'))
  })

  it('复制时预检未完成也先提醒，取消不访问剪贴板', async () => {
    const copy = vi.spyOn(corePorts, 'copyRichText')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderApp()
    typeSource('# 周末活动\n\n欢迎报名。')
    await typesetWithShortcut()
    vi.spyOn(document, 'createElement').mockImplementationOnce(() => { throw new Error('无法检查正文') })
    act(() => buttonByText('复制正文').click())
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('未能完成微信公众号发布预检'))
    expect(copy).not.toHaveBeenCalled()
  })

  it('右侧改稿实时重新检查，不影响其它平台的检查和复制', async () => {
    await editArticle()
    const paragraph = container.querySelector<HTMLElement>('.article p')
    if (!paragraph) throw new Error('找不到正文段落')
    const change = (value: string) => act(() => {
      paragraph.textContent = value
      paragraph.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(queryText('.publish-review__status')).toBe('本地未发现疑似风险')
    change('这个产品保证盈利。')
    expect(queryText('.publish-review__findings')).toContain('这个产品保证盈利。')
    change('已经核对风险。')
    expect(queryText('.publish-review__status')).toBe('本地未发现疑似风险')
    expect(container.querySelector('.publish-review__findings')).toBeNull()
    act(() => container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]?.click())
    expect(queryText('.publish-review__status')).toBe('本地未发现疑似风险')
    expect(buttonByText('复制正文').disabled).toBe(false)
  })

  async function editArticle() {
    renderApp()
    typeSource('# 标题\n\n原正文。')
    await typesetWithShortcut()
    act(() => buttonByText('编辑正文').click())
    const paragraph = container.querySelector<HTMLElement>('.article p')
    if (!paragraph) throw new Error('找不到正文段落')
    act(() => {
      paragraph.textContent = '已修改的正文。'
      paragraph.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  function sourceDraft() {
    return container.querySelector<HTMLTextAreaElement>('#source-markdown')?.value
  }

  it('导入后编辑两个平台，切换与重排均不会改原稿或互相覆盖', async () => {
    renderApp()
    const markdown = '# 标题\n\n原正文。'
    await importDraft(markdown, '样稿.txt')
    expect(container.querySelector<HTMLTextAreaElement>('#source-markdown')?.readOnly).toBe(true)
    await typesetWithShortcut()
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    act(() => buttonByText('编辑正文').click())
    act(() => setValue(titleField(), '公众号新标题'))
    changeBodyParagraph('公众号改过的正文。')
    expect(container.textContent).not.toContain('同步到源稿')
    act(() => tabs[1]?.click())
    expect(queryText('.article-title')).toBe('标题')
    expect(queryText('.article')).toBe('原正文。')
    expect(buttonByText('复制正文').disabled).toBe(false)
    act(() => buttonByText('编辑正文').click())
    act(() => setValue(titleField(), '头条号新标题'))
    changeBodyParagraph('头条号改过的正文。')
    await typesetWithShortcut()
    expect(queryText('.article-title')).toBe('头条号新标题')
    expect(queryText('.article')).toBe('头条号改过的正文。')
    act(() => tabs[0]?.click())
    expect(queryText('.article-title')).toBe('公众号新标题')
    expect(queryText('.article')).toBe('公众号改过的正文。')
    expect(sourceDraft()).toBe(markdown)
    act(() => buttonByText('撤销右侧改动').click())
    expect(queryText('.article-title')).toBe('标题')
    expect(queryText('.article')).toBe('原正文。')
    act(() => tabs[1]?.click())
    expect(queryText('.article-title')).toBe('头条号新标题')
    expect(queryText('.article')).toBe('头条号改过的正文。')
  })

  it('编辑中的标题可参与两项检查、定位及复制', async () => {
    await editArticle()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const copy = vi.spyOn(corePorts, 'copyRichText').mockResolvedValue({ ok: true, mode: 'rich-text' })
    act(() => setValue(titleField(), '  自已保证盈利  '))
    expect(queryText('.publish-review__findings')).toContain('保证盈利')
    act(() => buttonByText('一键检测').click())
    expect(queryText('.publish-review__status')).toContain('重新检测')
    act(() => container.querySelector<HTMLButtonElement>('.publish-review__findings button')?.click())
    const title = titleField()
    expect(title.value.slice(title.selectionStart ?? 0, title.selectionEnd ?? 0)).toBe('保证盈利')
    act(() => buttonByText('一键检查内容').click())
    expect(queryText('.content-check__list')).toContain('自已')
    act(() => container.querySelector<HTMLButtonElement>('.content-check__list button[aria-label^="定位标题"]')?.click())
    expect(title.value.slice(title.selectionStart ?? 0, title.selectionEnd ?? 0)).toBe('自已')
    act(() => buttonByText('复制标题').click())
    await flush()
    expect(confirm).toHaveBeenCalledOnce()
    expect(copy.mock.calls[0]?.[0].plainText).toBe('自已保证盈利')
    act(() => setValue(title, ''))
    expect(buttonByText('复制标题').disabled).toBe(true)
    expect(container.querySelector('.content-check__list')).toBeNull()
  })

  it('标题校对结果在普通预览和编辑框之间可以继续定位', async () => {
    renderApp()
    typeSource('# 自已来检查\n\n正常正文。')
    await typesetWithShortcut()
    const locateTitle = () => {
      const button = container.querySelector<HTMLButtonElement>('.content-check__list button[aria-label^="定位标题"]')
      if (!button) throw new Error('找不到校对标题结果')
      act(() => button.click())
    }
    act(() => buttonByText('一键检查内容').click())
    act(() => buttonByText('编辑正文').click())
    locateTitle()
    expect(titleField().value.slice(titleField().selectionStart ?? 0, titleField().selectionEnd ?? 0)).toBe('自已')
    act(() => buttonByText('一键检查内容').click())
    act(() => buttonByText('完成编辑').click())
    locateTitle()
    expect(container.querySelector('.content-check__notice')).toBeNull()
  })

  it('标题选区在进出专注编辑时保持不变', async () => {
    renderApp()
    typeSource('# 标题选区\n\n正常正文。')
    await typesetWithShortcut()
    act(() => buttonByText('编辑正文').click())
    const title = titleField()
    act(() => {
      title.focus()
      title.setSelectionRange(0, 2)
      buttonByText('专注编辑').click()
    })
    expect(document.activeElement).toBe(title)
    expect(title.selectionEnd).toBe(2)
    act(() => { title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(buttonByText('专注编辑')).toBeTruthy()
    expect(document.activeElement).toBe(title)
    expect(title.selectionEnd).toBe(2)
  })

  it('编辑后的正文进入复制失败的手动兜底', async () => {
    await editArticle()
    act(() => buttonByText('复制正文').click())
    await flush()
    expect(container.querySelector<HTMLTextAreaElement>('.manual-copy__textarea')?.value).toBe('已修改的正文。')
  })

  it('相同基线重排不确认，保留平台文字和样式', async () => {
    await editArticle()
    const paragraph = container.querySelector<HTMLElement>('.article p')
    if (!paragraph) throw new Error('找不到正文段落')
    act(() => {
      paragraph.innerHTML = '<span style="background-color: yellow">已修改的正文。</span>'
      paragraph.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const confirm = vi.spyOn(window, 'confirm')
    await typesetWithShortcut()
    expect(confirm).not.toHaveBeenCalled()
    expect(queryText('.article')).toBe('已修改的正文。')
    expect(container.querySelector('.article span[style]')).not.toBeNull()
    expect(sourceDraft()).toBe('# 标题\n\n原正文。')
  })

  it('失败或取消导入不改旧稿；确认替换才清空右侧，再按新原稿排版', async () => {
    await editArticle()
    act(() => setValue(titleField(), '上一稿平台标题'))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await importDraft('   ', '空稿.md')
    expect(queryText('.import-notice')).toContain('没有可排版的文字')
    expect(confirm).not.toHaveBeenCalled()
    await importDraft('# 新标题\n\n新版本。')
    expect(titleField().value).toBe('上一稿平台标题')
    expect(queryText('.article')).toBe('已修改的正文。')
    expect(sourceDraft()).toBe('# 标题\n\n原正文。')
    await importDraft('# 新标题\n\n新版本。')
    expect(queryText('.status-chip')).toContain('源稿就绪')
    expect(container.querySelector('.article')).toBeNull()
    expect(buttonByText('复制正文').disabled).toBe(true)
    await typesetWithShortcut()
    expect(queryText('.article-title')).toBe('新标题')
    expect(queryText('.article')).toBe('新版本。')
  })

  function templateChoice(name: string) {
    const button = container.querySelector<HTMLButtonElement>(`.wechat-templates__name[aria-label="${name}"]`)
    if (!button) throw new Error(`找不到模板：${name}`)
    return button
  }

  function changeBodyParagraph(text: string) {
    const paragraph = container.querySelector<HTMLElement>('.article p')
    if (!paragraph) throw new Error('找不到正文段落')
    act(() => {
      paragraph.textContent = text
      paragraph.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it.each([0, 1])('换版只更新当前平台（标签 %s），标题改动不覆盖其他平台', async (index) => {
    renderApp()
    const markdown = '---\ntitle: 城市手记\n---\n\n原文。\n\n## 路线\n\n沿河向北。'
    typeSource(markdown)
    await typesetWithShortcut()
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    act(() => tabs[index]?.click())
    const timestamp = queryText('.status-chip')
    const classic = container.querySelector('.article h2')?.getAttribute('style')
    const render = vi.spyOn(corePorts, 'typeset')
    try {
      act(() => templateChoice('清爽留白').click())
      expect(render).toHaveBeenCalledOnce()
      expect(render.mock.calls[0]?.[1]?.id).toBe(index === 0 ? 'wechat' : 'toutiao')
      expect(queryText('.status-chip')).toBe(timestamp)
      expect(container.querySelector('.article h2')?.getAttribute('style')).not.toBe(classic)
      expect(container.querySelector<HTMLTextAreaElement>('#source-markdown')?.value).toBe(markdown)
      act(() => buttonByText('编辑正文').click())
      expect(templateChoice('杂志长文').disabled).toBe(true)
      act(() => setValue(titleField(), '独立标题'))
      act(() => buttonByText('完成编辑').click())
      act(() => templateChoice('杂志长文').click())
      expect(templateChoice('杂志长文').getAttribute('aria-pressed')).toBe('true')
      expect(queryText('.article-title')).toBe('独立标题')
      act(() => tabs[1 - index]?.click())
      expect(templateChoice('观点蓝调').getAttribute('aria-pressed')).toBe('true')
      expect(queryText('.article-title')).toBe('城市手记')
      expect(buttonByText('复制正文').disabled).toBe(false)
      act(() => tabs[index]?.click())
      expect(templateChoice('杂志长文').getAttribute('aria-pressed')).toBe('true')
      await typesetWithShortcut()
      expect(templateChoice('杂志长文').getAttribute('aria-pressed')).toBe('true')
      act(() => templateChoice('观点蓝调').click())
      expect(container.querySelector('.article h2')?.getAttribute('style')).toBe(classic)
      expect(sourceDraft()).toBe(markdown)
    } finally {
      render.mockRestore()
    }
  })

  it('有平台专属样式时阻止换版，不丢弃正文', async () => {
    await editArticle()
    const article = container.querySelector<HTMLElement>('.article')
    const paragraph = article?.querySelector('p')
    if (!article || !paragraph) throw new Error('找不到正文')
    act(() => {
      paragraph.innerHTML = '<span style="background-color: yellow">已修改的正文。</span>'
      article.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const edited = article.innerHTML
    act(() => buttonByText('完成编辑').click())
    expect(templateChoice('清爽留白').disabled).toBe(true)
    expect(queryText('.wechat-templates__notice')).toContain('手动正文改动')
    expect(article.innerHTML).toBe(edited)
  })

  it('小标题的手动换行不会写回源稿；换版限制不会丢失手改内容', async () => {
    renderApp()
    const markdown = '# 标题\n\n## 甲 乙\n\n正文。'
    typeSource(markdown)
    await typesetWithShortcut()
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    act(() => tabs[1]?.click())
    act(() => buttonByText('编辑正文').click())
    const heading = container.querySelector('.article h2')
    if (!heading) throw new Error('找不到正文小标题')
    act(() => {
      heading.innerHTML = '甲<br>乙'
      heading.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(sourceDraft()).toBe(markdown)
    act(() => buttonByText('完成编辑').click())
    expect(templateChoice('清爽留白').disabled).toBe(true)
    expect(container.querySelector('.article h2')?.innerHTML).toBe('甲<br>乙')
    act(() => buttonByText('撤销右侧改动').click())
    expect(container.querySelector('.article h2')?.textContent).toBe('甲 乙')
  })

  it('换版只重新核对公众号图片告警，不会抹掉其他平台的告警', async () => {
    renderApp()
    typeSource('# 标题\n\n![外链图](https://example.test/photo.png)')
    await typesetWithShortcut()
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    const failImage = () => act(() => {
      container.querySelector('.article img')?.dispatchEvent(new Event('error'))
    })
    failImage()
    expect(queryText('.compat__message')).toContain('加载失败')
    act(() => tabs[1]?.click())
    failImage()
    expect(queryText('.compat__message')).toContain('加载失败')
    act(() => tabs[0]?.click())
    act(() => templateChoice('暖纸手记').click())
    expect(queryText('.compat__message')).not.toContain('加载失败')
    act(() => tabs[1]?.click())
    expect(queryText('.compat__message')).toContain('加载失败')
  })

  it('重新生成的正文与当前编辑文字不一致时拒绝安装模板', async () => {
    renderApp()
    typeSource('# 标题\n\n原正文。')
    await typesetWithShortcut()
    const realTypeset = corePorts.typeset.bind(corePorts)
    const render = vi.spyOn(corePorts, 'typeset').mockImplementationOnce((request, platform) =>
      realTypeset({ ...request, markdown: '# 标题\n\n与成稿不同的文字。' }, platform))
    try {
      act(() => templateChoice('清爽留白').click())
      expect(queryText('.wechat-templates__notice')).toContain('会改变正文文字')
      expect(queryText('.article')).toBe('原正文。')
      expect(templateChoice('观点蓝调').getAttribute('aria-pressed')).toBe('true')
    } finally {
      render.mockRestore()
    }
  })

  it('切版渲染失败保留旧成稿、复制能力和选中模板，并可以重试', async () => {
    renderApp()
    typeSource('# 标题\n\n## 正文标题\n\n原文。')
    await typesetWithShortcut()
    const before = container.querySelector('.article')?.innerHTML
    const render = vi.spyOn(corePorts, 'typeset').mockImplementationOnce(() => { throw new Error('渲染中断') })
    try {
      act(() => templateChoice('清爽留白').click())
      expect(queryText('.wechat-templates__notice')).toContain('当前成稿已保留')
      expect(container.querySelector('.article')?.innerHTML).toBe(before)
      expect(templateChoice('观点蓝调').getAttribute('aria-pressed')).toBe('true')
      expect(buttonByText('复制正文').disabled).toBe(false)
      act(() => templateChoice('清爽留白').click())
      expect(queryText('.wechat-templates__notice')).toBe('')
      expect(templateChoice('清爽留白').getAttribute('aria-pressed')).toBe('true')
    } finally {
      render.mockRestore()
    }
  })

  it('专注编辑直接开启同一个正文编辑器，退出时继续编辑', async () => {
    renderApp()
    typeSource('# 标题\n\n原正文。')
    await typesetWithShortcut()
    const source = container.querySelector('#source-markdown')
    const article = container.querySelector<HTMLElement>('.article')
    act(() => buttonByText('专注编辑').click())
    expect(document.activeElement).toBe(article)
    expect(article?.getAttribute('contenteditable')).toBe('true')
    const paragraph = article?.querySelector('p')
    if (!paragraph) throw new Error('找不到正文段落')
    act(() => {
      paragraph.textContent = '专注时修改。'
      paragraph.dispatchEvent(new Event('input', { bubbles: true }))
      buttonByText('退出专注').click()
    })
    expect(container.querySelector('.article[contenteditable]')).toBe(article)
    expect(document.activeElement).toBe(article)
    expect(container.querySelector('#source-markdown')).toBe(source)
    expect(sourceDraft()).toBe('# 标题\n\n原正文。')
    expect(queryText('.article')).toBe('专注时修改。')
    expect(container.textContent).not.toContain('同步到源稿')
  })

  it('完全撤销后重新排版不需要确认', async () => {
    await editArticle()
    const paragraph = container.querySelector<HTMLElement>('.article p')
    if (!paragraph) throw new Error('找不到正文段落')
    act(() => {
      paragraph.textContent = '原正文。'
      paragraph.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const confirm = vi.spyOn(window, 'confirm')
    try {
      await typesetWithShortcut()
      expect(confirm).not.toHaveBeenCalled()
    } finally {
      confirm.mockRestore()
    }
  })

  it('切换平台不改动源稿内容，失败平台标签带文字标记', async () => {
    renderApp()
    typeSource('# 一篇中文样稿\n\n第一段正文。')
    await typesetWithShortcut()

    const sourceBefore = container.querySelector<HTMLTextAreaElement>('#source-markdown')?.value
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    act(() => {
      tabs[4]?.click()
    })
    expect(container.querySelector<HTMLTextAreaElement>('#source-markdown')?.value).toBe(
      sourceBefore,
    )
    expect(tabs[4]?.getAttribute('aria-selected')).toBe('true')
    expect(container.textContent).toContain('知乎')
  })

  it('预览图片加载失败时列出位置、原地址和补插方法，重新排版后不继承旧失败', async () => {
    renderApp()
    const url = 'https://example.test/missing.png'
    typeSource(`# 图文样稿\n\n第一段正文。\n\n![图示](${url})`)
    await typesetWithShortcut()
    const image = container.querySelector<HTMLImageElement>('.article img')
    expect(image).not.toBeNull()
    act(() => {
      image?.dispatchEvent(new Event('error'))
      image?.dispatchEvent(new Event('error'))
    })
    const messages = container.querySelectorAll('.compat__message')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.textContent).toContain('第 1 张预览图片')
    expect(queryText('.compat__excerpt')).toContain(url)
    expect(queryText('.compat__action')).toContain('原位置手动补插')

    const toggle = buttonByText('收起清单')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    act(() => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('#compat-body')?.hasAttribute('hidden')).toBe(true)
    act(() => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await importDraft('# 新稿\n\n不含图片的正文。')
    await typesetWithShortcut()
    expect(container.querySelector('.preview-compatibility')).toBeNull()
  })

  it('图片位置改变时兼容性提示随之更新；删除坏图后复制不再要求确认', async () => {
    const copy = vi.spyOn(corePorts, 'copyRichText').mockResolvedValue({ ok: true, mode: 'rich-text' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderApp()
    typeSource('# 图文样稿\n\n第一段正文。\n\n![好图](https://example.test/good.png)\n\n![坏图](https://example.test/missing.png)')
    await typesetWithShortcut()
    const images = container.querySelectorAll<HTMLImageElement>('.article img')
    act(() => { images[1]?.dispatchEvent(new Event('error')) })
    expect(queryText('.compat__message')).toContain('第 2 张预览图片「坏图」')
    act(() => buttonByText('编辑正文').click())
    const editor = container.querySelector('.article[contenteditable]')
    if (!editor) throw new Error('找不到成稿编辑器')
    const removeFirstImage = () => act(() => {
      const image = editor.querySelector('img')
      if (!image) throw new Error('找不到要删除的图片')
      ;(image.closest('figure, p') ?? image).remove()
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    })
    removeFirstImage()
    expect(queryText('.compat__message')).toContain('第 1 张预览图片「坏图」')
    removeFirstImage()
    expect(container.querySelector('.preview-compatibility')).toBeNull()
    act(() => buttonByText('复制正文').click())
    await flush()
    expect(confirm).not.toHaveBeenCalled()
    expect(copy).toHaveBeenCalledOnce()
    expect(copy.mock.calls[0]?.[0].html).not.toContain('<img')
  })

  it('无警告的成稿不占用提示空间，可直接复制正文', async () => {
    const copy = vi.spyOn(corePorts, 'copyRichText').mockResolvedValue({ ok: true, mode: 'rich-text' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderApp()
    typeSource('# 一篇中文样稿\n\n第一段正文。')
    await typesetWithShortcut()

    expect(container.querySelector('.preview-compatibility')).toBeNull()
    expect(container.querySelector('.preview-banner')).toBeNull()
    expect(queryText('.status-chip')).toContain('已排版')
    expect(queryText('.article')).toBe('第一段正文。')
    expect(buttonByText('复制正文').disabled).toBe(false)
    act(() => buttonByText('复制正文').click())
    await flush()
    expect(confirm).not.toHaveBeenCalled()
    expect(copy).toHaveBeenCalledOnce()
  })
})
