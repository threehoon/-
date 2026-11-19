/**
 * 导入 .md 的读取与校验。界面只负责把结果转成提示，
 * 「失败不覆盖当前稿」由调用方保证：这里从不返回半成品文本。
 */

export type ImportOutcome =
  | { readonly ok: true; readonly markdown: string; readonly fileName: string }
  | { readonly ok: false; readonly message: string; readonly detail: string }

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.txt']

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase()
}

/** 读取原始字节，严格区分无效字节和合法编码的替换字符。 */
async function readBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return await file.arrayBuffer()
  }
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result)
      else reject(new Error('浏览器没有返回文件字节'))
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('FileReader 读取失败'))
    }
    reader.readAsArrayBuffer(file)
  })
}

export async function readMarkdownFile(file: File): Promise<ImportOutcome> {
  const extension = extensionOf(file.name)
  if (!MARKDOWN_EXTENSIONS.includes(extension)) {
    return {
      ok: false,
      message: `无法导入「${file.name}」：工具只接收 Markdown 或 TXT 文件。`,
      detail: '请把稿件另存为 .md 或 .txt 后重试；当前源稿保持原样。',
    }
  }
  if (file.size === 0) {
    return {
      ok: false,
      message: `无法导入「${file.name}」：文件里没有内容。`,
      detail: '当前源稿保持原样。请确认文件不是空的，或直接把 Markdown 粘贴到左侧。',
    }
  }

  let bytes: ArrayBuffer
  try {
    bytes = await readBytes(file)
  } catch (error) {
    const reason = error instanceof Error ? error.message : '浏览器没有返回原因'
    return {
      ok: false,
      message: `无法导入「${file.name}」：浏览器读取这个文件失败。`,
      detail: `当前源稿保持原样。可以重试一次，或直接把内容粘贴到左侧。技术原因：${reason}`,
    }
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return {
      ok: false,
      message: `无法导入「${file.name}」：文件不是 UTF-8 编码，中文会变成乱码。`,
      detail: '请在编辑器里把文件另存为 UTF-8，或直接把 Markdown 粘贴到左侧；当前源稿保持原样。',
    }
  }
  if (text.trim() === '') {
    return {
      ok: false,
      message: `无法导入「${file.name}」：文件里没有可排版的文字。`,
      detail: '当前源稿保持原样。请确认文件里确实有正文，而不是只有空行。',
    }
  }
  return { ok: true, markdown: text, fileName: file.name }
}
