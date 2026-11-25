import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { resetWorkbench } from './reset-workbench.mjs'

const target = new URL(process.env.TARGET_URL ?? 'http://127.0.0.1:5183/')
const installed = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const out = process.env.OUT_DIR ?? '.tmp/wechat-templates'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n3sAAAAASUVORK5CYII=', 'base64')
const photo = 'images/city.png'
const markdown = `# 沿河散步手记\n\n## 从老街出发\n\n打开地图，沿着河岸经过两座桥。这里有**晨间集市**和安静的巷子。\n\n> 把脚步放慢一点，留意老街一侧的店招。\n\n- 带一瓶水\n- 保留车票\n\n---\n\n| 地点 | 停留 |\n| --- | --- |\n| 河岸 | 20 分钟 |\n\n使用 \`walk --north\` 记下本次路线。\n\n\`\`\`sh\nwalk --north\n\`\`\`\n\n![配对图片](${photo})`
const titles = ['观点蓝调', '清爽留白', '内容简报', '杂志长文', '暖纸手记', '技术专栏', '水墨国风', '深度周刊', '朱砂快讯', '森系轻读', '操作手册', '极简黑白']
const platforms = [
  { tab: '公众号', name: '微信公众号', variant: '渐变章节签', fill: 'rgb(23, 53, 95)', table: true, code: true },
  { tab: '头条', name: '头条号', variant: '浅蓝章节', fill: 'rgb(237, 243, 250)', table: false, code: true },
  { tab: '搜狐', name: '搜狐号', variant: '浅蓝章节', fill: 'rgb(237, 243, 250)', table: true, code: false },
  { tab: '百家', name: '百家号', variant: '深蓝字＋细线', fill: 'rgba(0, 0, 0, 0)', table: false, code: false },
  { tab: '知乎', name: '知乎', variant: '深蓝字＋细线', fill: 'rgba(0, 0, 0, 0)', table: true, code: true },
  { tab: '腾讯', name: '腾讯内容开放平台', variant: '浅蓝章节', fill: 'rgb(237, 243, 250)', table: true, code: true },
]

