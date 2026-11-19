import { describe, expect, it } from 'vitest'
import { compactUrl, inspectImageSource, inspectUrl } from './policy'

describe('链接协议白名单', () => {
  it('放行 http / https / mailto', () => {
    expect(inspectUrl('https://example.com/a')).toEqual({
      allowed: true,
      url: 'https://example.com/a',
    })
    expect(inspectUrl('http://example.com').allowed).toBe(true)
    expect(inspectUrl('mailto:hi@example.com').allowed).toBe(true)
  })

  it('大小写不同的协议同样放行', () => {
    expect(inspectUrl('HTTPS://EXAMPLE.COM').allowed).toBe(true)
    expect(inspectUrl('MailTo:hi@example.com').allowed).toBe(true)
  })

  it('拦截 javascript: / data: / vbscript: / file:', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      const verdict = inspectUrl(url)
      expect(verdict.allowed).toBe(false)
      if (!verdict.allowed) {
        expect(verdict.reason).toContain('协议')
      }
    }
  })

  it('拦截用空白或制表符混淆的脚本协议', () => {
    const verdict = inspectUrl('java\tscript:alert(1)')
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) {
      expect(verdict.reason).toContain('javascript:')
    }
    expect(compactUrl('  java\nscript:alert(1) ')).toBe('javascript:alert(1)')
  })

  it('拦截相对路径、协议相对地址与空地址', () => {
    expect(inspectUrl('/about').allowed).toBe(false)
    expect(inspectUrl('#section').allowed).toBe(false)
    expect(inspectUrl('//evil.example.com').allowed).toBe(false)
    const empty = inspectUrl('   ')
    expect(empty.allowed).toBe(false)
    if (!empty.allowed) {
      expect(empty.reason).toContain('空')
    }
  })
})

describe('图片地址策略', () => {
  it('外链只接受 http(s)', () => {
    expect(inspectImageSource('https://cdn.example.com/a.png').allowed).toBe(true)
    expect(inspectImageSource('http://cdn.example.com/a.png').allowed).toBe(true)
    expect(inspectImageSource('file:///tmp/a.png').allowed).toBe(false)
  })

  it('data: 只接受图片类型', () => {
    expect(inspectImageSource('data:image/png;base64,AAAA').allowed).toBe(true)
    const html = inspectImageSource('data:text/html,<b>x</b>')
    expect(html.allowed).toBe(false)
    if (!html.allowed) {
      expect(html.reason).toContain('图片')
    }
  })

  it('拦截 javascript: 图片地址', () => {
    expect(inspectImageSource('javascript:alert(1)').allowed).toBe(false)
  })
})
