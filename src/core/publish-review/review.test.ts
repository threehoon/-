import { describe, expect, it, vi } from 'vitest'
import { PLATFORM_IDS, type PlatformId, type RenderedDocument } from '@/core/types'
import { getPublishPolicy } from './policies'
import { reviewPublishDocument } from './review'

function article(platform: PlatformId, title: string | null, html: string): RenderedDocument {
  return { platform, title, html, plainText: '', warnings: [], stats: { blocks: 0, characters: 0 } }
}

const OFFICIAL_HOSTS = {
  wechat: 'weixin.qq.com', toutiao: 'toutiao.com', sohu: 'sohu.com',
  baijiahao: 'baidu.com', zhihu: 'zhihu.com', qq: 'om.qq.com',
} satisfies Record<PlatformId, string>

describe('发布规则与本地预检', () => {
  it.each(PLATFORM_IDS)('%s 提供本平台官方正文来源和人工核对项', (platform) => {
    const policy = getPublishPolicy(platform)
    expect(policy.sources.some((source) => source.access === 'public-text')).toBe(true)
    expect(policy.manualChecks.length).toBeGreaterThan(0)
    for (const source of policy.sources) {
      const url = new URL(source.url)
      const host = OFFICIAL_HOSTS[platform]
      expect(url.protocol).toBe('https:')
      expect(url.hostname === host || url.hostname.endsWith(`.${host}`)).toBe(true)
    }
  })

  it('读实际成稿的标题和可见文字，跨行内标签匹配而不跨段，跳过图片、代码块和脚本', () => {
    const html = `<section><p>欢迎参加活动。</p><div><p>转<strong>发</strong>后领取资料。</p>
      <p>转发后</p><p>领取其他资料。</p><pre>稳赚不赔</pre><script>包治百病</script>
      <img src="https://example.test/image.webp" alt="稳赚不赔"><hr></div></section>`
    expect(reviewPublishDocument(article('wechat', '震惊！活动公布', html))).toEqual({
      status: 'reviewed', findings: [
        { rule: 'clickbait', location: '标题', excerpt: '震惊！活动公布' },
        { rule: 'engagement', location: '正文第 2 个文字块', excerpt: '转发后领取资料。' },
      ],
    })
  })

  it('腾讯社交账号和百家格式规则只应用到对应平台', () => {
    const html = '<p>QQ号：12345678</p><p>✅ 活动说明</p>'
    for (const platform of PLATFORM_IDS) {
      expect(reviewPublishDocument(article(platform, null, html))).toMatchObject({
        status: 'reviewed', findings: platform === 'qq' ? [{ rule: 'qqContact' }]
          : platform === 'baijiahao' ? [{ rule: 'baijiaFormat' }] : [],
      })
    }
  })

  it.each([
    ['privacy', '个人手机号：13800000000'],
    ['claims', '保证盈利'],
    ['repost', '无授权转载'],
    ['sourcing', '据网传消息'],
    ['promotion', '添加客服微信领取课程'],
  ])('提示 %s 的具体片段', (rule, text) => {
    expect(reviewPublishDocument(article('toutiao', null, `<p>${text}</p>`))).toEqual({
      status: 'reviewed', findings: [{ rule, location: '正文第 1 个文字块', excerpt: text }],
    })
  })

  it('长段摘录保留命中上下文而不是只显示段落开头', () => {
    const text = `${'前文'.repeat(100)}转发后领取资料${'后文'.repeat(100)}`
    const result = reviewPublishDocument(article('wechat', null, `<p>${text}</p>`))
    expect(result.status).toBe('reviewed')
    expect(result.status === 'reviewed' ? result.findings[0]?.excerpt : undefined).toMatch(/^….*转发后领取资料.*…$/u)
  })

  it('只含常规资料外链或空稿不会当成疑似风险', () => {
    expect(reviewPublishDocument(article('sohu', null, '<p>参阅<a href="https://example.test/reader">读者说明</a>。</p>'))).toEqual({ status: 'reviewed', findings: [] })
    expect(reviewPublishDocument(article('wechat', null, ''))).toEqual({ status: 'reviewed', findings: [] })
  })

  it('浏览器解析失败不会返回未发现风险', () => {
    vi.spyOn(document, 'createElement').mockImplementationOnce(() => { throw new Error('无法读取成稿') })
    expect(reviewPublishDocument(article('wechat', null, '正文'))).toEqual({ status: 'unavailable' })
  })
})
