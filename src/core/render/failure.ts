import type { PlatformId, PlatformRenderOutcome } from '../types'
import { describeError } from './html'

/**
 * 单平台渲染失败的统一构造。
 * document.ts（适配器内部兜底）与 typeset.ts（管线兜底）共用一份，避免两处各写一遍失败对象。
 */
export function renderFailure(platform: PlatformId, error: unknown): PlatformRenderOutcome {
  return {
    ok: false,
    failure: {
      platform,
      code: 'render',
      reason: describeError(error),
    },
  }
}
