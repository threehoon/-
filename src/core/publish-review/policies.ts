import type { PlatformId } from '@/core/types'

interface PublishRule {
  readonly title: string
  readonly action: string
  readonly scope: 'title' | 'body' | 'both'
  readonly pattern: RegExp
}

/** Local cues, not platform keyword lists or legal findings. No stateful regular expressions. */
export const PUBLISH_RULES = {
  privacy: {
    title: '可能暴露个人信息',
    action: '确认信息是否可以公开；涉及个人身份证号、手机号等，建议删除或脱敏。',
    scope: 'both',
    pattern: /(?:身份证(?:号码|号)?\s*[：:]?\s*\d{17}[0-9Xx](?![0-9Xx])|(?:私人电话|个人手机号|联系方式|手机号|手机号码|联系电话)\s*[：:]?\s*(?:\+86[ -]?)?1[3-9]\d{9}(?!\d))/u,
  },
  claims: {
    title: '绝对化宣传或收益、疗效承诺',
    action: '核对证据、推广资质及适用规则；不要把未经证实的效果或收益写成保证。',
    scope: 'both',
    pattern: /(?:稳赚不赔|零风险(?:投资|理财|赚钱)|保证(?:盈利|获利|赚钱|治愈)|包治百病|药到病除|根治(?:癌症|糖尿病)|(?:100%|百分之百)(?:有效|治愈|成功|获利))/u,
  },
  repost: {
    title: '转载授权需核对',
    action: '请核对原作者许可、转载范围及署名要求；注明来源不等于已获得授权。',
    scope: 'both',
    pattern: /(?:未经授权转载|未获授权转载|无授权转载|来源不详[，,；;\s]{0,3}(?:侵删|如有侵权)|侵权(?:请联系|即)删|如有侵权[，,\s]{0,3}(?:请)?(?:联系)?(?:我)?删除)/u,
  },
  clickbait: {
    title: '标题可能夸张或误导',
    action: '让标题具体说明正文事实，不用夸张或制造悬念的措辞代替信息。',
    scope: 'title',
    pattern: /(?:不看后悔|不转不是|看完惊呆|震惊[！!]{1,}|全网炸锅|竟然是这样|速看[！!]{2,})/u,
  },
  promotion: {
    title: '站外导流或营销线索',
    action: '核对站外联系和商品推广是否允许、是否需要资质或声明；不要将联系方式设为获取正文的前提。',
    scope: 'both',
    pattern: /(?:(?:加我(?:的)?微信|添加(?:客服|助理)微信|加群领(?:取)?|私信领(?:取)?).{0,18}(?:资料|课程|福利|红包|优惠|返现|高收益)|(?:扫码|扫描二维码).{0,12}(?:领(?:取)?红包|返现|加群)|(?:微信号|客服微信)\s*[：:]\s*[A-Za-z][\w-]{5,19})/u,
  },
  engagement: {
    title: '可能诱导分享、关注或互动',
    action: '不要把查看内容、领福利或参与活动与关注、点赞、集赞或转发绑定。',
    scope: 'both',
    pattern: /(?:(?:关注|转发|分享|点赞|集赞)(?:本号|公众号|文章|到朋友圈|朋友圈)?(?:后|即可|就能|才能|才可以|一下就)[^。！？\n]{0,16}(?:领(?:取)?|查看|解锁|抽奖|返现|得红包)|集(?:满|齐)\s*\d+\s*个?赞[^。！？\n]{0,16}(?:领取|兑换|获赠|抽奖))/u,
  },
  qqContact: {
    title: '腾讯图文可能含社交账号',
    action: '按腾讯图文发布帮助，删去作为联系方式展示的微信号、微博号或 QQ 号，再人工核对。',
    scope: 'both',
    pattern: /(?:微信(?:号|ID)|微博(?:号|ID)|QQ(?:号|号码)?)\s*[:：]\s*(?:[A-Za-z][\w-]{5,19}|\d{5,13})(?![\w-])/iu,
  },
  baijiaFormat: {
    title: '百家号文字格式需核对',
    action: '检查是否有装饰符号或乱码；还原缺失文字，保留必要的常规标点。',
    scope: 'both',
    pattern: /(?:[♨✪✅]|�{2,})/u,
  },
  sourcing: {
    title: '消息来源待核实',
    action: '引用新闻、公共事件或数据时核对原始来源、时间与上下文；未核实的说法不要写成确定事实。',
    scope: 'both',
    pattern: /(?:内部消息[：:]|据网传消息|未经证实的消息|转发出去.{0,8}(?:别被删|赶紧看)|据可靠内部消息)/u,
  },
} satisfies Record<string, PublishRule>

export type PublishRuleId = keyof typeof PUBLISH_RULES

interface PolicySource {
  readonly label: string
  readonly url: `https://${string}`
  readonly access: 'public-text' | 'official-entry'
  readonly detail: string
}

interface PublishPolicy {
  readonly sources: readonly PolicySource[]
  readonly rules: readonly PublishRuleId[]
  readonly manualChecks: readonly string[]
}

