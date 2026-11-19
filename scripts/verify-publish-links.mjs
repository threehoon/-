import assert from 'node:assert/strict'
import { join } from 'node:path'

const DRAFT = '# 发布样稿\n\n这是一段用于检查排版和发布入口的正文。'
const SOHU_CENTER = 'https://mp.sohu.com/home?spm=smpc.channel_454.block_5_875_YYoeMk_1_fd.6.1795072260153nhjPYmf_8107'
const DESTINATIONS = [
  ['微信视频号', 'https://channels.weixin.qq.com/platform/post/create'],
  ['小红书', 'https://creator.xiaohongshu.com/publish/publish'],
  ['抖音', 'https://creator.douyin.com/creator-micro/content/upload'],
]
const ARTICLE_DESTINATIONS = [
  ['公众号', 'https://mp.weixin.qq.com/'],
  ['头条', 'https://mp.toutiao.com/'],
  ['搜狐', SOHU_CENTER],
  ['百家', 'https://baijiahao.baidu.com/'],
  ['知乎', 'https://www.zhihu.com/creator'],
  ['腾讯', 'https://om.qq.com/'],
]

export async function verifyPublishLinks({ browser, target, out }) {
  const layouts = []
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width === 390,
      locale: 'zh-CN',
      reducedMotion: 'reduce',
    })
    try {
      const externalRequests = []
      await context.route('**/*', (route) => {
        const request = route.request()
        const url = request.url()
        if (new URL(url).origin === target.origin) return route.continue()
        externalRequests.push([url, request.headers().referer])
        if (url === SOHU_CENTER || DESTINATIONS.some(([, entry]) => entry === url)) {
          return route.fulfill({ contentType: 'text/html', body: '<title>本地跳转验证</title>' })
        }
        return route.abort()
      })
      const page = await context.newPage()
      page.setDefaultTimeout(5000)
      await page.goto(target.href)
      const source = page.locator('#source-markdown')
      const publish = page.getByRole('button', { name: '视频发布入口', exact: true })
      const linksNav = page.getByRole('navigation', { name: '视频发布入口', exact: true })
      const linkFor = (name) => linksNav.getByRole('link', { name: `${name} 发布页（在新标签页打开）`, exact: true })
      const toolbar = page.locator('.action-bar')
      const edit = page.getByRole('button', { name: '编辑正文', exact: true })

      if (width === 1440) {
        assert(!(await linksNav.isVisible()), '空稿时默认收起')
        await publish.click()
        await linksNav.waitFor()
        await page.getByRole('heading', { name: '左侧还没有源稿' }).click()
        await linksNav.waitFor({ state: 'hidden' })
      }
      await source.fill(DRAFT)
      await page.getByRole('button', { name: '一键排版' }).click()
      await edit.waitFor()
      await toolbar.scrollIntoViewIfNeeded()
      if (width === 390) {
        await toolbar.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 400))
      }
      assert.equal(await page.getByRole('tab').count(), 6)
      const selectedPlatform = page.getByRole('tab', { selected: true })
      assert.match(await selectedPlatform.innerText(), /公众号/)
      const currentPlatform = page.getByRole('link', { name: /在新窗口打开.*(?:编辑器|创作中心)/ })
      if (width === 1440) {
        for (const [name, url] of ARTICLE_DESTINATIONS) {
          await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click()
          assert.match(await selectedPlatform.innerText(), new RegExp(`^${name}`))
          assert.equal(await currentPlatform.getAttribute('href'), url)
          if (name === '搜狐') assert.match(await currentPlatform.innerText(), /打开创作中心/)
          assert(await page.getByRole('button', { name: '复制正文', exact: true }).isEnabled())
          assert(await edit.isEnabled())
        }
        await page.getByRole('tab', { name: /^公众号/ }).click()
      }
      assert(await currentPlatform.isVisible())
      assert(!(await linksNav.isVisible()), '排版后默认收起')
      const anchored = await page.evaluate(() => CSS.supports('(position-area: block-end span-inline-start) and (position-try-fallbacks: flip-block)'))
      const screenshot = async (state) => {
        const { x, y, width: paneWidth } = await page.locator('.panel--preview').boundingBox()
        const popover = await linksNav.isVisible() ? await linksNav.boundingBox() : null
        const top = Math.max(0, popover ? Math.min(y, popover.y - 8) : y)
        await page.screenshot({ path: join(out, `publish-${state}-${width}.png`), clip: {
          x, y: top, width: paneWidth, height: Math.min(height - top, 320),
        } })
      }
      await screenshot('closed')
      const closed = await toolbar.boundingBox()
      const triggerBox = await publish.boundingBox()
      await currentPlatform.focus()
      await page.keyboard.press('Tab')
      assert(await publish.evaluate((el) => document.activeElement === el && getComputedStyle(el).outlineWidth === '2px'))
      await page.keyboard.press('Enter')
      await linksNav.waitFor()
      await screenshot('open')
      const floating = await linksNav.boundingBox()
      assert.equal((await toolbar.boundingBox()).height, closed.height, '打开浮层不改变操作栏高度')
      assert(floating.x >= 0 && floating.x + floating.width <= width)
      assert(floating.y >= 0 && floating.y + floating.height <= height)
      if (anchored) {
        assert(Math.abs(floating.x + floating.width - triggerBox.x - triggerBox.width) < 1, '浮层右边缘贴齐入口')
      } else {
        assert(Math.abs(floating.x + floating.width / 2 - width / 2) < 1, '不支持锚定时居中展示')
        assert(Math.abs(floating.y + floating.height / 2 - height / 2) < 1)
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      if (width !== 390) assert.equal(closed.height, 53, '桌面默认栏宽下无需加行')
      if (width === 390) {
        assert(triggerBox.height >= 44)
        for (const link of await linksNav.getByRole('link').all()) assert((await link.boundingBox()).height >= 44)
      }
      for (const [name] of DESTINATIONS) {
        await page.keyboard.press('Tab')
        const link = linkFor(name)
        assert(await link.evaluate((el) => document.activeElement === el && getComputedStyle(el).outlineWidth === '2px'))
      }
      await page.keyboard.press('Escape')
      await linksNav.waitFor({ state: 'hidden' })
      assert(await publish.evaluate((el) => document.activeElement === el), '关闭后回到入口')

      if (width === 1440) {
        for (const [name, url] of DESTINATIONS) {
          if (!(await linksNav.isVisible())) await publish.click()
          const newTab = context.waitForEvent('page')
          await linkFor(name).press('Enter')
          const opened = await newTab
          await opened.waitForURL(url)
          assert(await opened.evaluate(() => window.opener === null))
          await opened.close()
        }
        await page.getByRole('tab', { name: /^搜狐/ }).click()
        const sohuTab = context.waitForEvent('page')
        await currentPlatform.click()
        const center = await sohuTab
        await center.waitForURL(SOHU_CENTER)
        assert(await center.evaluate(() => window.opener === null))
        await center.close()
        assert.deepEqual(externalRequests, [...DESTINATIONS.map(([, url]) => [url, undefined]), [SOHU_CENTER, undefined]],
          '四个平台只打开精确地址，不传 Referer 或稿件')
        await page.getByRole('tab', { name: /^公众号/ }).click()
        await edit.click()
        await page.locator('.article[contenteditable] p').evaluate((el) => {
          const range = document.createRange()
          range.selectNodeContents(el)
          const selection = window.getSelection()
          selection.removeAllRanges()
          selection.addRange(range)
        })
        await page.getByRole('button', { name: '插入链接', exact: true }).click()
        const linkInput = page.getByRole('textbox', { name: '链接地址' })
        await linkInput.waitFor()
        await publish.click()
        await linksNav.waitFor()
        await page.keyboard.press('Tab')
        await page.keyboard.press('Escape')
        await linksNav.waitFor({ state: 'hidden' })
        assert(await linkInput.isVisible(), '第一个 Escape 只关闭外部发布浮层，不丢弃正在编辑的链接')
        assert(await publish.evaluate((el) => document.activeElement === el))
        await page.keyboard.press('Escape')
        await linkInput.waitFor({ state: 'hidden' })
        await page.getByRole('button', { name: '专注编辑', exact: true }).click()
        assert.equal(await publish.count(), 0)
        await page.getByRole('button', { name: '退出专注', exact: true }).click()
        assert(await publish.isVisible())
        assert(!(await linksNav.isVisible()))
        await source.fill(`${DRAFT}\n\n更新后正文。`)
        await page.locator('.status-chip[data-state="stale"]').waitFor()
        await publish.click()
        await linksNav.waitFor()
      } else {
        assert.deepEqual(externalRequests, [])
      }
      if (width === 1024) {
        const separator = page.getByRole('separator')
        const divider = await separator.boundingBox()
        await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2)
        await page.mouse.down()
        await page.mouse.move(width - 20, divider.y + divider.height / 2, { steps: 8 })
        await page.mouse.up()
        await publish.click()
        await linksNav.waitFor()
        const narrow = await linksNav.boundingBox()
        assert(narrow.x >= 0 && narrow.x + narrow.width <= width)
        assert(narrow.y >= 0 && narrow.y + narrow.height <= height)
        await screenshot('narrow-split')
      }
      if (width === 390 && anchored) {
        // Put the trigger near the viewport bottom on the naturally scrolling narrow layout.
        await publish.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().bottom - innerHeight + 8))
        const nearBottom = await publish.boundingBox()
        assert(nearBottom.y + nearBottom.height > height - 24)
        await publish.tap()
        await linksNav.waitFor()
        const flipped = await linksNav.boundingBox()
        assert(flipped.y >= 0 && flipped.y + flipped.height < nearBottom.y, '空间不足时向上展开')
        await screenshot('flipped')
      }
      layouts.push({ width, toolbarHeight: closed.height, popoverHeight: floating.height })
    } finally {
      await context.close()
    }
  }
  return layouts
}
