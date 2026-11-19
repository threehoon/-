import type {
  ParsedDocument,
  PlatformId,
  PlatformRenderOutcome,
  RenderContext,
  PlatformCapabilities,
} from '../types'
import { renderBlocks } from './blocks'
import { renderFailure } from './failure'
import { styleAttribute } from './html'
import type { RenderTheme } from './theme'
import { ARTICLE_SOURCE_ATTR, sourceAttribute } from './source-markers'

/**
 * 把「解析结果 + 主题 + 能力」拼成某个平台的成稿。
 * 适配器只需要提供 id / capabilities / theme，渲染逻辑与平台名无关。
 */
export interface RenderDocumentInput {
  readonly parsed: ParsedDocument
  readonly context: RenderContext
  readonly platform: PlatformId
  readonly capabilities: PlatformCapabilities
  readonly theme: RenderTheme
}

export function renderDocument(input: RenderDocumentInput): PlatformRenderOutcome {
  try {
    const body = renderBlocks({
      root: input.parsed.root,
      theme: input.theme,
      capabilities: input.capabilities,
      assets: input.context.assets,
      sourceOffset: input.parsed.bodyOffset,
    })

    const override = (input.context.titleOverride ?? '').trim()
    const title = override.length > 0 ? override : input.parsed.title.value
    const wrapper = input.theme.wrapperTag
    const marker = input.parsed.bodyOffset === undefined ? '' : sourceAttribute(ARTICLE_SOURCE_ATTR, '')
    const html = body.html === '' ? '' : `<${wrapper}${styleAttribute(input.theme.container)}${marker}>${body.html}</${wrapper}>`

    return {
      ok: true,
      document: {
        platform: input.platform,
        title,
        html,
        plainText: body.plainText,
        warnings: body.warnings,
        stats: input.parsed.stats,
      },
    }
  } catch (error) {
    return renderFailure(input.platform, error)
  }
}
