import type { ReactNode, SVGProps } from 'react'

/**
 * 统一 1.5px 描边的内联图标。只用描边路径，不用 emoji 或 Unicode 符号，
 * 颜色跟随 currentColor，尺寸由 CSS 控制。
 */
export type IconName =
  | 'copy'
  | 'check'
  | 'alert'
  | 'info'
  | 'chevron'
  | 'upload'
  | 'external'
  | 'image'
  | 'clock'
  | 'refresh'
  | 'file'
  | 'close'
  | 'edit'

const SHAPES: Record<IconName, ReactNode> = {
  copy: (
    <>
      <path d="M9.5 2.5H5A1.5 1.5 0 0 0 3.5 4v6.5" />
      <rect x="6.5" y="5.5" width="7" height="8" rx="1.5" />
    </>
  ),
  check: <path d="M3.5 8.4l3 3 6-6.8" />,
  alert: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5.2v3.6" />
      <path d="M8 10.7v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7.4v3.4" />
      <path d="M8 5.3v.1" />
    </>
  ),
  chevron: <path d="M4.5 6.5L8 10l3.5-3.5" />,
  upload: (
    <>
      <path d="M8 10.5V3.5" />
      <path d="M5 6.5L8 3.5l3 3" />
      <path d="M3.5 11.2v.8a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5v-.8" />
    </>
  ),
  external: (
    <>
      <path d="M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7A1.5 1.5 0 0 0 12.5 12V9.5" />
      <path d="M9.2 3.5h3.3v3.3" />
      <path d="M12.2 3.8L7.5 8.5" />
    </>
  ),
  image: (
    <>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
      <circle cx="5.8" cy="6.8" r="0.9" />
      <path d="M3 11.5l3.4-2.9 2.2 2 1.6-1.4 2.3 2.1" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2.1 1.2" />
    </>
  ),
  refresh: (
    <>
      <path d="M12.9 6.6A5 5 0 1 0 13 9.4" />
      <path d="M13.2 3.3v3.5h-3.5" />
    </>
  ),
  file: (
    <>
      <path d="M9.3 2.5H5A1.5 1.5 0 0 0 3.5 4v8A1.5 1.5 0 0 0 5 13.5h6A1.5 1.5 0 0 0 12.5 12V5.7z" />
      <path d="M9.3 2.5v3.2h3.2" />
    </>
  ),
  edit: <path d="M10.5 3.5l2 2m-9 7 2.8-.6 7-7a1.4 1.4 0 0 0-2-2l-7 7-.8 2.6Z" />,
  close: <path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8" />,
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  readonly name: IconName
  readonly size?: number
}

export function Icon({ name, size = 16, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {SHAPES[name]}
    </svg>
  )
}
