import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const target = process.env.TARGET_URL ?? 'http://127.0.0.1:5183/'
const out = process.env.OUT_DIR ?? '.tmp/draft-persistence'
const installedChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const executablePath = process.env.CHROME_BIN ?? (existsSync(installedChrome) ? installedChrome : chromium.executablePath())
const tmp = resolve(tmpdir())
const profile = await mkdtemp(join(tmp, 'typeset-draft-test-'))
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n3sAAAAASUVORK5CYII=', 'base64')
const markdown = '# 恢复测试标题\n\n第一段原正文。\n\n![源稿照片](images/photo.png)\n\n> 原稿引文。\n\n```js\nconst fixture = 1\n```'
const errors = []
const deepSeekCalls = []
const fixtureKey = 'browser-fixture-only'
const launch = async () => {
  const browser = await chromium.launchPersistentContext(profile, {
    executablePath, headless: true, viewport: { width: 1440, height: 900 }, locale: 'zh-CN', reducedMotion: 'reduce',
  })
  await browser.route('https://api.deepseek.com/chat/completions', async (route) => {
    const request = route.request()
    const { model, messages } = request.postDataJSON()
    deepSeekCalls.push({ model, blocks: JSON.parse(messages[1].content).blocks, fixtureAuth: request.headers().authorization === `Bearer ${fixtureKey}` })
    await route.fulfill({
      headers: { 'access-control-allow-origin': new URL(target).origin },
      json: { choices: [{ finish_reason: 'stop', message: { content: '{"issues":[]}' } }] },
    })
  })
  return browser
}
let context

function bind(page) {
  page.setDefaultTimeout(5000)
  page.on('pageerror', (error) => errors.push(error.message))
  const button = (name) => page.getByRole('button', { name, exact: true })
  const status = (state) => page.locator(`.draft-status[data-state="${state}"]`)
  const choose = async (label, file) => {
    const chooser = page.waitForEvent('filechooser')
    await button(label).click()
    await (await chooser).setFiles(file)
  }
  return {
    page, button, status, choose, saved: () => status('saved').waitFor(),
    source: page.getByRole('textbox', { name: 'Markdown 源稿' }),
    edit: page.getByRole('textbox', { name: '成稿正文' }),
    title: page.getByRole('textbox', { name: '当前平台标题' }),
    article: page.locator('.article'),
    tab: (name) => page.getByRole('tab', { name }),
  }
}

async function open(page = undefined) {
  const ui = bind(page ?? await context.newPage())
  await ui.page.goto(target)
  await ui.page.locator('.workspace[aria-busy="false"]').waitFor()
  return ui
}

async function decoded(image) {
  await image.evaluate((node) => node.decode())
  assert(await image.evaluate((node) => node.naturalWidth > 0))
}

async function shot(ui, name) {
  await mkdir(out, { recursive: true })
  await ui.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await ui.page.screenshot({ path: join(out, `${name}.png`) })
}

async function failNext(ui, owner, method, errorName) {
  await ui.page.evaluate(({ owner, method, errorName }) => {
    const prototype = window[owner].prototype
    const original = prototype[method]
    prototype[method] = () => {
      prototype[method] = original
      throw new DOMException('Simulated browser storage error', errorName)
    }
  }, { owner, method, errorName })
}

