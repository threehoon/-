import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyRichText } from './copy-rich-text'

/**
 * 剪贴板测试。jsdom 没有真实的 clipboard/ClipboardItem，
 * 这里用替身验证「写不进去就不要报成功」的行为。
 */
class FakeClipboardItem {
  readonly items: Record<string, Blob>

  constructor(items: Record<string, Blob>) {
    this.items = items
  }
}

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('copyRichText', () => {
  function mockCopyCommand(run: () => boolean) {
    const original = Object.getOwnPropertyDescriptor(document, 'execCommand')
    const command = vi.fn(run)
    Object.defineProperty(document, 'execCommand', { value: command, configurable: true })
    return {
      command,
      restore: () => {
        if (original) Object.defineProperty(document, 'execCommand', original)
        else Reflect.deleteProperty(document, 'execCommand')
      },
    }
  }

  it('标准剪贴板不可用时，点击同步复制带格式的 HTML 和纯文本', async () => {
    setClipboard(undefined)
    const setData = vi.fn()
    const event = Object.assign(new Event('copy', { cancelable: true }), { clipboardData: { setData } })
    const { command, restore } = mockCopyCommand(() => {
      document.dispatchEvent(event)
      return true
    })
    try {
      const result = await copyRichText({ html: '<strong>正文</strong>', plainText: '正文' })
      expect(result).toEqual({ ok: true, mode: 'rich-text' })
      expect(command).toHaveBeenCalledExactlyOnceWith('copy')
      expect(event.defaultPrevented).toBe(true)
      expect(setData.mock.calls).toEqual([['text/plain', '正文'], ['text/html', '<strong>正文</strong>']])
    } finally {
      restore()
    }
  })

  it('命令未派发 copy 事件时，不报成功或拦截用户之后的手动复制', async () => {
    setClipboard(undefined)
    const { restore } = mockCopyCommand(() => true)
    try {
      const result = await copyRichText({ html: '<p>正文</p>', plainText: '正文' })
      expect(result.ok).toBe(false)
      const userCopy = new Event('copy', { cancelable: true })
      document.dispatchEvent(userCopy)
      expect(userCopy.defaultPrevented).toBe(false)
    } finally {
      restore()
    }
  })

  it('写入成功时返回 rich-text，并同时带 html 与 plain text', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    const write = vi.fn((_items: FakeClipboardItem[]) => Promise.resolve(undefined))
    setClipboard({ write })

    const result = await copyRichText({ html: '<p>正文</p>', plainText: '正文' })

    expect(result).toEqual({ ok: true, mode: 'rich-text' })
    expect(write).toHaveBeenCalledTimes(1)
    const payload = write.mock.calls[0]?.[0] ?? []
    expect(payload).toHaveLength(1)
    expect(Object.keys(payload[0]?.items ?? {}).sort()).toEqual(['text/html', 'text/plain'])
  })

  it('浏览器拒绝写入时返回失败原因与手动复制文本', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    setClipboard({
      write: vi.fn((_items: FakeClipboardItem[]) =>
        Promise.reject(new Error('Write permission denied')),
      ),
    })

    const result = await copyRichText({ html: '<p>正文</p>', plainText: '正文' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.manualText).toBe('正文')
      expect(result.reason).toContain('剪贴板权限')
      expect(result.reason).toContain('Write permission denied')
    }
  })

  it('没有 navigator.clipboard.write 时直接说明不支持', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    setClipboard(undefined)

    const result = await copyRichText({ html: '<p>正文</p>', plainText: '正文' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('不支持富文本剪贴板')
      expect(result.manualText).toBe('正文')
    }
  })

  it('缺少 ClipboardItem 时不假装成功', async () => {
    vi.stubGlobal('ClipboardItem', undefined)
    const write = vi.fn((_items: FakeClipboardItem[]) => Promise.resolve(undefined))
    setClipboard({ write })

    const result = await copyRichText({ html: '<p>正文</p>', plainText: '正文' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('ClipboardItem')
    }
    expect(write).not.toHaveBeenCalled()
  })

  it('空内容直接失败并给出空的手动文本', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    setClipboard({ write: vi.fn((_items: FakeClipboardItem[]) => Promise.resolve(undefined)) })

    const result = await copyRichText({ html: '   ', plainText: '' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('没有可复制的内容')
      expect(result.manualText).toBe('')
    }
  })
})
