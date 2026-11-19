import { describe, expect, it } from 'vitest'
import { rebaseSourceChanges } from './source-rebase'

describe('rebaseSourceChanges', () => {
  it('returns the exact proposal when the source still equals the baseline', () => {
    expect(rebaseSourceChanges('重复\n\n重复', '替换\n\n重复', '重复\n\n重复')).toBe('替换\n\n重复')
  })

  it('returns the exact current source when the proposal has no change', () => {
    expect(rebaseSourceChanges('', '', '\uFEFF新内容\r\n')).toBe('\uFEFF新内容\r\n')
  })

  it('applies multiple separate edits while preserving intervening and adjacent source edits', () => {
    const baseline = '开头\n\n甲原文\n\n中间原文\n\n乙原文\n\n结尾'
    const proposed = '开头\n\n甲新文\n\n中间原文\n\n\n\n结尾'
    const current = '开头\n\n新增前段\n\n甲原文\n\n中间改写\n\n乙原文\n\n新增后段\n\n结尾'
    expect(rebaseSourceChanges(baseline, proposed, current))
      .toBe('开头\n\n新增前段\n\n甲新文\n\n中间改写\n\n\n\n新增后段\n\n结尾')
  })

  it('preserves changed YAML, BOM, CRLF, hidden definitions and Markdown indentation byte for byte', () => {
    const baseline = '\uFEFF---\r\ntitle: 文章标题\r\nkey: old\r\n---\r\n\r\n# 文章标题\r\n\r\n甲原文\r\n仍属同段  \r\n\r\n  *保留格式*\r\n\r\n[ref]: https://example.test/\r\n'
    const proposed = baseline.replace('甲原文', '甲新文')
    const current = baseline.replace('key: old', 'key: "new" # 注释').replace('example.test', 'example.invalid')
    expect(rebaseSourceChanges(baseline, proposed, current)).toBe(current.replace('甲原文', '甲新文'))
  })

  it('deletes a block with its proposal separator without deleting newly adjacent content', () => {
    const baseline = '甲\n\n待删\n\n乙'
    const current = '甲\n\n待删\n\n新增\n\n乙'
    expect(rebaseSourceChanges(baseline, '甲\n\n乙', current)).toBe('甲\n\n新增\n\n乙')
  })

  it('inserts between stable blocks when a different block changed', () => {
    const baseline = '甲\n\n乙\n\n尾段'
    const proposed = '甲\n\n新增\n\n乙\n\n尾段'
    const current = '甲\n\n乙\n\n改写尾段'
    expect(rebaseSourceChanges(baseline, proposed, current)).toBe('甲\n\n新增\n\n乙\n\n改写尾段')
  })

  it('locates insertions at both stable document edges', () => {
    const baseline = '甲\r\n\r\n乙\r\n\r\n丙'
    const proposed = `插入开头\r\n\r\n${baseline}\r\n\r\n插入结尾`
    const current = baseline.replace('乙', '源稿改写')
    expect(rebaseSourceChanges(baseline, proposed, current)).toBe(proposed.replace('乙', '源稿改写'))
  })

  it('allows identical inserted text elsewhere when separate stable anchors disambiguate the insertion', () => {
    const baseline = '甲\n\n乙\n\n中间\n\n重复\n\n末尾'
    const proposed = '甲\n\n重复\n\n乙\n\n中间\n\n重复\n\n末尾'
    expect(rebaseSourceChanges(baseline, proposed, baseline.replace('末尾', '源稿末尾')))
      .toBe(proposed.replace('末尾', '源稿末尾'))
  })

  it('refuses edits to different lines of the same paragraph', () => {
    const baseline = '甲原文\n同段次行\n\n末尾'
    const proposed = baseline.replace('甲原文', '甲新文')
    const current = baseline.replace('同段次行', '源稿新行')
    expect(rebaseSourceChanges(baseline, proposed, current)).toBeNull()
  })

  it('treats a GFM table as one unit when separate rows are edited', () => {
    const baseline = '表头 | 值\n--- | ---\n甲 | 1\n乙 | 2\n\n尾段'
    const proposed = baseline.replace('甲 | 1', '甲 | 3')
    const current = baseline.replace('乙 | 2', '乙 | 4')
    expect(rebaseSourceChanges(baseline, proposed, current)).toBeNull()
  })

  it('refuses an edited block whose indentation was independently changed', () => {
    expect(rebaseSourceChanges('  甲\n\n乙', '  改甲\n\n乙', ' 甲\n\n乙')).toBeNull()
  })

  it('refuses the entire merge when one of multiple edits conflicts', () => {
    const baseline = '甲\n\n中间\n\n乙'
    const proposed = '甲新文\n\n中间\n\n乙新文'
    expect(rebaseSourceChanges(baseline, proposed, '甲\n\n中间\n\n乙源稿改写')).toBeNull()
  })

  it.each([
    ['原段\n\n原段\n\n末尾', '新段\n\n原段\n\n末尾', '原段\n\n原段\n\n源稿末尾'],
    ['原段\n\n末尾', '新段\n\n末尾', '原段\n\n末尾\n\n原段'],
  ])('refuses duplicated candidate blocks in the baseline or current source', (baseline, proposed, current) => {
    expect(rebaseSourceChanges(baseline, proposed, current)).toBeNull()
  })

  it('does not match a paragraph as a substring inside a longer block or fenced code', () => {
    const baseline = '原段\n\n尾段'
    const proposed = '新段\n\n尾段'
    const current = '已改原段\n\n尾段\n\n```md\n原段\n```'
    expect(rebaseSourceChanges(baseline, proposed, current)).toBeNull()
  })

  it('refuses a candidate that crossed surviving baseline anchors', () => {
    expect(rebaseSourceChanges('甲\n\n原段\n\n乙', '甲\n\n新段\n\n乙', '甲\n\n改写\n\n乙\n\n原段')).toBeNull()
  })

  it.each([
    '甲\n\n并发插入\n\n乙\n\n尾段',
    '甲\n\n\n乙\n\n尾段',
    '甲\n\n改写乙\n\n尾段',
    '甲\n\n乙\n\n尾段\n\n乙',
  ])('refuses an insertion whose anchors or intervening gap no longer identify one location', (current) => {
    const baseline = '甲\n\n乙\n\n尾段'
    expect(rebaseSourceChanges(baseline, '甲\n\n新增\n\n乙\n\n尾段', current)).toBeNull()
  })

  it('refuses a first insertion when current already added a new first block', () => {
    expect(rebaseSourceChanges('甲\n\n尾段', '右侧首段\n\n甲\n\n尾段', '左侧首段\n\n甲\n\n尾段')).toBeNull()
  })

  it('refuses to replace across a concurrent block inserted inside the affected range', () => {
    const baseline = '甲\n\n乙\n\n尾段'
    expect(rebaseSourceChanges(baseline, '甲乙合并\n\n尾段', '甲\n\n源稿新增\n\n乙\n\n尾段')).toBeNull()
  })

  it('refuses pathologically deep Markdown without throwing a parser error', () => {
    expect(rebaseSourceChanges('原段\n\n尾段', '新段\n\n尾段', `${'> '.repeat(16_000)}原段\n\n尾段`)).toBeNull()
  })

  it('refuses a replay that changes the Markdown block boundaries around concurrent content', () => {
    const baseline = '尾段\n\n正文'
    const proposed = '尾段\n\n```md\n这是到文末的代码'
    const current = '尾段\n\n正文\n\n源稿新增'
    expect(rebaseSourceChanges(baseline, proposed, current)).toBeNull()
  })
})
