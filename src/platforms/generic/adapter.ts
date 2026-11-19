import type {
  CapabilityEvidence,
  ParsedDocument,
  PlatformCapabilities,
  PlatformDefinition,
  PlatformId,
  PlatformRenderOutcome,
  RenderContext,
} from '@/core/types'
import { renderDocument } from '@/core/render/document'
import { resolveArticleTheme } from '@/platforms/wechat/theme'

/**
 * 五个平台的通用适配器。
 *
 * 结构差异来自 capabilities；呈现方式由模板按平台选择。
 */
export interface GenericPlatformConfig {
  readonly id: PlatformId
  readonly name: string
  readonly shortName: string
  readonly articleLabel: string
  readonly entryUrl: string
  readonly capabilities: PlatformCapabilities
  /** 未提供时统一记为待用户试用：首版没有对任何平台做过真实后台验证。 */
  readonly capabilityEvidence?: CapabilityEvidence
}

export function createGenericPlatform(config: GenericPlatformConfig): PlatformDefinition {
  const capabilities = config.capabilities

  return {
    id: config.id,
    name: config.name,
    shortName: config.shortName,
    articleLabel: config.articleLabel,
    entryUrl: config.entryUrl,
    capabilities,
    capabilityEvidence: config.capabilityEvidence ?? 'pending-user-trial',
    render(parsed: ParsedDocument, context: RenderContext): PlatformRenderOutcome {
      return renderDocument({
        parsed,
        context,
        platform: config.id,
        capabilities,
        theme: resolveArticleTheme(context.template, config.id),
      })
    },
  }
}
