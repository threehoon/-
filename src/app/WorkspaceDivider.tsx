import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'

interface WorkspaceDividerProps {
  readonly preferredShare: number | null
  readonly onShareChange: (share: number | null) => void
  readonly hidden: boolean
}

interface SplitBounds {
  readonly width: number
  readonly sourceMin: number
  readonly sourceMax: number
  readonly defaultShare: number
}

function measure(workspace: HTMLElement): SplitBounds {
  const width = workspace.getBoundingClientRect().width
  const styles = getComputedStyle(workspace)
  return {
    width,
    sourceMin: Number.parseFloat(styles.getPropertyValue('--source-min-width')),
    sourceMax: width - Number.parseFloat(styles.getPropertyValue('--preview-min-width')),
    defaultShare: Number.parseFloat(styles.getPropertyValue('--default-source-share')) / 100,
  }
}

function clampSource(pixels: number, { sourceMin, sourceMax }: SplitBounds): number {
  return Math.min(sourceMax, Math.max(sourceMin, pixels))
}

/** The divider overlays the shared edge without taking space from either panel. */
export function WorkspaceDivider({ preferredShare, onShareChange, hidden }: WorkspaceDividerProps) {
  const divider = useRef<HTMLDivElement>(null)
  const drag = useRef<{ readonly pointer: number; readonly offset: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [bounds, setBounds] = useState<SplitBounds | null>(null)

  useLayoutEffect(() => {
    const workspace = divider.current?.parentElement
    if (!workspace || hidden) return
    const refresh = () => setBounds(measure(workspace))
    refresh()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh)
    observer?.observe(workspace)
    window.addEventListener('resize', refresh)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', refresh)
    }
  }, [hidden])

  const ownBounds = bounds && bounds.sourceMax >= bounds.sourceMin ? bounds : null
  const sourceWidth = ownBounds ? Math.round(clampSource(
    ownBounds.width * (preferredShare ?? ownBounds.defaultShare),
    ownBounds,
  )) : undefined

  function resize(pixels: number, workspace: HTMLElement) {
    const next = measure(workspace)
    if (next.width > 0 && next.sourceMax >= next.sourceMin) {
      onShareChange(clampSource(pixels, next) / next.width)
    }
  }

  function stopDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointer !== event.pointerId) return
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      ref={divider}
      className="workspace-divider"
      data-dragging={dragging}
      hidden={hidden}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="调整源稿与成稿宽度"
      aria-controls="workspace-source"
      aria-valuemin={ownBounds ? Math.ceil(ownBounds.sourceMin) : undefined}
      aria-valuemax={ownBounds ? Math.floor(ownBounds.sourceMax) : undefined}
      aria-valuenow={sourceWidth}
      aria-valuetext={sourceWidth === undefined ? undefined : `源稿 ${sourceWidth} 像素`}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return
        const target = event.currentTarget
        const rect = target.getBoundingClientRect()
        event.preventDefault()
        target.setPointerCapture(event.pointerId)
        drag.current = { pointer: event.pointerId, offset: event.clientX - (rect.left + rect.width / 2) }
        setDragging(true)
      }}
      onPointerMove={(event) => {
        const current = drag.current
        const workspace = event.currentTarget.parentElement
        if (current?.pointer !== event.pointerId || !workspace) return
        resize(event.clientX - workspace.getBoundingClientRect().left - current.offset, workspace)
      }}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onLostPointerCapture={stopDrag}
      onDoubleClick={() => onShareChange(null)}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
        if (event.key === 'Enter') {
          event.preventDefault()
          onShareChange(null)
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          const target = event.currentTarget
          const workspace = target.parentElement
          if (!workspace) return
          const rect = target.getBoundingClientRect()
          const current = rect.left + rect.width / 2 - workspace.getBoundingClientRect().left
          event.preventDefault()
          resize(current + (event.key === 'ArrowLeft' ? -24 : 24), workspace)
        }
      }}
    />
  )
}
