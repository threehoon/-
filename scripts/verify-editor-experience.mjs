import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'

const commandKey = process.platform === 'darwin' ? 'Meta' : 'Control'
const CJK_DRAFT = '# 性能样稿\n\n' + ('字'.repeat(100) + '\n\n').repeat(100)
const EDIT_LIMIT_MS = 300

export async function verifyEditorExperience({ page, context, source, trigger, copyBody, shot, png }) {
  const openEditor = page.getByRole('button', { name: '编辑正文', exact: true })
  const openFocus = page.getByRole('button', { name: '专注编辑', exact: true })
  const exitFocus = page.getByRole('button', { name: '退出专注', exact: true })
  const tools = page.getByRole('group', { name: '成稿格式工具栏' })
  const editor = page.getByRole('textbox', { name: '成稿正文' })
  const article = page.locator('.article')
  const canvas = page.locator('.preview-canvas')
  const scroll = page.locator('.preview__scroll')
  const divider = page.getByRole('separator', { name: '调整源稿与成稿宽度' })
  const tabs = page.getByRole('tab')
  const currentTab = (name) => page.getByRole('tab', { name, selected: true })
  const layout = { width: 1440, height: 900 }
  const scenarios = []
  const failures = []
  const evidence = {}
  const typeset = () => page.locator('.status-chip[data-state="typeset"]').waitFor()
  const frame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  async function scenario(id, run) {
    try {
      await page.setViewportSize(layout)
      await page.reload()
      await source.waitFor()
      await run()
      scenarios.push(id)
      console.log(`${id} passed`)
    } catch (cause) {
      console.error(`${id} failed:`, cause)
      await shot(`${id}-failure`).catch(() => undefined)
      failures.push(new Error(`${id}: ${cause.message}`, { cause }))
    }
  }

  async function render(markdown) {
    await source.fill(markdown)
    await trigger.click()
    await typeset()
  }

  async function selectIn(locator, start, end = start) {
    await locator.evaluate((el, [from, to]) => {
      el.closest('[contenteditable]').focus({ preventScroll: true })
      const node = el.firstChild
      if (node?.nodeType !== Node.TEXT_NODE) throw new Error('验收段落不是以文字开始')
      window.getSelection().setBaseAndExtent(node, from, node, to)
    }, [start, end])
  }

  async function selectRenderedWord(locator, word) {
    await locator.evaluate((el, value) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode
        const start = node.textContent.indexOf(value)
        if (start < 0) continue
        window.getSelection().setBaseAndExtent(node, start, node, start + value.length)
        return
      }
      throw new Error(`未找到正文选区：${value}`)
    }, word)
  }

  async function selection() {
    return editor.evaluate((el) => {
      const current = window.getSelection()
      return {
        inside: el.contains(current.anchorNode) && el.contains(current.focusNode),
        focused: document.activeElement === el,
        collapsed: current.isCollapsed,
        offset: current.anchorOffset,
        text: current.toString(),
      }
    })
  }

  async function expectSource(expected) {
    await page.waitForFunction((value) => document.querySelector('#source-markdown').value === value, expected)
    assert.equal(await source.inputValue(), expected)
  }

  async function visibleOutline(locator) {
    return locator.evaluate((el) => {
      const css = getComputedStyle(el)
      return document.activeElement === el && css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) >= 2
    })
  }

  async function clipboardHtml() {
    return page.evaluate(async () => {
      const [item] = await navigator.clipboard.read()
      return (await item.getType('text/html')).text()
    })
  }

  async function copyCurrentBody({ expectWarning = false } = {}) {
    const warning = expectWarning ? dismissDialog(true) : null
    await copyBody.click()
    if (warning) assert.match(await warning, /百家号兼容性提示/u)
    await page.getByText(/正文已复制为富文本/).waitFor()
    return clipboardHtml()
  }

  async function pasteImage() {
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 80
      canvas.height = 48
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#1b365d'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      const image = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })])
    })
    await page.keyboard.press(`${commandKey}+V`)
  }

  async function chooseImage(button, name, buffer) {
    const chooser = page.waitForEvent('filechooser')
    await button.click()
    await (await chooser).setFiles({ name, mimeType: 'image/png', buffer })
  }

  const syncButton = page.getByRole('button', { name: '同步到源稿', exact: true })
  async function syncSource({ accept = true, expected } = {}) {
    const message = dismissDialog(accept)
    await syncButton.click()
    assert.match(await message, /同步到源稿.*可能覆盖左侧同段改动/u)
    if (expected !== undefined) await expectSource(expected)
  }

  async function measuredEdit(expected, eventName, action) {
    await page.evaluate(({ expected, eventName }) => {
      const article = document.getElementById('platform-article')
      window.qaEdit = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 3000)
        article.addEventListener(eventName, () => {
          const started = performance.now()
          requestAnimationFrame(() => {
            clearTimeout(timer)
            const observed = article.querySelector('p').textContent === expected
            const committed = Boolean(document.querySelector('#article-patch-status'))
            resolve(observed && committed ? performance.now() - started : null)
          })
        }, { capture: true, once: true })
      })
    }, { expected, eventName })
    await action()
    const elapsed = await page.evaluate(() => window.qaEdit)
    assert(elapsed !== null && elapsed <= EDIT_LIMIT_MS,
      `${eventName} 后约 10,000 字成稿未在 ${EDIT_LIMIT_MS}ms 内显示已提交编辑（实测 ${elapsed ?? '无匹配'}）`)
    await expectSource(CJK_DRAFT)
    return Math.round(elapsed * 10) / 10
  }

  await scenario('A01', async () => {
    await source.fill(CJK_DRAFT)
    const start = performance.now()
    await trigger.click()
    await typeset()
    const typesetMs = Math.round(performance.now() - start)
    assert(typesetMs > 0 && typesetMs < 2000, `10,000 字从点击到显示已排版耗时异常：${typesetMs} 毫秒`)
    assert.equal(await page.locator('.preview-banner').count(), 0, '顶栏已显示排版成功，成稿不应重复提示')
    await openEditor.press('Enter')
    assert(await visibleOutline(editor), '键盘进入右侧编辑后焦点不可见')
    assert(await tools.evaluate((el) => !el.closest('.preview__scroll')))
    const toolTop = (await tools.boundingBox())?.y
    assert(await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight
      return el.scrollTop > 0
    }), '长文没有独立滚动区域')
    assert.equal((await tools.boundingBox())?.y, toolTop, '滚动正文时工具栏一起滚动')
    await scroll.evaluate((el) => { el.scrollTop = 0 })

    const first = editor.locator('p').first()
    const firstChars = (value) => '字字' + value + '字'.repeat(98)
    await selectIn(first, 2)
    const committedInputMs = await measuredEdit(firstChars('中'), 'input', () => page.keyboard.insertText('中'))
    assert.deepEqual(await selection(), { inside: true, focused: true, collapsed: true, offset: 3, text: '' })
    await page.keyboard.press('Backspace')
    await expectSource(CJK_DRAFT)

    const cdp = await context.newCDPSession(page)
    let chromiumCompositionMs
    try {
      // This uses Chromium's composition pipeline, not macOS input source/candidate UI.
      await cdp.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 })
      assert.match(await first.innerText(), /zhongwen/, '合成中的候选文本没有进入右侧暂态')
      await frame()
      assert.equal(await source.inputValue(), CJK_DRAFT, '候选文字尚未提交就写回源稿')
      chromiumCompositionMs = await measuredEdit(firstChars('中文'), 'compositionend', () =>
        cdp.send('Input.insertText', { text: '中文' }))
    } finally {
      await cdp.detach()
    }
    assert.deepEqual(await selection(), { inside: true, focused: true, collapsed: true, offset: 4, text: '' })
    await page.keyboard.press('Backspace')
    const deleteMs = await measuredEdit(firstChars(''), 'input', () => page.keyboard.press('Backspace'))
    await selectIn(first, 2, 4)
    assert.equal((await selection()).text, '字字')
    await page.evaluate(() => navigator.clipboard.writeText('粘贴'))
    const pasted = CJK_DRAFT.replace('字'.repeat(4), '字字粘贴')
    const pasteMs = await measuredEdit('字字粘贴' + '字'.repeat(96), 'input', () => page.keyboard.press(`${commandKey}+V`))
    assert((await selection()).collapsed && (await selection()).focused, '粘贴后没有保留编辑焦点和折叠光标')
    await page.keyboard.press(`${commandKey}+Z`)
    assert.equal(await first.innerText(), firstChars(''))
    await page.keyboard.press(`${commandKey}+Shift+Z`)
    assert.match(await first.innerText(), /^字字粘贴/u)
    await expectSource(CJK_DRAFT)
    assert.match(await copyCurrentBody(), /字字粘贴/)
    await syncSource({ expected: pasted })
    evidence.performanceMs = { typesetMs, committedInputMs, chromiumCompositionMs, deleteMs, pasteMs, limit: EDIT_LIMIT_MS }
    evidence.inputMethod = 'Chromium CDP composition simulation and committed input; native macOS IME not exercised'
    await shot('11-chinese-committed-1440')
  })

  await scenario('A02', async () => {
    const draft = [
      '---', 'title: 元信息标题', 'custom: "  原样  "', '---', '', '# 独立首标题', '', '只改这一段。', '',
      '留住 [外链原字](https://example.test/reference "原样标题") 与 *斜体*。', '',
      '| 项目 | 说明 |', '| :--- | ---: |', '| 降级单元 | 单元乙 |', '', '![配对原图](./images/local.png)', '', '原样收尾。', '',
    ].join('\n')
    await source.fill(draft)
    await chooseImage(page.getByRole('button', { name: '选择文件' }), 'local.png', png)
    const title = page.getByLabel('文章标题（可留空）')
    await title.fill('验收手填标题')
    await trigger.click()
    await typeset()
    await tabs.filter({ hasText: '百家' }).click()
    assert.equal(await article.locator('table').count(), 0, '验收平台未降级表格')
    assert.equal(await article.locator('a[href="https://example.test/reference"]').count(), 0, '验收平台未降级外链')
    await page.waitForFunction(() => [...document.images].some((img) => img.alt === '配对原图' && img.naturalWidth > 0))
    assert.equal(await page.locator('.article-title').innerText(), '验收手填标题')
    await openEditor.click()
    await page.getByRole('button', { name: '完成编辑', exact: true }).click()
    assert.equal(await source.inputValue(), draft, '只进出编辑态改写了源稿')
    await openEditor.click()
    await selectIn(editor.getByText('只改这一段。', { exact: true }), 0, 2)
    await page.keyboard.insertText('更新')
    const updated = draft.replace('只改这一段。', '更新这一段。')
    await expectSource(draft)
    await syncSource({ expected: updated })
    assert.equal(await title.inputValue(), '验收手填标题')
    await selectRenderedWord(editor.getByText(/降级单元/).last(), '降级单元')
    await page.keyboard.insertText('右侧表格改动')
    await syncSource()
    await page.locator('.article-edit__issue').filter({ hasText: /未同步/ }).waitFor()
    assert.match(await editor.innerText(), /右侧表格改动/)
    assert.equal(await source.inputValue(), updated, '降级表格的修改破坏了公共源稿')
    assert(!(await copyBody.isDisabled()), '保留的右侧修改应仍可复制')
    assert.match(await copyCurrentBody({ expectWarning: true }), /右侧表格改动/)
    await shot('12-degraded-table-warning-1440')
  })

  await scenario('A03', async () => {
    const draft = '# 编辑验收\n\n加粗字、标记字。\n\n本地图片位置。'
    await render(draft)
    await openEditor.click()
    const first = editor.locator('p').first()
    await selectIn(first, 4, 7)
    await tools.getByRole('button', { name: '高亮', exact: true }).click()
    assert.match(await first.innerHTML(), /background-color:[^>]+>标记字/)
    assert.equal(await source.inputValue(), draft, '高亮不能写入 Markdown')
    await tabs.nth(1).click()
    assert(!(await copyBody.isDisabled()), '只加高亮不能让其他平台过期')
    await tabs.first().click()
    await openEditor.click()
    await selectIn(first, 0, 3)
    await tools.getByRole('button', { name: '加粗', exact: true }).click()
    const boldDraft = draft.replace('加粗字', '**加粗字**')
    await expectSource(draft)
    await syncSource({ expected: boldDraft })
    assert.match(await first.innerHTML(), /<(?:b|strong)>加粗字/)
    const imageButton = tools.getByRole('button', { name: '插入图片', exact: true })
    const last = editor.locator('p').last()
    await selectIn(last, 4)
    await chooseImage(imageButton, '损坏.png', Buffer.from('invalid PNG fixture'))
    await page.getByText(/浏览器无法打开这张图片/).waitFor()
    assert.equal(await source.inputValue(), boldDraft)
    assert.equal(await editor.locator('img').count(), 0)
    await selectIn(last, 4)
    await pasteImage()
    await page.waitForFunction(() => [...document.querySelectorAll('.article img')].some((img) => img.naturalWidth === 80))
    assert.match(await last.innerHTML(), /本地图片<img[^>]+>位置。/)
    await expectSource(boldDraft)
    await syncSource({ accept: false, expected: boldDraft })
    assert.equal(await editor.locator('img').count(), 1)
    await syncSource()
    const pairedDraft = await source.inputValue()
    const reference = pairedDraft.match(/!\[[^\]]*\]\(([^)]+)\)/u)?.[1]
    assert.match(reference ?? '', /^[\w-]+\.png$/u, '本地图片必须写成简短且非 Base64/blob 的引用')
    assert.match(pairedDraft, /\*\*加粗字\*\*/)
    assert.doesNotMatch(pairedDraft, /data:image|blob:|<span|background-color/)
    const copied = await copyCurrentBody()
    assert.match(copied, /data:image\/png;base64,/)
    assert.match(copied, /background-color:[^>]+>标记字/)
    await shot('13-inline-edit-image-1440')

    let rerenderPrompt = null
    const observePrompt = async (dialog) => { rerenderPrompt = dialog.message(); await dialog.dismiss() }
    page.on('dialog', observePrompt)
    try {
      await trigger.click()
      await typeset()
    } finally {
      page.off('dialog', observePrompt)
    }
    assert.equal(rerenderPrompt, null, '相同基线重新排版不应该询问是否覆盖')
    await page.waitForFunction(() => [...document.querySelectorAll('.article img')].some((img) => img.naturalWidth === 80))
    assert.equal(await source.inputValue(), pairedDraft, '重新排版丢失了已同步文字或已配对图片引用')
    assert.match(await article.innerHTML(), /<(?:b|strong)\b[^>]*>加粗字/)
    assert.match(await article.innerHTML(), /background-color:[^>]+>标记字/)
  })

  function dismissDialog(accept) {
    const observed = page.waitForEvent('dialog')
    page.once('dialog', (dialog) => accept ? dialog.accept() : dialog.dismiss())
    return observed.then((dialog) => dialog.message())
  }

  await scenario('A04', async () => {
    const draft = '# 平台状态验收\n\n甲乙丙丁。'
    await render(draft)
    await openEditor.click()
    const first = editor.locator('p').first()
    await selectIn(first, 2)
    await editor.evaluate(() => {
      document.execCommand('insertText', false, '最新')
      Array.from(document.querySelectorAll('button')).find((button) => button.textContent.trim() === '复制正文').click()
    })
    await page.getByText(/正文已复制为富文本/).waitFor()
    const copied = await clipboardHtml()
    assert.match(copied, /甲乙最新丙丁/)
    assert.doesNotMatch(copied, /data-uma-source|<!--uma-source:/, '复制输出泄漏了内部映射标记')
    await selectIn(first, 4)
    await editor.evaluate(() => {
      document.execCommand('insertText', false, '切换')
      document.querySelectorAll('[role=tab]')[1].click()
    })
    await currentTab(/头条/).waitFor()
    assert.match(await article.innerText(), /甲乙丙丁/)
    assert.doesNotMatch(await article.innerText(), /最新|切换/)
    assert(!(await copyBody.isDisabled()), '同步前其它平台不应过期')
    assert(await openFocus.isVisible())
    await expectSource(draft)
    await tabs.first().click()
    assert.match(await article.innerText(), /甲乙最新切换丙丁/)
    const updated = draft.replace('甲乙', '甲乙最新切换')
    await syncSource({ expected: updated })
    await tabs.nth(1).click()
    assert(await copyBody.isDisabled(), '显式同步后其它平台应过期')
    assert.equal(await openFocus.count(), 0)
    assert.match(await page.locator('.preview-banner').innerText(), /源稿.*重新排版/)
    await shot('14-other-platform-stale-1440')

    const newer = updated + '\n\n左侧手改的新段。'
    await source.fill(newer)
    await tabs.first().click()
    assert(await copyBody.isDisabled(), '左侧另行编辑后当前平台也应过期')
    assert.equal(await openEditor.count(), 0)
    await trigger.click()
    await typeset()
    assert.match(await page.locator('#article-patch-status').innerText(), /基线已变/u)
    await page.getByRole('button', { name: '撤销右侧改动', exact: true }).click()
    assert.match(await article.innerText(), /左侧手改的新段/)
    await openEditor.click()
    await selectIn(first, 2)
    await editor.evaluate(() => {
      document.execCommand('insertText', false, '紧接重排')
      Array.from(document.querySelectorAll('button')).find((button) => button.textContent.trim() === '一键排版').click()
    })
    await typeset()
    assert.match(await article.innerText(), /甲乙紧接重排最新切换丙丁/)
    assert.match(await article.innerText(), /左侧手改的新段/)
    await expectSource(newer)
    await syncSource({ expected: newer.replace('甲乙', '甲乙紧接重排') })
  })

  async function measureSplit() {
    const [left, right, paper, handle] = await Promise.all([
      page.locator('.panel--source').boundingBox(), page.locator('.panel--preview').boundingBox(),
      canvas.boundingBox(), divider.boundingBox(),
    ])
    assert(left && right && paper && handle)
    return { left: left.width, right: right.width, paper: paper.width, handle: handle.width }
  }

  async function dragDivider(x) {
    const handle = await divider.boundingBox()
    assert(handle)
    const y = handle.y + Math.min(110, handle.height / 2)
    await page.mouse.move(handle.x + handle.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(x, y, { steps: 8 })
    await page.mouse.up()
    await frame()
  }

  function near(actual, expected, message) {
    assert(Math.abs(actual - expected) <= 1, `${message}: ${actual}px（预期 ${expected}px）`)
  }

  async function noOverflow() {
    return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  }

  await scenario('A05', async () => {
    const draft = '# 分栏验收\n\n甲乙丙丁。'
    await render(draft)
    const previewWidth = (await canvas.boundingBox()).width
    await openEditor.click()
    await selectIn(editor.locator('p').first(), 1, 3)
    const widths = []
    for (const [width, height, leftMin, rightMin] of [[1440, 900, 380, 520], [1024, 768, 320, 480]]) {
      await page.setViewportSize({ width, height })
      await divider.press('Enter')
      await frame()
      const normal = await measureSplit()
      assert(normal.handle >= 12, `分隔线命中不足 12px: ${normal.handle}`)
      assert(await divider.getAttribute('aria-valuenow'), '手柄未公布宽度值')
      assert(await divider.evaluate((el) => getComputedStyle(el).cursor === 'col-resize'))
      await selectIn(editor.locator('p').first(), 1, 3)
      await dragDivider(1)
      const leftEdge = await measureSplit()
      near(leftEdge.left, leftMin, `${width}px 左栏下限`)
      assert(leftEdge.right > normal.right && leftEdge.paper > normal.paper, `${width}px 向左拖未拓宽成稿和编辑画布`)
      assert.equal((await selection()).text, '乙丙', `${width}px 拖动丢失选区`)
      assert(await tools.evaluate((el) => [...el.querySelectorAll('button')].every((button) => {
        const area = el.getBoundingClientRect()
        const box = button.getBoundingClientRect()
        return box.left >= area.left - 1 && box.right <= area.right + 1
      })), '编辑工具栏横向被裁切')
      await shot(`15-divider-left-${width}`)
      await dragDivider(width - 1)
      const rightEdge = await measureSplit()
      near(rightEdge.right, rightMin, `${width}px 右栏下限`)
      const beforeMove = rightEdge.left
      await page.mouse.move(40, 100, { steps: 4 })
      near((await measureSplit()).left, beforeMove, '释放鼠标后仍在拖动')
      await shot(`16-divider-right-${width}`)
      await divider.dblclick()
      await frame()
      near((await measureSplit()).left, normal.left, '双击未恢复默认')
      await divider.press('ArrowLeft')
      await frame()
      const keyboardLeft = await measureSplit()
      near(keyboardLeft.left, normal.left - 24, '方向键左移未调整 24px')
      await divider.press('ArrowRight')
      await frame()
      near((await measureSplit()).left, normal.left, '方向键右移未调整 24px')
      assert(await visibleOutline(divider), '键盘分隔线焦点不可见')
      await divider.press('ArrowLeft')
      await divider.press('Enter')
      await frame()
      near((await measureSplit()).left, normal.left, 'Enter 未恢复默认')
      assert(await noOverflow(), `${width}px 页面级横向溢出`)
      widths.push({ width, default: normal, leftEdge, rightEdge })
    }
    await page.setViewportSize(layout)
    await dragDivider(1)
    await page.getByRole('button', { name: '完成编辑', exact: true }).click()
    near((await canvas.boundingBox()).width, previewWidth, '分栏改变了现有平台预览宽度')
    assert.equal(await source.inputValue(), draft)
    await openEditor.click()
    await page.setViewportSize({ width: 820, height: 860 })
    assert(!(await divider.isVisible()), '820px 不应显示分栏把手')
    assert(await noOverflow(), '820px 页面级横向溢出')
    await tools.scrollIntoViewIfNeeded()
    await shot('17-editor-stack-820')
    evidence.splitWidths = widths

    // Regression: the default expanded warning list must not leave only a sliver for editing.
    await page.setViewportSize({ width: 1024, height: 768 })
    await divider.press('Enter')
    const tables = Array.from({ length: 8 }, (_, i) => `| 第一列 | ${i} |\n| --- | --- |\n| 单元 | ABC |`)
    await render('# 警告布局验收\n\n普通正文。\n\n' + tables.join('\n\n'))
    await tabs.filter({ hasText: '百家' }).click()
    await openEditor.click()
    await selectRenderedWord(editor.getByText(/单元/).first(), '单元')
    await page.keyboard.insertText('改动')
    await syncSource()
    await page.locator('.article-edit__issue').filter({ hasText: /未同步/ }).waitFor()
    const crowdedLayout = await scroll.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      const list = document.querySelector('.compat__list')
      return {
        visibleBodyPx: Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0),
        listScrolls: list.scrollHeight > list.clientHeight,
        articleScrolls: el.scrollHeight > el.clientHeight,
      }
    })
    assert(crowdedLayout.visibleBodyPx >= 140 && crowdedLayout.listScrolls && crowdedLayout.articleScrolls,
      `1024px 警告清单遮住了正文或没有独立滚动：${JSON.stringify(crowdedLayout)}`)
    evidence.crowdedLayout = crowdedLayout
    await shot('22-compact-warning-list-1024')
  })

  await scenario('A06', async () => {
    const paragraphs = Array.from({ length: 52 }, (_, index) => `段落${index + 1}：本段有明确的定位文本。`)
    const longWord = 'w'.repeat(180)
    const wideTable = ['短字列', '---', '内容'].map((cell) => '|' + (` ${cell} |`).repeat(60)).join('\n')
    const wideCode = '```txt\n' + longWord + '\n```'
    const draft = ['# 专注验收', ...paragraphs, wideTable, wideCode].join('\n\n')
    await render(draft)
    await openFocus.click()
    await editor.waitFor()
    assert(await visibleOutline(editor), '直接进入专注编辑后正文未聚焦')
    assert(!(await source.isVisible()) && !(await divider.isVisible()) && !(await tabs.first().isVisible()))
    assert.match(await page.locator('#platform-panel').getAttribute('aria-labelledby'), /platform/)
    assert(!(await copyBody.isDisabled()))
    assert(await noOverflow())
    const wideBlocks = {}
    for (const tag of ['table', 'pre']) {
      const dimensions = await editor.locator(tag).evaluate((el) => {
        el.scrollLeft = el.scrollWidth
        const measured = {
          viewportPx: el.clientWidth, contentPx: el.scrollWidth,
          articlePx: el.closest('article').clientWidth, scrollLeft: el.scrollLeft,
        }
        el.scrollLeft = 0
        return measured
      })
      assert(dimensions.viewportPx <= dimensions.articlePx && dimensions.scrollLeft > 0,
        `专注模式中的超宽 ${tag} 没有块内滚动：${JSON.stringify(dimensions)}`)
      wideBlocks[tag] = dimensions
    }
    evidence.focusWideBlocks = wideBlocks
    await exitFocus.click()
    await divider.waitFor()
    assert(await editor.isVisible(), '退出专注错误地完成了编辑')
    const defaultPaperWidth = (await canvas.boundingBox()).width
    await dragDivider(510)
    const split = await measureSplit()
    const anchor = editor.locator('p').nth(30)
    await anchor.scrollIntoViewIfNeeded()
    await selectIn(anchor, 0, 4)
    const selectionBefore = await selection()
    const scrollBefore = await scroll.evaluate((el) => el.scrollTop)
    assert(scrollBefore > 0, '没有建立长文阅读位置')
    await editor.evaluate((el) => { window.qaOriginalEditor = el })
    await openFocus.click()
    assert(await editor.evaluate((el) => window.qaOriginalEditor === el), '专注模式重新挂载了编辑器')
    assert.deepEqual(await selection(), selectionBefore, '进入专注丢失光标选区或焦点')
    assert((await canvas.boundingBox()).width > Math.max(split.paper, defaultPaperWidth), '专注画布未获得实际宽度')
    assert((await canvas.boundingBox()).width <= 1201, '专注画布超过约定上限')
    assert(await tools.evaluate((el) => !el.closest('.preview__scroll')))
    await page.keyboard.insertText('已在专注修改')
    const modified = paragraphs[30].replace(/^.{4}/u, '已在专注修改')
    assert.equal(await anchor.innerText(), modified)
    assert.match(await copyCurrentBody(), /已在专注修改/)
    await shot('18-focus-long-1440')
    await exitFocus.click()
    assert(await editor.evaluate((el) => window.qaOriginalEditor === el), '退出专注重新挂载了编辑器')
    await currentTab(/公众号/).waitFor()
    near((await measureSplit()).left, split.left, '退出未恢复调整后的分栏')
    assert((await selection()).inside && (await selection()).focused, '退出后正文光标和焦点未恢复')
    assert(await anchor.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const scrolling = el.closest('.preview__scroll').getBoundingClientRect()
      return r.top >= scrolling.top - 1 && r.bottom <= scrolling.bottom + 1
    }), '退出未保留当前阅读位置')
    await expectSource(draft)
    await page.keyboard.press(`${commandKey}+Z`)
    assert.equal(await anchor.innerText(), paragraphs[30])
    await expectSource(draft)

    // Hold exactly one real FileReader call. The image still arrives via the browser clipboard.
    await page.evaluate(() => {
      const read = FileReader.prototype.readAsDataURL
      FileReader.prototype.readAsDataURL = function (blob) {
        FileReader.prototype.readAsDataURL = read
        window.qaFinishImage = () => read.call(this, blob)
      }
    })
    await openFocus.click()
    await selectIn(anchor, 0, 4)
    await page.keyboard.insertText('第31段')
    await selectIn(anchor, 4)
    await pasteImage()
    await page.getByText(/正在读取图片/).waitFor()
    assert(await syncButton.isDisabled(), '读取图片时不能同步旧版本的右侧正文')
    await exitFocus.click()
    assert(await editor.isVisible(), '图片读取过程中无法退出专注')
    await page.evaluate(() => window.qaFinishImage())
    await anchor.locator('img').waitFor()
    assert.match(await anchor.innerHTML(), /第31段<img[^>]+>：本段有明确的定位文本。/)
    await expectSource(draft)
    await syncSource()
    assert.match(await source.inputValue(), /第31段!\[[^\]]*\]\([\w-]+\.png\)：本段/)
    await shot('19-returned-from-focus-1440')
  })

  await scenario('editor-space', async () => {
    const draft = [
      '# 视频号短视频 · AI 三秒给你一份方案，为什么你还是落不下去',
      '- **标题**：AI 三秒给你一份方案，为什么你还是落不下去？\n- **配文**：方案正在贬值，判断和落地正在变贵。AI 越强，能陪你把事做成的人越值钱。\n- **时长**：约 55 秒（203 字，按 4 字/秒，含两处停顿）\n- **画幅**：竖屏 9:16，1080×1920\n- **视觉主轴**：纸 vs 人。前半段全是纸（方案），后半段全是人（现场）',
      '---',
      '## 一、口播定稿',
      ...Array(30).fill('你有没有试过，把公司的问题发给 AI？它三秒钟给你一份方案。结构完整，逻辑通顺，还带实施步骤和风险提示。可你知道——落实不下去。'),
    ].join('\n\n')
    const compatibility = page.getByRole('region', { name: '微信公众号兼容性' })
    const topbar = page.locator('.topbar')
    const note = page.locator('.capability-note')
    const measureEditor = () => editor.evaluate((el) => {
      const body = el.getBoundingClientRect()
      const viewport = el.closest('.preview__scroll').getBoundingClientRect()
      return { width: body.width, visibleHeight: Math.min(innerHeight, viewport.bottom, body.bottom) - Math.max(0, viewport.top, body.top) }
    })

    await page.setViewportSize({ width: 1440, height: 722 })
    await render(draft)
    assert.equal(await compatibility.count(), 0, '无警告的清单不应占用预览区')
    await openEditor.click()
    assert.equal(await compatibility.count(), 0, '无警告的清单不应占用编辑区')
    assert(await note.evaluate((el) => Boolean(el.closest('.preview__scroll'))), '编辑时平台说明应随正文滚动')
    // 发布预检条在编辑时也常驻预览顶部（约 50px），给「删掉内容后一键检测」留一个随手可点的入口。
    const split = await measureEditor()
    assert(split.width >= 800 && split.visibleHeight >= 290, JSON.stringify(split))
    assert((await source.boundingBox()).height >= 320, 'Markdown 编辑框高度不足')
    await shot('after-split-1440x722')

    await openFocus.click()
    assert(!(await topbar.isVisible()), '专注模式仍显示全局顶栏')
    const focus = await measureEditor()
    assert(focus.width >= 1100 && focus.visibleHeight >= 400, JSON.stringify(focus))
    await shot('after-focus-1440x722')

    await page.setViewportSize({ width: 390, height: 844 })
    await frame()
    assert(await noOverflow())
    assert((await measureEditor()).visibleHeight >= 380, '窄屏专注正文高度不足')
    await shot('after-focus-390x844')
    await exitFocus.click()
    assert(await topbar.isVisible())
    await page.getByRole('button', { name: '完成编辑', exact: true }).click()
    assert.equal(await compatibility.count(), 0, '完成编辑后不应恢复无警告的清单')
    evidence.editorSpace = { split, focus }
  })

  await scenario('A07', async () => {
    await page.getByRole('heading', { name: '左侧还没有源稿' }).waitFor()
    assert.equal(await openFocus.count(), 0)
    await render('# 只有标题')
    assert.equal(await openFocus.count(), 0, '只有排版标题、没有可编辑正文时不能打开专注')
    assert(await copyBody.isDisabled())
    await source.fill('# 键盘验收\n\n链接位置。')
    assert.equal(await openFocus.count(), 0)
    await page.evaluate(() => {
      const schedule = window.setTimeout
      window.setTimeout = (callback, delay, ...args) => {
        if (delay !== 0) return schedule(callback, delay, ...args)
        window.setTimeout = schedule
        window.qaFinishTypeset = () => schedule(callback, delay, ...args)
        return 0
      }
    })
    await trigger.click()
    await page.locator('.status-chip[data-state="typesetting"]').waitFor()
    assert.equal(await openFocus.count(), 0, '正在排版时仍可以开启专注')
    await shot('20-typesetting-1440')
    await page.evaluate(() => window.qaFinishTypeset())
    await typeset()
    await openEditor.focus()
    await page.keyboard.press('Tab')
    assert(await visibleOutline(openFocus), '专注入口未在普通编辑旁提供可见 Tab 焦点')
    await page.keyboard.press('Enter')
    assert(await visibleOutline(editor), '键盘进入专注后缺少可见正文焦点')
    await shot('23-keyboard-focus-1440')
    await selectIn(editor.locator('p').first(), 0, 2)
    const linkCommand = tools.getByRole('button', { name: /链接/ })
    await linkCommand.focus()
    await page.keyboard.press('Enter')
    const link = page.getByRole('textbox', { name: '链接地址' })
    await link.waitFor()
    await link.press('Escape')
    assert(!(await link.isVisible()) && await exitFocus.isVisible(), '第一次 Escape 应只关闭链接表单')
    assert.equal((await selection()).text, '链接')
    assert(await visibleOutline(editor))
    // CDP cancellation removes its temporary composition span rather than restoring selected text.
    await selectIn(editor.locator('p').first(), 2)
    const cdp = await context.newCDPSession(page)
    try {
      await cdp.send('Input.imeSetComposition', { text: 'xuan', selectionStart: 4, selectionEnd: 4 })
      await page.keyboard.press('Escape')
      assert(await exitFocus.isVisible(), '组字过程中 Escape 不应退出专注')
      await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
    } finally {
      await cdp.detach()
    }
    assert.equal(await editor.innerText(), '链接位置。')
    for (let count = 0; count < 12; count += 1) {
      await page.keyboard.press('Tab')
      assert(await page.evaluate(() => !document.activeElement.closest('[hidden]')), '焦点进入了隐藏工作区')
    }
    await editor.focus()
    await page.keyboard.press('Escape')
    await divider.waitFor()
    assert(await editor.isVisible(), '正文 Escape 应退出专注但保持编辑')
    await source.fill('# 过期\n\n新稿。')
    assert.equal(await openFocus.count(), 0)

    // Confirm the app honors the media preference, rather than always disabling motion.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    try {
      assert.equal(await canvas.evaluate((el) => getComputedStyle(el).transitionDuration), '0.12s')
      await shot('24-normal-motion-1440')
    } finally {
      await page.emulateMedia({ reducedMotion: 'reduce' })
    }

    // A real browser renders this state with one test-injected dev adapter failure.
    const modulePath = '/src/platforms/registry.ts'
    const support = await context.request.get(new URL(modulePath, page.url()).href)
    try {
      if (support.ok() && /javascript/.test(support.headers()['content-type'] ?? '')) {
        await page.evaluate(async (path) => {
          // Vite may append a version query after edits; patch the module instance the page loaded.
          const loaded = performance.getEntriesByType('resource').findLast(({ name }) => new URL(name).pathname === path)
          const { PLATFORMS } = await import(loaded?.name ?? path)
          const target = PLATFORMS.find((candidate) => candidate.id === 'wechat')
          target.render = () => { throw new Error('浏览器验收模拟平台适配器失败') }
        }, modulePath)
        await trigger.click()
        await page.getByText(/公众号.*本次没有生成成功/).waitFor()
        assert.equal(await openFocus.count(), 0, '平台失败时仍提供专注入口')
        assert(await copyBody.isDisabled())
        assert.match(await article.innerText(), /链接位置。/, '单平台重排失败不应删除先前成稿')
        assert.equal(await source.inputValue(), '# 过期\n\n新稿。')
        await shot('21-platform-failure-1440')
        await tabs.nth(1).click()
        assert(await openFocus.isEnabled(), '其他平台异常被连带禁用')
        evidence.platformFailure = 'injected in Vite development browser; isolated to one adapter'
      } else {
        evidence.platformFailure = 'not injected: target did not expose Vite development modules'
      }
    } finally {
      await support.dispose()
    }
  })

  await scenario('A08-typography', async () => {
    const draft = '# 公众号排版试稿\n\n在一篇文章里，正文、**重点句**和引用可以用不同的字体。\n\n发布前，请核对预览。'
    const font = tools.getByRole('combobox', { name: '字体', exact: true })
    const size = tools.getByRole('combobox', { name: '字号', exact: true })
    await render(draft)
    assert.equal(await font.count(), 0, '字体控件不应显示在只读成稿')
    for (const tab of await tabs.all()) {
      await tab.click()
      assert.match(await article.locator('p').first().evaluate((el) => getComputedStyle(el).fontFamily), /^["']?Microsoft YaHei\b/)
      assert.match(await page.locator('.article-title').evaluate((el) => getComputedStyle(el).fontFamily), /^["']?Microsoft YaHei\b/)
    }
    await tabs.first().click()
    await openEditor.click()
    const expectControl = (label, value) => page.waitForFunction(([name, expected]) => (
      document.querySelector(`select[aria-label="${name}"]`)?.value === expected
    ), [label, value])
    await expectControl('字体', 'yahei')
    await expectControl('字号', '18')
    assert.deepEqual(await font.locator('option').allTextContents(), ['字体', '微软雅黑', '黑体', '宋体', '楷体'])
    const p = editor.locator('p').first()
    const wordSize = (locator, word) => locator.evaluate((el, value) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        if (walker.currentNode.textContent.includes(value)) return getComputedStyle(walker.currentNode.parentElement).fontSize
      }
      throw new Error(`未找到要核对字号的文字：${value}`)
    }, word)
    const originalSize = await wordSize(p, '在一篇')
    const original = await editor.innerHTML()
    await selectIn(p, 0)
    await font.selectOption('heiti')
    await page.getByRole('alert').filter({ hasText: '请先选中' }).waitFor()
    assert.equal(await editor.innerHTML(), original)
    await selectRenderedWord(p, '重点句')
    await source.click()
    await source.press('ArrowRight')
    await font.selectOption('kaiti')
    assert.equal(await editor.innerHTML(), original, '离开正文后不得修改旧选区')

    await editor.focus()
    await selectRenderedWord(p, '重点句')
    await tools.getByRole('combobox', { name: '段落与标题级别' }).focus()
    await page.keyboard.press('Tab')
    assert(await visibleOutline(font), '键盘进入字体控件时缺少可见焦点环')
    await font.selectOption('songti')
    await expectControl('字体', 'songti')
    assert.match(await p.innerHTML(), /SimSun/)
    await expectSource(draft)
    assert.equal((await selection()).text, '重点句')
    await font.focus()
    await page.keyboard.press('Tab')
    assert(await visibleOutline(size), '键盘进入字号控件时缺少可见焦点环')
    await size.selectOption('23')
    await expectControl('字号', '23')
    await expectControl('字体', 'songti')
    const styled = p.locator('[style*="font-size: 23px"]')
    assert.equal(await styled.evaluate((el) => getComputedStyle(el).fontSize), '23px')
    assert.equal(await styled.innerText(), '重点句')
    assert.equal((await selection()).text, '重点句')
    assert.equal(await wordSize(p, '在一篇'), originalSize, '未选中的正文应保留原字号')
    await expectSource(draft)
    await page.keyboard.press(`${commandKey}+Z`)
    assert.equal(await styled.count(), 0)
    await expectControl('字号', '18')
    assert.match(await p.innerHTML(), /SimSun/)
    await page.keyboard.press(`${commandKey}+Z`)
    await expectControl('字体', 'yahei')
    assert.doesNotMatch(await p.innerHTML(), /SimSun/)
    await page.keyboard.press(`${commandKey}+Shift+Z`)
    await expectControl('字体', 'songti')
    assert.match(await p.innerHTML(), /SimSun/)
    await page.keyboard.press(`${commandKey}+Shift+Z`)
    await expectControl('字号', '23')
    assert.equal(await styled.evaluate((el) => getComputedStyle(el).fontSize), '23px')
    await expectSource(draft)

    await p.evaluate((el) => {
      const before = el.firstChild
      getSelection().setBaseAndExtent(before, 1, before, 1)
    })
    await expectControl('字体', 'yahei')
    await expectControl('字号', '18')
    await selectRenderedWord(p, '在一篇')
    await page.getByText('一份 Markdown，六个平台的正文').click()
    await size.selectOption('72')
    assert.doesNotMatch(await editor.innerHTML(), /72px/, '点外部非焦点区域后不得修改原选区')
    await editor.focus()
    await selectRenderedWord(p, '在一篇')
    await size.selectOption('72')
    assert.equal(await p.locator('[style*="font-size: 72px"]').innerText(), '在一篇')
    assert.equal(await p.locator('strong').innerText(), '重点句', '未选中的加粗保持原状')
    await expectSource(draft)
    await page.keyboard.press(`${commandKey}+Z`)
    await editor.evaluate((el) => window.getSelection().selectAllChildren(el))
    await expectControl('字体', '')
    await expectControl('字号', '')
    await size.selectOption('24')
    await expectControl('字号', '24')
    assert.equal(await wordSize(p, '重点句'), '24px')
    assert.equal(await wordSize(editor.locator('p').last(), '核对预览'), '24px')
    await expectSource(draft)
    await page.keyboard.press(`${commandKey}+Z`)
    await selectRenderedWord(p, '重点句')
    await shot('25-typography-1440')

    await page.getByRole('button', { name: '完成编辑', exact: true }).click()
    const copied = await copyCurrentBody()
    assert.match(copied, /font-size:\s*23px/)
    assert.match(copied, /Microsoft YaHei/)
    assert.match(copied, /SimSun/)
    assert.doesNotMatch(copied, /data-studio|公众号排版试稿/)
    await tabs.nth(1).click()
    assert.doesNotMatch(await article.innerHTML(), /SimSun|font-size:\s*23px/)
    assert.match(await copyCurrentBody(), /Microsoft YaHei/)
    await tabs.nth(0).click()
    assert.match(await article.innerHTML(), /font-size:\s*23px/)

    await page.setViewportSize({ width: 390, height: 844 })
    await openFocus.click()
    await selectRenderedWord(editor.locator('p').last(), '核对预览')
    await size.selectOption('19')
    assert.equal(await wordSize(editor.locator('p').last(), '核对预览'), '19px')
    assert(await tools.evaluate((el) => el.scrollWidth <= el.clientWidth))
    assert(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth))
    await shot('26-typography-focus-390')
  })

  if (failures.length) throw new AggregateError(failures, 'Editor experience browser scenarios failed')
  return { scenarios, ...evidence }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runner = fileURLToPath(new URL('./verify-ui.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [runner, '--editor-only'], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
