import assert from 'node:assert/strict'
import { access, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const target = new URL(process.env.TARGET_URL ?? 'http://localhost:5183/')
const out = process.env.OUT_DIR ?? '.tmp/publish-review'
const installedChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? await access(installedChrome).then(() => installedChrome, () => chromium.executablePath()),
})
const riskyDraft = '# 社区阅读活动\n\n欢迎带一本喜欢的书。\n\n转发后领取资料。'
const officialHosts = [/weixin\.qq\.com$/u, /toutiao\.com$/u, /sohu\.com$/u, /baidu\.com$/u, /zhihu\.com$/u, /om\.qq\.com$/u]

try {
  await mkdir(out, { recursive: true })
  for (const [width, height] of [[1440, 722], [1024, 768], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 900, reducedMotion: 'reduce', locale: 'zh-CN' })
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
    const body = review.locator('#publish-review-details')
    const sources = review.locator('.publish-review__sources > summary')
    const copyBody = page.getByRole('button', { name: '复制正文', exact: true })
    const copyTitle = page.getByRole('button', { name: '复制标题', exact: true })
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText())
    const typeset = async (markdown) => {
      if (await source.evaluate((el) => el.readOnly)) {
        const prompt = page.waitForEvent('dialog')
        const importing = page.locator('.panel--source input[accept^=".md,"]').setInputFiles({ name: '预检样稿.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) })
        await (await prompt).accept()
        await importing
        await page.locator('.status-chip[data-state="ready"]').waitFor()
      } else await source.fill(markdown)
      await page.getByRole('button', { name: '一键排版', exact: true }).click()
      await page.locator('.status-chip[data-state="typeset"]').waitFor()
    }
    const toggleSummary = async (open) => {
      if (await body.isVisible() !== open) await summary.press('Enter')
      await body.waitFor({ state: open ? 'visible' : 'hidden' })
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
    assert.equal(await body.isVisible(), false, '发现风险不能替用户打开详情')
    await toggleSummary(true)
    await page.screenshot({ path: join(out, `risk-${width}.png`) })
    await toggleSources(true)
    assert.equal(await sources.evaluate((el) => getComputedStyle(el).outlineWidth), '2px')
    await page.screenshot({ path: join(out, `sources-${width}.png`) })
    await toggleSources(false)
    await toggleSummary(false)
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
    assert.equal(await source.evaluate((el) => el.readOnly), true)
    assert.equal(await source.inputValue(), riskyDraft)
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
    const compatToggle = compatibility.getByRole('button', { name: '百家号兼容性', exact: true })
    const compatPanel = compatibility.locator('[popover]')
    const checkCompatPlacement = async (mode) => {
      await compatToggle.scrollIntoViewIfNeeded()
      await compatPanel.waitFor({ state: 'hidden' })
      const geometry = () => page.locator('.preview__scroll').evaluate((el) => ({
        canvas: el.getBoundingClientRect().toJSON(), scroll: el.scrollTop, page: window.scrollY,
        article: document.querySelector('#platform-article').getBoundingClientRect().toJSON(),
      }))
      const baseline = await geometry()
      await compatToggle.press('Enter')
      await compatPanel.waitFor()
      const rect = await compatPanel.boundingBox()
      assert(rect && rect.x >= 0 && rect.x + rect.width <= width && rect.y >= 0 && rect.y + rect.height <= height)
      if (width >= 900) {
        assert(mode === 'focus' ? rect.x > width / 2 : rect.x + rect.width <= baseline.canvas.x)
      } else {
        assert(rect.height <= height * 0.4 && rect.y < 24)
      }
      assert.deepEqual(await geometry(), baseline, '打开兼容性详情不应挤压或滚动正文')
      await page.screenshot({ path: join(out, `compatibility-${mode}-${width}.png`) })
      if (mode === 'focus') await compatPanel.getByRole('button', { name: '关闭详情', exact: true }).click()
      else {
        await page.keyboard.press('Tab')
        assert(await compatPanel.getByRole('button', { name: '关闭详情', exact: true }).evaluate((el) => el === document.activeElement))
        await page.keyboard.press('Escape')
      }
      await compatPanel.waitFor({ state: 'hidden' })
      assert(await compatToggle.evaluate((el) => el === document.activeElement))
      assert.deepEqual(await geometry(), baseline, '关闭兼容性详情不应挤压或滚动正文')
    }
    await checkCompatPlacement('split')
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
    await checkCompatPlacement('focus')
    await attempt(copyBody, false, /百家号兼容性提示（2 项）.*网址仍在正文.*兼容性清单/su)
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
    await typeset(`# 社区阅读活动\n\n欢迎带一本喜欢的书。\n\n${before}\n\n如需了解社区活动的详情，请向志愿者核对联系方式。记录电话：138 0000 4724\n\n${after}`)
    assert.equal(await status.textContent(), '发现 1 项疑似风险')
    await toggleSummary(true)
    const phone = page.locator('#platform-article p').filter({ hasText: '138' })
    const jump = review.getByRole('button', { name: /^定位正文第/u })
    assert.match(await jump.getAttribute('aria-label'), /记录电话|请向志愿者/u)
    const scroller = page.locator('.preview__scroll')
    const scrolledBefore = await scroller.evaluate((el) => el.scrollTop)
    await jump.click()
    await body.waitFor({ state: 'hidden' })
    if (await scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 200)) {
      assert(await scroller.evaluate((el) => el.scrollTop) > scrolledBefore, '定位应把预览滚到命中处')
    }
    assert(await phone.evaluate((el) => {
      const block = el.getBoundingClientRect()
      const viewport = el.closest('.preview__scroll').getBoundingClientRect()
      return block.top >= viewport.top && block.bottom <= viewport.bottom
    }), '定位后目标段落应完整落在预览可视区')
    const marks = await page.evaluate(() => [...(CSS.highlights.get('studio-review-issue') ?? [])].map((range) => range.toString()))
    assert(marks.some((text) => text.includes('138 0000 4724')), '定位应高亮命中的号码')
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
    assert.equal(await body.isVisible(), false, '修改命中内容后不应自动打开详情')
    await toggleSummary(true)
    await review.getByRole('button', { name: '定位上次提示所在段落' }).click()
    await body.waitFor({ state: 'hidden' })
    assert.match(await review.locator('.visually-hidden[role="status"]').textContent(), /已定位到它所在的段落/u)
    const paragraphMark = await page.evaluate(() => [...(CSS.highlights.get('studio-review-issue') ?? [])].map(String))
    assert.deepEqual(paragraphMark, [await phone.textContent()], '命中内删两个字后高亮所在段，不跳邻段')
    await page.screenshot({ path: join(out, `paragraph-fallback-${width}.png`) })
    await article.focus()
    await article.evaluate((el) => {
      const block = [...el.querySelectorAll('p')].find((candidate) => candidate.textContent?.includes('138'))
      const range = document.createRange()
      range.selectNodeContents(block)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
    })
    await page.keyboard.press('Backspace')
    assert.equal(await status.textContent(), '本地未发现疑似风险')
    await review.getByRole('button', { name: '一键检测' }).click()
    assert.equal(await status.textContent(), '重新检测 · 本地未发现疑似风险')
    assert.equal(await body.isVisible(), false, '重新检测仅更新摘要，不打开详情')
    assert.match(await review.locator('.publish-review__check').first().textContent(), /已按当前正文检测/u)
    assert.equal(await review.locator('.publish-review__findings').count(), 0)
    await page.evaluate(() => navigator.clipboard.writeText('编辑前剪贴板'))
    await article.getByText('欢迎带一本喜欢的书。', { exact: true }).evaluate((paragraph) => {
      paragraph.closest('[contenteditable]').focus()
      const range = document.createRange()
      range.selectNodeContents(paragraph)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
    })
    await page.keyboard.insertText('转发后领取资料。')
    await attempt(copyBody, false)
    assert.equal(await clipboard(), '编辑前剪贴板')
    await attempt(copyBody, true)
    assert.match(await clipboard(), /转发后领取资料/u)
    await article.getByText('转发后领取资料。', { exact: true }).evaluate((paragraph) => {
      paragraph.closest('[contenteditable]').focus()
      const range = document.createRange()
      range.selectNodeContents(paragraph)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
    })
    await page.keyboard.insertText('欢迎带一本喜欢的书。')
    let unexpectedDialog = false
    const rejectUnexpected = (dialog) => { unexpectedDialog = true; return dialog.dismiss() }
    page.on('dialog', rejectUnexpected)
    try {
      await copyBody.click()
      assert.equal(unexpectedDialog, false, '移除当前成稿的风险后不应继续弹出旧风险')
      assert.match(await clipboard(), /欢迎带一本喜欢的书/u)
      assert.doesNotMatch(await clipboard(), /转发后领取资料|138 0000/u)
    } finally {
      page.off('dialog', rejectUnexpected)
    }
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

    const layoutDraft = '# 工厂交接记录\n\n' + '交接班先核对当天的生产记录，确认工序和人员安排。\n\n'.repeat(15) +
      '联系电话：138 0000 0000\n\n' + '下一段继续整理生产记录。\n\n'.repeat(15)
    await tabs.nth(0).click()
    await typeset(layoutDraft)
    await page.getByRole('button', { name: '编辑正文', exact: true }).click()
    const measure = () => page.locator('#platform-article').evaluate((el) => {
      const r = el.getBoundingClientRect()
      const scroller = el.closest('.preview__scroll')
      const viewport = scroller.getBoundingClientRect()
      return {
        top: r.top,
        width: r.width,
        visibleHeight: Math.max(0, Math.min(r.bottom, viewport.bottom, innerHeight) - Math.max(0, r.top, viewport.top)),
        scrollTop: scroller.scrollTop,
        pageScroll: window.scrollY,
      }
    })
    for (const mode of ['split', 'focus']) {
      if (mode === 'focus') await page.getByRole('button', { name: '专注编辑', exact: true }).click()
      assert.equal(await body.isVisible(), false)
      await summary.evaluate((el) => { el.closest('.preview__scroll').scrollTop = 0 })
      await summary.scrollIntoViewIfNeeded()
      await summary.focus()
      const beforeLayout = await measure()
      await page.screenshot({ path: join(out, `layout-${mode}-${width}-closed.png`) })
      await toggleSummary(true)
      assert.deepEqual(await measure(), beforeLayout, `${mode}: 打开详情不应改变布局或滚动位置`)
      const panelBox = await body.boundingBox()
      assert(panelBox.x >= 0 && panelBox.y >= 0 && panelBox.x + panelBox.width <= width && panelBox.y + panelBox.height <= height)
      if (mode === 'split' && width >= 900) {
        const articleBox = await article.boundingBox()
        assert(panelBox.x + panelBox.width < articleBox.x, '双栏详情不遮挡成稿')
      }
      if (width < 900) {
        assert(panelBox.height <= height * 0.4 + 1, '窄屏详情需要限高')
        assert(panelBox.y + panelBox.height <= beforeLayout.top, '窄屏顶部的详情不能盖住样稿正文')
      }
      await page.screenshot({ path: join(out, `layout-${mode}-${width}-open.png`) })
      const close = body.getByRole('button', { name: '关闭详情' })
      await page.keyboard.press('Tab')
      assert(await close.evaluate((el) => document.activeElement === el && getComputedStyle(el).outlineWidth === '2px'))
      await page.keyboard.press('Escape')
      await body.waitFor({ state: 'hidden' })
      assert(await summary.evaluate((el) => document.activeElement === el), '关闭后焦点应回到预检入口')
      assert.deepEqual(await measure(), beforeLayout, `${mode}: 关闭详情不应改变布局或滚动位置`)
      if (mode === 'focus') assert(await page.getByRole('button', { name: '退出专注' }).isVisible())
      console.log(`${width}×${height} ${mode}: 正文可见高度开合均为 ${Math.round(beforeLayout.visibleHeight)}px`)
    }

    assert.deepEqual(externalRequests, [])
    assert.deepEqual(pageErrors, [])
    console.log(`${width}px: 发布预检、定位跳转、一键检测、两条明文网址兼容提醒、逐次确认、取消保留剪贴板、键盘、专注及平台切换通过`)
    await context.close()
  }
  console.log(`Chromium ${browser.version()}`)
} finally {
  await browser.close()
}
