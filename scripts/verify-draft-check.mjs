import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'

export async function verifyDraftCheck({ browser, target, png }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: target.origin })
    const externalRequests = []
    const requests = []
    const endpoint = 'https://api.deepseek.com/chat/completions'
    let replyKind = 'normal'
    await context.route('**/*', async (route) => {
      const request = route.request()
      if (new URL(request.url()).origin === target.origin) return route.continue()
      if (request.url() !== endpoint) {
        externalRequests.push(request.url())
        return route.abort()
      }
      const { messages, model } = request.postDataJSON()
      const payload = JSON.parse(messages[1].content)
      requests.push({ payload, model })
      const issues = payload.blocks.flatMap(({ id, text: block }) => ['按装', '，，', '已经已经', '一段长句'.repeat(22)]
        .filter((quote) => block.includes(quote)).map((quote) => ({ block: id, quote, problem: '样稿校对', suggestion: '人工核对' })))
      const kind = replyKind
      if (kind === 'slow') await new Promise((resolve) => setTimeout(resolve, 450))
      // A canceled navigation/request can close this route before its delayed reply.
      try {
        await route.fulfill({
          status: kind === 'error' ? 429 : 200,
          headers: { 'access-control-allow-origin': request.headers().origin ?? target.origin },
          json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ issues: kind === 'empty' ? [] : issues }) } }] },
        })
      } catch (error) {
        if (kind !== 'slow') throw error
      }
    })
    const officialLinks = [
      ['在 DeepSeek 开放平台创建', 'https://platform.deepseek.com/api_keys'],
      ['DeepSeek API 充值', 'https://platform.deepseek.com/top_up'],
    ]
    const verifyOfficialLinks = async (modal) => {
      for (const [name, href] of officialLinks) {
        const link = modal.getByRole('link', { name, exact: true })
        await link.waitFor()
        assert.equal(await link.getAttribute('href'), href)
        assert.equal(await link.getAttribute('target'), '_blank')
        assert.match(await link.getAttribute('rel'), /\bnoreferrer\b/u)
      }
    }
    await context.route(/^https:\/\/platform\.deepseek\.com\/(api_keys|top_up)$/u, async (route) => {
      assert.equal(await route.request().headerValue('referer'), null)
      await route.fulfill({ contentType: 'text/html', body: '<title>DeepSeek 官方链接测试</title>' })
    })
    // Compare the same assets under non-loopback HTTP and HTTPS browser origins.
    // A built preview can be supplied separately from the full localhost workflow.
    const deploymentSource = new URL(process.env.AI_DEPLOYMENT_SOURCE_URL ?? target.href)
    const serveDeploymentAssets = async (route) => {
      const { pathname, search } = new URL(route.request().url())
      await route.fulfill({ response: await context.request.get(new URL(pathname + search, deploymentSource).href) })
    }
    const openDeploymentSettings = async (page, origin, secure) => {
      await page.route(`${origin}/**`, deploymentSource.origin === origin ? (route) => route.continue() : serveDeploymentAssets)
      await page.goto(new URL(deploymentSource.pathname, origin).href)
      assert.equal(await page.evaluate(() => window.isSecureContext), secure)
      const settingsButton = page.getByRole('button', { name: 'AI 设置', exact: true })
      await settingsButton.click()
      const modal = page.getByRole('dialog', { name: 'DeepSeek 校对设置' })
      return { settingsButton, modal, keyField: modal.getByLabel('API Key', { exact: true }) }
    }
    for (const protocol of ['http', 'https']) {
      const origin = `${protocol}://workbench.test`
      const secure = protocol === 'https'
      const deployed = await context.newPage()
      deployed.setDefaultTimeout(5000)
      try {
        const { settingsButton, modal, keyField } = await openDeploymentSettings(deployed, origin, secure)
        const testButton = modal.getByRole('button', { name: '测试连接' })
        assert.equal(await modal.getByLabel('API 地址（固定）', { exact: true }).inputValue(), endpoint)
        assert.equal(await keyField.isDisabled(), !secure)
        assert.equal(await testButton.isDisabled(), true)
        assert.equal(await modal.getByRole('button', { name: '启用 DeepSeek' }).isDisabled(), true)
        await verifyOfficialLinks(modal)
        if (secure) {
          assert.equal(await keyField.evaluate((el) => document.activeElement === el), true)
          if (process.env.AI_SCREENSHOT_DIR) await deployed.screenshot({ path: `${process.env.AI_SCREENSHOT_DIR}/deepseek-settings-https.png` })
          await deployed.keyboard.type('abc123')
          assert.equal(await keyField.inputValue(), 'abc123')
          await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
          await deployed.evaluate(() => navigator.clipboard.writeText('browser-test-only'))
          await deployed.keyboard.press('ControlOrMeta+A')
          await deployed.keyboard.press('ControlOrMeta+V')
          assert.equal(await keyField.inputValue(), 'browser-test-only')
          assert.equal(await testButton.isEnabled(), true)
        } else {
          await modal.getByText(/当前连接不安全.*HTTPS.*localhost/u).waitFor()
          assert.equal(await modal.getByRole('button', { name: '取消' }).evaluate((el) => document.activeElement === el), true)
          if (process.env.AI_SCREENSHOT_DIR) await deployed.screenshot({ path: `${process.env.AI_SCREENSHOT_DIR}/deepseek-settings-insecure.png` })
          for (const [name, href] of officialLinks) {
            const popupOpened = deployed.waitForEvent('popup')
            await modal.getByRole('link', { name, exact: true }).press('Enter')
            const popup = await popupOpened
            try {
              assert.equal(popup.url(), href)
              assert.equal(await popup.evaluate(() => window.opener === null), true)
            } finally {
              await popup.close()
            }
          }
          assert.equal(await settingsButton.isVisible(), true)
          assert.equal(await modal.isVisible(), true)
        }
        assert.equal(requests.length, 0, '打开外链、输入和粘贴均不触发 API 请求')
        await deployed.keyboard.press('Escape')
        await modal.waitFor({ state: 'hidden' })
        assert.equal(await settingsButton.evaluate((el) => document.activeElement === el), true)
      } finally {
        await deployed.close()
      }
    }

    const lanOrigin = 'http://192.168.0.101:4173'
    const lan = await context.newPage()
    lan.setDefaultTimeout(5000)
    const clipboardPage = await context.newPage()
    try {
      const { settingsButton: settings, modal, keyField: key } = await openDeploymentSettings(lan, lanOrigin, false)
      const unlock = modal.getByRole('button', { name: '了解风险，临时允许输入' })
      const test = modal.getByRole('button', { name: '测试连接' })
      const apply = modal.getByRole('button', { name: '启用 DeepSeek' })
      assert.equal(await key.isDisabled(), true)
      assert.equal(await test.isDisabled(), true)
      assert.equal(await modal.getByText(/局域网 HTTP 不加密/u).isVisible(), true)
      assert.equal(await unlock.evaluate((el) => document.activeElement === el), true)
      await lan.setViewportSize({ width: 390, height: 640 })
      assert.equal(await modal.evaluate((el) => el.scrollWidth <= el.clientWidth), true)
      await unlock.press('Enter')
      assert.equal(await key.evaluate((el) => document.activeElement === el), true)
      await lan.keyboard.type('lan-typed-test')
      assert.equal(await key.inputValue(), 'lan-typed-test')
      await clipboardPage.goto(target.href)
      await clipboardPage.bringToFront()
      await clipboardPage.evaluate(() => navigator.clipboard.writeText('lan-pasted-test'))
      await lan.bringToFront()
      await lan.keyboard.press('ControlOrMeta+A')
      await lan.keyboard.press('ControlOrMeta+V')
      assert.equal(await key.inputValue(), 'lan-pasted-test')
      assert.equal(await modal.getByText('在此浏览器记住配置').count(), 0)
      assert.equal(requests.length, 0, '解锁、输入和粘贴不触发 API 请求')
      assert.equal(await apply.isDisabled(), true)
      await test.click()
      await modal.getByText(/连接成功/u).waitFor()
      assert.equal(await apply.isDisabled(), true)
      await modal.getByRole('checkbox', { name: /我同意/u }).check()
      await apply.click()
      await modal.waitFor({ state: 'hidden' })
      assert.equal(requests.length, 1)
      assert.equal(await lan.evaluate(() => localStorage.getItem('typeset-studio:deepseek-config:v1')), null)
      await lan.reload()
      await settings.click()
      assert.equal(await unlock.isVisible(), true)
      assert.equal(await key.isDisabled(), true)
      assert.equal(await key.inputValue(), '')
      await lan.setContent('<iframe src="/?embedded"></iframe>')
      const frame = lan.frameLocator('iframe')
      await frame.getByRole('button', { name: 'AI 设置', exact: true }).click()
      assert.equal(await frame.getByLabel('API Key', { exact: true }).isDisabled(), true)
      assert.equal(await frame.getByRole('button', { name: '了解风险，临时允许输入' }).count(), 0)
      requests.length = 0
    } finally {
      await clipboardPage.close()
      await lan.close()
    }

    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    await page.goto(target.href)
    const source = page.locator('#source-markdown')
    const article = page.locator('#platform-article')
    const check = page.getByRole('button', { name: 'AI 检查内容', exact: true })
    const findings = page.getByRole('list', { name: 'AI 检查结果' })
    const locator = page.getByRole('group', { name: 'AI 定位导航' })
    const previous = locator.getByRole('button', { name: '上一处' })
    const next = locator.getByRole('button', { name: '下一处' })
    const current = locator.getByRole('button', { name: '回到此处' })
    const localCheck = page.getByRole('button', { name: '本地比对', exact: true })
    const localFindings = page.getByRole('list', { name: '本地比对结果' })
    const details = page.locator('#article-check-details')
    const aiStatus = details.locator('.content-check__summary').first()
    const showChecks = async () => {
      if (await details.isHidden()) await check.click()
      await details.waitFor()
    }
    const recheck = async () => {
      await showChecks()
      await details.getByRole('button', { name: '重新检查', exact: true }).click()
    }
    const checkAiPlacement = async (mode, width, height) => {
      await check.scrollIntoViewIfNeeded()
      await details.waitFor({ state: 'hidden' })
      const measure = () => article.evaluate((el) => {
        const scroller = el.closest('.preview__scroll')
        return { canvas: scroller.getBoundingClientRect().toJSON(), article: el.getBoundingClientRect().toJSON(),
          scrollTop: scroller.scrollTop, pageTop: window.scrollY }
      })
      const before = await measure()
      const previousRequests = requests.length
      await check.press('Enter')
      await findings.waitFor()
      assert.equal(requests.length, previousRequests, '重新打开结果不发送稿件')
      const rect = await details.boundingBox()
      assert(rect && rect.x >= 0 && rect.x + rect.width <= width && rect.y >= 0 && rect.y + rect.height <= height)
      if (width >= 900) assert(mode === 'focus' ? rect.x > width / 2 : rect.x + rect.width <= before.canvas.x)
      else assert(rect.height <= height * 0.4 && rect.y < 24)
      assert.deepEqual(await measure(), before, '打开已有检查结果不应移动正文')
      if (process.env.AI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.AI_SCREENSHOT_DIR}/check-side-${mode}-${width}.png` })
      await page.keyboard.press('Tab')
      assert(await details.getByRole('button', { name: '关闭详情' }).evaluate((el) => el === document.activeElement))
      await page.keyboard.press('Escape')
      await details.waitFor({ state: 'hidden' })
      assert(await check.evaluate((el) => el === document.activeElement), '关闭内容检查后回到入口')
      assert.deepEqual(await measure(), before, '关闭内容检查不应移动正文')
    }
    const drop = (element, files, caret) => element.evaluate((el, { files, caret }) => {
      const transfer = new DataTransfer()
      for (const { name, type, bytes, size } of files) {
        transfer.items.add(new File([new Uint8Array(bytes ?? size)], name, { type }))
      }
      const point = { clientX: 0, clientY: 0 }
      if (caret) {
        const block = Array.from(el.querySelectorAll('p')).find((candidate) => candidate.textContent === caret.text)
        const range = document.createRange()
        range.setStart(block.firstChild, caret.offset)
        range.collapse(true)
        const rect = range.getBoundingClientRect()
        point.clientX = Math.max(1, rect.x)
        point.clientY = rect.y + rect.height / 2
      }
      for (const event of ['dragover', 'drop']) {
        el.dispatchEvent(new DragEvent(event, { bubbles: true, cancelable: true, dataTransfer: transfer, ...point }))
      }
    }, { files, caret })
    const text = (name, value) => ({ name, type: 'text/plain', bytes: [...Buffer.from(value)] })
    const typeset = async () => {
      await page.getByRole('button', { name: '一键排版', exact: true }).click()
      await page.locator('.status-chip[data-state="typeset"]').waitFor()
    }
    const draft = [
      '# 按装指南',
      '第一次按**装**软件，，',
      ...Array(14).fill('这是将第二处错写和表格放到较远位置的一段正文。'),
      '第二次按装软件，已经已经下载。',
      '一段长句'.repeat(22) + '。',
      '| 列名称 | 数量 |\n| --- | --- |\n| 零件 | 1 |',
      '请参考[操作说明](https://example.test/manual)。',
      '`按装` 和 https://example.test/按装。',
      '插入图片测试：图前图后',
    ].join('\n\n')

    await drop(source, [text('校对样稿.txt', draft)])
    await page.getByText(/已导入 校对样稿/).waitFor()
    assert.equal(await source.inputValue(), draft)
    assert.equal(await source.evaluate((el) => el.readOnly), true)
    await drop(source, [{ name: '损坏.md', type: 'text/markdown', bytes: [255, 254, 253] }])
    await page.getByText(/不是 UTF-8 编码/u).waitFor()
    await drop(source, [text('无效.docx', '内容')])
    await page.getByText(/只接收 Markdown 或 TXT/u).waitFor()
    await drop(source, [text('一.md', '第一份'), text('二.md', '第二份')])
    await page.getByText('一次只能导入一份稿件。', { exact: true }).waitFor()
    for (const accept of [false, true]) {
      const prompt = page.waitForEvent('dialog')
      const replacement = drop(source, [text('替换.md', accept ? draft.replaceAll('\n', '\r\n') : '被取消的稿件')])
      const dialog = await prompt
      assert.match(dialog.message(), /会替换左侧原稿.*右侧六个平台/u)
      if (accept) await dialog.accept()
      else await dialog.dismiss()
      await replacement
      assert.equal(await source.inputValue(), draft)
    }

    await typeset()
    await check.click()
    const settings = page.getByRole('dialog', { name: 'DeepSeek 校对设置' })
    const keyField = settings.getByLabel('API Key', { exact: true })
    const setupButton = settings.getByRole('button', { name: '启用 DeepSeek' })
    await settings.waitFor()
    assert.equal(requests.length, 0)
    assert.equal(await keyField.evaluate((el) => document.activeElement === el), true, '弹窗打开后可直接输入 API Key')
    assert.equal(await keyField.getAttribute('type'), 'password')
    assert.deepEqual(await settings.locator('.field__label').allTextContents(), ['API 地址（固定）', '模型', 'API Key'])
    const apiAddress = settings.getByLabel('API 地址（固定）', { exact: true })
    const modelField = settings.getByLabel('模型', { exact: true })
    const createKey = settings.getByRole('link', { name: '在 DeepSeek 开放平台创建' })
    assert.equal(await apiAddress.getAttribute('readonly'), '')
    assert.equal(await apiAddress.inputValue(), endpoint)
    await verifyOfficialLinks(settings)
    await page.keyboard.press('Shift+Tab')
    assert.equal(await modelField.evaluate((el) => document.activeElement === el), true)
    await page.keyboard.press('Shift+Tab')
    assert.equal(await apiAddress.evaluate((el) => document.activeElement === el), true)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('ControlOrMeta+C')
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), endpoint)
    await page.keyboard.press('X')
    assert.equal(await apiAddress.inputValue(), endpoint)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    assert.equal(await createKey.evaluate((el) => document.activeElement === el), true)
    for (const [width, height] of [[1440, 900], [1024, 768], [390, 640]]) {
      await page.setViewportSize({ width, height })
      const bounds = await settings.boundingBox()
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width)
      assert(await settings.evaluate((el) => el.scrollWidth <= el.clientWidth))
      if (process.env.AI_SCREENSHOT_DIR) {
        await settings.screenshot({ path: `${process.env.AI_SCREENSHOT_DIR}/deepseek-layout-${width}.png` })
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.keyboard.press('Escape')
    await settings.waitFor({ state: 'hidden' })
    assert.equal(await check.evaluate((el) => document.activeElement === el), true)
    await check.click()
    await page.keyboard.type('abc123')
    assert.equal(await keyField.inputValue(), 'abc123')
    await page.evaluate(() => navigator.clipboard.writeText('browser-test-only'))
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('ControlOrMeta+V')
    assert.equal(await keyField.inputValue(), 'browser-test-only')
    assert.equal(requests.length, 0, '输入和粘贴不能发出请求')
    assert.equal(await setupButton.isDisabled(), true)
    await settings.getByRole('button', { name: '测试连接' }).click()
    await settings.getByRole('status').filter({ hasText: '连接成功' }).waitFor()
    assert.equal(await setupButton.isDisabled(), true)
    const remember = settings.getByRole('checkbox', { name: '在此浏览器记住配置' })
    assert.equal(await remember.isChecked(), false)
    await settings.getByRole('checkbox', { name: /^我同意/u }).check()
    assert.equal(requests.length, 1)
    assert.match(requests[0].payload.blocks[0].text, /固定样例/u)
    assert.equal(requests[0].model, 'deepseek-flash')
    const screenshots = process.env.AI_SCREENSHOT_DIR
    if (screenshots) {
      await page.screenshot({ path: `${screenshots}/deepseek-settings-desktop.png` })
      await page.setViewportSize({ width: 1024, height: 768 })
      await page.screenshot({ path: `${screenshots}/deepseek-settings-compact.png` })
      await page.setViewportSize({ width: 1440, height: 900 })
    }
    await setupButton.click()
    await settings.waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => localStorage.getItem('typeset-studio:deepseek-config:v1') === null), true)
    await page.getByRole('tab', { name: /^百家/ }).click()
    const compatibility = page.locator('.compat')
    await compatibility.getByRole('button', { name: '百家号兼容性', exact: true }).click()
    await compatibility.getByRole('button', { name: /定位.*表格已按原行序/u }).click()
    await compatibility.locator('[popover]').waitFor({ state: 'hidden' })
    const marks = (name) => page.evaluate((name) => [...CSS.highlights.get(name) ?? []].map(String), name)
    assert((await marks('studio-compat-issue')).some((range) => /列名称：零件.*数量：1/u.test(range)))
    const alreadyDegraded = compatibility.locator('li').filter({ hasText: '操作说明' })
    assert.match(await alreadyDegraded.textContent(), /重新排版确认/u)
    // 百家号成稿没有 <a>，不能把源稿快照伪装成实时定位；在保留外链的平台验证实际结构差异。
    await page.getByRole('tab', { name: /^搜狐/ }).click()
    await page.getByRole('button', { name: '编辑正文', exact: true }).click()
    const originalLinkCount = await article.locator('a[href^="https:"]').count()
    await article.locator('a[href="https://example.test/manual"]').evaluate((link) => {
      link.replaceWith(...link.childNodes)
      document.querySelector('#platform-article').dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    assert.equal(await source.inputValue(), draft)
    await localCheck.click()
    const linkLoss = localFindings.locator('li').filter({ hasText: `外链 ${originalLinkCount}→${originalLinkCount - 1}` })
    await linkLoss.getByRole('button', { name: /定位/u }).click()
    assert.match(await linkLoss.textContent(), /未能定位.*全篇数量变化/u)
    await article.getByText('第二次按装软件，已经已经下载。', { exact: true }).evaluate((paragraph) => {
      paragraph.remove()
      document.querySelector('#platform-article').dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await localCheck.click()
    const missing = localFindings.locator('li').filter({ hasText: '疑似缺失段落' })
    await missing.getByRole('button', { name: /定位/u }).click()
    assert.match(await missing.textContent(), /第二次按装.*未能定位.*已经不在当前成稿/u)
    await page.getByRole('tab', { name: /^百家/ }).click()

    const originalHtml = await article.innerHTML()
    await check.click()
    await findings.waitFor()
    if (screenshots) await page.screenshot({ path: `${screenshots}/deepseek-findings-desktop.png` })
    await page.getByRole('heading', { name: '多平台排版', exact: true }).click()
    await details.waitFor({ state: 'hidden' })
    await checkAiPlacement('split', 1440, 900)
    await showChecks()
    assert.doesNotMatch(JSON.stringify(requests.at(-1).payload), /https:|example\.test/u)
    const originals = await marks('studio-content-issue')
    assert.equal(originals.filter((range) => range === '按装').length, 3)
    assert(originals.includes('，，') && originals.includes('已经已经'))
    assert(originals.some((range) => range === '一段长句'.repeat(22)))
    const typos = findings.getByRole('button', { name: '定位正文中的「按装」', exact: true })
    assert.equal(await locator.count(), 1)
    assert(await previous.isDisabled() && await next.isDisabled(), '未定位前不显示可用的上下处')
    await locator.getByRole('button', { name: '定位首处' }).focus()
    await page.keyboard.press('Enter')
    assert.match(await locator.textContent(), /第 1 \/ 6 处.*标题 · 按装/u)
    assert(await previous.isDisabled())
    await typos.nth(1).click()
    await details.waitFor({ state: 'hidden' })
    const bodyHit = page.getByText('第二次按装软件，已经已经下载。', { exact: true })
    const visibleApartFromBars = (target) => target.evaluate((el) => {
      const block = el.getBoundingClientRect()
      const scroller = el.closest('.preview__scroll')
      const viewport = scroller.getBoundingClientRect()
      const locator = document.querySelector('.ai-locator').getBoundingClientRect()
      const review = scroller.querySelector('.publish-review')
      const inset = review && getComputedStyle(review).position === 'sticky' ? review.getBoundingClientRect().bottom : 0
      return block.top >= Math.max(0, locator.bottom, viewport.top, inset)
        && block.bottom <= Math.min(innerHeight, viewport.bottom)
        && locator.top >= 0 && locator.bottom <= innerHeight
    })
    assert(await visibleApartFromBars(bodyHit), '长文第二处命中与定位栏应同时在视野内，且不被预检挡住')
    assert.match(await locator.textContent(), /第 4 \/ 6 处.*正文 · 按装/u)
    assert.equal(await details.locator('.content-check__list [aria-current="true"]').count(), 1)
    assert.deepEqual(await marks('studio-content-current'), ['按装'])
    assert(await current.evaluate((el) => el === document.activeElement), '列表定位后键盘焦点回到可见导航')
    if (screenshots) await page.screenshot({ path: `${screenshots}/ai-locator-1440.png` })
    await bodyHit.evaluate((el) => { el.closest('.preview__scroll').scrollTop = 0 })
    await current.focus()
    await page.keyboard.press('Enter')
    assert(await visibleApartFromBars(bodyHit), '手动滚开后可重新回到同一处')
    await page.keyboard.press('Tab')
    assert(await next.evaluate((el) => el === document.activeElement && el.matches(':focus-visible')))
    await page.keyboard.press('Enter')
    assert.match(await locator.textContent(), /第 5 \/ 6 处/u)
    assert.deepEqual(await marks('studio-content-current'), ['已经已经'])
    await page.keyboard.press('Enter')
    assert.match(await locator.textContent(), /第 6 \/ 6 处/u)
    assert(await next.isDisabled())
    await page.keyboard.press('Enter')
    assert.match(await locator.textContent(), /第 6 \/ 6 处/u)
    await previous.click()
    assert.match(await locator.textContent(), /第 5 \/ 6 处/u)
    await page.setViewportSize({ width: 1024, height: 768 })
    await checkAiPlacement('split', 1024, 768)
    await current.click()
    assert(await visibleApartFromBars(bodyHit))
    if (screenshots) await page.screenshot({ path: `${screenshots}/ai-locator-1024.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    await current.click()
    assert(await visibleApartFromBars(bodyHit), '窄屏页面滚动时也能在原句旁保留定位栏')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    if (screenshots) await page.screenshot({ path: `${screenshots}/ai-locator-390.png` })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: '专注编辑', exact: true }).click()
    assert.match(await locator.textContent(), /第 5 \/ 6 处/u)
    await checkAiPlacement('focus', 1440, 900)
    await page.setViewportSize({ width: 390, height: 844 })
    await checkAiPlacement('focus', 390, 844)
    await page.setViewportSize({ width: 1440, height: 900 })
    await current.click()
    assert(await visibleApartFromBars(bodyHit), '专注编辑沿用选中项，并能直接回到原句')
    if (screenshots) await page.screenshot({ path: `${screenshots}/ai-locator-focus.png` })
    await page.getByRole('button', { name: '退出专注', exact: true }).click()
    await page.getByRole('button', { name: '完成编辑', exact: true }).click()
    assert.equal(await article.innerHTML(), originalHtml, '检查不写入编辑正文')
    const copyDialog = page.waitForEvent('dialog')
    const copy = page.getByRole('button', { name: '复制正文', exact: true }).click()
    await (await copyDialog).accept()
    await copy
    const clipboard = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read()
      return (await item.getType('text/html')).text()
    })
    assert.match(clipboard, /按/u)
    assert.doesNotMatch(clipboard, /studio-(?:content-(?:issue|current)|compat-issue)|uma-source/u)

    await page.getByRole('button', { name: '编辑正文', exact: true }).click()
    await showChecks()
    await findings.getByRole('button', { name: '定位标题中的「按装」' }).click()
    const title = page.getByRole('textbox', { name: '当前平台标题' })
    assert(await title.evaluate((el) => el === document.activeElement
      && el.value.slice(el.selectionStart, el.selectionEnd) === '按装'))
    await next.click()
    await next.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Enter')
    assert.match(await locator.textContent(), /第 1 \/ 6 处.*标题 · 按装/u)
    assert(await previous.evaluate((el) => el === document.activeElement), '从导航跳到编辑标题时保留键盘导航焦点')
    const beforeEditingRequests = requests.length
    await title.fill('安装指南')
    assert.equal(await details.locator('.content-check__list li').count(), 6, '改标题后保留整批建议')
    await locator.getByText(/原句已改.*当前标题/u).waitFor()
    assert.match(await locator.textContent(), /第 1 \/ 6 处/u)
    await current.click()
    assert(await title.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd) === '安装指南'))
    const changeParagraph = (target, value) => target.evaluate((paragraph, value) => {
      paragraph.textContent = value
      paragraph.closest('article').dispatchEvent(new InputEvent('input', { bubbles: true }))
    }, value)
    await changeParagraph(bodyHit, '说明：第二次按装软件，已经已经下载。')
    await showChecks()
    await typos.nth(1).click()
    assert.deepEqual(await marks('studio-content-current'), ['按装'], '原句前加字后仍精确定位')
    const editedBody = article.getByText('说明：第二次安装软件，已经已经下载。', { exact: true })
    await changeParagraph(article.getByText('说明：第二次按装软件，已经已经下载。', { exact: true }),
      '说明：第二次安装软件，已经已经下载。')
    await locator.getByText(/原句已改.*所在段落/u).waitFor()
    assert.match(await locator.textContent(), /第 4 \/ 6 处/u)
    assert.deepEqual(await marks('studio-content-current'), [await editedBody.textContent()])
    if (screenshots) await page.screenshot({ path: `${screenshots}/ai-locator-edited-desktop.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    await current.click()
    assert(await visibleApartFromBars(editedBody), '窄屏改后仍可回到实际段落')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    if (screenshots) await page.screenshot({ path: `${screenshots}/ai-locator-edited-390.png` })
    await page.setViewportSize({ width: 1440, height: 900 })
    await next.click()
    assert.deepEqual(await marks('studio-content-current'), ['已经已经'], '同一段没改到的问题照常精确定位')
    await page.getByRole('button', { name: '完成编辑', exact: true }).click()
    await previous.click()
    assert.deepEqual(await marks('studio-content-current'), [await editedBody.textContent()], '结束编辑导致正文重绘后仍可回到改后的段落')
    await page.getByRole('button', { name: '专注编辑', exact: true }).click()
    await editedBody.evaluate((paragraph) => {
      const article = paragraph.closest('article')
      paragraph.remove()
      article.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await locator.getByText(/无法定位/u).waitFor()
    assert.match(await locator.textContent(), /第 4 \/ 6 处/u)
    await current.click()
    assert.deepEqual(await marks('studio-content-current'), [], '删掉段落后不跳到别段的相同词')
    await showChecks()
    assert.equal(await findings.locator('li').count(), 6)
    await findings.locator('[aria-current="true"]').getByRole('button').click()
    assert(await details.isVisible(), '无法定位时保留详情和失败说明')
    assert.equal(requests.length, beforeEditingRequests, '改稿和定位不重新请求 AI')
    if (screenshots) await page.screenshot({ path: `${screenshots}/ai-locator-deleted-focus.png` })
    await page.getByRole('button', { name: '退出专注', exact: true }).click()
    await article.getByText('请参考操作说明。', { exact: true }).scrollIntoViewIfNeeded()
    await drop(article, [{ name: '保护位置.png', type: 'image/png', bytes: [...png] }],
      { text: '请参考操作说明。', offset: '请参考'.length })
    await article.getByRole('img', { name: '保护位置' }).waitFor()
    assert.equal(await source.inputValue(), draft)
    await page.getByRole('button', { name: '完成编辑', exact: true }).click()

    await page.getByRole('tab', { name: /^公众号/ }).click()
    assert.equal(await findings.count(), 0)
    assert.equal((await marks('studio-content-issue')).length, 0)
    assert.equal((await marks('studio-content-current')).length, 0)
    assert.equal(await locator.count(), 0)
    await check.click()
    await typeset()
    assert.equal(await findings.count(), 0, '重新排版清除旧校对结果')
    await page.getByRole('button', { name: '编辑正文', exact: true }).click()
    await check.click()
    await findings.waitFor()
    const place = article.getByText('插入图片测试：图前图后', { exact: true })
    await place.scrollIntoViewIfNeeded()
    const caret = { text: '插入图片测试：图前图后', offset: '插入图片测试：图前'.length }
    await drop(article, [{ name: '过大.png', type: 'image/png', size: 5 * 1024 * 1024 + 1 }], caret)
    await page.getByRole('alert').filter({ hasText: '单张图片不能超过 5 MB' }).waitFor()
    assert.equal(await source.inputValue(), draft)
    await drop(article, [{ name: '配图.png', type: 'image/png', bytes: [...png] }], caret)
    await article.locator('img[alt="配图"]').waitFor()
    assert.match(await article.innerHTML(), /图前<img[^>]*>图后/u)
    assert.equal(await source.inputValue(), draft, '右侧图片不应自动写入左侧')
    assert.equal(await page.getByRole('button', { name: '同步到源稿', exact: true }).count(), 0)
    assert.equal(await details.locator('.content-check__list').count(), 1, '插入图片不清除已完成的检查')
    assert.equal(await locator.count(), 1, '插入图片不清除旧定位栏')
    await typeset()
    assert.match(await article.locator('img[alt="配图"]').getAttribute('src'), /^data:image\/png/u)
    await check.click()
    await page.getByRole('button', { name: '撤销右侧改动', exact: true }).click()
    assert.equal(await findings.count(), 0, '撤销当前平台编辑清除旧校对结果')
    replyKind = 'error'
    await check.click()
    await aiStatus.filter({ hasText: '请求过于频繁' }).waitFor()
    assert.equal(await locator.count(), 0)
    replyKind = 'empty'
    await recheck()
    await aiStatus.filter({ hasText: '未发现明显问题' }).waitFor()
    assert.equal(await locator.count(), 0)
    replyKind = 'slow'
    await recheck()
    await aiStatus.filter({ hasText: '正在检查' }).waitFor()
    await page.getByRole('button', { name: '取消 AI 检查' }).click()
    await aiStatus.filter({ hasText: '已取消' }).waitFor()
    assert.equal(await findings.count(), 0)
    await recheck()
    await aiStatus.filter({ hasText: '正在检查' }).waitFor()
    await page.getByRole('tab', { name: /^搜狐/ }).click()
    await page.getByRole('tab', { name: /^公众号/ }).click()
    assert.equal(await findings.count(), 0)
    replyKind = 'normal'
    const isolationDraft = '# 平台独立验收\n\n请访问[网站链接](https://example.test/site)。\n\n故意整段删掉的原文。\n\n这里是完全不同的相邻段。'
    const importPrompt = page.waitForEvent('dialog')
    const importNew = drop(source, [text('平台独立验收.md', isolationDraft)])
    await (await importPrompt).accept()
    await importNew
    await page.getByText(/已导入 平台独立验收/u).waitFor()
    await typeset()
    const sohu = page.getByRole('tab', { name: /^搜狐/ })
    const baijia = page.getByRole('tab', { name: /^百家/ })
    const edit = page.getByRole('button', { name: '编辑正文', exact: true })
    const remove = (locator) => locator.evaluate((element) => {
      element.remove()
      document.querySelector('#platform-article').dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await sohu.click()
    await page.getByRole('button', { name: '搜狐号兼容性', exact: true }).click()
    const sohuLink = page.locator('.compat__message').filter({ hasText: '正文仍有站外链接或明文网址' })
    await sohuLink.waitFor()
    await edit.click()
    await remove(article.getByRole('link', { name: '网站链接' }))
    await sohuLink.waitFor({ state: 'detached' })
    assert.equal(await source.inputValue(), isolationDraft)
    await baijia.click()
    const sameParagraph = article.getByText('请访问网站链接。', { exact: true })
    await sameParagraph.waitFor()
    await edit.click()
    await remove(sameParagraph)
    await page.getByRole('button', { name: '完成编辑', exact: true }).click()
    assert.doesNotMatch(await article.textContent(), /网站链接/u)
    assert.equal(await source.inputValue(), isolationDraft)
    await sohu.click()
    assert.equal(await sohuLink.count(), 0, '切回搜狐兼容项不应复现')
    assert.match(await article.textContent(), /请访问。/u)
    assert.equal(await source.inputValue(), isolationDraft)
    await baijia.click()
    assert(!(await page.getByRole('button', { name: '复制正文', exact: true }).isDisabled()))
    assert.doesNotMatch(await article.textContent(), /网站链接/u, '百家号自身补丁仍可查看')
    await sohu.click()
    await edit.click()
    await remove(article.getByText('故意整段删掉的原文。', { exact: true }))
    await localCheck.click()
    const missingInSohu = localFindings.locator('li').filter({ hasText: '故意整段删掉的原文。' })
    await missingInSohu.getByRole('button', { name: /定位/u }).click()
    assert.match(await missingInSohu.textContent(), /疑似缺失段落.*基线第 2 段.*未能定位/u)

    // Deleting the last paragraph keeps the editor active and leaves the original untouched.
    const lastDraft = '# 空稿编辑测试\n\n最后一段。'
    const lastPrompt = page.waitForEvent('dialog')
    const lastImport = drop(source, [text('最后一段.md', lastDraft)])
    await (await lastPrompt).accept()
    await lastImport
    await page.getByText(/已导入 最后一段/u).waitFor()
    await typeset()
    await edit.click()
    await remove(article.getByText('最后一段。', { exact: true }))
    assert.equal(await source.inputValue(), lastDraft)
    assert(await page.getByRole('button', { name: '复制正文', exact: true }).isDisabled())
    assert.equal(await article.getAttribute('contenteditable'), 'true')
    assert(await page.getByRole('button', { name: '完成编辑', exact: true }).isVisible())

    assert.deepEqual(externalRequests, [], '除模拟的 DeepSeek 官方地址外，校对和拖放没有额外请求')
    return ['稿件拖入与替换确认', '校对红线与重复词定位', '长文、窄屏和专注模式的持续 AI 定位、键盘导航', '改标题、改正文和删段后的建议保留与重新定位', '兼容来源标识、外链与段落差异定位', '剪贴板隔离', '图片拖放与重新排版', '搜狐删除外链、百家号删保护段、平台隔离和缺段']
  } finally {
    await context.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runner = fileURLToPath(new URL('./verify-ui.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [runner, '--draft-only'], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
