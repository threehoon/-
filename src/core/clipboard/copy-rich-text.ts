import type { CopyResult } from '../types'
import { describeError } from '../render/html'

/**
 * 富文本复制。
 *
 * 只有「真的写进剪贴板」才算成功；写不进去就返回 ok:false 并附上手动复制文本，
 * 让界面能显示失败原因和兜底内容——不报假成功，也不偷偷降级成纯文本假装成功。
 */
export interface CopyRichTextPayload {
  readonly html: string
  readonly plainText: string
}

/** 用本次用户点击同步写入，避免等权限拒绝后丢失用户激活。 */
function copyFromClick(payload: CopyRichTextPayload): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false

  let written = false
  const writeFormats = (event: ClipboardEvent) => {
    // 不让浏览器把用户之前选中的其它内容当作本次复制结果。
    event.preventDefault()
    if (!event.clipboardData) return
    try {
      event.clipboardData.setData('text/plain', payload.plainText)
      event.clipboardData.setData('text/html', payload.html)
      written = true
    } catch {
      event.clipboardData.clearData()
    }
  }

  document.addEventListener('copy', writeFormats, { capture: true, once: true })
  try {
    return document.execCommand('copy') && written
  } catch {
    return false
  } finally {
    document.removeEventListener('copy', writeFormats, true)
  }
}

export async function copyRichText(payload: CopyRichTextPayload): Promise<CopyResult> {
  const manualText = payload.plainText
  const hasHtml = payload.html.trim().length > 0
  const hasPlain = manualText.trim().length > 0

  if (!hasHtml && !hasPlain) {
    return {
      ok: false,
      reason: '没有可复制的内容：当前正文为空。',
      manualText,
    }
  }

  if (copyFromClick(payload)) return { ok: true, mode: 'rich-text' }

  const fail = (reason: string): CopyResult => ({ ok: false, reason, manualText })

  if (typeof navigator === 'undefined') {
    return fail('当前环境没有 navigator，无法访问剪贴板。')
  }

  const clipboard: Clipboard | undefined = navigator.clipboard
  if (!clipboard || typeof clipboard.write !== 'function') {
    return fail(
      '当前浏览器不支持富文本剪贴板（navigator.clipboard.write 不可用）。请使用桌面版 Chrome 或 Edge，并用 https 或 localhost 打开本工具。',
    )
  }

  if (typeof ClipboardItem === 'undefined') {
    return fail('当前浏览器不支持 ClipboardItem，无法写入富文本。请使用桌面版 Chrome 或 Edge。')
  }

  try {
    const item = new ClipboardItem({
      'text/html': new Blob([payload.html], { type: 'text/html' }),
      'text/plain': new Blob([manualText], { type: 'text/plain' }),
    })
    await clipboard.write([item])
    return { ok: true, mode: 'rich-text' }
  } catch (error) {
    return fail(
      `写入剪贴板失败：${describeError(error)}。可能是浏览器拒绝了剪贴板权限，请允许后重试，或在下方文本框里手动全选复制。`,
    )
  }
}
