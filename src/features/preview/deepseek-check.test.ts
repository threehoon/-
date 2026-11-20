import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_API, checkBlocks, deepSeekPageAccess, enableLanDeepSeekForPage, requestDeepSeek } from './deepseek-check'
import { articleTextUnits, rangeOf } from './content-check'
import { aiTarget, matchDeepSeekIssues, rebaseAiAnchors, sameCheckText } from './deepseek-findings'

const config = { key: 'test-key', model: 'deepseek-flash' } as const
const signal = () => new AbortController().signal
const reply = (content: string, finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason, message: { content } }] }))
const blocks = [{ id: 0, title: true, text: '自已看看' }]

beforeEach(() => vi.stubGlobal('isSecureContext', true))
afterEach(() => vi.unstubAllGlobals())

describe('DeepSeek 官方 API', () => {
  it('只发至官方地址，不携带浏览器 cookie 或接受重定向', async () => {
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(reply('{"issues":[]}'))
    vi.stubGlobal('fetch', fetchApi)
    await expect(requestDeepSeek(config, blocks, signal())).resolves.toEqual([])
    expect(fetchApi).toHaveBeenCalledWith(DEEPSEEK_API, expect.objectContaining({
      method: 'POST', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
    }))
    const body = fetchApi.mock.calls[0]?.[1]?.body
    expect(body).toContain('deepseek-flash')
    expect(body).toContain('自已看看')
  })

  it('连接测试只发送固定样例', async () => {
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(reply('{"issues":[]}'))
    vi.stubGlobal('fetch', fetchApi)
    await requestDeepSeek(config, null, signal())
    expect(fetchApi.mock.calls[0]?.[1]?.body).toContain('用于测试连接的固定样例')
  })

  it('在非安全上下文不发送请求', async () => {
    vi.stubGlobal('isSecureContext', false)
    const fetchApi = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchApi)
    await expect(requestDeepSeek(config, blocks, signal())).rejects.toThrow('HTTPS')
    expect(fetchApi).not.toHaveBeenCalled()
  })

  it.each(['http://192.168.0.101:4174/', 'http://192.168.0.102:4173/', 'http://example.test/'])('非指定 HTTP 地址 %s 无法解锁', (url) => {
    vi.stubGlobal('isSecureContext', false)
    vi.stubGlobal('location', new URL(url))
    expect(deepSeekPageAccess()).toBe('blocked')
    expect(enableLanDeepSeekForPage()).toBe(false)
  })

  it('指定 HTTP 地址的请求必须经过本页解锁，解锁后仍只连接官方 HTTPS 接口', async () => {
    vi.stubGlobal('isSecureContext', false)
    vi.stubGlobal('location', new URL('http://192.168.0.101:4173/'))
    const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(reply('{"issues":[]}'))
    vi.stubGlobal('fetch', fetchApi)
    expect(deepSeekPageAccess()).toBe('lan-http')
    await expect(requestDeepSeek(config, null, signal())).rejects.toThrow('HTTPS')
    expect(fetchApi).not.toHaveBeenCalled()
    expect(enableLanDeepSeekForPage()).toBe(true)
    await expect(requestDeepSeek(config, null, signal())).resolves.toEqual([])
    expect(fetchApi).toHaveBeenCalledExactlyOnceWith(DEEPSEEK_API, expect.objectContaining({ method: 'POST' }))
  })

  it('拒绝超长稿件而不是截断发送', async () => {
    const fetchApi = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchApi)
    await expect(requestDeepSeek(config, [{ id: 0, title: false, text: '甲'.repeat(50_000) }], signal())).rejects.toThrow('未发送')
    expect(fetchApi).not.toHaveBeenCalled()
  })

  it.each([[401, 'API Key'], [403, 'API Key'], [402, '余额'], [429, '频繁'], [503, '暂时不可用'], [400, 'HTTP 400']])('HTTP %i 以脱敏文案反馈', async (status, text) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('private error detail', { status })))
    await expect(requestDeepSeek(config, blocks, signal())).rejects.toThrow(text)
  })

  it.each([
    [' ', 'stop', '未返回完整结果'],
    ['{', 'stop', '格式不正确'],
    ['{}', 'stop', '清单格式'],
    ['{"issues":[{"block":-1}]}', 'stop', '条目格式'],
    ['{"issues":[]}', 'length', '未返回完整结果'],
  ])('拒绝错误的回复 %j / %s', async (content, finish, text) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(reply(content, finish)))
    await expect(requestDeepSeek(config, blocks, signal())).rejects.toThrow(text)
  })

  it('限制服务返回体大小', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(128_001))))
    await expect(requestDeepSeek(config, blocks, signal())).rejects.toThrow('返回的内容过长')
  })

  it('为连接错误、主动取消和超时返回不同提示', async () => {
    const fetchApi = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('hidden network detail'))
    vi.stubGlobal('fetch', fetchApi)
    await expect(requestDeepSeek(config, blocks, signal())).rejects.toThrow('无法连接')
    const user = new AbortController()
    user.abort()
    await expect(requestDeepSeek(config, blocks, user.signal)).rejects.toThrow('已取消')
    const clock = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(clock.signal)
    clock.abort()
    await expect(requestDeepSeek(config, blocks, signal())).rejects.toThrow('超时')
  })
})

