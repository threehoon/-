import { useLayoutEffect, useRef, useState } from 'react'
import type { LiveLink } from '@/app/studio-state'
import type { PlatformDefinition, PlatformId } from '@/core/types'

interface LiveLinkProps {
  readonly platform: PlatformDefinition
  readonly platforms: readonly PlatformDefinition[]
  readonly available: readonly PlatformId[]
  readonly link: LiveLink | null
  readonly onSave: (targets: readonly PlatformId[]) => string | null
}

export function LiveLinkControl({ platform, platforms, available, link, onSave }: LiveLinkProps) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const source = platforms.find(({ id }) => id === link?.source) ?? platform
  const label = !link ? '实时联动' : source.id === platform.id ? `联动中 · ${link.targets.length} 个平台`
    : link.targets.includes(platform.id) ? `跟随${source.shortName}` : '管理联动'

  return (
    <>
      <button className="btn btn--ghost live-link-trigger" type="button" ref={trigger} aria-haspopup="dialog"
        aria-label={label} onClick={() => setOpen(true)}>
        <span className="live-link-trigger__full">{label}</span>
        <span className="live-link-trigger__compact" aria-hidden="true">{link ? '联动中' : '联动'}</span>
      </button>
      {open ? <LiveLinkDialog source={source} platforms={platforms} available={available} link={link} onSave={onSave}
        onClose={() => {
          setOpen(false)
          trigger.current?.focus({ preventScroll: true })
        }} /> : null}
    </>
  )
}

function LiveLinkDialog({ source, platforms, available, link, onSave, onClose }: Omit<LiveLinkProps, 'platform'> & {
  readonly source: PlatformDefinition
  readonly onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const firstChoice = useRef<HTMLInputElement>(null)
  const [targets, setTargets] = useState<readonly PlatformId[]>(link?.targets ?? [])
  const [error, setError] = useState<string | null>(null)
  const options = platforms.filter(({ id }) => id !== source.id)
  const firstAvailable = options.find(({ id }) => available.includes(id))?.id
  const newlySelected = targets.filter((id) => !link?.targets.includes(id)).length
  useLayoutEffect(() => {
    dialog.current?.showModal()
    firstChoice.current?.focus()
  }, [])

  const close = () => {
    dialog.current?.close()
    onClose()
  }
  function save(selection: readonly PlatformId[]) {
    const failure = onSave(selection)
    if (failure) setError(failure)
    else close()
  }

  return (
    <dialog className="live-link-dialog" aria-labelledby="live-link-title" aria-describedby="live-link-summary" ref={dialog}
      onCancel={(event) => { event.preventDefault(); close() }}>
      <form onSubmit={(event) => {
        event.preventDefault()
        if (targets.length > 0) save(targets)
      }}>
        <h2 id="live-link-title">实时联动</h2>
        <p id="live-link-summary">以 <strong>{source.name}</strong> 为来源。标题和正文改动按目标平台的规则重新排版，不改左侧 Markdown。</p>
        <fieldset className="live-link-dialog__targets">
          <legend>选择跟随的平台</legend>
          {options.map(({ id, name }) => (
            <label key={id} className="live-link-dialog__choice">
              <input type="checkbox" ref={id === firstAvailable ? firstChoice : undefined}
                checked={targets.includes(id)} disabled={!available.includes(id)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked
                  setError(null)
                  setTargets((previous) => checked ? [...previous, id] : previous.filter((target) => target !== id))
                }} />
              <span>{name}{available.includes(id) ? '' : '（未生成成稿）'}</span>
            </label>
          ))}
        </fieldset>
        <p className="live-link-dialog__scope" role="status">{newlySelected > 0
          ? `确认后将替换新选中 ${newlySelected} 个平台的标题和正文，包括已有改动。`
          : targets.length === 0 ? '请至少勾选一个平台。' : `已选 ${targets.length} 个平台；取消勾选会保留该平台最后一次同步的版本。`}</p>
        <p>字体、字号按目标平台模板排版。手动编辑目标草稿，会停止该平台的跟随。</p>
        {error ? <p className="live-link-note" role="alert">{error}</p> : null}
        <div className="live-link-dialog__actions">
          {link ? <button className="btn btn--ghost" type="button" onClick={() => save([])}>停止联动</button> : null}
          <button className="btn btn--secondary" type="button" onClick={close}>取消</button>
          <button className="btn btn--primary" type="submit" disabled={targets.length === 0}>
            {link ? '更新联动' : '开始联动'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
