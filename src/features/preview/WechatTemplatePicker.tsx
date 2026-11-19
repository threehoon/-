import { useId, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { parseDocument } from '@/core/markdown/parse'
import { stripArticleSourceMarkers } from '@/core/render/source-markers'
import type { PlatformDefinition, WechatTemplateId } from '@/core/types'
import { WECHAT_TEMPLATES } from '@/platforms/wechat/theme'

// The sample and the article use the same platform adapter.
const sample = parseDocument('## 城市散步手记\n\n沿河去看老街。\n\n> 把脚步放慢。\n\n---')

interface WechatTemplatePickerProps {
  readonly platform: PlatformDefinition
  readonly selected: WechatTemplateId
  readonly blocked: string | null
  readonly onSelect: (template: WechatTemplateId) => string | null
}

export function WechatTemplatePicker({ platform, selected, blocked, onSelect }: WechatTemplatePickerProps) {
  const templates = useMemo(() => WECHAT_TEMPLATES.map(({ id, name, description }) => {
    const outcome = platform.render(sample, { titleOverride: null, template: id, assets: { resolve: () => ({ kind: 'missing' }) } })
    return { id, name, description, preview: { __html: outcome.ok ? stripArticleSourceMarkers(outcome.document.html) : '' } }
  }), [platform])
  const id = useId()
  const popover = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState<string | null>(null)
  const active = templates.find(({ id }) => id === selected)

  function apply(template: WechatTemplateId) {
    if (blocked) return
    const reason = onSelect(template)
    setError(reason)
    if (reason) return
    popover.current?.hidePopover?.()
    trigger.current?.focus({ preventScroll: true })
  }

  return (
    <div className="wechat-templates">
      <button
        ref={trigger}
        className="btn btn--secondary wechat-templates__trigger"
        type="button"
        aria-label={`排版模板：${active?.name ?? ''}`}
        title={active?.name}
        popoverTarget={id}
        onClick={() => setError(null)}
      >
        <span>模板<span className="wechat-templates__current"> · {active?.name}</span></span>
        <Icon name="chevron" size={14} />
      </button>
      <section id={id} ref={popover} className="wechat-templates__popover" popover="auto" aria-labelledby={`${id}-title`}>
        <header className="wechat-templates__header">
          <h2 id={`${id}-title`}>排版模板</h2>
          <p>同一篇示例对比版式。选中后，只更新当前平台的成稿与富文本复制。</p>
        </header>
        {blocked ? <p className="wechat-templates__notice" role="status">{blocked}</p> : null}
        {error ? <p className="wechat-templates__notice" data-tone="error" role="alert">{error}</p> : null}
        <div className="wechat-templates__grid">
          {templates.map(({ id: template, name, description, preview }) => (
            <div key={template} className="wechat-templates__choice" data-selected={template === selected}>
              <div className="wechat-templates__proof" aria-hidden="true">
                <div className="wechat-templates__sample" dangerouslySetInnerHTML={preview} />
              </div>
              <button
                className="wechat-templates__name"
                type="button"
                aria-pressed={template === selected}
                aria-label={name}
                aria-describedby={`${id}-${template}`}
                disabled={blocked !== null}
                onClick={() => apply(template)}
              >
                {name}
                {template === selected ? <span className="wechat-templates__selected"><Icon name="check" size={14} />当前</span> : null}
              </button>
              <p className="wechat-templates__description" id={`${id}-${template}`}>{description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
