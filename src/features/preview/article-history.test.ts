import { expect, it, vi } from 'vitest'
import { ArticleHistory } from './article-history'

const snapshot = (html: string, offset = 0) => {
  const point = { path: [0, 0], offset }
  return { html, selection: { anchor: point, focus: point } }
}

it('groups nearby typing at the same caret, then branches after a new edit', () => {
  const history = new ArticleHistory()
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
  try {
    const initial = snapshot('<p></p>')
    const first = snapshot('<p>甲</p>', 1)
    const second = snapshot('<p>甲乙</p>', 2)
    const third = snapshot('<p>甲乙丙</p>', 3)
    history.record(initial, first.selection, 'insertText')
    now.mockReturnValue(1400)
    history.record(first, second.selection, 'insertText')
    now.mockReturnValue(2250)
    history.record(second, third.selection, 'insertText')
    expect(history.restore('undo', third)).toEqual(second)
    expect(history.restore('undo', second)).toEqual(initial)
    expect(history.restore('redo', initial)).toEqual(second)
    history.record(second, null, '')
    expect(history.available('redo')).toBe(false)
    history.clear()
    expect(history.restore('undo', third)).toBeUndefined()
  } finally {
    now.mockRestore()
  }
})

it('retains several recent steps for a draft with a large embedded image', () => {
  const history = new ArticleHistory()
  const initial = snapshot('<p>正文</p>')
  const embedded = 'A'.repeat(5 * 1024 * 1024)
  const withImage = (suffix: string) => snapshot(`<p>正文${suffix}</p><img src="data:image/png;base64,${embedded}">`)
  const afterInsertion = withImage('')
  const afterTyping = withImage('甲')
  history.record(initial, null, '')
  history.record(afterInsertion, null, '')
  expect(history.restore('undo', afterTyping)).toBe(afterInsertion)
  expect(history.restore('undo', afterInsertion)).toBe(initial)
  expect(history.restore('redo', initial)).toBe(afterInsertion)
  expect(history.restore('redo', afterInsertion)).toBe(afterTyping)
})
