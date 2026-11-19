import { describe, expect, it } from 'vitest'
import { editedArticleText } from './article-text'

function toText(html: string): string {
  const article = document.createElement('article')
  article.innerHTML = html
  return editedArticleText(article)
}

describe('成稿的纯文本复制内容', () => {
  it('保留未改动的有序列表编号和段落边界', () => {
    expect(toText('<p>改稿</p><ol start="3"><li>第一项</li><li>第二项</li></ol><p>末段</p>'))
      .toBe('改稿\n\n3. 第一项\n4. 第二项\n\n末段')
  })

  it('保留无序列表并缩进嵌套项', () => {
    expect(toText('<ul><li>外层<ul><li>内层</li></ul></li></ul>')).toBe('- 外层\n  - 内层')
  })

  it('把图片转成纯文本补插标记', () => {
    expect(toText('<img alt="本地图"><img>')).toBe('［图片：本地图］［图片：未命名］')
  })

  it('换行占位和分隔线不被误判为纯文本', () => {
    expect(toText('<div><br></div><hr>')).toBe('')
  })
})
