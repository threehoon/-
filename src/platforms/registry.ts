import type { PlatformDefinition, PlatformId } from '@/core/types'
import { createGenericPlatform } from './generic/adapter'
import { createWechatPlatform } from './wechat/adapter'

/**
 * 六平台注册表。顺序即界面切换顺序：公众号默认展示。
 * 能力声明代表首版的保守策略；未经真实后台验证，证据等级统一为待用户试用。
 */
export const PLATFORMS: readonly PlatformDefinition[] = [
  createWechatPlatform(),
  createGenericPlatform({
    id: 'toutiao',
    name: '头条号',
    shortName: '头条',
    articleLabel: '长文',
    entryUrl: 'https://mp.toutiao.com/',
    capabilities: {
      tables: 'degrade',
      codeBlocks: 'keep',
      inlineCode: 'keep',
      images: 'keep',
      links: 'keep',
      blockquotes: 'keep',
      maxHeadingLevel: 3,
    },
  }),
  createGenericPlatform({
    id: 'sohu',
    name: '搜狐号',
    shortName: '搜狐',
    articleLabel: '文章',
    entryUrl: 'https://mp.sohu.com/home?spm=smpc.channel_454.block_5_875_YYoeMk_1_fd.6.1795072260153nhjPYmf_8107',
    capabilities: {
      tables: 'keep',
      codeBlocks: 'degrade',
      inlineCode: 'degrade',
      images: 'keep',
      links: 'keep',
      blockquotes: 'keep',
      maxHeadingLevel: 3,
    },
  }),
  createGenericPlatform({
    id: 'baijiahao',
    name: '百家号',
    shortName: '百家',
    articleLabel: '图文文章',
    entryUrl: 'https://baijiahao.baidu.com/',
    capabilities: {
      tables: 'degrade',
      codeBlocks: 'degrade',
      inlineCode: 'degrade',
      images: 'keep',
      links: 'degrade',
      blockquotes: 'keep',
      maxHeadingLevel: 3,
    },
  }),
  createGenericPlatform({
    id: 'zhihu',
    name: '知乎',
    shortName: '知乎',
    articleLabel: '专栏文章（非回答）',
    entryUrl: 'https://www.zhihu.com/creator',
    capabilities: {
      tables: 'keep',
      codeBlocks: 'keep',
      inlineCode: 'keep',
      images: 'keep',
      links: 'keep',
      blockquotes: 'keep',
      maxHeadingLevel: 6,
    },
  }),
  createGenericPlatform({
    id: 'qq',
    name: '腾讯内容开放平台',
    shortName: '腾讯',
    articleLabel: '图文文章',
    entryUrl: 'https://om.qq.com/',
    capabilities: {
      tables: 'keep',
      codeBlocks: 'keep',
      inlineCode: 'keep',
      images: 'keep',
      links: 'keep',
      blockquotes: 'keep',
      maxHeadingLevel: 4,
    },
  }),
]

const BY_ID = new Map<PlatformId, PlatformDefinition>(PLATFORMS.map((p) => [p.id, p]))

/** 未登记的 id 直接抛错，避免界面静默渲染成空面板。 */
export function getPlatform(id: PlatformId): PlatformDefinition {
  const platform = BY_ID.get(id)
  if (!platform) {
    throw new Error(`未登记的平台：${id}`)
  }
  return platform
}

export const DEFAULT_PLATFORM_ID: PlatformId = 'wechat'
