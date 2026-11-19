import { describe, expect, it } from 'vitest'
import { readMarkdownFile } from './import-markdown'

describe('导入 .md：读取与校验', () => {
  it('正常 UTF-8 文件返回原文与文件名', async () => {
    const outcome = await readMarkdownFile(new File(['# 标题\n\n正文'], '样稿.md', { type: 'text/markdown' }))
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.markdown).toBe('# 标题\n\n正文')
      expect(outcome.fileName).toBe('样稿.md')
    }
  })

  it('非 Markdown 扩展名给出原因，不返回文本', async () => {
    const outcome = await readMarkdownFile(new File(['# 标题'], '样稿.pdf'))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.message).toContain('工具只接收 Markdown 或 TXT 文件')
      expect(outcome.detail).toContain('当前源稿保持原样')
    }
  })

  it('空文件单独说明，不返回空文本让界面覆盖当前稿', async () => {
    const outcome = await readMarkdownFile(new File([], '空稿.md'))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.message).toContain('文件里没有内容')
      expect(outcome.detail).toContain('当前源稿保持原样')
    }
  })

  it('只有空白的文件按「没有可排版的文字」处理', async () => {
    const outcome = await readMarkdownFile(new File(['   \n\n\t'], '空白.md'))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.message).toContain('没有可排版的文字')
    }
  })

  it('非法 UTF-8 字节提示编码问题，而不是把乱码塞进源稿', async () => {
    const outcome = await readMarkdownFile(new File([new Uint8Array([0xff, 0xfe, 0x23])], '坏编码.md'))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.message).toContain('不是 UTF-8 编码')
      expect(outcome.detail).toContain('另存为 UTF-8')
    }
  })

  it('保留合法 UTF-8 文件中有意输入的 U+FFFD', async () => {
    const markdown = '# 标题\n\n保留字符：\uFFFD。'
    const outcome = await readMarkdownFile(new File([markdown], '合法.md'))
    expect(outcome).toEqual({ ok: true, markdown, fileName: '合法.md' })
  })

  it('浏览器读取抛错时说明原因并保留当前稿', async () => {
    const broken = {
      name: '损坏.md',
      size: 12,
      arrayBuffer: () => Promise.reject(new Error('NotReadableError: 文件已被移走')),
    } as unknown as File
    const outcome = await readMarkdownFile(broken)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.message).toContain('浏览器读取这个文件失败')
      expect(outcome.detail).toContain('NotReadableError')
      expect(outcome.detail).toContain('当前源稿保持原样')
    }
  })

  it('接受 .txt 与 .markdown 扩展名', async () => {
    const txt = await readMarkdownFile(new File(['正文'], '稿.txt'))
    const markdown = await readMarkdownFile(new File(['正文'], '稿.MARKDOWN'))
    expect(txt.ok).toBe(true)
    expect(markdown.ok).toBe(true)
  })
})
