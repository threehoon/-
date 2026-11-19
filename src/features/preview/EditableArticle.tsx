import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { RenderedDocument } from '@/core/types'
import type { StudioApi } from '@/app/use-studio'
import { reasonOf } from '@/app/text'
import { Icon } from '@/components/Icon'
import { inspectUrl } from '@/core/security/policy'
import { EditorToolbar, type EditorCommand } from '@/features/editor/EditorToolbar'
import { activeTypography, FontSizeHistory, runNativeTextStyle, type ActiveTypography } from '@/features/editor/typography'
import { clipboardImage, LOCAL_IMAGE_ACCEPT, readLocalImage } from './local-image'
import { editedArticleText } from './article-text'
import { ARTICLE_CHECK_FORM_ID } from './panel-ids'

const FORMATS = {
  paragraph: ['formatBlock', 'p'],
  h1: ['formatBlock', 'h1'],
  h2: ['formatBlock', 'h2'],
  h3: ['formatBlock', 'h3'],
  bold: ['bold'],
  italic: ['italic'],
  strike: ['strikeThrough'],
  underline: ['underline'],
  quote: ['formatBlock', 'blockquote'],
  bullets: ['insertUnorderedList'],
  numbers: ['insertOrderedList'],
  rule: ['insertHorizontalRule'],
} as const

const TABLE_HTML = '<table><thead><tr><th>列名一</th><th>列名二</th></tr></thead><tbody><tr><td>内容</td><td>内容</td></tr></tbody></table><p><br></p>'

export interface ArticleLayout {
  readonly action?: ReactNode
  readonly focusAction?: ReactNode
  readonly tools?: ReactNode
  readonly article?: ReactNode
  readonly editing?: boolean
}

interface ArticleProps {
  readonly document: RenderedDocument
  readonly onEdit?: StudioApi['editBody']
  readonly onImageError?: (src: string) => void
  readonly hasPlatformEdits: boolean
  readonly onDiscard?: () => void
  readonly focused: boolean
  readonly onFocusChange?: (enabled: boolean) => void
  readonly renderLayout: (parts: ArticleLayout) => ReactNode
}

interface LayoutPosition {
  readonly range: Range | null
  readonly backwards: boolean
  readonly readingAnchor: Range | null
  readonly top: number
}

function rangeIn(article: HTMLElement): Range | null {
  const selection = article.ownerDocument.getSelection()
  if (!selection?.rangeCount) return null
  const range = selection.getRangeAt(0)
  return article.contains(range.commonAncestorContainer) ? range.cloneRange() : null
}

function dropRange(article: HTMLElement, x: number, y: number): Range | null {
  const owner = article.ownerDocument
  const position = owner.caretPositionFromPoint?.(x, y)
  if (position && article.contains(position.offsetNode)) {
    const range = owner.createRange()
    range.setStart(position.offsetNode, position.offset)
    range.collapse(true)
    return range
  }
  const range = owner.caretRangeFromPoint?.(x, y)
  return range && article.contains(range.commonAncestorContainer) ? range : null
}

function imageDropInCode(range: Range): boolean {
  const origin = range.startContainer
  const element = origin instanceof Element ? origin : origin.parentElement
  return Boolean(element?.closest('pre,code'))
}

function restoreRange(article: HTMLElement, saved: Range | null, collapse = false): Range {
  const owner = article.ownerDocument
  const range = saved && article.contains(saved.commonAncestorContainer) ? saved.cloneRange() : owner.createRange()
  if (!article.contains(range.commonAncestorContainer)) {
    range.selectNodeContents(article.firstElementChild?.matches('section') ? article.firstElementChild : article)
    range.collapse(false)
  }
  if (collapse) range.collapse(false)
  article.focus({ preventScroll: true })
  const selection = owner.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return range
}

function previewScroll(article: HTMLElement): HTMLElement | null {
  return article.closest('.preview__scroll')
}

