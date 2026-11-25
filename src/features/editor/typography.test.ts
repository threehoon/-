import { expect, it, vi } from 'vitest'
import { applyFontSize, FONT_SIZE_GROUPS } from './typography'

it('offers every integer pixel size from 12 through 72 exactly once', () => {
  const sizes = FONT_SIZE_GROUPS.flatMap(({ values }) => values).sort((a, b) => a - b)
  expect(sizes).toEqual(Array.from({ length: 61 }, (_, index) => index + 12))
})

it('normalizes the native font command without changing the font family', () => {
  const owner = document.implementation.createHTMLDocument()
  const article = owner.createElement('article')
  article.innerHTML = '<p><span style="font-family:serif;font-size:26px">正文</span></p>'
  const span = article.querySelector('span')!
  owner.queryCommandState = vi.fn(() => false)
  owner.execCommand = vi.fn((command: string) => {
    if (command === 'fontSize') span.style.fontSize = 'x-small'
    return true
  })
  expect(applyFontSize(article, 23)).toBe(true)
  expect(span.style.fontSize).toBe('23px')
  expect(span.style.fontFamily).toBe('serif')
})
