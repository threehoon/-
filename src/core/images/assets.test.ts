import { describe, expect, it } from 'vitest'
import { collectImageSources, createAssetRegistry } from './assets'
import { parseDocument } from '../markdown/parse'

describe('素材登记表解析', () => {
  it('http(s) 外链判为 remote', () => {
    const registry = createAssetRegistry([])
    expect(registry.resolve('https://cdn.example.com/a.png')).toEqual({
      kind: 'remote',
      url: 'https://cdn.example.com/a.png',
    })
  })

  it('本地图片未配对时判为 missing，不猜目录', () => {
    const registry = createAssetRegistry([])
    expect(registry.resolve('images/team.png')).toEqual({ kind: 'missing' })
    // 只有同名文件、但没有显式配对，同样不认
    const other = createAssetRegistry({ 'photos/team.png': 'blob:https://x/1' })
    expect(other.resolve('images/team.png')).toEqual({ kind: 'missing' })
  })

  it('显式配对后判为 bound，兼容 ./ 与反斜杠写法', () => {
    const registry = createAssetRegistry({ 'images/team.png': 'blob:https://x/1' })
    expect(registry.resolve('images/team.png')).toEqual({
      kind: 'bound',
      url: 'blob:https://x/1',
    })
    expect(registry.resolve('./images/team.png')).toEqual({
      kind: 'bound',
      url: 'blob:https://x/1',
    })
    const windows = createAssetRegistry({ 'images\\team.png': 'data:image/png;base64,AAAA' })
    expect(windows.resolve('images/team.png').kind).toBe('bound')
  })

  it('条目数组同样可用', () => {
    const registry = createAssetRegistry([{ path: 'a.png', url: 'https://cdn.example.com/a.png' }])
    expect(registry.resolve('a.png').kind).toBe('bound')
  })

  it('源稿里的 data: / javascript: 图片地址判为 blocked', () => {
    const registry = createAssetRegistry([])
    expect(registry.resolve('data:image/png;base64,AAAA').kind).toBe('blocked')
    expect(registry.resolve('javascript:alert(1)').kind).toBe('blocked')
    const blocked = registry.resolve('data:image/png;base64,AAAA')
    if (blocked.kind === 'blocked') {
      expect(blocked.reason).toContain('data:')
    }
  })

  it('配对到不安全地址时判为 blocked 并说明原因', () => {
    const registry = createAssetRegistry({ 'a.png': 'javascript:alert(1)' })
    const resolved = registry.resolve('a.png')
    expect(resolved.kind).toBe('blocked')
    if (resolved.kind === 'blocked') {
      expect(resolved.reason).toContain('配对')
    }
  })

  it('空地址判为 missing', () => {
    expect(createAssetRegistry([]).resolve('   ')).toEqual({ kind: 'missing' })
  })
})

describe('collectImageSources', () => {
  it('按出现顺序去重收集，并解析引用式图片', () => {
    const parsed = parseDocument(
      [
        '正文。',
        '',
        '![外链](https://cdn.example.com/a.png)',
        '',
        '![本地](images/b.png)',
        '',
        '![再来一次](https://cdn.example.com/a.png)',
        '',
        '![引用式][pic]',
        '',
        '[pic]: https://cdn.example.com/c.png',
      ].join('\n'),
    )

    expect(collectImageSources(parsed)).toEqual([
      'https://cdn.example.com/a.png',
      'images/b.png',
      'https://cdn.example.com/c.png',
    ])
  })

  it('引用式图片按出现顺序收集，并用首个同名引用定义', () => {
    const parsed = parseDocument('![封面][pic]\n\n![正文](images/inline.png)\n\n[pic]: images/first.png\n[pic]: images/second.png')
    expect(collectImageSources(parsed)).toEqual(['images/first.png', 'images/inline.png'])
  })

  it('没有图片时返回空列表', () => {
    expect(collectImageSources(parseDocument('只有文字。'))).toEqual([])
  })
})
