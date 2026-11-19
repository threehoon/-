const LOCAL_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
const MAX_IMAGE_SIZE = 5 * 1024 * 1024

export const LOCAL_IMAGE_ACCEPT = LOCAL_IMAGE_TYPES.join(',')

/** Paste events already contain files; no clipboard-read permission prompt is needed. */
export function clipboardImage(data: DataTransfer): File | null {
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) return file
  }
  return Array.from(data.files ?? []).find((file) => file.type.startsWith('image/')) ?? null
}

export async function readLocalImage(file: File): Promise<string> {
  if (!LOCAL_IMAGE_TYPES.includes(file.type)) {
    throw new Error('请选择 PNG、JPG、WebP、GIF 或 AVIF 图片。')
  }
  if (file.size > MAX_IMAGE_SIZE) throw new Error('单张图片不能超过 5 MB，请压缩后重试。')
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('无法读取图片，请重新选择文件。'))
    }
    reader.onerror = reader.onabort = () => reject(new Error('无法读取图片，请重新选择文件。'))
    reader.readAsDataURL(file)
  })
  const image = new Image()
  image.src = src
  try {
    await image.decode()
  } catch {
    throw new Error('浏览器无法打开这张图片，请检查文件或换一张。')
  }
  return src
}
