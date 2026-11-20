import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { DEFAULT_ARTICLE_FONT } from '@/core/render/article-font'
import type {
  CompatWarning,
  CompatibilityLocation,
  PlatformDefinition,
  RenderFailure,
  RenderedDocument,
  TypesetReport,
  WechatTemplateId,
} from '@/core/types'
import type { StudioStatus } from '@/app/studio-state'
import type { StudioApi } from '@/app/use-studio'
import { formatClock } from '@/app/text'
import { Icon } from '@/components/Icon'
import { EditableArticle, type ArticleLayout } from './EditableArticle'
import { ArticleCheck } from './ArticleCheck'
import type { DeepSeekConfig } from './deepseek-check'
import { CompatibilityList, type LocateFeedback } from './CompatibilityList'
import { compatibilityTargets, locateRange } from './issue-locations'

const NO_WARNINGS: readonly CompatWarning[] = []
const FOCUS_CANVAS_KEY = 'typeset-studio:focus-canvas'
const FOCUS_CANVAS_CONTROLS = [
  { label: '画布宽度', min: 320, max: 1200, step: 20, unit: 'px' },
  { label: '画布高度', min: 50, max: 100, step: 5, unit: '%' },
  { label: '正文显示比例', min: 75, max: 125, step: 5, unit: '%' },
] as const
const DEFAULT_FOCUS_CANVAS = [920, 100, 100] as const

type FocusCanvasSize = readonly [width: number, height: number, zoom: number]

function loadFocusCanvas(): FocusCanvasSize {
  try {
    const stored = window.localStorage.getItem(FOCUS_CANVAS_KEY)?.split(',').map(Number)
    if (stored?.length === 3 && FOCUS_CANVAS_CONTROLS.every(({ min, max, step }, index) => {
      const value = stored[index]
      return value >= min && value <= max && Number.isInteger((value - min) / step)
    })) return [stored[0], stored[1], stored[2]]
  } catch {
    // Storage is optional; the view remains adjustable on this page.
  }
  return DEFAULT_FOCUS_CANVAS
}

function FocusCanvasControl({ size, onChange }: { readonly size: FocusCanvasSize; readonly onChange: (size: FocusCanvasSize) => void }) {
  const id = useId()
  return (
    <>
      <button className="btn btn--ghost btn--small focus-canvas-trigger" type="button" popoverTarget={id}>
        画布大小 <Icon name="chevron" size={14} />
      </button>
      <section id={id} className="focus-canvas-controls" popover="auto" aria-labelledby={`${id}-heading`}>
        <h2 id={`${id}-heading`}>调整画布</h2>
        {FOCUS_CANVAS_CONTROLS.map(({ label, min, max, step, unit }, index) => (
          <label className="focus-canvas-controls__field" key={label}>
            <span>{label}</span>
            <span className="focus-canvas-controls__value" aria-hidden="true">{size[index]}{unit === '%' ? unit : ` ${unit}`}</span>
            <input type="range" aria-label={label} aria-valuetext={`${size[index]}${unit === '%' ? '%' : ' 像素'}`}
              min={min} max={max} step={step} value={size[index]} onChange={(event) => {
                const next: [number, number, number] = [...size]
                next[index] = event.currentTarget.valueAsNumber
                onChange(next)
              }} />
          </label>
        ))}
        <div className="focus-canvas-controls__footer">
          <p>只改变编辑视图，不影响复制和发布。</p>
          <button className="btn btn--secondary btn--small" type="button" onClick={() => onChange(DEFAULT_FOCUS_CANVAS)}>恢复默认</button>
        </div>
      </section>
    </>
  )
}

export interface PreviewPanelProps {
  readonly platform: PlatformDefinition
  readonly template?: WechatTemplateId
  readonly status: StudioStatus
  readonly document: RenderedDocument | null
  readonly failure: RenderFailure | null
  readonly report: TypesetReport | null
  readonly parseErrorMessage: string | null
  readonly typesetFailureReason: string | null
  /** 本次排版里成功生成的其它平台名称，用于失败说明。 */
  readonly availablePlatformNames: readonly string[]
  readonly generation?: number
  readonly sourceRevision?: number
  readonly onBodyEdit?: StudioApi['editBody']
  readonly contentBaseline?: StudioApi['contentBaseline']
  readonly hasPlatformEdits?: boolean
  readonly titleInput?: string
  readonly onTitleEdit?: StudioApi['editTitle']
  readonly patchBlockReason?: string | null
  readonly onDiscard?: () => void
  readonly focused?: boolean
  readonly onFocusChange?: (enabled: boolean) => void
  readonly renderActions?: (editAction: ReactNode, focusAction: ReactNode, editing: boolean, templateBlockReason: string | null) => ReactNode
  readonly compatibilityWarnings?: readonly CompatWarning[]
  readonly onLocateSource?: (location: CompatibilityLocation) => boolean
  readonly publishReview?: ReactNode
  readonly onImageError?: (src: string) => void
  readonly deepSeekConfig?: DeepSeekConfig | null
  readonly aiRevision?: number
  readonly onOpenAiSettings?: () => void
}

