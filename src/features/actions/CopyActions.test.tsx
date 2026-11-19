import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlatformDefinition } from '@/core/types'
import type { ManualCopy } from '@/app/studio-state'
import { CopyActions, ManualCopyFallback } from './CopyActions'

const platform: PlatformDefinition = {
  id: 'wechat',
  name: '微信公众号',
  shortName: '公众号',
  articleLabel: '图文正文',
  entryUrl: 'https://mp.weixin.qq.com/',
  capabilities: {
    tables: 'keep',
    codeBlocks: 'keep',
    inlineCode: 'keep',
    images: 'keep',
    links: 'keep',
    blockquotes: 'keep',
    maxHeadingLevel: 6,
  },
  capabilityEvidence: 'pending-user-trial',
  render: () => ({
    ok: false,
    failure: { platform: 'wechat', code: 'render', reason: '测试替身不渲染' },
  }),
}

const manualCopy: ManualCopy = {
  kind: 'body',
  platform: 'wechat',
  reason: '剪贴板权限被拒绝（NotAllowedError）',
  text: '第一段正文\n\n第二段正文',
}

describe('复制操作区', () => {
  it('输出过期时禁用复制正文，并把原因写在按钮旁边', () => {
    const html = renderToStaticMarkup(
      <CopyActions
        platform={platform}
        copyBlockReason="源稿在排版后有改动，当前显示的是上一版输出；重新排版后才能复制新版。"
        titleBlockReason="源稿在排版后有改动，当前显示的是上一版输出；重新排版后才能复制新版。"
        copyNotice={null}
        manualCopy={null}
        onCopyTitle={() => {}}
        onCopyBody={() => {}}
        onDismissManual={() => {}}
      />,
    )

    expect(html).toContain('复制正文')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*复制正文/)
    expect(html).toContain('复制已禁用：源稿在排版后有改动')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('https://mp.weixin.qq.com/')
    expect(html).toContain('rel="noreferrer"')
    expect(html).toContain('target="_blank"')
  })

  it('可以复制时按钮不禁用，成功提示写进 aria-live 区域', () => {
    const html = renderToStaticMarkup(
      <CopyActions
        platform={platform}
        copyBlockReason={null}
        titleBlockReason={null}
        copyNotice={{
          kind: 'body',
          platform: 'wechat',
          message: '正文已复制为富文本，到平台编辑器里粘贴即可。',
          nonce: 1,
        }}
        manualCopy={null}
        onCopyTitle={() => {}}
        onCopyBody={() => {}}
        onDismissManual={() => {}}
      />,
    )

    expect(html).not.toMatch(/<button[^>]*disabled/)
    expect(html).toContain('正文已复制为富文本')
  })

  it('复制失败时展示 manualText 的可全选文本域与手动复制说明', () => {
    const html = renderToStaticMarkup(
      <CopyActions
        platform={platform}
        copyBlockReason={null}
        titleBlockReason={null}
        copyNotice={null}
        manualCopy={manualCopy}
        onCopyTitle={() => {}}
        onCopyBody={() => {}}
        onDismissManual={() => {}}
      />,
    )

    expect(html).toContain('手动复制正文：浏览器没有完成自动复制')
    expect(html).toContain('剪贴板权限被拒绝（NotAllowedError）')
    expect(html).toContain('Ctrl / ⌘ + C')
    expect(html).toContain('aria-label="手动复制正文的内容"')
    expect(html).toContain('第一段正文')
    expect(html).toContain('第二段正文')
    expect(html).toContain('关闭手动复制')
    // 失败时不能出现「已复制」这种假成功文案。
    expect(html).not.toContain('已复制为')
  })

  it('没有可提取标题时只禁用复制标题，正文仍可复制', () => {
    const html = renderToStaticMarkup(
      <CopyActions
        platform={platform}
        copyBlockReason={null}
        titleBlockReason="这篇稿子没有可提取的标题；填写标题后重新排版，或直接复制正文。"
        copyNotice={null}
        manualCopy={null}
        onCopyTitle={() => {}}
        onCopyBody={() => {}}
        onDismissManual={() => {}}
      />,
    )

    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*复制标题/)
    expect(html).toMatch(/<button[^>]*>[\s\S]*复制正文/)
    expect(html).toContain('这篇稿子没有可提取的标题')
  })

  it('手动复制面板可独立渲染，并把只读文本域标成只读', () => {
    const html = renderToStaticMarkup(
      <ManualCopyFallback manualCopy={manualCopy} onDismiss={() => {}} />,
    )
    expect(html.toLowerCase()).toContain('readonly')
    expect(html).toContain('手动复制正文')
  })
})
