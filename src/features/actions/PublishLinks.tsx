import { useId } from 'react'
import { Icon } from '@/components/Icon'

const PUBLISH_LINKS = [
  { name: '微信视频号', url: 'https://channels.weixin.qq.com/platform/post/create' },
  { name: '小红书', url: 'https://creator.xiaohongshu.com/publish/publish' },
  { name: '抖音', url: 'https://creator.douyin.com/creator-micro/content/upload' },
] as const

/** 视频发布入口不依赖排版结果，也不携带稿件。 */
export function PublishLinks() {
  const popoverId = useId()
  const labelId = `${popoverId}-label`

  return (
    <div className="publish-links">
      <button id={labelId} className="btn publish-links__trigger" type="button" popoverTarget={popoverId}>
        视频发布入口
        <Icon name="chevron" size={14} />
      </button>
      <nav id={popoverId} className="publish-links__popover" popover="auto" aria-labelledby={labelId}>
        {PUBLISH_LINKS.map(({ name, url }) => (
          <a key={name} className="btn publish-links__link" href={url} target="_blank" rel="noopener noreferrer">
            {name}
            <span className="visually-hidden">发布页（在新标签页打开）</span>
            <Icon name="external" size={14} />
          </a>
        ))}
      </nav>
    </div>
  )
}