try {
  context = await launch()
  let ui = await open(context.pages()[0])
  assert.equal(await ui.source.inputValue(), '')
  await ui.source.fill(markdown)
  await ui.saved()
  await ui.page.close()
  ui = await open()
  assert.equal(await ui.source.inputValue(), markdown, '关闭并重新打开标签页，恢复未排版原稿')
  assert(await ui.source.isEditable())
  await ui.choose('选择文件', { name: 'paired.png', mimeType: 'image/png', buffer: png })
  await ui.button('一键排版').click()
  await ui.page.locator('.status-chip[data-state="typeset"]').waitFor()
  const originalPhoto = ui.article.getByAltText('源稿照片')
  await decoded(originalPhoto)
  const oldUrl = await originalPhoto.getAttribute('src')
  assert.match(oldUrl, /^blob:/)

  await ui.page.locator('.wechat-templates > button').click()
  await ui.page.getByRole('button', { name: '暖纸手记', exact: true }).click()
  await ui.button('专注编辑').focus()
  await ui.page.keyboard.press('Enter')
  await ui.title.fill('公众号独立标题')
  const paragraph = ui.edit.locator('p').first()
  await paragraph.evaluate((node) => {
    node.closest('[contenteditable]').focus()
    getSelection().collapse(node, node.childNodes.length)
  })
  await ui.page.keyboard.insertText('补写一句。')
  await paragraph.evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    getSelection().removeAllRanges()
    getSelection().addRange(range)
  })
  await ui.button('加粗').click()
  assert.match(await ui.edit.innerHTML(), /<(?:b|strong)[^>]*>第一段原正文。补写一句。/u)
  await ui.edit.getByText('第一段原正文。补写一句。', { exact: true }).click()
  await ui.page.keyboard.press('End')
  await ui.choose('插入图片', { name: 'inserted.png', mimeType: 'image/png', buffer: png })
  await decoded(ui.edit.getByAltText('inserted'))
  await ui.saved()
  await shot(ui, 'focus-saved-1440')
  await ui.page.setViewportSize({ width: 390, height: 844 })
  assert(await ui.status('saved').isVisible())
  assert(await ui.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await shot(ui, 'focus-saved-390')
  await ui.page.setViewportSize({ width: 1440, height: 900 })
  await ui.button('退出专注').click()
  await ui.tab(/头条/).click()
  await ui.button('编辑正文').click()
  await ui.title.fill('头条独立标题')
  await ui.saved()

  const openAi = async ({ page, button }) => {
    await button('AI 设置').click()
    const dialog = page.getByRole('dialog', { name: 'DeepSeek 校对设置' })
    await dialog.waitFor()
    return {
      dialog,
      key: dialog.getByLabel('API Key', { exact: true }),
      model: dialog.getByLabel('模型', { exact: true }),
      remember: dialog.getByRole('checkbox', { name: '在此浏览器记住配置' }),
      consent: dialog.getByRole('checkbox', { name: /^我同意/u }),
      status: dialog.getByRole('status'),
      save: dialog.getByRole('button', { name: '启用 DeepSeek' }),
    }
  }
  const renderSettings = async (ai, width, height) => {
    await ui.page.setViewportSize({ width, height })
    const bounds = await ai.dialog.boundingBox()
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width)
    assert(await ai.dialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth))
    await shot(ui, `deepseek-remember-${width}`)
  }
  let ai = await openAi(ui)
  assert.equal(await ai.remember.isChecked(), false)
  await ai.key.fill(fixtureKey)
  await ai.model.selectOption('deepseek-v4-pro')
  await ai.remember.focus()
  await ui.page.keyboard.press('Space')
  assert.equal(await ai.remember.isChecked(), true)
  assert(await ai.save.isDisabled(), '记住配置不能跳过测试或同意')
  await ai.dialog.getByRole('button', { name: '测试连接' }).click()
  await ai.status.filter({ hasText: '连接成功' }).waitFor()
  assert(await ai.save.isDisabled(), '测试通过仍需明确同意发送正文')
  await ai.consent.check()
  await failNext(ui, 'Storage', 'setItem', 'QuotaExceededError')
  await ai.save.click()
  await ai.status.filter({ hasText: '浏览器未能保存配置' }).waitFor()
  await renderSettings(ai, 390, 640)
  await renderSettings(ai, 1440, 900)
  await ai.save.click()
  await ai.dialog.waitFor({ state: 'hidden' })
  assert.equal(deepSeekCalls.length, 1, '配置保存没有追加请求')
  assert.match(deepSeekCalls[0].blocks[0].text, /固定样例/u)

  await context.close()
  context = await launch()
  ui = await open(context.pages()[0])
  await ui.saved()
  ai = await openAi(ui)
  assert.equal(await ai.key.evaluate((input, expected) => input.value === expected, fixtureKey), true)
  assert.equal(await ai.model.inputValue(), 'deepseek-v4-pro')
  assert.equal(await ai.remember.isChecked(), true)
  await ai.dialog.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(deepSeekCalls.length, 1, '重启和读取配置不发送任何请求')
  await ui.button('AI 检查内容').click()
  await ui.page.getByText(/DeepSeek.*未发现|未发现明显问题/u).first().waitFor()
  assert.equal(deepSeekCalls.length, 2)
  assert.equal(deepSeekCalls[1].model, 'deepseek-v4-pro')
  assert.equal(deepSeekCalls[1].fixtureAuth, true)
  assert(deepSeekCalls[1].blocks.some((block) => block.text.includes('头条独立标题')))

  // Clearing remembered credentials also disables them in a tab that already restored them.
  const openedEarlier = await open()
  const otherAi = await openAi(openedEarlier)
  assert.equal(await otherAi.remember.isChecked(), true)
  ai = await openAi(ui)
  await ai.remember.uncheck()
  await ai.save.click()
  await ai.dialog.waitFor({ state: 'hidden' })
  await otherAi.dialog.getByRole('button', { name: '清除配置' }).waitFor({ state: 'hidden' })
  assert.equal(await otherAi.key.inputValue(), '')
  await openedEarlier.page.close()
  ai = await openAi(ui)
  assert.equal(await ai.remember.isChecked(), false)
  await ai.remember.check()
  await ai.save.click()
  await ai.dialog.waitFor({ state: 'hidden' })
  ai = await openAi(ui)
  await failNext(ui, 'Storage', 'removeItem', 'SecurityError')
  await ai.dialog.getByRole('button', { name: '清除配置' }).click()
  await ai.status.filter({ hasText: '浏览器未能清除保存的配置' }).waitFor()
  await ai.dialog.getByRole('button', { name: '清除配置' }).click()
  await ai.dialog.waitFor({ state: 'hidden' })
  await ui.page.reload()
  await ui.saved()
  ai = await openAi(ui)
  assert.equal(await ai.key.inputValue(), '')
  assert.equal(deepSeekCalls.length, 2, '关闭记住、清除与刷新均不发请求')
  await ai.dialog.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await ui.source.inputValue(), markdown)
  assert.equal(await ui.source.isEditable(), false)
  assert.equal(await ui.tab(/头条/).getAttribute('aria-selected'), 'true')
  assert.equal(await ui.article.getByAltText('inserted').count(), 0)
  await ui.button('编辑正文').click()
  assert.equal(await ui.title.inputValue(), '头条独立标题')
  await ui.tab(/公众号/).click()
  assert.equal(await ui.page.locator('.wechat-templates > button').getAttribute('aria-label'), '排版模板：暖纸手记')
  assert.match(await ui.article.innerHTML(), /<(?:b|strong)[^>]*>第一段原正文。补写一句。/u)
  const restoredPhoto = ui.article.getByAltText('源稿照片')
  await decoded(restoredPhoto)
  assert.notEqual(await restoredPhoto.getAttribute('src'), oldUrl, '配对文件恢复成新的可用 Blob URL')
  await decoded(ui.article.getByAltText('inserted'))
  await ui.button('编辑正文').click()
  assert.equal(await ui.title.inputValue(), '公众号独立标题')
  await ui.saved()
  await shot(ui, 'restored-1440')

  // Simulate a quota error at the actual write boundary; a failed transaction may not replace the last draft.
  await failNext(ui, 'IDBObjectStore', 'put', 'QuotaExceededError')
  await ui.title.fill('未保存的标题')
  await ui.status('save-error').waitFor()
  assert.equal(await ui.title.inputValue(), '未保存的标题')
  assert(await ui.page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }))))
  await shot(ui, 'write-error-1440')
  const other = await open()
  await other.button('编辑正文').click()
  assert.equal(await other.title.inputValue(), '公众号独立标题', '失败写入未覆盖旧草稿')
  await ui.title.fill('重试后保存的标题')
  await ui.saved()
  assert(await ui.page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true }))))
  await other.title.fill('旧标签不应覆盖先保存的标题')
  await other.status('conflict').waitFor()
  await ui.page.reload()
  await ui.saved()
  await ui.button('编辑正文').click()
  assert.equal(await ui.title.inputValue(), '重试后保存的标题')

  const replacement = { name: 'new.md', mimeType: 'text/markdown', buffer: Buffer.from('# 新原稿\n\n新正文。') }
  const importFile = ui.page.locator('.panel--source > input[type=file]')
  const importWith = async (decision) => {
    await Promise.all([
      ui.page.waitForEvent('dialog').then((dialog) => dialog[decision]()),
      importFile.setInputFiles(replacement),
    ])
  }
  await importWith('dismiss')
  assert.equal(await ui.source.inputValue(), markdown)
  await importWith('accept')
  await ui.page.getByText(/已导入 new\.md/).waitFor()
  await ui.saved()
  await ui.page.reload()
  await ui.saved()
  assert.equal(await ui.source.inputValue(), '# 新原稿\n\n新正文。')
  assert.equal(await ui.article.count(), 0)

  await ui.page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get() { return undefined } })
  })
  await ui.page.reload()
  await ui.status('load-error').waitFor()
  assert(await ui.source.isEditable(), '本机存储不可用时仍可编辑和复制备份')
  assert.deepEqual(errors, [])
  console.log('Chrome pass: tab and browser restart, source and independent drafts, templates and images, quota rollback, retry, stale tabs, draft replacement, DeepSeek configuration restore, manual request only, opt-out and clear.')
} finally {
  await context?.close()
  if (dirname(profile) === tmp && basename(profile).startsWith('typeset-draft-test-')) {
    await rm(profile, { recursive: true, force: true })
  }
}