function capturePosition(article: HTMLElement, saved: Range | null): LayoutPosition {
  const scroller = previewScroll(article)
  const scrollBounds = scroller?.getBoundingClientRect()
  const selection = article.ownerDocument.getSelection()
  const current = rangeIn(article)
  const range = current ?? saved
  const backwards = Boolean(current && selection && !current.collapsed && (
    selection.anchorNode !== current.startContainer || selection.anchorOffset !== current.startOffset
  ))
  const fallback = { range, backwards, readingAnchor: null, top: scroller?.scrollTop ?? 0 }
  if (!scrollBounds) return fallback

  const canvasBounds = article.getBoundingClientRect()
  const visibleTop = Math.max(0, scrollBounds.top, canvasBounds.top)
  const visibleBottom = Math.min(scrollBounds.bottom, canvasBounds.bottom, article.ownerDocument.documentElement.clientHeight)
  if (visibleTop >= visibleBottom) return fallback

  const selectedLine = current?.cloneRange()
  selectedLine?.collapse(backwards)
  const lineRect = selectedLine?.getClientRects()[0]
  const anchor = selectedLine && lineRect && lineRect.top >= visibleTop && lineRect.bottom <= visibleBottom
    ? selectedLine
    : article.ownerDocument.caretRangeFromPoint?.(canvasBounds.left + 8, Math.min(visibleTop + 8, visibleBottom - 1))
  if (!anchor || !article.contains(anchor.commonAncestorContainer)) return fallback
  const anchorRect = anchor.getClientRects()[0]
  return anchorRect ? { range, backwards, readingAnchor: anchor, top: anchorRect.top - Math.max(0, scrollBounds.top) } : fallback
}

