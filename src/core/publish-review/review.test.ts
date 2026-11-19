import { describe, expect, it, vi } from 'vitest'
import { PLATFORM_IDS, type PlatformId, type RenderedDocument } from '@/core/types'
import { getPublishPolicy } from './policies'
import { reviewPublishDocument, type PublishReviewResult } from './review'
import { collectBodyUnits } from './units'

function article(platform: PlatformId, title: string | null, html: string): RenderedDocument {
  return { platform, title, html, plainText: '', warnings: [], stats: { blocks: 0, characters: 0 } }
}

/** 逐条只比规则、位置和摘录；命中偏移量另有专门用例。 */
function summarize(result: PublishReviewResult) {
  return result.status === 'reviewed'
    ? {
        status: result.status,
        findings: result.findings.map(({ rule, location, excerpt }) => ({ rule, location, excerpt })),
      }
    : { status: result.status }
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
    expect(summarize(reviewPublishDocument(article('wechat', '震惊！活动公布', html)))).toEqual({
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
          : platform === 'baijiahao' ? [{ rule: 'baijiaFormat' }]
            : platform === 'sohu' ? [{ rule: 'sohuContact' }] : [],
      })
    }
  })

  it.each([
    ['privacy', '身份证号：00000000000000000X'],
    ['contactPhone', '个人手机号：13800000000'],
    ['claims', '保证盈利'],
    ['repost', '无授权转载'],
    ['sourcing', '据网传消息'],
    ['promotion', '添加客服微信领取课程'],
  ])('提示 %s 的具体片段', (rule, text) => {
    expect(summarize(reviewPublishDocument(article('toutiao', null, `<p>${text}</p>`)))).toEqual({
      status: 'reviewed', findings: [{ rule, location: '正文第 1 个文字块', excerpt: text }],
    })
  })

  it('长段摘录保留命中上下文而不是只显示段落开头', () => {
    const text = `${'前文'.repeat(100)}转发后领取资料${'后文'.repeat(100)}`
    const result = reviewPublishDocument(article('wechat', null, `<p>${text}</p>`))
    expect(result.status).toBe('reviewed')
    expect(result.status === 'reviewed' ? result.findings[0]?.excerpt : undefined).toMatch(/^….*转发后领取资料.*…$/u)
  })

  it.each(['电话：138 0000 0000', '咨询热线：400-123-4567', '联系电话：（０１０）１２３４５６７８', '手机：+86 138\u00a00000-0000'])('各平台提示带联系标签的号码 %s', (text) => {
    for (const platform of PLATFORM_IDS) {
      expect(summarize(reviewPublishDocument(article(platform, null, `<p>${text}</p>`)))).toEqual({
        status: 'reviewed', findings: [{ rule: 'contactPhone', location: '正文第 1 个文字块', excerpt: text.replace(/\s+/gu, ' ') }],
      })
    }
  })

  it('搜狐对分段电话、站外网址和服务联系号召分别报出命中位置', () => {
    const html = '<p>找某老师做管理陪跑，让企业更高效。</p>'
      + '<p><a href="https://example.test/report">公开报道</a></p>'
      + '<p>来源： https://reports.example.test/a。</p>'
      + '<p>联系我们</p><p>电话：138 <strong>0000</strong> 0000</p>'
    expect(reviewPublishDocument(article('sohu', null, html))).toMatchObject({
      status: 'reviewed', findings: [
        { rule: 'sohuSolicitation', location: '正文第 1 个文字块' },
        { rule: 'sohuExternalLink', location: '正文第 2 个文字块', excerpt: '公开报道（https://example.test/report）' },
        { rule: 'sohuExternalLink', location: '正文第 3 个文字块', excerpt: '来源： https://reports.example.test/a。' },
        { rule: 'contactPhone', location: '正文第 5 个文字块', excerpt: '电话：138 0000 0000' },
      ],
    })
  })

  it('搜狐识别无标签的手机号、邮箱和二维码导流措辞', () => {
    const html = '<p>138-0000-0000</p><p>邮箱：team@example.test</p><p>扫描二维码查看课程</p><p>微信 ID ：staff-2026</p>'
    expect(reviewPublishDocument(article('sohu', null, html))).toMatchObject({
      status: 'reviewed', findings: [{ rule: 'contactPhone' }, { rule: 'sohuContact' }, { rule: 'sohuContact' }, { rule: 'sohuContact' }],
    })
  })

  it('仅在一个段落内识别电话号码的软换行', () => {
    const html = '<p>电话：138<br>0000 0000</p><p>电话：<br>136 0000 0000</p><p>137</p><p>0000 0000</p>'
    expect(reviewPublishDocument(article('sohu', null, html))).toMatchObject({
      status: 'reviewed', findings: [
        { rule: 'contactPhone', location: '正文第 1 个文字块' }, { rule: 'contactPhone', location: '正文第 2 个文字块' },
      ],
    })
  })

  it('标出只包裹图片的站外链接及常见裸域名', () => {
    const html = '<p><a href="https://example.test/report"><img src="/test.png" alt="示意图"></a></p>'
      + '<p>另见 reports.example.com/report。</p><p>访问 reports.example.com。</p>'
    expect(reviewPublishDocument(article('sohu', null, html))).toMatchObject({
      status: 'reviewed', findings: [
        { rule: 'sohuExternalLink', location: '正文图片链接第 1 处', excerpt: '图片链接（https://example.test/report）' },
        { rule: 'sohuExternalLink', location: '正文第 1 个文字块', excerpt: '另见 reports.example.com/report。' },
        { rule: 'sohuExternalLink', location: '正文第 2 个文字块', excerpt: '访问 reports.example.com。' },
      ],
    })
  })

  it('提示联系服务的号召，不把叙述往事标成招揽', () => {
    const html = '<p>找老师做管理陪跑。</p><p>联系王老师，了解管理陪跑服务。</p><p>我昨天找王老师做了课堂示范。</p>'
      + '<p>找王老师做过管理陪跑，效果不错。</p><p>有需要的话，联系王老师了解管理陪跑。</p>'
    expect(reviewPublishDocument(article('sohu', null, html))).toMatchObject({
      status: 'reviewed', findings: [
        { rule: 'sohuSolicitation', location: '正文第 1 个文字块' },
        { rule: 'sohuSolicitation', location: '正文第 2 个文字块' },
        { rule: 'sohuSolicitation', location: '正文第 5 个文字块' },
      ],
    })
  })

  it('普通数字、搜狐站内链接和其他平台的普通资料外链不提示', () => {
    const sohuHtml = '<p>年营收 1 千万到 3 亿，服务 8000+ 家，办公室 1210 室。</p><p>电话咨询仅在工作日；日期 2026-11-19。</p>'
      + '<p>批号：9138000000008。</p><p>电话：010-123456789012。</p>'
      + '<p>订单号：138 0000 0000。</p><p>年度预算为 138 0000 0000 元。</p>'
      + '<p>公开报道：<a href="https://www.sohu.com/a/13800000000">搜狐原文</a>、https://mp.sohu.com/13800000000。</p>'
    expect(summarize(reviewPublishDocument(article('sohu', null, sohuHtml)))).toEqual({ status: 'reviewed', findings: [] })
    expect(summarize(reviewPublishDocument(article('qq', null, '<p>参阅<a href="https://example.test/reader">读者说明</a>。</p>')))).toEqual({ status: 'reviewed', findings: [] })
    expect(summarize(reviewPublishDocument(article('wechat', null, '')))).toEqual({ status: 'reviewed', findings: [] })
  })

  it('命中位置能在对应文字块上回读为同一段原文', () => {
    const html = '<p>欢迎参加。</p><p>转发后领取资料。</p>'
    const result = reviewPublishDocument(article('wechat', '震惊！活动公布', html))
    expect(result.status).toBe('reviewed')
    if (result.status !== 'reviewed') return
    const template = document.createElement('template')
    template.innerHTML = html
    const units = collectBodyUnits(template.content)
    expect(result.findings.length).toBe(2)
    for (const finding of result.findings) {
      if (finding.unit < 0) {
        expect(finding.original).toBe('震惊！')
        continue
      }
      const unit = units[finding.unit]
      expect(unit?.location).toBe(finding.location)
      expect(unit?.text.slice(finding.start, finding.end)).toBe(finding.original)
      expect(finding.original).not.toBe('')
    }
  })

  it('块序号与界面上的文字块编号对齐', () => {
    const result = reviewPublishDocument(article('wechat', null, '<p>欢迎参加。</p><p>电话：177 2259 4724</p>'))
    expect(result).toMatchObject({
      status: 'reviewed',
      findings: [{ rule: 'contactPhone', location: '正文第 2 个文字块', unit: 1 }],
    })
  })

  it('全角号码折成半角再匹配，但定位片段回读正文原文', () => {
    const result = reviewPublishDocument(article('wechat', null, '<p>联系电话：（０１０）１２３４５６７８</p>'))
    expect(result).toMatchObject({
      status: 'reviewed',
      findings: [{ rule: 'contactPhone', unit: 0, start: 0, original: '联系电话：（０１０）１２３４５６７８' }],
    })
  })

  it('只含图片的站外链接自成一个文字块，序号与正文文字块分开', () => {
    const html = '<p><a href="https://example.test/report"><img src="/test.png" alt="示意图"></a></p><p>另见 reports.example.com/report。</p>'
    const result = reviewPublishDocument(article('sohu', null, html))
    expect(result).toMatchObject({
      status: 'reviewed',
      findings: [
        { rule: 'sohuExternalLink', location: '正文图片链接第 1 处', unit: 0, original: '' },
        { rule: 'sohuExternalLink', location: '正文第 1 个文字块', unit: 1 },
      ],
    })
  })

  it('浏览器解析失败不会返回未发现风险', () => {
    vi.spyOn(document, 'createElement').mockImplementationOnce(() => { throw new Error('无法读取成稿') })
    expect(summarize(reviewPublishDocument(article('wechat', null, '正文')))).toEqual({ status: 'unavailable' })
  })
})
