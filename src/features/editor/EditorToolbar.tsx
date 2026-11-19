import { EDITOR_FONTS, FONT_SIZE_GROUPS, type ActiveTypography } from './typography'

const groups = [
  [
    ['bold', '加粗', 'M6 4h6a4 4 0 0 1 0 8H6m0 0h7a4 4 0 0 1 0 8H6V4'],
    ['italic', '斜体', 'M10 4h8M6 20h8m1-16L9 20'],
    ['strike', '删除线', 'M4 12h16M17 6c-2-3-9-3-10 1-1 3 2 3 5 4m0 2c5 1 6 4 3 6-2 2-7 1-9-1'],
    ['underline', '下划线', 'M6 4v8a6 6 0 0 0 12 0V4M5 21h14'],
    ['highlight', '高亮', 'm4 16 8-11 6 4-8 11H4zm4-3 6 4M15 21h6'],
  ],
  [
    ['link', '插入链接', 'm10 13 4-4m-2-1 3-3a4 4 0 0 1 6 6l-3 3m-6 2-3 3a4 4 0 0 1-6-6l3-3'],
    ['image', '插入图片', 'M3 4h18v16H3zm0 12 5-5 4 4 4-4 5 5M16 8h.01'],
    ['code', '代码', 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16'],
  ],
  [
    ['quote', '引用', 'M4 6h6v6c0 4-2 6-5 7m9-13h6v6c0 4-2 6-5 7M4 6v6h6m4-6v6h6'],
    ['bullets', '无序列表', 'M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01'],
    ['numbers', '有序列表', 'M10 6h11m-11 6h11m-11 6h11M3 5l2-1v5m-2 0h4m-4 5c0-2 4-2 4 0 0 2-4 2-4 5h4'],
    ['table', '插入表格', 'M3 4h18v16H3zm0 6h18M3 15h18M12 4v16'],
    ['rule', '分隔线', 'M4 12h16'],
  ],
] as const

type HeadingCommand = 'paragraph' | 'h1' | 'h2' | 'h3'
export type EditorCommand = HeadingCommand | (typeof groups)[number][number][0]

interface EditorToolbarProps {
  readonly label: string
  readonly disabled?: boolean
  readonly onCommand: (command: EditorCommand) => void
  readonly onFontFamily: (family: string) => void
  readonly onFontSize: (size: number) => void
  readonly typography: ActiveTypography
}

export function EditorToolbar({ label, disabled = false, onCommand, onFontFamily, onFontSize, typography }: EditorToolbarProps) {
  const { fontId, size } = typography
  const numericSize = Number(size)
  const customSize = size !== '' && !FONT_SIZE_GROUPS.some(({ values }) => values.includes(numericSize))
  return (
    <div className="editor-tools" role="group" aria-label={label}>
      <select
        className="editor-tools__select"
        aria-label="段落与标题级别"
        value=""
        disabled={disabled}
        onChange={(event) => {
          const command = event.currentTarget.value
          if (command === 'paragraph' || command === 'h1' || command === 'h2' || command === 'h3') onCommand(command)
        }}
      >
        <option value="" disabled>标题</option>
        <option value="paragraph">普通段落</option>
        <option value="h1">一级标题</option>
        <option value="h2">二级标题</option>
        <option value="h3">三级标题</option>
      </select>
      <div className="editor-tools__group editor-tools__typography">
        <select
          className="editor-tools__select"
          aria-label="字体"
          value={fontId}
          disabled={disabled}
          onChange={(event) => {
            const font = EDITOR_FONTS.find(({ id }) => id === event.currentTarget.value)
            if (font) onFontFamily(font.family)
          }}
        >
          <option value="" disabled>字体</option>
          {EDITOR_FONTS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
        </select>
        <select
          className="editor-tools__select"
          aria-label="字号"
          aria-describedby="article-edit-hint"
          value={size}
          disabled={disabled}
          onChange={(event) => onFontSize(Number(event.currentTarget.value))}
        >
          <option value="" disabled>字号</option>
          {customSize ? <option value={size} disabled>{size} px</option> : null}
          {FONT_SIZE_GROUPS.map(({ label, values }) => (
            <optgroup key={label} label={label}>
              {values.map((size) => <option key={size} value={size}>{size} px</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      {groups.map((group) => (
        <div className="editor-tools__group" key={group[0][0]}>
          {group.map(([command, name, path]) => (
            <button
              className="editor-tools__button"
              type="button"
              key={command}
              aria-label={name}
              title={name}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onCommand(command)}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
