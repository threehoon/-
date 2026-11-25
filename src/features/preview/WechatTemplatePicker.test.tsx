import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLATFORMS } from '@/platforms/registry'
import { WECHAT_TEMPLATE_CATEGORIES, WECHAT_TEMPLATES } from '@/platforms/wechat/theme'
import { WechatTemplatePicker } from './WechatTemplatePicker'

const wechat = PLATFORMS.find(({ id }) => id === 'wechat') ?? PLATFORMS[0]

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

function buttonByLabel(label: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
}

function filterButtonByText(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>('.wechat-templates__filter'))
    .find((button) => button.textContent?.includes(text))
  if (!found) throw new Error(`找不到分类按钮：${text}`)
  return found
}

describe('WechatTemplatePicker', () => {
  it('默认展示全部分组与十二套模板，触发按钮显示当前模板名', () => {
    act(() => {
      root.render(
        <WechatTemplatePicker
          platform={wechat}
          selected="ink"
          blocked={null}
          onSelect={() => null}
        />,
      )
    })

    expect(buttonByLabel('排版模板：水墨国风')).not.toBeNull()
    expect(filterButtonByText('全部').getAttribute('aria-pressed')).toBe('true')

    const groupTitles = Array.from(container.querySelectorAll('.wechat-templates__group-header h3')).map((node) => node.textContent)
    expect(groupTitles).toEqual(WECHAT_TEMPLATE_CATEGORIES.map(({ name }) => name))

    for (const template of WECHAT_TEMPLATES) {
      const button = buttonByLabel(template.name)
      expect(button, template.name).not.toBeNull()
      expect(button?.getAttribute('aria-pressed')).toBe(String(template.id === 'ink'))
    }
  })

  it('支持按分类筛选并切回全部，同时支持方向键切换筛选焦点', () => {
    act(() => {
      root.render(
        <WechatTemplatePicker
          platform={wechat}
          selected="classic"
          blocked={null}
          onSelect={() => null}
        />,
      )
    })

    const allFilter = filterButtonByText('全部')
    const opinionFilter = filterButtonByText('观点长文')
    const knowledgeFilter = filterButtonByText('知识干货')

    allFilter.focus()
    act(() => {
      allFilter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(document.activeElement).toBe(opinionFilter)
    act(() => {
      opinionFilter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    expect(document.activeElement).toBe(allFilter)
    act(() => {
      allFilter.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    expect(document.activeElement).toBe(knowledgeFilter)
    act(() => {
      knowledgeFilter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    expect(document.activeElement).toBe(allFilter)

    act(() => {
      knowledgeFilter.click()
    })
    expect(knowledgeFilter.getAttribute('aria-pressed')).toBe('true')
    expect(allFilter.getAttribute('aria-pressed')).toBe('false')
    expect(buttonByLabel('技术专栏')).not.toBeNull()
    expect(buttonByLabel('操作手册')).not.toBeNull()
    expect(buttonByLabel('极简黑白')).not.toBeNull()
    expect(buttonByLabel('观点蓝调')).toBeNull()
    expect(buttonByLabel('暖纸手记')).toBeNull()

    act(() => {
      allFilter.click()
    })
    expect(buttonByLabel('观点蓝调')).not.toBeNull()
    expect(buttonByLabel('暖纸手记')).not.toBeNull()
  })

  it('点击模板会触发 onSelect，失败时保留错误提示且不关闭', () => {
    const onSelect = vi.fn().mockReturnValueOnce('换版失败：请稍后重试').mockReturnValueOnce(null)
    act(() => {
      root.render(
        <WechatTemplatePicker
          platform={wechat}
          selected="classic"
          blocked={null}
          onSelect={onSelect}
        />,
      )
    })

    act(() => {
      buttonByLabel('森系轻读')?.click()
    })
    expect(onSelect).toHaveBeenCalledWith('forest')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('换版失败：请稍后重试')

    act(() => {
      buttonByLabel('极简黑白')?.click()
    })
    expect(onSelect).toHaveBeenCalledWith('minimal')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('处于阻止态时展示说明并禁用全部模板按钮', () => {
    const onSelect = vi.fn()
    act(() => {
      root.render(
        <WechatTemplatePicker
          platform={wechat}
          selected="classic"
          blocked="当前成稿有手动正文改动。"
          onSelect={onSelect}
        />,
      )
    })

    expect(container.querySelector('[role="status"]')?.textContent).toBe('当前成稿有手动正文改动。')
    for (const template of WECHAT_TEMPLATES) {
      const button = buttonByLabel(template.name)
      expect(button?.disabled).toBe(true)
    }
    expect(onSelect).not.toHaveBeenCalled()
  })
})
