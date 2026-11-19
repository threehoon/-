import { afterEach, describe, expect, it, vi } from 'vitest'
import { readLocalImage } from './local-image'

const image = new File(['image bytes'], 'test.png', { type: 'image/png' })

function stubDecode(decode: () => Promise<void>) {
  vi.stubGlobal('Image', class {
    src = ''
    decode = decode
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('本地插图', () => {
  it('生成可随成稿复制的内嵌图片地址', async () => {
    stubDecode(() => Promise.resolve())
    await expect(readLocalImage(image)).resolves.toMatch(/^data:image\/png;base64,/)
  })

  it('拒绝不支持的格式', async () => {
    const svg = new File(['<svg/>'], 'test.svg', { type: 'image/svg+xml' })
    await expect(readLocalImage(svg)).rejects.toThrow('请选择 PNG')
  })

  it('拒绝超过大小限制的图片', async () => {
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })
    await expect(readLocalImage(oversized)).rejects.toThrow('不能超过 5 MB')
  })

  it('拒绝内容损坏的图片', async () => {
    stubDecode(() => Promise.reject(new Error('decode error')))
    await expect(readLocalImage(image)).rejects.toThrow('无法打开')
  })
})
