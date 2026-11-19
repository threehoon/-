import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { arch, cpus, platform, release } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { verifyEditorExperience } from './verify-editor-experience.mjs'
import { verifyPublishLinks } from './verify-publish-links.mjs'
import { verifyDraftCheck } from './verify-draft-check.mjs'

const target = new URL(process.env.TARGET_URL ?? 'http://localhost:5183/')
const out = process.env.OUT_DIR ?? '.tmp/verify-ui'
const goodImage = 'https://assets.example.test/ok.png'
const missingImage = 'https://assets.example.test/missing.png'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n3sAAAAASUVORK5CYII=', 'base64')
const fixture = await readFile(new URL('../tests/fixtures/complex.md', import.meta.url), 'utf8')
// Browser validation is fully local. Test images substitute controlled success and error responses.
const body = fixture.replace(/^---\n[\s\S]*?\n---\n\n# [^\n]+\n/u, '').replace(/^.*!\[[^\n]*\n/gm, '')
const markdown = `# 浏览器验收样稿\n\n![可加载](${goodImage})\n\n![失效外链](${missingImage})\n\n![本地图](images/local.png)\n\n${body}`

await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
  headless: true,
})
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    reducedMotion: 'reduce',
  })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: target.origin })
  const unexpectedRequests = []
  await context.route('**/*', async (route) => {
    const url = route.request().url()
    if (url === goodImage) return route.fulfill({ contentType: 'image/png', body: png })
    if (url === missingImage) return route.fulfill({ status: 404, body: 'test: image unavailable' })
    if (new URL(url).origin === target.origin) return route.continue()
    unexpectedRequests.push(url)
    return route.abort()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error' && message.location().url !== missingImage) errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  const source = page.getByRole('textbox', { name: 'Markdown 源稿' })
  const trigger = page.getByRole('button', { name: '一键排版' })
  const copyBody = page.getByRole('button', { name: '复制正文' })
  const confirmImageWarning = async (button) => {
    const observed = page.waitForEvent('dialog')
    const clicked = button.click()
    const dialog = await observed
    await dialog.accept()
    await clicked
    assert.match(dialog.message(), /微信公众号兼容性提示.*加载失败/su)
  }
  const openEditor = page.getByRole('button', { name: '编辑正文', exact: true })
  const openFocus = page.getByRole('button', { name: '专注编辑', exact: true })
  const shot = async (name) => {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.screenshot({ path: join(out, `${name}.png`), timeout: 15000 })
  }
  const waitTypeset = () => page.locator('.status-chip[data-state="typeset"]').waitFor()

  await page.goto(target.href)
  await page.getByRole('heading', { name: '左侧还没有源稿' }).waitFor()
  assert(await trigger.isDisabled())
  assert(await copyBody.isDisabled())
  assert.equal(await openEditor.count(), 0)
  assert.equal(await openFocus.count(), 0)
  assert.equal(await page.locator('.panel--source .editor-tools').count(), 0)
  await page.keyboard.press('Tab')
  await page.getByRole('link', { name: '跳到源稿编辑区' }).press('Enter')
  assert(await source.evaluate((el) => document.activeElement === el && getComputedStyle(el).outlineWidth === '2px'))
  await shot('01-empty-1440')

  const importMarkdown = async (name, buffer) => {
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '导入 .md' }).click()
    await (await chooser).setFiles({ name, mimeType: 'text/markdown', buffer })
  }
  await importMarkdown('复杂样稿.md', Buffer.from(markdown))
  await page.getByText(/已导入 复杂样稿/).waitFor()
  assert.equal(await source.inputValue(), markdown)
  assert.equal(await openEditor.count(), 0, '只导入不开放成稿编辑')
  assert.equal(await openFocus.count(), 0, '只导入不开放专注编辑')
  await importMarkdown('空稿.md', Buffer.alloc(0))
  await page.getByText(/无法导入.*空稿\.md/).waitFor()
  assert.equal(await source.inputValue(), markdown, '空文件不能覆盖已导入稿件')
  await page.getByRole('button', { name: '关闭导入提示' }).click()

  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = function () {
      if (!this.name.startsWith('慢读')) return read.call(this)
      return new Promise((resolve) => {
        window.finishImport = async () => resolve(await read.call(this))
      })
    }
  })
  await importMarkdown('慢读-旧.md', Buffer.from('# 过时稿'))
  await page.waitForFunction(() => typeof window.finishImport === 'function')
  await source.fill('# 读取期间刚改的稿件')
  await page.evaluate(() => window.finishImport())
  await page.getByText(/读取期间稿件有改动/).waitFor()
  assert.equal(await source.inputValue(), '# 读取期间刚改的稿件')
  await importMarkdown('慢读-先选.md', Buffer.from('# 先选的旧稿'))
  const replacementDialog = page.waitForEvent('dialog')
  const replacement = importMarkdown('复杂样稿.md', Buffer.from(markdown))
  await (await replacementDialog).accept()
  await replacement
  await page.getByText(/已导入 复杂样稿/).waitFor()
  await page.evaluate(() => window.finishImport())
  assert.equal(await source.inputValue(), markdown)
  await page.getByRole('button', { name: '关闭导入提示' }).click()

  await trigger.click()
  await waitTypeset()
  const article = page.locator('.article')
  await article.getByRole('img', { name: '可加载' }).waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('.article img')].some((img) => img.alt === '可加载' && img.naturalWidth > 0))
  await page.getByText(/预览图片「失效外链」加载失败/).waitFor()
  assert.match(await page.locator('.compat').innerText(), /missing\.png/)
  assert.match(await page.locator('.compat').innerText(), /images\/local\.png/)
  assert(await page.getByRole('tab', { name: /公众号/, selected: true }).count())
  assert.equal(await article.getByText('浏览器验收样稿', { exact: true }).count(), 0)
  await shot('02-images-1440')

  const tabs = page.getByRole('tab')
  assert.equal(await tabs.count(), 6)
  await tabs.first().focus()
  await page.keyboard.press('ArrowRight')
  assert(await tabs.nth(1).evaluate((el) => document.activeElement === el && el.getAttribute('aria-selected') === 'true'))
  const viewNames = ['微信公众号', '头条号', '搜狐号', '百家号', '知乎', '腾讯内容开放平台']
  for (const [index, name] of viewNames.entries()) {
    await tabs.nth(index).click()
    await page.getByRole('region', { name: `${name}预览` }).waitFor()
    assert.match(await page.locator('.capability-note').innerText(), /未经真实后台验证/)
    assert(!(await copyBody.isDisabled()))
    assert.equal(await source.inputValue(), markdown)
  }
  await tabs.nth(3).click()
  assert.match(await page.locator('.compat').innerText(), /表格/)
  await shot('03-baijiahao-1440')

  await tabs.first().click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择文件' }).click()
  await (await chooser).setFiles({ name: 'local.png', mimeType: 'image/png', buffer: png })
  assert(await copyBody.isDisabled())
  await page.keyboard.press('Control+Enter')
  await waitTypeset()
  await page.waitForFunction(() => [...document.querySelectorAll('.article img')].some((img) => img.alt === '本地图' && img.naturalWidth > 0))

  // 浏览器拒绝标准写入时，仍由真实的用户点击同步复制富文本。
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'write', {
    configurable: true,
    value: () => Promise.reject(new DOMException('验收模拟权限拒绝', 'NotAllowedError')),
  }))
  await confirmImageWarning(page.getByRole('button', { name: '复制标题' }))
  await page.getByText(/标题已复制为富文本/).waitFor()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '浏览器验收样稿')
  await confirmImageWarning(copyBody)
  await page.getByText(/正文已复制为富文本/).waitFor()
  const clipboard = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    if (!item) throw new Error('剪贴板未写入')
    const html = await (await item.getType('text/html')).text()
    const text = await (await item.getType('text/plain')).text()
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    document.body.append(editor)
    editor.focus()
    return { html, text }
  })
  assert.match(clipboard.html, /<(table|strong)\b/)
  assert(!clipboard.html.includes('浏览器验收样稿'))
  assert(clipboard.text.length > 0)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
  await page.locator('[contenteditable] table').waitFor()
  await page.locator('[contenteditable]').evaluate((el) => el.remove())

  await page.evaluate(() => Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: () => false,
  }))
  await confirmImageWarning(copyBody)
  const manualCopy = page.locator('.manual-copy__textarea')
  await manualCopy.waitFor()
  assert.equal(await manualCopy.inputValue(), clipboard.text)
  assert.doesNotMatch(await page.locator('.copy-status').innerText(), /已复制/)
  await shot('04-copy-fallback-1440')

  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'write', {
    configurable: true,
    value: () => new Promise((_resolve, reject) => {
      window.finishCopy = () => reject(new DOMException('迟到的剪贴板拒绝', 'NotAllowedError'))
    }),
  }))
  await confirmImageWarning(copyBody)
  await page.waitForFunction(() => typeof window.finishCopy === 'function')
  await source.fill(markdown + '\n\n编辑后的段落。')
  await page.locator('.status-chip[data-state="stale"]').waitFor()
  await page.evaluate(() => window.finishCopy())
  assert(await copyBody.isDisabled())
  assert(!(await manualCopy.isVisible()), '过期复制不能重新露出旧正文')
  assert.equal(await openEditor.count(), 0, '旧成稿不可编辑')
  assert.equal(await openFocus.count(), 0, '旧成稿不可专注编辑')
  await page.evaluate(() => {
    Reflect.deleteProperty(navigator.clipboard, 'write')
    Reflect.deleteProperty(document, 'execCommand')
  })
  await shot('05-stale-1440')
  await page.keyboard.press('Control+Enter')
  await waitTypeset()
  assert(!(await copyBody.isDisabled()))
  assert.match(await article.innerText(), /编辑后的段落/)

  assert.equal(await page.locator('.preview-canvas').evaluate((el) => getComputedStyle(el).transitionDuration), '0s')
  for (const [width, height] of [[1440, 900], [1024, 768], [820, 860]]) {
    await page.setViewportSize({ width, height })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `页面在 ${width}px 横向溢出`)
    const editorBounds = await source.boundingBox()
    const titleBounds = await page.getByText('文章标题（可留空）', { exact: true }).boundingBox()
    assert(editorBounds && titleBounds && editorBounds.y + editorBounds.height <= titleBounds.y,
      `源稿编辑框在 ${width}px 遮挡标题字段`)
    await shot(`06-layout-${width}`)
  }

  const evidence = await verifyEditorExperience({ page, context, source, trigger, copyBody, shot, png })
  assert.deepEqual(unexpectedRequests, [], '访问了非测试站点')
  assert.deepEqual(errors, [], '存在未预期的浏览器错误')
  console.log(JSON.stringify({
    result: 'passed',
    browser: browser.version(),
    machine: { platform: platform(), arch: arch(), kernel: release(), cpu: cpus()[0]?.model },
    target: target.href,
    screenshots: out,
    publishLinks: await verifyPublishLinks({ browser, target, out }),
    draftCheck: await verifyDraftCheck({ browser, target, png }),
    ...evidence,
  }, null, 2))
} finally {
  await browser.close()
}
