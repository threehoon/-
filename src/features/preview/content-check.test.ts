import { describe, expect, it } from 'vitest'
import { articleTextUnits, checkArticleContent, contentRange } from './content-check'
import { outcomeRange } from './locate-shared'

function inspectArticle(title: string, body: string) {
  const canvas = document.createElement('div')
  canvas.innerHTML = `<h2 class="article-title">${title}</h2><article id="platform-article">${body}</article>`
  const units = articleTextUnits(canvas)
  return { units, findings: checkArticleContent(units) }
}

describe('本地中文校对', () => {
  it('定位标题中的错别字以及跨粗体的正文错写', () => {
    const { findings, units } = inspectArticle('工序应该按步就班', '<p>让员工<strong>自</strong>已学会。</p><p>团队一拍既合。</p>')
    expect(findings).toMatchObject([
      { title: true, original: '按步就班', advice: '疑似错别字，核对是否应写作「按部就班」。' },
      { title: false, original: '自已', advice: '疑似错别字，核对是否应写作「自己」。' },
      { title: false, original: '一拍既合', advice: '疑似错别字，核对是否应写作「一拍即合」。' },
    ])
    expect(findings.map((finding) => outcomeRange(contentRange(units, finding))?.toString())).toEqual(['按步就班', '自已', '一拍既合'])
  })

  it('命中片段被改掉以后明确报未能定位，不把整段当命中', () => {
    const { findings } = inspectArticle('', '<p>让员工自已学会。</p>')
    const [finding] = findings
    if (!finding) throw new Error('应当命中错别字')
    const current = document.createElement('div')
    current.innerHTML = '<h2 class="article-title"></h2><article id="platform-article"><p>这段话已经整段重写。</p></article>'
    const outcome = contentRange(articleTextUnits(current), { ...finding, unit: 0 })
    expect(outcome.status).toBe('unavailable')
    expect(outcome.status === 'unavailable' ? outcome.reason : '').toContain('已经找不到')
  })

  it('段落仍在、只删了命中文字后面的一小段时退到段落并说明', () => {
    const { findings } = inspectArticle('', '<p>团队经过三轮试跑以后一拍既合，当天就定下了方案。</p>')
    const [finding] = findings
    if (!finding) throw new Error('应当命中错别字')
    const current = document.createElement('div')
    current.innerHTML = '<h2 class="article-title"></h2><article id="platform-article"><p>团队经过三轮试跑以后一拍即合。</p></article>'
    const outcome = contentRange(articleTextUnits(current), { ...finding, unit: 0 })
    expect(outcome.status).toBe('block')
    expect(outcomeRange(outcome)?.toString()).toContain('一拍即合')
  })

  it('把案例中读起来不顺的片段和错别字分开，不替作者改稿', () => {
    const { findings } = inspectArticle('', '<p>系统只能说“看起来像不对”。</p><p>不如听起来像不太对劲。</p>')
    expect(findings).toMatchObject([
      { original: '看起来像不对', advice: '这句读起来不顺，建议改为「看起来不对」。' },
      { original: '听起来像不太对劲', advice: '这句读起来不顺，建议改为「听起来不太对劲」。' },
    ])
  })

  it('不标正常写法、案例专名、网址和代码中的文本', () => {
    const { findings } = inspectArticle('高效益陪跑｜人盯人', '<p>自己应该按部就班。川流不息，看起来不太对。</p><p>因该项目延期，图纸看起来像不对称的图形。设备须按装配顺序摆放。</p><p>https://example.test/按步就班</p><pre>自已</pre>')
    expect(findings).toEqual([])
  })
})
