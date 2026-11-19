import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlatformDefinition, PlatformId } from '@/core/types'
import { PlatformTabs } from './PlatformTabs'

const PLATFORMS: readonly PlatformDefinition[] = (
  [
    ['wechat', '公众号', '图文正文'],
    ['toutiao', '头条', '长文'],
    ['sohu', '搜狐', '文章'],
    ['baijiahao', '百家', '图文文章'],
    ['zhihu', '知乎', '专栏文章（非回答）'],
    ['qq', '腾讯', '图文文章'],
  ] as const
).map(([id, shortName, articleLabel]) => ({
  id,
  name: shortName,
  shortName,
  articleLabel,
  entryUrl: `https://example.com/${id}`,
  capabilities: {
    tables: 'keep',
    codeBlocks: 'keep',
    inlineCode: 'keep',
    images: 'keep',
    links: 'keep',
    blockquotes: 'keep',
    maxHeadingLevel: 6,
  },
  capabilityEvidence: 'pending-user-trial',
  render: () => ({
    ok: false,
    failure: { platform: id, code: 'render', reason: '测试替身不渲染' },
  }),
}))

function Harness({ failedIds }: { readonly failedIds: readonly PlatformId[] }) {
  const [active, setActive] = useState<PlatformId>('wechat')
  return (
    <PlatformTabs
      platforms={PLATFORMS}
      activeId={active}
      failedIds={failedIds}
      panelId="platform-panel"
      onSelect={setActive}
    />
  )
}

let container: HTMLDivElement
let root: Root

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

function renderHarness(failedIds: readonly PlatformId[] = []) {
  act(() => {
    root.render(<Harness failedIds={failedIds} />)
  })
}

function tab(name: string): HTMLButtonElement {
  const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  const found = tabs.find((candidate) => candidate.textContent?.startsWith(name))
  if (!found) {
    throw new Error(`找不到平台标签：${name}`)
  }
  return found
}

function pressKey(element: HTMLElement, key: string) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

describe('平台标签键盘交互', () => {
  it('默认选中公众号，且只有一个 tab 在 Tab 序列里', () => {
    renderHarness()
    const tabs = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'))
    expect(tabs).toHaveLength(6)
    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(tabs[0]?.tabIndex).toBe(0)
    expect(tabs.slice(1).every((element) => element.tabIndex === -1)).toBe(true)
    expect(tabs[0]?.getAttribute('aria-controls')).toBe('platform-panel')
  })

  it('右方向键切到下一个平台，焦点跟随', () => {
    renderHarness()
    const first = tab('公众号')
    first.focus()
    pressKey(first, 'ArrowRight')
    expect(tab('头条').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tab('头条'))
  })

  it('左方向键从第一个平台回绕到最后一个', () => {
    renderHarness()
    const first = tab('公众号')
    first.focus()
    pressKey(first, 'ArrowLeft')
    expect(tab('腾讯').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tab('腾讯'))
  })

  it('Home 与 End 跳到首尾平台', () => {
    renderHarness()
    const last = tab('腾讯')
    last.focus()
    pressKey(last, 'Home')
    expect(tab('公众号').getAttribute('aria-selected')).toBe('true')
    pressKey(tab('公众号'), 'End')
    expect(tab('腾讯').getAttribute('aria-selected')).toBe('true')
  })

  it('失败平台在标签里有文字标记，不只靠颜色', () => {
    renderHarness(['wechat'])
    const wechat = tab('公众号')
    expect(wechat.textContent).toContain('排版失败')
    expect(tab('头条').textContent).not.toContain('排版失败')
  })

  it('上下方向键不改变选中平台', () => {
    renderHarness()
    const first = tab('公众号')
    pressKey(first, 'ArrowDown')
    expect(tab('公众号').getAttribute('aria-selected')).toBe('true')
  })
})
