const PARAGRAPHS = new Set(['P', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

function listText(list: HTMLOListElement | HTMLUListElement): string {
  const items = Array.from(list.children).filter((item): item is HTMLLIElement => item.tagName === 'LI')
  const ordered = list.tagName === 'OL' ? list as HTMLOListElement : null
  let number = ordered?.hasAttribute('start') ? ordered.start : ordered?.reversed ? items.length : 1
  return items.map((item) => {
    if (ordered && item.hasAttribute('value')) number = item.value
    const value = Array.from(item.childNodes, nodeText).join('').trim()
    const marker = ordered ? `${number}.` : '-'
    number += ordered?.reversed ? -1 : 1
    return value === '' ? '' : `${marker} ${value.replaceAll('\n', '\n  ')}`
  }).filter(Boolean).join('\n')
}

function nodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (!(node instanceof HTMLElement)) return ''
  const tag = node.tagName
  if (node instanceof HTMLImageElement) return `［图片：${node.alt.trim() || '未命名'}］`
  if (tag === 'HR') return ''
  if (tag === 'BR') return '\n'
  if (node instanceof HTMLOListElement || node instanceof HTMLUListElement) return `\n${listText(node)}\n`
  if (node instanceof HTMLTableElement) {
    return `\n${Array.from(node.rows, (row) => Array.from(row.cells, (cell) => nodeText(cell).trim()).join('\t')).join('\n')}\n`
  }
  if (tag === 'PRE') return `\n\n${node.textContent ?? ''}\n\n`
  const content = Array.from(node.childNodes, nodeText).join('')
  if (PARAGRAPHS.has(tag)) return `\n\n${content.trim()}\n\n`
  if (tag === 'DIV') return `\n${content}\n`
  return content
}

/** 浏览器的 innerText 不包含列表标记；从编辑后的 DOM 保留可读的结构。 */
export function editedArticleText(article: HTMLElement): string {
  return nodeText(article).replace(/\n{3,}/g, '\n\n').trim()
}
