import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import type { PlatformDefinition, PlatformId } from '@/core/types'
import { platformTabId } from './panel-ids'

export interface PlatformTabsProps {
  readonly platforms: readonly PlatformDefinition[]
  readonly activeId: PlatformId
  readonly failedIds: readonly PlatformId[]
  readonly panelId: string
  readonly onSelect: (id: PlatformId) => void
}

/**
 * 六个平台的文字标签 + 2px 底部指示条（不用胶囊）。
 * 键盘：左右方向键循环切换，Home/End 跳到首尾，焦点跟随选中项。
 */
export function PlatformTabs({
  platforms,
  activeId,
  failedIds,
  panelId,
  onSelect,
}: PlatformTabsProps) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])

  const moveTo = (index: number) => {
    const next = platforms[index]
    if (!next) {
      return
    }
    buttons.current[index]?.focus()
    onSelect(next.id)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = platforms.length - 1
    switch (event.key) {
      case 'ArrowRight': {
        event.preventDefault()
        moveTo(index === last ? 0 : index + 1)
        return
      }
      case 'ArrowLeft': {
        event.preventDefault()
        moveTo(index === 0 ? last : index - 1)
        return
      }
      case 'Home': {
        event.preventDefault()
        moveTo(0)
        return
      }
      case 'End': {
        event.preventDefault()
        moveTo(last)
        return
      }
      default: {
        return
      }
    }
  }

  return (
    <div className="platform-tabs" role="tablist" aria-label="目标平台">
      {platforms.map((platform, index) => {
        const selected = platform.id === activeId
        const failed = failedIds.includes(platform.id)
        return (
          <button
            key={platform.id}
            ref={(node) => {
              buttons.current[index] = node
            }}
            id={platformTabId(platform.id)}
            className="platform-tab"
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onSelect(platform.id)
            }}
            onKeyDown={(event) => {
              handleKeyDown(event, index)
            }}
          >
            <span className="platform-tab__name">{platform.shortName}</span>
            <span className="platform-tab__meta">{platform.articleLabel}</span>
            {failed ? (
              <span className="platform-tab__flag">
                <span className="platform-tab__flag-mark" aria-hidden="true" />
                排版失败
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
