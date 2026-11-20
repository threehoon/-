import type {
  AssetRegistry,
  CopyResult,
  ParsedDocument,
  PlatformDefinition,
  TypesetRequest,
  TypesetReport,
} from '@/core/types'

/**
 * 界面与核心排版层之间的唯一接缝。
 *
 * 界面只依赖这个接口：`src/app/core-ports.ts` 把真实核心模块接进来，
 * 测试可以注入替身，因此状态机与组件测试不需要先实现排版算法。
 */
export interface CopyPayload {
  readonly html: string
  readonly plainText: string
}

export interface StudioPorts {
  /** 解析失败时抛出 `Error`，由界面捕获并说明原因。 */
  parse(markdown: string): ParsedDocument
  typeset(input: TypesetRequest, onlyPlatform?: PlatformDefinition | readonly PlatformDefinition[]): TypesetReport
  createAssets(entries: Readonly<Record<string, string>>): AssetRegistry
  copyRichText(payload: CopyPayload): Promise<CopyResult>
  /** 列出源稿里出现的图片原始路径，用于本地配对清单。 */
  collectImages(parsed: ParsedDocument): readonly string[]
}
