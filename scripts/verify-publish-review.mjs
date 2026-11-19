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
    const summary = review.locator(':scope > summary')
    const sources = review.locator('.publish-review__sources > summary')
    const copyBody = page.getByRole('button', { name: '复制正文', exact: true })
    const copyTitle = page.getByRole('button', { name: '复制标题', exact: true })
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText())
    const typeset = async (markdown) => {
      await source.fill(markdown)
      await page.getByRole('button', { name: '一键排版' }).click()
      await page.locator('.status-chip[data-state="typeset"]').waitFor()
    }
    const toggle = async (control, open) => {
      if (await control.evaluate((el) => el.parentElement.open) !== open) await control.press('Enter')
      assert.equal(await control.evaluate((el) => el.parentElement.open), open)
    }
    assert.equal(await status.textContent(), '等待一键排版')
    for (const [index, host] of officialHosts.entries()) {
      await tabs.nth(index).click()
      await toggle(summary, true)
      await toggle(sources, true)
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
    assert.equal(await summary.evaluate((el) => el.parentElement.open), true)
    await page.screenshot({ path: join(out, `risk-${width}.png`) })
    await toggle(sources, true)
    assert.equal(await sources.evaluate((el) => getComputedStyle(el).outlineWidth), '2px')
    await page.screenshot({ path: join(out, `sources-${width}.png`) })
    await toggle(sources, false)
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
    await toggle(summary, true)
    assert.match(await review.locator('.publish-review__note').first().textContent(), /不等于平台审核通过/u)
    await toggle(summary, false)
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
    assert.deepEqual(externalRequests, [])
    assert.deepEqual(pageErrors, [])
    console.log(`${width}px: 发布预检、两条明文网址兼容提醒、逐次确认、取消保留剪贴板、键盘、专注及平台切换通过`)
    await context.close()
  }
  console.log(`Chromium ${browser.version()}`)
} finally {
  await browser.close()
}