export const PUBLISH_POLICY_CHECKED_ON = '2026-11-19'

const common = ['privacy', 'claims', 'repost', 'sourcing'] as const
const authorization = '核实文字、图片和转载素材的授权；确认人物信息、肖像与联系方式可以公开。'
const facts = '核对标题与正文是否一致，以及事实、数据和截图的原始来源。'

const POLICIES = {
  wechat: {
    sources: [
      { label: '微信公众平台运营规范', url: 'https://mp.weixin.qq.com/cgi-bin/readtemplate?t=business/faq_operation_tmpl&type=info&lang=zh_CN', access: 'public-text', detail: '3.3 诱导分享及关注，3.6 原创声明，3.8 资质；第 4 章为内容规范。' },
      { label: '微信公众平台服务协议', url: 'https://mp.weixin.qq.com/cgi-bin/readtemplate?t=home/agreement_tmpl&type=info&lang=zh_CN', access: 'public-text', detail: '5.1 信息内容，5.2.2 虚假信息、诱导关注或分享等。' },
    ],
    rules: [...common, 'clickbait', 'engagement', 'promotion'],
    manualChecks: ['确认未绑定分享、转发或关注来获取福利；原创声明需核对文字和素材的实际权利。', authorization],
  },
  toutiao: {
    sources: [{ label: '头条号内容创作规范', url: 'https://baike.toutiao.com/detail/236/238/0?enter_from=left_navigation', access: 'public-text', detail: '区分平台不允许（如抄袭侵权、专业资质、谣言、违规推广）与不鼓励（如低质标题、过时内容、引导互粉）。' }],
    rules: [...common, 'clickbait', 'engagement', 'promotion'],
    manualChecks: [facts, '医疗、投资等专业内容与电商推广请核对资质、创作规则及所需声明。'],
  },
  sohu: {
    sources: [
      { label: '搜狐号百科：文章发布规范', url: 'https://www.sohu.com/a/419012143_120635073', access: 'public-text', detail: '第 3–7 项：专业资质、AI 作品标识、标题与正文、恶意推广、肖像隐私及抄袭。' },
      { label: '搜狐号服务协议', url: 'https://www.sohu.com/na/435536343_120635073', access: 'public-text', detail: '第四节第 3–4 项：发布内容须享有合法权益，不得侵权或干扰运营；第五节第 5 项限制自定义推广位不得用于第三方推广。' },
    ],
    rules: [...common, 'clickbait', 'promotion'],
    manualChecks: [authorization, '按图文规范核对专业资质、AI 创作声明、联系方式、站外营销链接和二维码。'],
  },
  baijiahao: {
    sources: [{ label: '百家号平台服务协议', url: 'https://baijiahao.baidu.com/docs/#/markdownsingle/BaiJiaHaoFuWuXieYi', access: 'public-text', detail: '4.2 新闻资质及转载追溯，4.4 侵权，4.5 图文格式、标题、广告与旧闻，4.6 诱导互动等使用限制。' }],
    rules: [...common, 'clickbait', 'promotion', 'engagement', 'baijiaFormat'],
    manualChecks: [facts, '核对新闻发布或转载资质、来源和署名；正文联系方式、网址和二维码可能被识别为广告。'],
  },
  zhihu: {
    sources: [
      { label: '知乎协议', url: 'https://www.zhihu.com/term/zhihu-terms', access: 'public-text', detail: '第二章第 4–7 项：虚假信息、标题与正文严重不符、非真实合成信息标识；第三章为知识产权。' },
      { label: '知乎社区规范', url: 'https://www.zhihu.com/term/community', access: 'official-entry', detail: '协议引用的官方规范入口；本次无法读取跳转后的正文。' },
    ],
    rules: [...common, 'clickbait', 'promotion'],
    manualChecks: ['发布可能导致误认的非真实合成内容需显著标识；本工具无法判断实际生成来源。', authorization],
  },
  qq: {
    sources: [
      { label: '腾讯内容开放平台服务协议', url: 'https://static.om.qq.com/om/om_3.0/normal/html/4J47G9BrXldBM2xEoPqPUVLGMo11T5O2.html', access: 'public-text', detail: '4.1 内容及 AI 生成合成声明，4.2.2 诱导互动，4.3 来源与旧闻/演绎标注，8.2 作品权利。' },
      { label: '图文发布帮助：什么样的文章算违规发文？', url: 'https://kf.om.qq.com/detail/f68d2d84-06be-4d6b-8058-6dfe83fb3693', access: 'public-text', detail: '图文标题或正文勿展示社交账号联系方式；核实网址是否相关，以及文案是否有违规广告。' },
    ],
    rules: [...common, 'clickbait', 'engagement', 'promotion', 'qqContact'],
    manualChecks: ['上传时按要求主动声明是否含 AI 生成合成内容；时事、公共议题要标来源，旧闻或演绎按要求标识。', authorization],
  },
} satisfies Record<PlatformId, PublishPolicy>

export function getPublishPolicy(platform: PlatformId): PublishPolicy {
  return POLICIES[platform]
}
