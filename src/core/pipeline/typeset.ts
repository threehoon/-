import { PLATFORMS } from '@/platforms/registry'
import type {
  DocumentStats,
  ParsedDocument,
  PlatformDefinition,
  PlatformRenderOutcome,
  RenderContext,
  TypesetReport,
  TypesetRequest,
} from '../types'
import { parseDocument } from '../markdown/parse'
import { renderFailure } from '../render/failure'
import { describeError } from '../render/html'

/**
 * 一次排版：解析一遍，逐个平台渲染。
 *
 * 单平台渲染抛异常只让该平台 `ok: false`，其它平台照常产出；
 * 只有整体解析失败时 results 为空，并由 parseError 说明原因。
 * 注意：core 依赖 platforms/registry 是单向的（registry 不 import 本文件），不构成循环。
 */
export interface TypesetOptions {
  /** 测试或将来「只排部分平台」用；默认就是注册表里的六个平台。 */
  readonly platforms?: readonly PlatformDefinition[]
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

const EMPTY_STATS: DocumentStats = { characters: 0, blocks: 0 }

function safeRender(
  platform: PlatformDefinition,
  parsed: ParsedDocument,
  context: RenderContext,
): PlatformRenderOutcome {
  try {
    return platform.render(parsed, context)
  } catch (error) {
    return renderFailure(platform.id, error)
  }
}

export function typeset(request: TypesetRequest, options: TypesetOptions = {}): TypesetReport {
  const startedAt = nowMs()
  const platforms = options.platforms ?? PLATFORMS

  let parsed: ParsedDocument
  try {
    parsed = parseDocument(request.markdown)
  } catch (error) {
    return {
      title: null,
      typesetAt: null,
      results: [],
      stats: EMPTY_STATS,
      parseError: `无法解析源稿：${describeError(error)}`,
      durationMs: nowMs() - startedAt,
    }
  }

  const results = platforms.map((platform) => ({
    platform: platform.id,
    outcome: safeRender(platform, parsed, {
      assets: request.assets,
      titleOverride: request.titleOverride,
      template: request.platformTemplates?.[platform.id],
    }),
  }))

  const override = (request.titleOverride ?? '').trim()

  return {
    title: override.length > 0 ? override : parsed.title.value,
    typesetAt: Date.now(),
    results,
    stats: parsed.stats,
    parseError: null,
    durationMs: nowMs() - startedAt,
  }
}
