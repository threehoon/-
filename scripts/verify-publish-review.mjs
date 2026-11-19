import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const target = new URL(process.env.TARGET_URL ?? 'http://localhost:5183/')
const out = process.env.OUT_DIR ?? '.tmp/publish-review'
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? chromium.executablePath() })
const riskyDraft = '# 社区阅读活动\n\n欢迎带一本喜欢的书。\n\n转发后领取资料。'
const officialHosts = [/weixin\.qq\.com$/u, /toutiao\.com$/u, /sohu\.com$/u, /baidu\.com$/u, /zhihu\.com$/u, /om\.qq\.com$/u]

try {
  await mkdir(out, { recursive: true })
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', locale: 'zh-CN' })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: target.origin })
    const externalRequests = []
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === target.origin) return route.continue()
      externalRequests.push(route.request().url())
      return route.abort()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(target.href)
    const source = page.getByRole('textbox', { name: 'Markdown 源稿' })
    const tabs = page.getByRole('tab')
    const review = page.locator('.publish-review')
    const status = review.locator('.publish-review__status')
    const summary = review.locator('.publish-review__summary')
    const body = review.locator('#publish-review-body')
    const sources = review.locator('.publish-review__sources > summary')
    const copyBody = page.getByRole('button', { name: '复制正文', exact: true })
    const copyTitle = page.getByRole('button', { name: '复制标题', exact: true })
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText())
    const typeset = async (markdown) => {
      await source.fill(markdown)
      await page.getByRole('button', { name: '一键排版', exact: true }).click()
      await page.locator('.status-chip[data-state="typeset"]').waitFor()
    }
    const toggleSummary = async (open) => {
      if (await summary.getAttribute('aria-expanded') !== String(open)) await summary.press('Enter')
      assert.equal(await summary.getAttribute('aria-expanded'), String(open))
      assert.equal(await body.isHidden(), !open)
    }
    const toggleSources = async (open) => {
      if (await sources.evaluate((el) => el.parentElement.open) !== open) await sources.press('Enter')
      assert.equal(await sources.evaluate((el) => el.parentElement.open), open)
    }
    assert.equal(await status.textContent(), '等待一键排版')
    for (const [index, host] of officialHosts.entries()) {
      await tabs.nth(index).click()
      await toggleSummary(true)
      await toggleSources(true)
      const link = review.locator('.publish-review__source-list a').first()
      assert.match(new URL(await link.getAttribute('href')).hostname, host)
      assert.equal(await link.getAttribute('rel'), 'noreferrer')
      assert.equal(await link.getAttribute('target'), '_blank')
    }
    await tabs.nth(0).click()
    await typeset(riskyDraft)
    await summary.scrollIntoViewIfNeeded()
    assert.equal(await status.textContent(), '发现 1 项疑似风险')
    assert.match(await review.locator('.publish-review__findings').textContent(), /正文第 2 个文字块.*转发后领取资料/u)
    assert.equal(await summary.getAttribute('aria-expanded'), 'true')
    await page.screenshot({ path: join(out, `risk-${width}.png`) })
    await toggleSources(true)
    assert.equal(await sources.evaluate((el) => getComputedStyle(el).outlineWidth), '2px')
    await page.screenshot({ path: join(out, `sources-${width}.png`) })
    await toggleSources(false)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))

    await page.evaluate(() => navigator.clipboard.writeText('剪贴板原值'))
    const attempt = async (button, accept, message = /可能不符合微信公众号的发布规则/u, key) => {
      const dialog = page.waitForEvent('dialog')
      const clicked = key ? button.press(key) : button.click()
      const prompt = await dialog
      if (accept) await prompt.accept()
      else await prompt.dismiss()
      await clicked
      assert.equal(prompt.type(), 'confirm')
      assert.match(prompt.message(), message)
    }
    await attempt(copyBody, false)
    assert.equal(await clipboard(), '剪贴板原值')
    await attempt(copyBody, true)
    assert.match(await clipboard(), /转发后领取资料/u)
    const clipboardTypes = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types))
    assert(clipboardTypes.includes('text/html'))
    await attempt(copyTitle, false)
    assert.match(await clipboard(), /转发后领取资料/u)
    await attempt(copyTitle, true)
    assert.equal(await clipboard(), '社区阅读活动')

    await tabs.nth(4).click()
    assert.equal(await status.textContent(), '本地未发现疑似风险')
    await copyBody.click()
    assert.match(await clipboard(), /转发后领取资料/u)
    await source.fill(`${riskyDraft}\n\n这句是修改。`)
    assert.equal(await status.textContent(), '结果已过期，请重新排版')
    assert(await copyBody.isDisabled())
    await typeset('# 社区阅读活动\n\n欢迎带一本喜欢的书。')
    assert.equal(await status.textContent(), '本地未发现疑似风险')
    await toggleSummary(false)
    assert.equal(await body.isHidden(), true)
    await toggleSummary(true)
    assert.match(await review.locator('.publish-review__note').first().textContent(), /不等于平台审核通过/u)
    await toggleSummary(false)
    if (width === 390) await tabs.nth(4).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(out, `clean-${width}.png`) })
    await typeset('# 工厂观察\n\n媒体来源：<https://example.test/first>\n\n另一来源：<https://example.test/second>')
    await tabs.nth(3).click()
    const compatibility = page.locator('.compat')
    assert.match(await compatibility.locator('.compat__summary').innerText(), /2 项兼容性提示 · 复制前需确认/u)
    assert.equal(await status.textContent(), '本地未发现疑似风险')
    assert.equal(await page.locator('.article a').count(), 0)
    await compatibility.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(out, `compatibility-${width}.png`) })
    await compatibility.getByRole('button', { name: '收起清单' }).click()
    assert.equal(await compatibility.locator('#compat-body').isVisible(), false)
    await page.evaluate(() => navigator.clipboard.writeText('兼容性取消时保留'))
    const linkWarning = /百家号兼容性提示（2 项）.*网址仍在正文/su
    await copyTitle.focus()
    await page.keyboard.press('Tab')
    assert.equal(await copyBody.evaluate((el) => el === document.activeElement && getComputedStyle(el).outlineWidth === '2px'), true)
    await attempt(copyBody, false, linkWarning, 'Enter')
    assert.equal(await clipboard(), '兼容性取消时保留')
    await attempt(copyBody, true, linkWarning, 'Enter')
    assert.match(await clipboard(), /example\.test\/first.*example\.test\/second/su)
    await attempt(copyTitle, false, /仍要复制标题吗/u)
    assert.match(await clipboard(), /example\.test\/first/u)
    await attempt(copyTitle, true, /仍要复制标题吗/u)
    assert.equal(await clipboard(), '工厂观察')
    await page.getByRole('button', { name: '专注编辑' }).click()
    assert.equal(await compatibility.count(), 0, '专注只展示需要处理的提示')
    await attempt(copyBody, false, /百家号兼容性提示（2 项）.*网址仍在正文.*退出专注编辑.*兼容性清单/su)
    assert.equal(await clipboard(), '工厂观察')
    await page.keyboard.press('Escape')
    await tabs.nth(4).click()
    await copyBody.click()
    assert.match(await clipboard(), /example\.test\/second/u, '切换到无兼容提示的平台后可直接复制')

    // 定位与一键检测：整页重排成一条含电话的长稿，跳过去删掉电话，再按当前正文重算。
    // 号码放在长稿中间：滚动位置没有被夹到两端，才能验证「面板不遮挡定位结果」。
    const before = Array.from({ length: 6 }, (_, index) => `第 ${index + 1} 段普通正文。`).join('\n\n')
    const after = Array.from({ length: 6 }, (_, index) => `第 ${index + 7} 段普通正文。`).join('\n\n')
    await tabs.nth(0).click()
    await typeset(`# 社区阅读活动\n\n欢迎带一本喜欢的书。\n\n${before}\n\n如需了解社区活动的详情，请向志愿者核对联系方式。记录电话：177 2259 4724\n\n${after}`)
    assert.equal(await status.textContent(), '发现 1 项疑似风险')
    await toggleSummary(true)
    const phone = page.locator('#platform-article p').filter({ hasText: '177' })
    const jump = review.getByRole('button', { name: /^定位正文第/u })
    assert.match(await jump.getAttribute('aria-label'), /记录电话|请向志愿者/u)
    const scroller = page.locator('.preview__scroll')
    const scrolledBefore = await scroller.evaluate((el) => el.scrollTop)
    await jump.click()
    await page.waitForTimeout(150)
    if (await scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 200)) {
      assert(await scroller.evaluate((el) => el.scrollTop) > scrolledBefore, '定位应把预览滚到命中处')
    }
    assert(await phone.evaluate((el) => {
      const block = el.getBoundingClientRect()
      const viewport = el.closest('.preview__scroll').getBoundingClientRect()
      return block.top >= viewport.top && block.bottom <= viewport.bottom
    }), '定位后目标段落应完整落在预览可视区')
    const marks = await page.evaluate(() => [...(CSS.highlights.get('studio-review-issue') ?? [])].map((range) => range.toString()))
    assert(marks.some((text) => text.includes('177 2259 4724')), '定位应高亮命中的号码')
    const covered = await page.evaluate(() => {
      const [range] = CSS.highlights.get('studio-review-issue') ?? []
      const rect = range?.getClientRects()[0]
      const panel = document.querySelector('.publish-review').getBoundingClientRect()
      return rect ? rect.top < panel.bottom : true
    })
    assert.equal(covered, false, '钉住的预检条不应盖住定位到的字句')
    assert.equal(await review.count(), 1, '跳转后预检条仍留在预览顶部')
    await page.screenshot({ path: join(out, `located-${width}.png`) })

    await page.getByRole('button', { name: '编辑正文', exact: true }).click()
    const article = page.locator('#platform-article')
    await phone.evaluate((element) => {
      const text = element.firstChild
      const start = text.textContent.indexOf('24', text.textContent.indexOf('4724') + 2)
      const range = document.createRange()
      range.setStart(text, start)
      range.setEnd(text, start + 2)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
    })
    await page.keyboard.press('Backspace')
    await review.getByRole('button', { name: '定位上次提示所在段落' }).click()
    await review.getByText(/已定位到它所在的段落/u).waitFor()
    const paragraphMark = await page.evaluate(() => [...(CSS.highlights.get('studio-review-issue') ?? [])].map(String))
    assert.deepEqual(paragraphMark, [await phone.textContent()], '命中内删两个字后高亮所在段，不跳邻段')
    await page.screenshot({ path: join(out, `paragraph-fallback-${width}.png`) })
    await article.focus()
    await article.evaluate((el) => {
      const block = [...el.querySelectorAll('p')].find((candidate) => candidate.textContent?.includes('177'))
      const range = document.createRange()
      range.selectNodeContents(block)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
    })
    await page.keyboard.press('Backspace')
    assert.equal(await status.textContent(), '本地未发现疑似风险')
    await review.getByRole('button', { name: '一键检测' }).click()
    assert.equal(await status.textContent(), '重新检测 · 本地未发现疑似风险')
    assert.match(await review.locator('.publish-review__check').first().textContent(), /已按当前正文检测/u)
    assert.equal(await review.locator('.publish-review__findings').count(), 0)
    await page.getByRole('button', { name: '完成编辑', exact: true }).click()
    await page.screenshot({ path: join(out, `rechecked-${width}.png`) })

    // 命中从 <br> 换行处开始时（Markdown 硬换行）也要能定位，不能抛异常。
    await page.getByRole('tab', { name: /^搜狐/ }).click()
    await typeset('# 社区活动\n\n甲  \n咨询王老师购买课程\n\n正文结尾。')
    assert.equal(await status.textContent(), '发现 1 项疑似风险')
    await toggleSummary(true)
    await review.getByRole('button', { name: /^定位/ }).first().click()
    await page.waitForTimeout(150)
    const brMarks = await page.evaluate(() => [...(CSS.highlights.get('studio-review-issue') ?? [])].map((range) => range.toString()))
    assert(brMarks.some((text) => text.includes('咨询王老师购买课程')), '硬换行处的命中也要高亮到文字')
    assert.deepEqual(pageErrors, [], '定位不应抛未捕获异常')

    assert.deepEqual(externalRequests, [])
    assert.deepEqual(pageErrors, [])
    console.log(`${width}px: 发布预检、定位跳转、一键检测、两条明文网址兼容提醒、逐次确认、取消保留剪贴板、键盘、专注及平台切换通过`)
    await context.close()
  }
  console.log(`Chromium ${browser.version()}`)
} finally {
  await browser.close()
}
