import type { Root } from 'mdast'

/**
 * 六个首版平台的稳定标识。新增平台必须先在此登记，并同步 `src/platforms/registry.ts`。
 */
export type PlatformId = 'wechat' | 'toutiao' | 'sohu' | 'baijiahao' | 'zhihu' | 'qq'

export type WechatTemplateId = 'classic' | 'airy' | 'brief' | 'editorial' | 'warm' | 'technical'

export const PLATFORM_IDS = [
  'wechat',
  'toutiao',
  'sohu',
  'baijiahao',
  'zhihu',
  'qq',
] as const satisfies readonly PlatformId[]

/** 目标平台对某一类 Markdown 结构是否能原样保留。 */
export type RetentionMode = 'keep' | 'degrade'

export interface PlatformCapabilities {
  /** 富文本表格：keep 保留 <table>，degrade 转成「列名：值」段落。 */
  readonly tables: RetentionMode
  /** 围栏代码块：degrade 时保留原文与换行的等宽文本块。 */
  readonly codeBlocks: RetentionMode
  /** 行内代码：degrade 时去掉底色，仅保留等宽文本。 */
  readonly inlineCode: RetentionMode
  /** 图片：degrade 时输出补插标记与说明，不输出可能失效的 <img>。 */
  readonly images: RetentionMode
  /** 外链：degrade 时只保留链接文字，并在兼容性提示中给出原地址。 */
  readonly links: RetentionMode
  /** 引用块：degrade 时退化为普通段落，保留文字与顺序。 */
  readonly blockquotes: RetentionMode
  /** 该平台可信赖的最深标题层级，超出层级降级为加粗小标题。 */
  readonly maxHeadingLevel: 2 | 3 | 4 | 5 | 6
}

export interface ParsedDocument {
  /** mdast 语法树，平台适配器只读遍历，不得原地改写。 */
  readonly root: Root
  /** AST 的字符偏移以正文为起点；加上此值才对应原始源稿。 */
  readonly bodyOffset?: number
  /** 原稿中被提取为文章标题的首块起点；没有提取时缺省。 */
  readonly leadingTitleOffset?: number
  /** 原文标题候选（未叠加用户手动填写值）。 */
  readonly title: TitleCandidate
  readonly stats: DocumentStats
  readonly frontmatter: Readonly<Record<string, unknown>> | null
}

export interface TitleCandidate {
  readonly value: string | null
  /** 标题来源，用于界面说明；`none` 表示无法提取，需要手动填写。 */
  readonly from: 'frontmatter' | 'first-heading' | 'none'
}

export interface DocumentStats {
  /** 正文字符数（不含 Markdown 标记与首部标题行）。 */
  readonly characters: number
  readonly blocks: number
}

/** 图片地址的解析结果。本地图片必须由用户显式配对，插件不假设浏览器能读目录。 */
export type ResolvedAsset =
  | { readonly kind: 'remote'; readonly url: string }
  | { readonly kind: 'bound'; readonly url: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'blocked'; readonly reason: string }

export interface AssetRegistry {
  resolve(rawPath: string): ResolvedAsset
}

export interface RenderContext {
  readonly assets: AssetRegistry
  readonly template?: WechatTemplateId
  /** 用户手动填写的标题，优先级高于自动提取结果。 */
  readonly titleOverride: string | null
}

export type WarningKind =
  | 'table'
  | 'code'
  | 'image'
  | 'link'
  | 'raw-html'
  | 'heading'
  | 'blockquote'

/** `blocker` 表示该内容在目标平台无法自动保留，复制前必须让用户看到。 */
export type WarningSeverity = 'info' | 'attention' | 'blocker'

export interface SourceSpan {
  readonly start: number
  readonly end: number
}

export type CompatibilityLocation =
  | { readonly kind: 'block'; readonly span: SourceSpan }
  | { readonly kind: 'source'; readonly span: SourceSpan; readonly block: SourceSpan }
  | { readonly kind: 'image'; readonly index: number }

export interface CompatWarning {
  readonly id: string
  readonly kind: WarningKind
  readonly severity: WarningSeverity
  /** 现象描述，例如「表格已转为 4 组『列名：值』段落」。 */
  readonly message: string
  /** 用户可采取的动作。 */
  readonly action: string
  /** 原文片段，便于用户在源稿中定位。 */
  readonly excerpt: string
  /** 排版时记录的位置，图片加载失败时使用当前成稿的图片序号。 */
  readonly locations?: readonly CompatibilityLocation[]
}

export interface RenderedDocument {
  readonly platform: PlatformId
  /** 剥离首标题后用于「复制标题」的纯文本，可能为 null。 */
  readonly title: string | null
  /** 可粘贴的富文本正文片段。 */
  readonly html: string
  /** 纯文本兜底内容，与 html 同源。 */
  readonly plainText: string
  readonly warnings: readonly CompatWarning[]
  readonly stats: DocumentStats
}

export interface RenderFailure {
  readonly platform: PlatformId
  readonly code: 'render'
  readonly reason: string
}

export type PlatformRenderOutcome =
  | { readonly ok: true; readonly document: RenderedDocument }
  | { readonly ok: false; readonly failure: RenderFailure }

/**
 * 能力声明的证据等级。首版不访问、不登录任何平台，所有平台均从
 * `pending-user-trial` 起步；用户实测后由维护者改为 `user-verified` 并记录日期。
 */
export type CapabilityEvidence = 'pending-user-trial' | 'user-verified'

export interface PlatformDefinition {
  readonly id: PlatformId
  readonly name: string
  readonly shortName: string
  /** 平台内的文章类型，例如「图文正文」「专栏文章（非回答）」。 */
  readonly articleLabel: string
  readonly entryUrl: string
  readonly capabilities: PlatformCapabilities
  readonly capabilityEvidence: CapabilityEvidence
  render(parsed: ParsedDocument, context: RenderContext): PlatformRenderOutcome
}

export interface TypesetRequest {
  readonly markdown: string
  readonly titleOverride: string | null
  readonly assets: AssetRegistry
  readonly platformTemplates?: Readonly<Partial<Record<PlatformId, WechatTemplateId>>>
}

export interface PlatformResult {
  readonly platform: PlatformId
  readonly outcome: PlatformRenderOutcome
}

export interface TypesetReport {
  readonly title: string | null
  /** 源稿可正常解析时的时间戳毫秒值；解析失败时为 null。 */
  readonly typesetAt: number | null
  readonly results: readonly PlatformResult[]
  readonly stats: DocumentStats
  /** 解析失败的整体原因；此时 results 为空。 */
  readonly parseError: string | null
  readonly durationMs: number
}

export type CopyResult =
  | { readonly ok: true; readonly mode: 'rich-text' | 'plain-text' }
  | { readonly ok: false; readonly reason: string; readonly manualText: string }
