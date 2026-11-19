import type {
  ParsedDocument,
  PlatformCapabilities,
  PlatformDefinition,
  PlatformRenderOutcome,
  RenderContext,
} from '@/core/types'
import { renderDocument } from '@/core/render/document'
import { resolveArticleTheme } from './theme'

/**
 * 微信公众号：使用共享排版主题，保留公众号自己的能力声明。
 *
 * 能力声明按首版保守估计：公众号编辑器对 h1–h4 之外的标题、表格与代码块支持不稳定，
 * 因此最深标题定为 4 级；其余结构按「保留」声明，实际后台表现待用户试用确认。
 */
const WECHAT_CAPABILITIES: PlatformCapabilities = {
  tables: 'keep',
  codeBlocks: 'keep',
  inlineCode: 'keep',
  images: 'keep',
  links: 'keep',
  blockquotes: 'keep',
  maxHeadingLevel: 4,
}

export function createWechatPlatform(): PlatformDefinition {
  return {
    id: 'wechat',
    name: '微信公众号',
    shortName: '公众号',
    articleLabel: '图文正文',
    entryUrl: 'https://mp.weixin.qq.com/',
    capabilities: WECHAT_CAPABILITIES,
    capabilityEvidence: 'pending-user-trial',
    render(parsed: ParsedDocument, context: RenderContext): PlatformRenderOutcome {
      return renderDocument({
        parsed,
        context,
        platform: 'wechat',
        capabilities: WECHAT_CAPABILITIES,
        theme: resolveArticleTheme(context.template, 'wechat'),
      })
    },
  }
}
