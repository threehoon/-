import type { ReactNode, Ref } from 'react'

export function InspectionPopover({ id, heading, panelRef, children }: {
  readonly id: string
  readonly heading: string
  readonly panelRef?: Ref<HTMLElement>
  readonly children: ReactNode
}) {
  return (
    <section className="inspection-popover" id={id} ref={panelRef} popover="auto" aria-labelledby={`${id}-heading`}>
      <div className="inspection-popover__header">
        <h2 id={`${id}-heading`}>{heading}</h2>
        <button className="btn btn--ghost btn--small" type="button" popoverTarget={id} popoverTargetAction="hide">
          关闭详情
        </button>
      </div>
      <div className="inspection-popover__body" tabIndex={0} role="group" aria-label={heading}>{children}</div>
    </section>
  )
}
