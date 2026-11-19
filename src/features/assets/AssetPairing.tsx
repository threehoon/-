import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import type { AssetNotice } from '@/app/studio-state'

export interface AssetPairingProps {
  readonly remoteImages: readonly string[]
  readonly localImages: readonly string[]
  readonly boundAssets: Readonly<Record<string, string>>
  readonly notice: AssetNotice | null
  readonly onBind: (raw: string, file: File) => void
  readonly onUnbind: (raw: string) => void
}

/**
 * 本地图片配对：列出源稿里的相对路径，由用户逐个选择文件。
 * 不读取目录、不上传文件，配对结果只用于本地预览地址。
 */
export function AssetPairing({
  remoteImages,
  localImages,
  boundAssets,
  notice,
  onBind,
  onUnbind,
}: AssetPairingProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingRaw = useRef<string | null>(null)

  const pickFor = (raw: string) => {
    pendingRaw.current = raw
    inputRef.current?.click()
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    const raw = pendingRaw.current
    if (file && raw !== null) {
      onBind(raw, file)
    }
    pendingRaw.current = null
    // 清空 value，同一个文件下次还能再次选择。
    event.target.value = ''
  }

  return (
    <section className="assets" aria-labelledby="assets-title">
      <div className="assets__header">
        <h2 className="assets__title" id="assets-title">
          本地图片配对
        </h2>
        <span className="assets__count">{localImages.length} 个路径</span>
      </div>
      <p className="assets__intro">
        浏览器不会读取本地目录：源稿里的相对路径图片需要你在这里逐张选择文件。配对只在本地生成预览地址，不上传文件；未配对的图片在预览里显示为补插标记，复制到平台后需在该位置手动补插。
      </p>

      {notice === null ? null : (
        <p className="assets__notice" data-tone={notice.tone} role="status">
          {notice.message}
        </p>
      )}

      {localImages.length === 0 ? (
        <p className="assets__empty">源稿里没有需要配对的本地图片路径。</p>
      ) : (
        <ul className="asset-list">
          {localImages.map((raw) => {
            const bound = raw in boundAssets
            return (
              <li className="asset-row" key={raw} data-bound={bound}>
                <code className="asset-row__path">{raw}</code>
                <span className="asset-row__state" data-bound={bound}>
                  {bound ? '已配对' : '未配对'}
                </span>
                <span className="asset-row__actions">
                  <button
                    className="btn btn--secondary btn--small"
                    type="button"
                    onClick={() => {
                      pickFor(raw)
                    }}
                  >
                    {bound ? '更换文件' : '选择文件'}
                  </button>
                  {bound ? (
                    <button
                      className="btn btn--ghost btn--small"
                      type="button"
                      onClick={() => {
                        onUnbind(raw)
                      }}
                    >
                      取消配对
                    </button>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {remoteImages.length === 0 ? null : (
        <div className="assets__remote">
          <p className="assets__remote-title">HTTPS 外链（可直接预览，浏览器会请求原站）</p>
          <ul className="asset-list asset-list--remote">
            {remoteImages.map((url) => (
              <li className="asset-row" key={url}>
                <code className="asset-row__path">{url}</code>
                <span className="asset-row__state">外链</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFileChange}
      />
    </section>
  )
}
