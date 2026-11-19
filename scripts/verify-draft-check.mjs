import assert from 'node:assert/strict'

export async function verifyDraftCheck({ browser, target, png }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: target.origin })
    const externalRequests = []
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === target.origin) return route.continue()
      externalRequests.push(route.request().url())
      return route.abort()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    await page.goto(target.href)
    const source = page.locator('#source-markdown')
    const article = page.locator('#platform-article')
    const check = page.getByRole('button', { name: '一键检查内容', exact: true })
    const findings = page.getByRole('list', { name: '内容检查结果' })
    const selectedSource = () => source.evaluate((field) => field.value.slice(field.selectionStart, field.selectionEnd))
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
      assert.match(dialog.message(), /会替换当前稿件/u)
      if (accept) await dialog.accept()
      else await dialog.dismiss()
      await replacement
      assert.equal(await source.inputValue(), draft)
    }

    await typeset()
    await page.getByRole('tab', { name: /^百家/ }).click()
    const compatibility = page.locator('.compat')
    await compatibility.getByRole('button', { name: /定位.*表格已按原行序/u }).click()
    const marks = (name) => page.evaluate((name) => [...CSS.highlights.get(name) ?? []].map(String), name)
    assert((await marks('studio-compat-issue')).some((range) => /列名称：零件.*数量：1/u.test(range)))
    const removed = compatibility.locator('li').filter({ hasText: '操作说明' })
    await removed.getByRole('button', { name: /定位/u }).click()
    assert.equal(await selectedSource(), '[操作说明](https://example.test/manual)')
    assert(await source.evaluate((field) => field.scrollTop > 0), '定位已移除的外链时应滚到源稿位置')

    const originalHtml = await article.innerHTML()
    await check.click()
    await findings.waitFor()
    const originals = await marks('studio-content-issue')
    assert.equal(originals.filter((range) => range === '按装').length, 3)
    assert(originals.includes('，，') && originals.includes('已经已经'))
    assert(originals.some((range) => range === '一段长句'.repeat(22)))
    const typos = findings.getByRole('button', { name: '定位正文中的「按装」', exact: true })
    await typos.nth(1).click()
    assert(await page.getByText('第二次按装软件，已经已经下载。', { exact: true }).evaluate((el) => {
      const block = el.getBoundingClientRect()
      const viewport = el.closest('.preview__scroll').getBoundingClientRect()
      return block.top >= viewport.top && block.bottom <= viewport.bottom
    }), '同样的词出现多次时，第二条要跳到第二处')
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
    assert.doesNotMatch(clipboard, /studio-(?:content|compat)-issue|uma-source/u)

    await page.getByRole('button', { name: '编辑正文', exact: true }).click()
    await article.getByText('请参考操作说明。', { exact: true }).scrollIntoViewIfNeeded()
    await drop(article, [{ name: '保护位置.png', type: 'image/png', bytes: [...png] }],
      { text: '请参考操作说明。', offset: '请参考'.length })
    await page.getByRole('alert').filter({ hasText: '这个位置的图片无法同步到源稿' }).waitFor()
    assert.equal(await source.inputValue(), draft)
    assert.equal(await article.innerHTML(), originalHtml)
    await page.getByRole('button', { name: '完成编辑', exact: true }).click()

    await page.getByRole('tab', { name: /^公众号/ }).click()
    assert.equal(await findings.count(), 0)
    assert.equal((await marks('studio-content-issue')).length, 0)
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
    assert.match(await source.inputValue(), /图前!\[配图\]\(paste-1\.png\)图后/u)
    assert.equal(await findings.count(), 0, '正文修改清除旧校对结果')
    await typeset()
    assert.match(await article.locator('img[alt="配图"]').getAttribute('src'), /^data:image\/png/u)
    await check.click()
    await source.fill('# 正常标题\n\n这是一段正常的正文。')
    assert.equal(await findings.count(), 0, '修改左侧源稿清除旧校对结果')
    await typeset()
    await check.click()
    await page.getByText('本次规则未发现问题。', { exact: true }).waitFor()
    assert.deepEqual(externalRequests, [], '校对和拖放未联网')
    return ['稿件拖入与替换确认', '校对红线与重复词定位', '兼容清单及已移除链接定位', '剪贴板隔离', '图片拖放与重新排版']
  } finally {
    await context.close()
  }
}
