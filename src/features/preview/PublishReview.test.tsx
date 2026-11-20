import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformDefinition } from '@/core/types'
import type { PublishReviewResult } from '@/core/publish-review/review'
import { reviewPublishDocument } from '@/core/publish-review/review'
import type { StudioStatus } from '@/app/studio-state'
import { PublishReview } from './PublishReview'

const PLATFORM: PlatformDefinition = {
  id: 'wechat',
  name: '微信公众号',
  shortName: '公众号',
  articleLabel: '图文正文',
  entryUrl: 'https://mp.weixin.qq.com/',
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
  render: () => ({ ok: false, failure: { platform: 'wechat', code: 'render', reason: '测试替身不渲染' } }),
}

const HTML = '<p>欢迎参加。</p><p>联系电话：138 0000 0000</p>'

let scroll: HTMLDivElement
let article: HTMLElement
let host: HTMLDivElement
let root: Root

function resultOf(html: string): PublishReviewResult {
  return reviewPublishDocument({ platform: 'wechat', title: null, html, plainText: '', warnings: [], stats: { blocks: 0, characters: 0 } })
}

function render(result: PublishReviewResult | null, status: StudioStatus = 'typeset') {
  act(() => {
    root.render(<PublishReview platform={PLATFORM} status={status} result={result} failed={false} />)
  })
}

function terms(selector: string): string {
  return host.querySelector(selector)?.textContent ?? ''
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes(label))
  if (!found) throw new Error(`找不到按钮：${label}`)
  return found
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  scroll = document.createElement('div')
  scroll.className = 'preview__scroll'
  host = document.createElement('div')
  const canvas = document.createElement('div')
  canvas.className = 'preview-canvas'
  article = document.createElement('article')
  article.id = 'platform-article'
  article.innerHTML = HTML
  canvas.append(article)
  scroll.append(host, canvas)
  document.body.append(scroll)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  scroll.remove()
})

describe('发布预检面板', () => {
  it('每条提示都带一个定位按钮', () => {
    render(resultOf(HTML))
    expect(terms('.publish-review__status')).toBe('发现 1 项疑似风险')
    expect(button('定位').getAttribute('aria-label')).toContain('正文第 2 个文字块')
  })

  it('一键检测按当前正文重算，删掉的内容不会继续报', () => {
    render(resultOf(HTML))
    // 模拟在右侧正文里删掉带电话的段落：面板上的旧结果还在，正文已经变了。
    act(() => {
      article.querySelectorAll('p')[1]?.remove()
    })
    expect(terms('.publish-review__status')).toBe('发现 1 项疑似风险')
    act(() => button('一键检测').click())
    expect(terms('.publish-review__status')).toBe('重新检测 · 本地未发现疑似风险')
    expect(host.querySelector('.publish-review__findings')).toBeNull()
    expect(terms('.publish-review__check')).toContain('已按当前正文检测')
  })

  it('正文改过以后，上次检测的结论不再挂在面板上', () => {
    render(resultOf(HTML))
    act(() => button('一键检测').click())
    expect(terms('.publish-review__status')).toContain('重新检测')
    render(resultOf('<p>欢迎参加。</p>'))
    expect(terms('.publish-review__status')).toBe('本地未发现疑似风险')
    expect(terms('.publish-review__check')).not.toContain('已按当前正文检测')
  })

  it('源稿改过时不假装检测过，并说明为什么不能检测', () => {
    render(null, 'stale')
    expect(terms('.publish-review__status')).toBe('结果已过期，请重新排版')
    expect(button('一键检测').disabled).toBe(true)
    expect(terms('#publish-review-block')).toContain('重新排版后再检测')
    // 禁用原因留在折叠区外面，键盘用户即使跳过了不可聚焦的按钮也能读到。
    expect(button('一键检测').getAttribute('aria-describedby')).toBe('publish-review-block')
  })

  it('未排版时说明先生成成稿', () => {
    render(null, 'ready')
    expect(terms('.publish-review__status')).toBe('等待一键排版')
    expect(button('一键检测').disabled).toBe(true)
    expect(button('一键检测').title).toContain('一键排版')
    expect(terms('.publish-review__check')).toContain('一键排版')
  })

  it('定位成功时收起详情；找不到目标时保留详情和提示', () => {
    render(resultOf(HTML))
    const hidePopover = vi.fn()
    const details = host.querySelector('#publish-review-details')
    if (!details) throw new Error('找不到预检详情')
    Object.defineProperty(details, 'hidePopover', { value: hidePopover })
    act(() => button('定位').click())
    expect(hidePopover).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.publish-review__check')).toBeNull()
    act(() => {
      article.querySelectorAll('p')[1]?.remove()
    })
    act(() => button('定位').click())
    expect(hidePopover).toHaveBeenCalledTimes(1)
    expect(terms('.publish-review__check')).toContain('未能定位')
  })

  it('风险详情与关闭入口使用同一个原生浮层，检测按钮保持独立', () => {
    render(resultOf(HTML))
    const details = host.querySelector('[popover="auto"]')
    expect(details?.id).toBe(button('发布预检').getAttribute('popovertarget'))
    expect(details?.id).toBe(button('关闭详情').getAttribute('popovertarget'))
    expect(button('关闭详情').getAttribute('popovertargetaction')).toBe('hide')
    expect(details?.contains(button('定位'))).toBe(true)
    expect(details?.contains(button('一键检测'))).toBe(false)
  })
})
