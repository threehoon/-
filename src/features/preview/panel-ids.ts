import type { PlatformId } from '@/core/types'

export const ARTICLE_CHECK_FORM_ID = 'article-check-form'
export const ARTICLE_CHECK_DETAILS_ID = 'article-check-details'

/** 平台标签与预览面板共用的 id，保证 aria-controls / aria-labelledby 指向同一对元素。 */
export function platformTabId(id: PlatformId): string {
  return `platform-tab-${id}`
}