function restoreReadingPosition(article: HTMLElement, position: LayoutPosition) {
  const scroller = previewScroll(article)
  if (!scroller) return
  const anchorRect = position.readingAnchor?.getClientRects()[0]
  if (!anchorRect) {
    scroller.scrollTop = position.top
    return
  }
  const change = anchorRect.top - Math.max(0, scroller.getBoundingClientRect().top) - position.top
  if (scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop += change
  else if (position.top >= 0 && change !== 0) article.ownerDocument.defaultView?.scrollBy(0, change)
}

export function EditableArticle({ document, onEdit, onImageError, hasPlatformEdits, onDiscard, focused, onFocusChange, renderLayout }: ArticleProps) {
  const [editingHtml, setEditingHtml] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<{ readonly range: Range; readonly url: string } | null>(null)
  const canvas = useRef<HTMLElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const caret = useRef<Range | null>(null)
  const typographySelection = useRef<Range | null>(null)
  const [fontSizeHistory] = useState(() => new FontSizeHistory())
  const [typography, setTypography] = useState<ActiveTypography>({ fontId: '', size: '' })
  const pickerRange = useRef<Range | null>(null)
  const layoutPosition = useRef<LayoutPosition | null>(null)
  const readingImage = useRef(false)
  const composing = useRef(false)
  const endComposition = useRef<(() => void) | null>(null)
  const commanding = useRef(false)
  const lastHtml = useRef('')
  const editing = editingHtml !== null && onEdit !== undefined
  // Keep the initial markup for the lifetime of an edit session, even while temporarily read-only.
  // Reapplying the latest HTML would destroy the browser's selection, composition and undo history.
  const html = editingHtml ?? document.html
  const markup = useMemo(() => ({ __html: html }), [html])

  useLayoutEffect(() => {
    const article = canvas.current
    if (!article || editingHtml === null) return
    const position = layoutPosition.current
    layoutPosition.current = null
    if (article.getAttribute('contenteditable') === 'true') {
      // The title input stays mounted across layout changes; leave its caret alone.
      const active = article.ownerDocument.activeElement
      if (active instanceof HTMLInputElement && article.parentElement?.contains(active)) return
      article.focus({ preventScroll: true })
      const saved = position?.range
      if (saved && !composing.current && article.contains(saved.commonAncestorContainer)) {
        const selection = article.ownerDocument.getSelection()
        const [base, baseOffset, extent, extentOffset] = position.backwards
          ? [saved.endContainer, saved.endOffset, saved.startContainer, saved.startOffset] as const
          : [saved.startContainer, saved.startOffset, saved.endContainer, saved.endOffset] as const
        if (selection && (selection.anchorNode !== base || selection.anchorOffset !== baseOffset ||
          selection.focusNode !== extent || selection.focusOffset !== extentOffset)) {
          selection.setBaseAndExtent(base, baseOffset, extent, extentOffset)
        }
      }
    } else if (position) {
      previewScroll(article)?.focus({ preventScroll: true })
    }
    if (position) restoreReadingPosition(article, position)
  }, [editingHtml, focused])

  const refreshTypography = useCallback((article: HTMLElement, range: Range | null) => {
    if (composing.current) return
    const next = activeTypography(article, range)
    setTypography((previous) => previous.fontId === next.fontId && previous.size === next.size ? previous : next)
  }, [])

  function update(article: HTMLElement) {
    if (!onEdit || composing.current) return
    const nextHtml = article.innerHTML
    if (nextHtml === lastHtml.current) return
    lastHtml.current = nextHtml
    onEdit(nextHtml, editedArticleText(article))
  }

  function rememberCaret() {
    const article = canvas.current
    const range = article ? rangeIn(article) : null
    if (range) caret.current = range
  }

  function commitEdit(article: HTMLElement, operation: () => boolean): boolean {
    if (composing.current) return false
    // execCommand may fire input before returning; commit here exactly once.
    commanding.current = true
    try {
      if (!operation()) return false
    } finally {
      commanding.current = false
    }
    fontSizeHistory.onInput(article, lastHtml.current, '')
    update(article)
    rememberCaret()
    refreshTypography(article, rangeIn(article))
    return true
  }

  function runEdit(article: HTMLElement, command: string, value?: string): boolean {
    return commitEdit(article, () => article.ownerDocument.execCommand(command, false, value))
  }

  function formatTypography(change: { family: string } | { size: number }): boolean {
    const article = canvas.current
    if (!article || !editing || composing.current || readingImage.current || link) return false
    setError(null)
    const saved = article.ownerDocument.activeElement === article ? rangeIn(article) : typographySelection.current
    if (!saved || !article.contains(saved.commonAncestorContainer) || !saved.toString().trim()) {
      setError('请先选中要调整字体或字号的正文文字。')
      return false
    }
    restoreRange(article, saved)
    const applied = commitEdit(article, () => 'family' in change
      ? runNativeTextStyle(article, 'fontName', change.family)
      : fontSizeHistory.apply(article, change.size))
    if (!applied) setError('未能应用格式。请重新选中文字后再试。')
    return applied
  }

  const changeFocus = useCallback((enabled: boolean) => {
    const article = canvas.current
    if (!article || !onFocusChange || (enabled && !onEdit)) return
    layoutPosition.current = capturePosition(article, caret.current)
    if (enabled && editingHtml === null) {
      lastHtml.current = article.innerHTML
      setEditingHtml(document.html)
    }
    onFocusChange(enabled)
  }, [document.html, editingHtml, onEdit, onFocusChange])

  const closeLink = useCallback(() => {
    if (canvas.current && link) restoreRange(canvas.current, link.range)
    setError(null)
    setLink(null)
  }, [link])

  useEffect(() => () => {
    endComposition.current?.()
    endComposition.current = null
  }, [])

  useEffect(() => {
    const article = canvas.current
    if (!editing || !article) return
    const owner = article.ownerDocument
    function trackTypography() {
      if (!article) return
      refreshTypography(article, owner.activeElement === article ? rangeIn(article) : typographySelection.current)
    }
    function clearOutsideSelection(event: Event) {
      const target = event.target
      if (target instanceof Element && !article?.contains(target) && !target.closest('.editor-tools')) {
        typographySelection.current = null
        trackTypography()
      }
    }
    owner.addEventListener('focusin', clearOutsideSelection)
    // A click on non-focusable chrome can remove the selection without emitting focusin.
    owner.addEventListener('pointerup', clearOutsideSelection)
    owner.addEventListener('selectionchange', trackTypography)
    trackTypography()
    return () => {
      owner.removeEventListener('focusin', clearOutsideSelection)
      owner.removeEventListener('pointerup', clearOutsideSelection)
      owner.removeEventListener('selectionchange', trackTypography)
    }
  }, [editing, refreshTypography])

  useEffect(() => {
    if (!focused && !(editing && link)) return
    function handleEscape(event: KeyboardEvent) {
      if (event.defaultPrevented || event.key !== 'Escape' || event.isComposing || event.keyCode === 229 || composing.current) return
      // Leave Escape to the browser when a native popover is on top of the editor.
      if (window.document.querySelector(':is([popover]:popover-open)')) return
      event.preventDefault()
      if (editing && link) closeLink()
      else changeFocus(false)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [changeFocus, closeLink, editing, focused, link])

  async function insertImage(file: File, at: Range | null) {
    const article = canvas.current
    if (!article || !editing) return
    if (readingImage.current) {
      setError('正在读取上一张图片，请稍后再试。')
      return
    }
    readingImage.current = true
    setReading(true)
    setError(null)
    try {
      const src = await readLocalImage(file)
      if (article.isConnected && composing.current) {
        await new Promise<void>((resolve) => { endComposition.current = resolve })
      }
      if (!article.isConnected || article.getAttribute('contenteditable') !== 'true') return
      const owner = article.ownerDocument
      // Decoding may finish after the author has moved to another field.
      const previousFocus = owner.activeElement
      const previousCaret = rangeIn(article)
      const moved = previousFocus instanceof HTMLElement && previousFocus !== owner.body && !article.contains(previousFocus)
      const previousSelection = moved && (previousFocus instanceof HTMLTextAreaElement || previousFocus instanceof HTMLInputElement)
        ? { field: previousFocus, start: previousFocus.selectionStart, end: previousFocus.selectionEnd, direction: previousFocus.selectionDirection }
        : null
      try {
        restoreRange(article, at, true)
        const image = owner.createElement('img')
        image.src = src
        image.alt = file.name.replace(/\.[^.]+$/, '') || '粘贴图片'
        image.style.cssText = 'max-width:100%;height:auto;vertical-align:middle;'
        if (!runEdit(article, 'insertHTML', image.outerHTML)) {
          throw new Error('没有插入图片。请将光标放在正文后再试。')
        }
      } finally {
        if (moved && previousFocus.isConnected) {
          if (previousCaret) restoreRange(article, previousCaret)
          previousFocus.focus({ preventScroll: true })
          if (previousSelection?.start != null && previousSelection.end != null) {
            previousSelection.field.setSelectionRange(previousSelection.start, previousSelection.end, previousSelection.direction ?? undefined)
          }
        }
      }
    } catch (cause) {
      if (article.isConnected) setError(reasonOf(cause))
    } finally {
      readingImage.current = false
      if (article.isConnected) setReading(false)
    }
  }

  function format(command: EditorCommand) {
    const article = canvas.current
    if (!article || !editing || composing.current || readingImage.current) return
    setError(null)
    const selected = rangeIn(article) ?? caret.current
    if (command === 'image') {
      pickerRange.current = selected?.cloneRange() ?? null
      picker.current?.click()
      return
    }
    const range = restoreRange(article, selected, command === 'table' || command === 'rule')
    if (command === 'link') {
      const existing = range.startContainer.parentElement?.closest('a')
      if (range.collapsed && existing && article.contains(existing)) range.selectNodeContents(existing)
      setLink({ range: range.cloneRange(), url: existing?.getAttribute('href') ?? '' })
      return
    }
    if (command === 'highlight') {
      const color = article.ownerDocument.defaultView?.getComputedStyle(article).getPropertyValue('--warn-soft').trim()
      if (color) runEdit(article, 'hiliteColor', color)
      return
    }
    if (command === 'table') {
      runEdit(article, 'insertHTML', TABLE_HTML)
      return
    }
    if (command === 'code') {
      const element = article.ownerDocument.createElement('code')
      const text = range.toString() || '代码'
      element.textContent = text
      // Keep the typography when the output is pasted outside the app.
      element.style.fontFamily = 'monospace'
      runEdit(article, 'insertHTML', element.outerHTML)
      return
    }
    const [operation, value] = FORMATS[command]
    runEdit(article, operation, value)
  }

  function applyLink() {
    const article = canvas.current
    if (!article || !link) return
    const verdict = inspectUrl(link.url)
    if (!verdict.allowed) {
      setError(`链接不能插入：${verdict.reason}。请输入 HTTP、HTTPS 或邮箱链接。`)
      return
    }
    const range = restoreRange(article, link.range)
    if (range.collapsed) {
      const anchor = article.ownerDocument.createElement('a')
      anchor.href = verdict.url
      anchor.textContent = verdict.url
      runEdit(article, 'insertHTML', anchor.outerHTML)
    } else {
      runEdit(article, 'createLink', verdict.url)
    }
    setError(null)
    setLink(null)
  }

  const action = onEdit ? (
    <button
      type="button"
      className={`btn ${editing ? 'btn--ghost' : 'btn--secondary'}`}
      aria-controls="platform-article"
      disabled={reading}
      onClick={() => {
        setError(null)
        setLink(null)
        if (editing) {
          if (canvas.current) update(canvas.current)
          caret.current = null
          typographySelection.current = null
          fontSizeHistory.clear()
          pickerRange.current = null
          setEditingHtml(null)
        } else {
          lastHtml.current = canvas.current?.innerHTML ?? document.html
          setEditingHtml(document.html)
        }
      }}
    >
      <Icon name={editing ? 'check' : 'edit'} />
      {editing ? '完成编辑' : '编辑正文'}
    </button>
  ) : null

  const focusAction = (onEdit || focused) && onFocusChange ? (
    <button
      type="button"
      className="btn btn--secondary"
      aria-controls="platform-article"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => changeFocus(!focused)}
    >
      {focused ? '退出专注' : '专注编辑'}
    </button>
  ) : null

  const tools = editing || hasPlatformEdits ? (
    <div className="article-edit">
      {editing ? (
        <EditorToolbar
          label="成稿格式工具栏"
          disabled={reading || link !== null}
          onCommand={format}
          typography={typography}
          onFontFamily={(family) => formatTypography({ family })}
          onFontSize={(size) => formatTypography({ size })}
        />
      ) : null}
      {editing && link ? (
        <form
          className="field"
          onSubmit={(event) => {
            event.preventDefault()
            applyLink()
          }}
        >
          <label className="field__label" htmlFor="article-link-url">链接地址</label>
          <input
            autoFocus
            className="field__input"
            id="article-link-url"
            value={link.url}
            onChange={(event) => setLink({ range: link.range, url: event.currentTarget.value })}
          />
          <div className="article-edit__actions">
            <button type="submit" className="btn btn--secondary">应用链接</button>
            <button type="button" className="btn btn--ghost" onClick={closeLink}>取消</button>
          </div>
        </form>
      ) : null}
      {editing ? (
        <div className="article-edit__guide">
          <p className="article-edit__hint" id="article-edit-hint">
            {!hasPlatformEdits ? '编辑仅影响当前平台。' : null}选中文字可改字体和字号，也可拖入单张图片。
          </p>
          <button type="submit" form={ARTICLE_CHECK_FORM_ID} className="btn btn--ghost btn--small">
            一键检查内容
          </button>
        </div>
      ) : null}
      {hasPlatformEdits ? (
        <div className="article-edit__guide">
          <p className="article-edit__hint" id="article-patch-status" role="status">改动仅保留在当前平台，左侧原稿不变。</p>
          <button type="button" className="btn btn--ghost btn--small" disabled={!onDiscard || reading}
            aria-describedby="article-patch-status" onClick={onDiscard}>撤销右侧改动</button>
        </div>
      ) : null}
      <input
        ref={picker}
        type="file"
        accept={LOCAL_IMAGE_ACCEPT}
        hidden
        aria-label="选择本地图片"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          const at = pickerRange.current
          event.currentTarget.value = ''
          pickerRange.current = null
          if (file) void insertImage(file, at)
        }}
      />
      {reading ? <p className="article-edit__hint" role="status">正在读取图片…</p> : null}
      {error ? <p className="article-edit__error" role="alert">{error}</p> : null}
    </div>
  ) : null

  // Keep native HTML drops out of the editable article.
  const article = (
    <article
      id="platform-article"
      className="article"
      ref={canvas}
      contentEditable={editing || undefined}
      tabIndex={editing ? 0 : undefined}
      suppressContentEditableWarning
      role={editing ? 'textbox' : undefined}
      aria-multiline={editing ? true : undefined}
      aria-label={editing ? '成稿正文' : undefined}
      aria-describedby={editing ? 'article-edit-hint' : undefined}
      onBlur={editing ? (event) => {
        rememberCaret()
        typographySelection.current = rangeIn(event.currentTarget)
      } : undefined}
      onCompositionStart={editing ? () => { composing.current = true } : undefined}
      onCompositionEnd={(event) => {
        composing.current = false
        if (editing) update(event.currentTarget)
        endComposition.current?.()
        endComposition.current = null
      }}
      onInput={editing ? (event) => {
        if (!event.nativeEvent.isComposing && !commanding.current) {
          const article = event.currentTarget
          fontSizeHistory.onInput(article, lastHtml.current, event.nativeEvent.inputType)
          update(article)
          refreshTypography(article, rangeIn(article))
        }
      } : undefined}
      onPaste={editing ? (event) => {
        event.preventDefault()
        const image = clipboardImage(event.clipboardData)
        if (image) {
          void insertImage(image, rangeIn(event.currentTarget) ?? caret.current)
          return
        }
        const text = event.clipboardData.getData('text/plain')
        if (text) runEdit(event.currentTarget, 'insertText', text)
      } : undefined}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = editing ? 'copy' : 'none'
      }}
      onDrop={(event) => {
        if (editing || event.dataTransfer.types.includes('Files')) event.preventDefault()
        if (!editing || !event.dataTransfer.types.includes('Files')) return
        const files = event.dataTransfer.files
        if (files.length !== 1) {
          setError('一次只能拖入一张图片。')
          return
        }
        const at = dropRange(event.currentTarget, event.clientX, event.clientY)
        if (!at) {
          setError('无法定位图片的插入位置，请把图片拖到正文文字旁再试。')
          return
        }
        if (imageDropInCode(at)) {
          setError('不能在代码里插入图片，请拖到普通正文段落再试。')
          return
        }
        void insertImage(files[0], at)
      }}
      onClick={editing ? (event) => event.preventDefault() : undefined}
      onErrorCapture={(event) => {
        if (!(event.target instanceof HTMLImageElement)) return
        const src = event.target.getAttribute('src')
        if (src !== null) onImageError?.(src)
      }}
      dangerouslySetInnerHTML={markup}
    />
  )

  return renderLayout({ action, focusAction, tools, article, editing })
}