describe('校对快照与定位', () => {
  it('不发送网址、隐藏内容、代码、图片资源和链接目标，并保留正文文字', () => {
    const canvas = document.createElement('div')
    canvas.innerHTML = '<h2 class="article-title">标题</h2><article id="platform-article"><p>地址 https://example.test/私密</p><p>请<code>代码</code>参考<a href="https://secret.test">操作说明</a><img src="data:image/png,secret" alt="图片说明"><span hidden>秘密</span></p></article>'
    const sent = JSON.stringify(checkBlocks(articleTextUnits(canvas)))
    expect(sent).toContain('标题')
    expect(sent).toContain('操作说明')
    expect(sent).not.toMatch(/https|代码|秘密|图片说明|data:image|私密/u)
  })

  it('核验模型原句，跨格式选中原字句，重复词只定位整段，越界和伪造原句不入列', () => {
    const canvas = document.createElement('div')
    canvas.innerHTML = '<article id="platform-article"><p>先按<strong>装</strong>软件</p><p>重复重复</p></article>'
    const units = articleTextUnits(canvas)
    const issue = { problem: '错写', suggestion: '改写' }
    const result = matchDeepSeekIssues([
      { ...issue, block: 0, quote: '按装' }, { ...issue, block: 0, quote: '按装' },
      { ...issue, block: 1, quote: '重复' }, { ...issue, block: 0, quote: '不存在' }, { ...issue, block: 2, quote: '不存在' },
    ], checkBlocks(units), units)
    expect(result.omitted).toBe(2)
    expect(result.findings).toHaveLength(2)
    const [exact, repeated] = result.findings
    if (!exact || !repeated) throw new Error('缺失定位结果')
    const hit = aiTarget(exact, { unit: units[0] })
    expect(hit?.precision).toBe('exact')
    expect(hit && rangeOf(hit.unit, hit.start, hit.end)?.toString()).toBe('按装')
    expect(aiTarget(repeated, { unit: units[1] })).toMatchObject({ precision: 'repeated', start: 0, end: 4 })
  })

  function checkedBody(html: string, quote = '按装') {
    const article = document.createElement('article')
    article.id = 'platform-article'
    article.innerHTML = html
    const canvas = document.createElement('div')
    canvas.append(article)
    const units = articleTextUnits(canvas)
    const { findings: [finding] } = matchDeepSeekIssues([{ block: 0, quote, problem: '错写', suggestion: '改写' }],
      checkBlocks(units), units)
    if (!finding) throw new Error('缺失定位结果')
    return { article, canvas, units, finding }
  }

  it('重新定位偏移后的原句，而不是使用检查时的偏移', () => {
    const { article, canvas, units, finding } = checkedBody('<p>先按装软件</p>')
    units[0].element.prepend('明天，')
    const current = articleTextUnits(canvas)
    expect(sameCheckText(units, current)).toBe(false)
    const [anchor] = rebaseAiAnchors([{ unit: units[0] }], units, current, article, false)
    const hit = aiTarget(finding, anchor)
    expect(hit?.precision).toBe('exact')
    expect(hit && rangeOf(hit.unit, hit.start, hit.end)?.toString()).toBe('按装')
  })

  it('整句替换后仍可导航到原段；新出现的重复引用只定位整段', () => {
    const { article, canvas, units, finding } = checkedBody('<p>先按装软件</p>')
    const [original] = units
    original.element.textContent = '请先安装应用。'
    const current = articleTextUnits(canvas)
    const [edited] = rebaseAiAnchors([{ unit: original }], units, current, article, false)
    expect(aiTarget(finding, edited)).toMatchObject({ precision: 'edited', start: 0, end: 7 })
    original.element.textContent = '按装完再按装。'
    const [repeated] = rebaseAiAnchors([edited], current, articleTextUnits(canvas), article, false)
    expect(aiTarget(finding, repeated)).toMatchObject({ precision: 'repeated', start: 0, end: 7 })
  })

  it('删除其中一段时不跳到内容完全相同的另一段', () => {
    const { article, canvas, units, finding } = checkedBody('<p>先按装软件</p><p>先按装软件</p>')
    units[0].element.remove()
    const live = articleTextUnits(canvas)
    const [anchor] = rebaseAiAnchors([{ unit: units[0] }], units, live, article, false)
    expect(aiTarget(finding, anchor)).toBeNull()
  })

  it('结束编辑后同序重绘仍可映射到原来的重复段落', () => {
    const { article, canvas, units, finding } = checkedBody('<p>先按装软件</p><p>先按装软件</p>')
    article.innerHTML = '<p>先按装软件</p><p>先按装软件</p>'
    const live = articleTextUnits(canvas)
    const [anchor] = rebaseAiAnchors([{ unit: units[0] }], units, live, article, true)
    expect(aiTarget(finding, anchor)?.unit.element).toBe(live[0].element)
  })

  it('原段落原文唯一且未变时允许块格式替换', () => {
    const { article, canvas, units, finding } = checkedBody('<p>先按装软件</p><p>别的段落</p>')
    const heading = document.createElement('h3')
    heading.textContent = units[0].text
    units[0].element.replaceWith(heading)
    const [anchor] = rebaseAiAnchors([{ unit: units[0] }], units, articleTextUnits(canvas), article, false)
    expect(aiTarget(finding, anchor)?.unit.element).toBe(heading)
  })

  it('同一个段落内相同的文本组被分开时仍保持原序', () => {
    const { article, canvas, units } = checkedBody('<p>先按装软件<br>先按装软件</p>')
    const live = articleTextUnits(canvas)
    const [anchor] = rebaseAiAnchors([{ unit: units[0] }], units, live, article, false)
    expect(anchor?.unit).toBe(live[0])
  })
})