await mkdir(out, { recursive: true })
const executablePath = process.env.CHROME_BIN ?? (existsSync(installed) ? installed : chromium.executablePath())
const browser = await chromium.launch({ executablePath, headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  page.setDefaultTimeout(7000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const button = (name) => page.getByRole('button', { name, exact: true })
  const picker = page.getByRole('button', { name: /^排版模板：/ })
  const gallery = page.locator('.wechat-templates__popover')
  const choice = (name) => gallery.getByRole('button', { name, exact: true })
  const source = page.getByRole('textbox', { name: 'Markdown 源稿' })
  const article = page.locator('#platform-article')
  const tab = (name) => page.getByRole('tab', { name: new RegExp(`^${name}`) })
  const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) })
  const typeset = async () => {
    await button('一键排版').click()
    await page.locator('.status-chip[data-state="typeset"]').waitFor()
  }
  const apply = async (name) => {
    await picker.click()
    await choice(name).click()
    await gallery.waitFor({ state: 'hidden' })
    assert.equal(await picker.getAttribute('aria-label'), `排版模板：${name}`)
  }

  await page.goto(target.href)
  assert.equal(await picker.count(), 0)
  await source.fill(markdown)
  assert.equal(await picker.count(), 0)
  const chooser = page.waitForEvent('filechooser')
  await button('选择文件').click()
  await (await chooser).setFiles({ name: 'city.png', mimeType: 'image/png', buffer: png })
  await typeset()
  const imgSrc = await article.locator('img').getAttribute('src')
  assert.match(imgSrc, /^blob:/)
  const originalText = await article.textContent()
  const date = await page.locator('.status-chip').textContent()
  const proofs = []
  for (const platform of platforms) {
    await tab(platform.tab).click()
    const h2 = article.locator('h2')
    const style = await h2.getAttribute('style')
    assert.equal(await h2.evaluate((el) => getComputedStyle(el).backgroundColor), platform.fill)
    assert.equal(style.includes('linear-gradient'), platform.tab === '公众号')
    assert.equal(style.includes('display:table'), platform.tab === '公众号')
    assert.equal(await picker.getAttribute('aria-label'), '排版模板：观点蓝调')
    await picker.click()
    assert.equal(await gallery.locator('[data-selected="true"] h2').getAttribute('style'), style)
    await page.keyboard.press('Escape')
    await gallery.waitFor({ state: 'hidden' })
    const copyBody = button('复制正文')
    if (!platform.table || !platform.code) {
      const observed = page.waitForEvent('dialog')
      const clicked = copyBody.click()
      const dialog = await observed
      await dialog.accept()
      await clicked
      assert.match(dialog.message(), /兼容性提示/u)
    } else {
      await copyBody.click()
    }
    const clipboard = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read()
      const html = await (await item.getType('text/html')).text()
      const doc = new DOMParser().parseFromString(html, 'text/html')
      return {
        html,
        plain: await (await item.getType('text/plain')).text(),
        style: doc.querySelector('h2')?.style.cssText,
        table: Boolean(doc.querySelector('table')),
        code: Boolean(doc.querySelector('pre code')),
        codeText: doc.querySelector('pre')?.textContent,
      }
    })
    assert.equal(clipboard.style, await h2.evaluate((el) => el.style.cssText))
    assert.equal(clipboard.table, platform.table)
    assert.equal(clipboard.code, platform.code)
    assert.equal(clipboard.codeText, 'walk --north')
    assert.match(clipboard.plain, /晨间集市/)
    assert.doesNotMatch(clipboard.html, /沿河散步手记|uma-source/)
    proofs.push({ ...platform, html: clipboard.html })
  }
  await tab('头条').click()
  const toutiaoClassic = await article.innerHTML()
  await shot('toutiao-classic-1440')
  await tab('公众号').click()
  await picker.focus()
  await page.keyboard.press('Enter')
  await gallery.waitFor()
  assert.equal(await choice(titles[0]).getAttribute('aria-pressed'), 'true')
  for (const name of titles) await choice(name).waitFor()
  const filters = gallery.getByRole('group', { name: '模板分类筛选' })
  await page.keyboard.press('Tab')
  assert(await filters.evaluate((el) => el.contains(document.activeElement)))
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  assert.equal(await filters.getByRole('button', { name: /知识干货/ }).getAttribute('aria-pressed'), 'true')
  assert.equal(await choice('观点蓝调').count(), 0)
  for (const name of ['技术专栏', '操作手册', '极简黑白']) await choice(name).waitFor()
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  for (let index = 0; index < 5; index++) await page.keyboard.press('Tab')
  assert.equal(await page.locator('.wechat-templates__choice:focus-within').evaluate((el) => getComputedStyle(el).outlineWidth), '2px')
  await shot('gallery-1440')
  await page.keyboard.press('Escape')
  await gallery.waitFor({ state: 'hidden' })
  assert(await picker.evaluate((el) => el === document.activeElement))
  const signatures = new Set()
  for (const title of [...titles.slice(1), titles[0]]) {
    await apply(title)
    signatures.add(await article.locator('h2').getAttribute('style'))
    assert.equal(await article.textContent(), originalText)
    assert.equal(await article.locator('img').getAttribute('src'), imgSrc)
    assert.equal(await source.inputValue(), markdown)
    assert.equal(await page.locator('.status-chip').textContent(), date)
  }
  assert.equal(signatures.size, titles.length)
  await tab('头条').click()
  assert.equal(await article.innerHTML(), toutiaoClassic)
  for (const { tab: name } of platforms) {
    await tab(name).click()
    if (name !== '公众号') assert.doesNotMatch(await article.innerHTML(), /linear-gradient|display:table/)
    assert.equal(await picker.getAttribute('aria-label'), '排版模板：观点蓝调')
    await button('专注编辑').click()
    await picker.focus()
    await page.keyboard.press('Enter')
    await gallery.waitFor()
    await page.keyboard.press('Tab')
    assert(await gallery.evaluate((el) => el.contains(document.activeElement)))
    await page.keyboard.press('Escape')
    await gallery.waitFor({ state: 'hidden' })
    assert(await picker.evaluate((el) => el === document.activeElement))
    assert(await button('退出专注').isVisible())
    if (name === '公众号') {
      await picker.click()
      await shot('focus-gallery-1440')
      await page.keyboard.press('Escape')
      await gallery.waitFor({ state: 'hidden' })
      await apply('清爽留白')
    }
    await apply(name === '公众号' ? '暖纸手记' : '杂志长文')
    assert.equal(await article.getAttribute('contenteditable'), 'true')
    assert(await picker.evaluate((el) => el === document.activeElement))
    if (name === '公众号') {
      const selectSize = async (selector, expected) => {
        await article.locator(selector).first().evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          element.closest('[contenteditable]').focus()
          getSelection().removeAllRanges()
          getSelection().addRange(range)
        })
        await page.waitForFunction((value) => document.querySelector('select[aria-label="字号"]')?.value === value, expected)
      }
      await selectSize('h2', '21')
      await selectSize('code', '14')
    } else {
      assert.match(await article.innerHTML(), /text-indent:2em/)
    }
    assert(await button('复制正文').isEnabled())
    if (name === '腾讯') {
      await button('复制正文').click()
      const copied = await page.evaluate(async () => {
        const [item] = await navigator.clipboard.read()
        return (await item.getType('text/html')).text()
      })
      assert.match(copied, /text-indent:\s*2em/)
    }
    await picker.focus()
    await page.keyboard.press('Escape')
    await button('专注编辑').waitFor()
    await button('完成编辑').click()
    assert.equal(await picker.getAttribute('aria-label'), `排版模板：${name === '公众号' ? '暖纸手记' : '杂志长文'}`)
  }
  await tab('公众号').click()
  await apply('观点蓝调')
  await tab('腾讯').click()
  await button('复制正文').click()
  const tencentHtml = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    return (await item.getType('text/html')).text()
  })
  assert.match(tencentHtml, /text-indent:\s*2em/)
  assert.doesNotMatch(tencentHtml, /沿河散步手记|uma-source/)
  await tab('公众号').click()
  assert.equal(await picker.getAttribute('aria-label'), '排版模板：观点蓝调')
  const articleTitle = page.locator('.preview-canvas > .article-title')
  const titleAlign = () => articleTitle.evaluate((el) => getComputedStyle(el).textAlign)
  assert.equal(await titleAlign(), 'center')
  const headingCentered = () => article.locator('h2').evaluate((el) => {
    const parent = el.parentElement.getBoundingClientRect()
    const heading = el.getBoundingClientRect()
    return Math.abs(heading.left + heading.width / 2 - parent.left - parent.width / 2) < 1
  })
  assert(await headingCentered())
  await shot('article-classic-1440')
  await button('复制正文').click()
  await page.getByText('正文已复制为富文本', { exact: false }).waitFor()
  const classicHtml = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    return (await item.getType('text/html')).text()
  })
  assert.match(classicHtml, /linear-gradient/)
  assert.doesNotMatch(classicHtml, /沿河散步手记|uma-source/)
  await apply('杂志长文')
  assert.notEqual(await titleAlign(), 'center')
  await shot('article-editorial-1440')
  await button('复制正文').click()
  await page.getByText('正文已复制为富文本', { exact: false }).waitFor()
  const clipboard = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    const html = await (await item.getType('text/html')).text()
    return { html, plain: await (await item.getType('text/plain')).text() }
  })
  assert.match(clipboard.html, /text-indent:\s*2em/)
  assert.match(clipboard.html, /<blockquote/)
  assert.match(clipboard.plain, /晨间集市/)
  assert.doesNotMatch(clipboard.html, /uma-source|城市散步手记|沿河散步手记/)

  await apply('暖纸手记')
  await button('编辑正文').click()
  await picker.click()
  await gallery.getByText('先点「完成编辑」，再切换模板。').waitFor()
  assert(await choice('暖纸手记').isDisabled())
  await page.keyboard.press('Escape')
  const firstParagraph = article.locator('section > p').first()
  await firstParagraph.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    getSelection().removeAllRanges()
    getSelection().addRange(range)
  })
  await page.keyboard.insertText(' 下次再来。')
  assert.doesNotMatch(await source.inputValue(), /下次再来/)
  await button('完成编辑').click()
  assert.equal(await source.inputValue(), markdown)
  await picker.click()
  assert(await choice('暖纸手记').isDisabled())
  await page.keyboard.press('Escape')
  assert.match(await article.textContent(), /下次再来/)
  assert.equal(await article.locator('img').getAttribute('src'), imgSrc)
  await tab('头条').click()
  assert(!(await button('复制正文').isDisabled()))
  assert.doesNotMatch(await article.textContent(), /下次再来/)
  await tab('公众号').click()
  assert.equal(await picker.getAttribute('aria-label'), '排版模板：暖纸手记')
  await button('专注编辑').click()
  await picker.click()
  await gallery.getByText('当前成稿有手动正文改动。', { exact: false }).waitFor()
  assert(await choice('杂志长文').isDisabled())
  await page.keyboard.press('Escape')
  await gallery.waitFor({ state: 'hidden' })
  assert.match(await article.textContent(), /下次再来/)
  await button('退出专注').click()
  await button('完成编辑').click()
  await typeset()
  assert.equal(await picker.getAttribute('aria-label'), '排版模板：暖纸手记')
  assert.equal(await page.locator('.preview-canvas').evaluate((el) => getComputedStyle(el).transitionDuration), '0s')
  await tab('头条').click()
  assert.equal(await picker.getAttribute('aria-label'), '排版模板：杂志长文')

  for (const [width, height] of [[1024, 768], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await picker.click()
    await gallery.waitFor()
    const bounds = await gallery.boundingBox()
    assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    assert.equal(await gallery.locator('.wechat-templates__grid').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length), width < 640 ? 2 : 3)
    await shot(`gallery-${width}`)
    await page.keyboard.press('Escape')
    await gallery.waitFor({ state: 'hidden' })
    await button('专注编辑').click()
    await picker.click()
    await gallery.waitFor()
    const focusedBounds = await gallery.boundingBox()
    assert(focusedBounds && focusedBounds.x >= 0 && focusedBounds.y >= 0 && focusedBounds.x + focusedBounds.width <= width && focusedBounds.y + focusedBounds.height <= height)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    await shot(`focus-gallery-${width}`)
    await page.keyboard.press('Escape')
    await gallery.waitFor({ state: 'hidden' })
    await button('退出专注').click()
    await button('完成编辑').click()
  }
  assert.equal(await source.evaluate((el) => el.readOnly), true)
  await page.locator('.draft-status[data-state="saved"]').waitFor()
  await page.reload()
  await page.locator('.draft-status[data-state="saved"]').waitFor()
  assert.equal(await source.inputValue(), markdown)
  assert.equal(await picker.getAttribute('aria-label'), '排版模板：杂志长文')
  await button('专注编辑').click()
  await button('插入链接').click()
  await page.getByRole('textbox', { name: '链接地址' }).fill('https://example.test/old-town')
  await picker.click()
  await gallery.getByText('请先完成或取消链接编辑，再切换模板。').waitFor()
  assert(await choice('杂志长文').isDisabled())
  await page.keyboard.press('Escape')
  await gallery.waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('textbox', { name: '链接地址' }).inputValue(), 'https://example.test/old-town')
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: '链接地址' }).waitFor({ state: 'hidden' })
  assert(await button('退出专注').isVisible())

  await page.evaluate(() => {
    const read = FileReader.prototype.readAsDataURL
    FileReader.prototype.readAsDataURL = function (blob) {
      FileReader.prototype.readAsDataURL = read
      window.qaFinishTemplateImage = () => read.call(this, blob)
    }
  })
  const imageChooser = page.waitForEvent('filechooser')
  await button('插入图片').click()
  await (await imageChooser).setFiles({ name: 'template-guard.png', mimeType: 'image/png', buffer: png })
  await page.getByText('正在读取图片…', { exact: true }).waitFor()
  await picker.click()
  await gallery.getByText('图片正在读取，插入完成后再切换模板。').waitFor()
  assert(await choice('杂志长文').isDisabled())
  await page.keyboard.press('Escape')
  await gallery.waitFor({ state: 'hidden' })
  await page.evaluate(() => window.qaFinishTemplateImage())
  await article.getByAltText('template-guard').waitFor()
  await picker.click()
  await gallery.getByText('当前成稿有手动正文改动。', { exact: false }).waitFor()
  assert(await choice('杂志长文').isDisabled())
  // Chrome uses <b> alongside Markdown's <strong> when the editor formats adjacent text.
  await resetWorkbench(page)
  await source.fill('# 相邻格式回归\n\n**已加粗**相邻文字余下。')
  await typeset()
  await button('编辑正文').click()
  await article.locator('p').evaluate((el) => {
    const text = el.lastChild
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 4)
    getSelection().removeAllRanges()
    getSelection().addRange(range)
  })
  await page.locator('.editor-tools').getByRole('button', { name: /加粗/ }).click()
  assert.equal(await source.inputValue(), '# 相邻格式回归\n\n**已加粗**相邻文字余下。')
  await button('完成编辑').click()
  await typeset()
  assert.match(await article.innerHTML(), /<(?:b|strong)[^>]*>相邻文字/u)
  assert.equal(await article.textContent(), '已加粗相邻文字余下。')
  assert.deepEqual(errors, [])

  // Render the actual clipboard fragments outside the app, with no article CSS from the workbench.
  const comparison = await context.newPage()
  await comparison.setViewportSize({ width: 1440, height: 900 })
  await comparison.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>观点蓝调 · 六平台</title>
    <style>
      *{box-sizing:border-box} body{margin:0;padding:32px;background:#f5f4ed;color:#141413;font-family:system-ui,sans-serif}
      header{max-width:1260px;margin:0 auto 24px} h1{margin:0 0 8px;font-size:30px} header p{margin:0;color:#504e49}
      main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;max-width:1260px;margin:auto}
      article{background:#faf9f5;border:1px solid #e0ded2;border-radius:8px;padding:16px 20px;min-width:0}
      .label{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding-bottom:12px;border-bottom:1px solid #e0ded2}
      .label strong{font-size:16px;color:#1b365d} .label span{font-size:13px;color:#504e49}
      @media(max-width:900px){main{grid-template-columns:minmax(0,1fr)}body{padding:16px}}
    </style>
    <header><h1>观点蓝调 · 六平台对比</h1><p>同一段样稿，取自实际复制的正文。以下为本地渲染，不是平台后台截图。</p></header><main></main>`)
  await comparison.evaluate((entries) => {
    for (const { name, variant, html } of entries) {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const body = doc.body.querySelector('section')
      const article = document.createElement('article')
      const label = document.createElement('div')
      label.className = 'label'
      const nameNode = document.createElement('strong')
      nameNode.textContent = name
      const variantNode = document.createElement('span')
      variantNode.textContent = variant
      label.append(nameNode, variantNode)
      article.append(label)
      // Show the opening and table (or its equivalent text), not the full test fixture.
      body.querySelectorAll('pre, pre ~ *').forEach((node) => node.remove())
      body.lastElementChild.remove() // Removes the sentence introducing the code sample.
      article.append(body)
      document.querySelector('main').append(article)
    }
  }, proofs)
  await comparison.screenshot({ path: join(out, 'classic-six-platforms.png'), fullPage: true })
  await comparison.setViewportSize({ width: 390, height: 844 })
  assert(await comparison.evaluate(() => Array.from(document.querySelectorAll('article')).every((el) => el.scrollWidth <= el.clientWidth)))
  await comparison.screenshot({ path: join(out, 'classic-wechat-390.png') })
  assert(await comparison.evaluate(() => Array.from(document.querySelectorAll('article h2')).every((heading) => {
    heading.append(` ${'LongEnglishArticleHeading'.repeat(8)} ${'中英文长标题'.repeat(8)}`)
    return heading.scrollWidth <= heading.clientWidth
      && heading.getBoundingClientRect().right <= heading.closest('article').getBoundingClientRect().right
  })), 'long mixed-language headings wrap in a narrow pasted article')
  console.log(JSON.stringify({ result: 'passed', browser: browser.version(), target: target.href, screenshots: out, clipboardPlatforms: proofs.length, distinctTemplates: signatures.size }, null, 2))
} finally {
  await browser.close()
}
