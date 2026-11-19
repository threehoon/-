import { describe, expect, it } from 'vitest'
import type { PlatformId } from '@/core/types'
import type { PublishFinding } from '@/core/publish-review/review'
import { reviewPublishDocument } from '@/core/publish-review/review'
import { currentSourceSpan, locatePublishFinding, publishFindingElement, publishTargetOutcome, publishTargetRange } from './issue-locations'

function canvasWith(html: string, title: string | null): Element {
  const root = document.createElement('div')
  root.className = 'preview-canvas'
  if (title !== null) {
    const heading = document.createElement('h2')
    heading.className = 'article-title'
    heading.textContent = title
    root.append(heading)
  }
  const article = document.createElement('article')
  article.id = 'platform-article'
  article.innerHTML = html
  root.append(article)
  return root
}

function findingsOf(platform: PlatformId, title: string | null, html: string): readonly PublishFinding[] {
  const result = reviewPublishDocument({
    platform,
    title,
    html,
    plainText: '',
    warnings: [],
    stats: { blocks: 0, characters: 0 },
  })
  if (result.status !== 'reviewed') throw new Error('预检没有完成')
  return result.findings
}

describe('把发布预检提示映射回正文', () => {
  it('正文提示定位到文字块里的同一段原文', () => {
    const html = '<p>欢迎参加。</p><p>联系电话：138 0000 0000</p>'
    const canvas = canvasWith(html, null)
    const [finding] = findingsOf('wechat', null, html)
    expect(publishTargetRange(canvas, finding)?.toString()).toBe(finding.original)
  })

  it('标题提示定位到标题里的命中片段', () => {
    const html = '<p>正文。</p>'
    const canvas = canvasWith(html, '震惊！活动公布')
    const [finding] = findingsOf('wechat', '震惊！活动公布', html)
    expect(finding.unit).toBe(-1)
    expect(publishTargetRange(canvas, finding)?.toString()).toBe('震惊！')
  })

  it('命中片段被改掉以后不再跳到相邻段落', () => {
    const html = '<p>欢迎参加。</p><p>联系电话：138 0000 0000</p>'
    const canvas = canvasWith(html, null)
    const [finding] = findingsOf('wechat', null, html)
    const paragraph = canvas.querySelectorAll('#platform-article p')[1]
    if (!paragraph) throw new Error('找不到第二段')
    paragraph.textContent = '联系电话：'
    expect(publishTargetRange(canvas, finding)).toBeNull()
  })

  it('删掉命中之前的段落时，块序号前移也不乱跳到别的段落', () => {
    const html = '<p>第一段。</p><p>联系电话：138 0000 0000</p><p>最后一段。</p>'
    const canvas = canvasWith(html, null)
    const [finding] = findingsOf('wechat', null, html)
    expect(finding?.unit).toBe(1)
    canvas.querySelectorAll('#platform-article p')[0]?.remove()
    const range = publishTargetRange(canvas, finding)
    expect(range?.toString() ?? '').not.toContain('最后一段')
    expect(range).toBeNull()
  })

  it('旧定位锁定原 DOM 段落，即使顺移邻段有相同前缀和命中也不跳过去', () => {
    const html = '<p>共同前缀用于审核核对：联系电话：138 0000 0000，第一段。</p>' +
      '<p>共同前缀用于审核核对：联系电话：138 0000 0000，第二段。</p>'
    const canvas = canvasWith(html, null)
    const [finding] = findingsOf('wechat', null, html)
    const element = publishFindingElement(canvas, finding)
    expect(element?.textContent).toContain('第一段')
    element?.remove()
    expect(locatePublishFinding(canvas, finding, element).status).toBe('unavailable')
  })

  it('命中从 <br> 换行处开始时也能定位，不会抛越界错误', () => {
    const html = '<p>甲<br>咨询王老师购买课程</p>'
    const canvas = canvasWith(html, null)
    const [finding] = findingsOf('sohu', null, html)
    expect(finding?.original.startsWith('\n')).toBe(true)
    const range = publishTargetRange(canvas, finding)
    expect(range?.toString()).toBe('咨询王老师购买课程')
  })

  it('块序号超出当前正文时不乱跳', () => {
    const html = '<p>欢迎参加。</p><p>联系电话：138 0000 0000</p>'
    const canvas = canvasWith('<p>只剩一段。</p>', null)
    const [finding] = findingsOf('wechat', null, html)
    expect(publishTargetRange(canvas, finding)).toBeNull()
  })

  it('站外网址挂在锚文字或图片上时退回到整块定位', () => {
    const anchor = '<p><a href="https://example.test/report">公开报道</a></p>'
    const anchorCanvas = canvasWith(anchor, null)
    const [anchorFinding] = findingsOf('sohu', null, anchor)
    expect(anchorFinding?.original).toBe('')
    expect(publishTargetRange(anchorCanvas, anchorFinding)?.toString()).toBe('公开报道')

    const image = '<p>相关图<a href="https://example.test/report"><img src="/t.png"></a></p>'
    const imageCanvas = canvasWith(image, null)
    const [imageFinding] = findingsOf('sohu', null, image)
    const imageRange = publishTargetRange(imageCanvas, imageFinding)
    expect(imageRange?.startContainer.textContent).toContain('相关图')
  })

  it('命中文字被改掉但段落还在时退回到所在段落，并说明原因', () => {
    const html = '<p>欢迎参加。</p><p>联系电话：138 0000 0000</p>'
    const canvas = canvasWith(html, null)
    const [finding] = findingsOf('wechat', null, html)
    const paragraph = canvas.querySelectorAll('#platform-article p')[1]
    if (!paragraph) throw new Error('找不到第二段')
    paragraph.textContent = '联系电话：138 0000 0001'
    const outcome = publishTargetOutcome(canvas, finding)
    expect(outcome.status).toBe('block')
    expect(outcome.status === 'block' ? outcome.range.toString() : '').toBe('联系电话：138 0000 0001')
    const located = locatePublishFinding(canvas, finding)
    expect(located.status).toBe('block')
    expect(located.message).toContain('所在的段落')
  })

  it('段落整段换成别的内容时明确报未能定位，不圈整段', () => {
    const html = '<p>欢迎参加。</p><p>联系电话：138 0000 0000</p>'
    const canvas = canvasWith(html, null)
    const [finding] = findingsOf('wechat', null, html)
    const paragraph = canvas.querySelectorAll('#platform-article p')[1]
    if (!paragraph) throw new Error('找不到第二段')
    paragraph.textContent = '这一段重新写过。'
    const outcome = publishTargetOutcome(canvas, finding)
    expect(outcome.status).toBe('unavailable')
    expect(outcome.status === 'unavailable' ? outcome.reason : '').toContain('已经找不到')
  })

  it('命中落在表格单元格里时按单元格块定位', () => {
    const html = '<table><tr><td>联系电话：138 0000 0000</td></tr></table>'
    const canvas = canvasWith(html, null)
    const [finding] = findingsOf('wechat', null, html)
    expect(finding).toBeDefined()
    expect(publishTargetRange(canvas, finding)?.toString()).toBe(finding?.original)
  })

  it('标题的命中片段被改掉以后也不再退回到整个标题', () => {
    const html = '<p>正文。</p>'
    const canvas = canvasWith(html, '震惊！活动公布')
    const [finding] = findingsOf('wechat', '震惊！活动公布', html)
    const title = canvas.querySelector('.article-title')
    if (!title) throw new Error('找不到标题')
    title.textContent = '活动公布'
    expect(publishTargetRange(canvas, finding)).toBeNull()
  })

  it('没有正文时返回空，由界面提示无法定位', () => {
    const root = document.createElement('div')
    root.className = 'preview-canvas'
    const finding = findingsOf('wechat', null, '<p>联系电话：138 0000 0000</p>')[0]
    expect(publishTargetRange(root, finding)).toBeNull()
  })
})

it('源稿定位只匹配唯一的同类完整块，不跳到代码示例中的旧链接', () => {
  const link = '[链接](https://example.test/site)'
  const span = { start: 0, end: link.length }
  const location = { kind: 'source', span, block: span } as const
  const baseline = link + '\n\n其它段。'
  const prefix = '新段。\n\n'
  expect(currentSourceSpan(location, baseline, baseline)).toEqual({ start: 0, end: link.length })
  expect(currentSourceSpan(location, baseline, prefix + baseline)).toBeNull()
  expect(currentSourceSpan(location, baseline, '例子：`' + link + '`。')).toBeNull()
  expect(currentSourceSpan(location, baseline, baseline + '\n\n' + link)).toBeNull()
})
