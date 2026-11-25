import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '@/components/Icon'
import { parseDocument } from '@/core/markdown/parse'
import { stripArticleSourceMarkers } from '@/core/render/source-markers'
import type { PlatformDefinition, WechatTemplateCategoryId, WechatTemplateId } from '@/core/types'
import { WECHAT_TEMPLATE_CATEGORIES, WECHAT_TEMPLATES } from '@/platforms/wechat/theme'

// The sample and the article use the same platform adapter.
const sample = parseDocument('## 城市散步手记\n\n沿河去看老街。\n\n> 把脚步放慢。\n\n---')

type TemplateFilterId = 'all' | WechatTemplateCategoryId

interface WechatTemplatePickerProps {
  readonly platform: PlatformDefinition
  readonly selected: WechatTemplateId
  readonly blocked: string | null
  readonly onSelect: (template: WechatTemplateId) => string | null
}

export function WechatTemplatePicker({ platform, selected, blocked, onSelect }: WechatTemplatePickerProps) {
  const templates = useMemo(() => WECHAT_TEMPLATES.map(({ id, category, name, description }) => {
    const outcome = platform.render(sample, { titleOverride: null, template: id, assets: { resolve: () => ({ kind: 'missing' }) } })
    return {
      id,
      category,
      name,
      description,
      preview: { __html: outcome.ok ? stripArticleSourceMarkers(outcome.document.html) : '' },
    }
  }), [platform])

  const grouped = useMemo(() => WECHAT_TEMPLATE_CATEGORIES.map((category) => ({
    ...category,
    items: templates.filter((item) => item.category === category.id),
  })), [templates])

  const filters = useMemo(() => [
    { id: 'all' as const, name: '全部', count: templates.length },
    ...grouped.map(({ id: categoryId, name, items }) => ({ id: categoryId, name, count: items.length })),
  ], [grouped, templates.length])

  const id = useId()
  const popover = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const filterButtons = useRef<Array<HTMLButtonElement | null>>([])
  const [activeCategory, setActiveCategory] = useState<TemplateFilterId>('all')
  const [error, setError] = useState<string | null>(null)
  const active = templates.find(({ id: templateId }) => templateId === selected)
  const visibleGroups = activeCategory === 'all'
    ? grouped
    : grouped.filter((group) => group.id === activeCategory)

  function apply(template: WechatTemplateId) {
    if (blocked) return
    const reason = onSelect(template)
    setError(reason)
    if (reason) return
    popover.current?.hidePopover?.()
    trigger.current?.focus({ preventScroll: true })
  }

  function handleFilterKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = filters.length - 1
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = index === last ? 0 : index + 1
    else if (event.key === 'ArrowLeft') nextIndex = index === 0 ? last : index - 1
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = last
    if (nextIndex === null) return
    event.preventDefault()
    filterButtons.current[nextIndex]?.focus()
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
          <div className="wechat-templates__heading-row">
            <h2 id={`${id}-title`}>排版模板</h2>
            <span className="wechat-templates__summary">共 {templates.length} 套 · {grouped.length} 类</span>
          </div>
          <p>同一篇示例对比版式。选中后，只更新当前平台的成稿与富文本复制。</p>
        </header>
        <div className="wechat-templates__filters" role="group" aria-label="模板分类筛选">
          {filters.map((filter, index) => (
            <button
              key={filter.id}
              ref={(node) => { filterButtons.current[index] = node }}
              className="wechat-templates__filter"
              type="button"
              aria-pressed={activeCategory === filter.id}
              onClick={() => setActiveCategory(filter.id)}
              onKeyDown={(event) => handleFilterKeyDown(event, index)}
            >
              <span>{filter.name}</span>
              <span className="wechat-templates__filter-count">{filter.count}</span>
            </button>
          ))}
        </div>
        {blocked ? <p className="wechat-templates__notice" role="status">{blocked}</p> : null}
        {error ? <p className="wechat-templates__notice" data-tone="error" role="alert">{error}</p> : null}
        <div className="wechat-templates__body">
          {visibleGroups.map((group) => (
            <section
              key={group.id}
              className="wechat-templates__group"
              aria-labelledby={`${id}-group-${group.id}`}
            >
              <div className="wechat-templates__group-header">
                <h3 id={`${id}-group-${group.id}`}>{group.name}</h3>
                <p>{group.description}</p>
              </div>
              <div className="wechat-templates__grid">
                {group.items.map(({ id: template, name, description, preview }) => (
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
          ))}
        </div>
      </section>
    </div>
  )
}