/**
 * 预览区：空稿引导 / 排版中 / 单平台失败 / 输出过期 / 未验证声明都在这里落地。
 * 成稿工具留在正文滚动区外；预览只显示已排版或编辑后的正文。
 */
export function PreviewPanel({
  platform,
  template,
  status,
  document,
  failure,
  report,
  parseErrorMessage,
  typesetFailureReason,
  availablePlatformNames,
  onImageError,
  onBodyEdit,
  generation = 0,
  sourceRevision = 0,
  contentBaseline = null,
  hasPlatformEdits = false,
  titleInput = '',
  onTitleEdit,
  patchBlockReason = null,
  onDiscard,
  focused = false,
  onFocusChange,
  renderActions,
  compatibilityWarnings = NO_WARNINGS,
  onLocateSource,
  publishReview,
  deepSeekConfig,
  aiRevision = 0,
  onOpenAiSettings,
}: PreviewPanelProps) {
  const parseReason = report?.parseError ?? parseErrorMessage
  const isStale = status === 'stale'
  const canvas = useRef<HTMLDivElement>(null)
  const [aiLocatorHost, setAiLocatorHost] = useState<HTMLDivElement | null>(null)
  const [checkReset, setCheckReset] = useState(0)
  const [focusCanvas, setFocusCanvas] = useState(loadFocusCanvas)
  const [focusWidth, focusHeight, focusZoom] = focusCanvas
  const focusStyle = focused ? {
    '--focus-canvas-width': `${focusWidth}px`,
    '--focus-canvas-height': focusHeight / 100,
    '--focus-canvas-zoom': focusZoom / 100,
  } as CSSProperties : undefined

  function changeFocusCanvas(next: FocusCanvasSize) {
    setFocusCanvas(next)
    try {
      window.localStorage.setItem(FOCUS_CANVAS_KEY, next.join(','))
    } catch {
      // The current page can still use the chosen size without local storage.
    }
  }

  const canCheck = status === 'typeset' && failure === null && typesetFailureReason === null

  function locateCompatibility(warning: CompatWarning): LocateFeedback {
    const article = canvas.current?.querySelector('#platform-article')
    if (article) {
      const { ranges, images } = compatibilityTargets(article, warning.locations ?? [])
      if (ranges[0]) {
        locateRange(ranges[0])
        return { status: 'located' }
      }
      if (images[0]) {
        images[0].scrollIntoView({ block: 'center' })
        return { status: 'located' }
      }
    }
    const source = warning.locations?.some((location) => onLocateSource?.(location)) ?? false
    return source
      ? { status: 'located' }
      : { status: 'unavailable', message: '当前无法可靠定位，请按原文片段查找。' }
  }

  function renderLayout({ action, focusAction, tools, article, editing, templateBlockReason = null }: ArticleLayout) {
    const isEditing = Boolean(editing || focused)
    const capabilityNote = focused ? null : (
      <p className="capability-note" data-evidence={platform.capabilityEvidence}>
        <Icon name="info" />
        {platform.capabilityEvidence === 'pending-user-trial'
          ? `该平台能力未经真实后台验证，待你试用：把正文粘贴到${platform.name}的${platform.articleLabel}编辑器后，请在平台的预览或草稿里核对一次。`
          : '该平台能力已由维护者按真实后台的试用记录确认；平台改版后仍建议核对一次。'}
      </p>
    )
    return (
      <>
        {renderActions?.(action, focusAction, isEditing, templateBlockReason)}
        {tools}
        <section className="preview" style={focusStyle} aria-label={`${platform.name}预览`}>
          {document && compatibilityWarnings.length ? (
            <CompatibilityList
              key={`${platform.id}-${generation}`}
              platformName={platform.name}
              warnings={compatibilityWarnings}
              onLocate={canCheck ? locateCompatibility : undefined}
            />
          ) : null}
          <div className="preview__notices">
            {isStale && report?.typesetAt ? (
              <p className="preview-banner" data-tone="quiet">
                <Icon name="clock" />
                原稿配图已更新 · 重新排版后可复制。当前显示的是 {formatClock(report.typesetAt)} 生成的上一版输出，复制保持禁用。
              </p>
            ) : null}
            {status === 'typesetting' ? (
              <p className="preview-banner" data-tone="info" role="status">
                <Icon name="refresh" className="preview-banner__spin" />
                正在生成六个版本，下方仍是上一版输出，完成后自动更新。
              </p>
            ) : null}
          </div>

          <div className="ai-locator-host" ref={setAiLocatorHost} />
          <div
            className="preview__scroll"
            tabIndex={0}
            role="group"
            aria-label={`${platform.name}成稿预览画布，可滚动`}
          >
            {publishReview}
            {status === 'empty' ? (
              <div className="preview-empty">
                <Icon name="file" size={28} className="preview-empty__icon" />
                <h2 className="preview-empty__title">左侧还没有源稿</h2>
                <p className="preview-empty__text">
                  把 Markdown 粘贴到左侧源稿框，或点「导入 .md」选择本地文件。导入和排版在浏览器内完成，不会上传到任何服务器。AI 检查需另行启用。
                </p>
                <p className="preview-empty__hint">排版快捷键：Ctrl / ⌘ + Enter</p>
              </div>
            ) : null}

            {status === 'ready' ? (
              <div className="preview-empty">
                <Icon name="file" size={28} className="preview-empty__icon" />
                <h2 className="preview-empty__title">源稿已就绪，还没有生成成稿</h2>
                <p className="preview-empty__text">
                  点右上角「一键排版」，一次生成六个平台的正文。随后可在右侧选择平台，点击「编辑正文」或直接复制。
                </p>
              </div>
            ) : null}

            {parseReason !== null && status !== 'empty' ? (
              <div className="preview-failure" data-tone="danger">
                <p className="preview-failure__title">
                  <Icon name="alert" />
                  源稿无法解析，六个平台都没有生成
                </p>
                <p className="preview-failure__reason">原因：{parseReason}</p>
                <p className="preview-failure__next">
                  下一步：检查是不是有未闭合的代码块或表格分隔行。修好原稿后重新导入，再点「一键排版」。
                </p>
              </div>
            ) : null}

            {parseReason === null && typesetFailureReason !== null ? (
              <div className="preview-failure" data-tone="danger">
                <p className="preview-failure__title">
                  <Icon name="alert" />
                  这次排版没有完成
                </p>
                <p className="preview-failure__reason">原因：{typesetFailureReason}</p>
                <p className="preview-failure__next">
                  下一步：再点一次「一键排版」；如果仍失败，可修正原稿后重新导入再试。
                </p>
              </div>
            ) : null}

            {parseReason === null && failure !== null ? (
              <div className="preview-failure" data-tone="danger">
                <p className="preview-failure__title">
                  <Icon name="alert" />
                  「{platform.name}」本次没有生成成功
                </p>
                <p className="preview-failure__reason">失败原因：{failure.reason}</p>
                <p className="preview-failure__next">
                  其它平台仍然可用：
                  {availablePlatformNames.length > 0
                    ? availablePlatformNames.join('、')
                    : '暂无成功平台'}
                  。切换到这些平台可以正常复制；这个平台可以按上面的原因调整源稿后重新排版。
                </p>
              </div>
            ) : null}

            {article && document ? (
              <div
                ref={canvas}
                className="preview-canvas"
                data-platform={platform.id}
                data-article-template={template}
                data-editing={isEditing}
                data-dimmed={status === 'typesetting' ? 'true' : 'false'}
              >
                <ArticleCheck
                  key={`${generation}:${sourceRevision}:${checkReset}:${platform.id}:${template}:${canCheck}:${aiRevision}`}
                  bodyHtml={document.html}
                  titleText={document.title}
                  config={deepSeekConfig}
                  onOpenSettings={onOpenAiSettings}
                  enabled={canCheck}
                  baseline={contentBaseline}
                  locatorHost={aiLocatorHost}
                  inEditor={Boolean(editing)}
                  warnings={canCheck ? compatibilityWarnings : NO_WARNINGS}
                />
                {editing && onTitleEdit ? (
                  <div className="field article-title-field">
                    <label className="field__label" htmlFor="platform-article-title">当前平台标题</label>
                    <input
                      className="field__input"
                      id="platform-article-title"
                      type="text"
                      value={titleInput}
                      onChange={(event) => onTitleEdit(event.currentTarget.value)}
                      placeholder="填写当前平台的标题（可留空）"
                    />
                  </div>
                ) : document.title === null ? null : (
                  <h2 className="article-title" style={{ fontFamily: DEFAULT_ARTICLE_FONT }}>{document.title}</h2>
                )}
                {article}
                {document.title === null ? null : (
                  <p className="preview-canvas__note">
                    标题单独显示、单独复制，不包含在正文里。
                  </p>
                )}
              </div>
            ) : null}

            {status === 'typesetting' && document === null ? (
              <div className="preview-loading" role="status">
                <Icon name="refresh" className="preview-banner__spin" size={20} />
                正在生成六个版本…
              </div>
            ) : null}

            {isEditing ? capabilityNote : null}
          </div>

          {isEditing ? null : capabilityNote}
        </section>
      </>
    )
  }

  if (!document) return renderLayout({})

  const canEdit = status === 'typeset' && failure === null && patchBlockReason === null
  return (
    <EditableArticle
      key={`${platform.id}-${generation}`}
      document={document}
      template={template}
      onEdit={canEdit ? onBodyEdit : undefined}
      onImageError={onImageError}
      hasPlatformEdits={hasPlatformEdits}
      onDiscard={status === 'typesetting' || !onDiscard ? undefined : () => {
        onDiscard()
        setCheckReset((previous) => previous + 1)
      }}
      focused={focused}
      onFocusChange={onFocusChange}
      focusCanvasControl={focused ? <FocusCanvasControl size={focusCanvas} onChange={changeFocusCanvas} /> : null}
      renderLayout={renderLayout}
    />
  )
}
