import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  CapabilityEvidence,
  PlatformDefinition,
  RenderedDocument,
  RenderFailure,
  TypesetReport,
} from '@/core/types'
import type { StudioStatus } from '@/app/studio-state'
import { PreviewPanel } from './PreviewPanel'

function platformWith(evidence: CapabilityEvidence): PlatformDefinition {
  return {
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
    capabilityEvidence: evidence,
    render: () => ({
      ok: false,
      failure: { platform: 'wechat', code: 'render', reason: '测试替身不渲染' },
    }),
  }
}

const document: RenderedDocument = {
  platform: 'wechat',
  title: '一篇中文样稿',
  html: '<h2>第一个小标题</h2><p>正文段落。</p>',
  plainText: '第一个小标题\n正文段落。',
  warnings: [],
  stats: { characters: 8, blocks: 2 },
}

function report(overrides: Partial<TypesetReport> = {}): TypesetReport {
  return {
    title: '一篇中文样稿',
    typesetAt: 1_700_000_000_000,
    results: [
      { platform: 'wechat', outcome: { ok: true, document } },
    ],
    stats: { characters: 8, blocks: 2 },
    parseError: null,
    durationMs: 21,
    ...overrides,
  }
}

interface RenderOptions {
  status: StudioStatus
  document?: RenderedDocument | null
  failure?: RenderFailure | null
  report?: TypesetReport | null
  parseErrorMessage?: string | null
  typesetFailureReason?: string | null
  availablePlatformNames?: readonly string[]
  evidence?: CapabilityEvidence
}

function render(options: RenderOptions): string {
  return renderToStaticMarkup(
    <PreviewPanel
      platform={platformWith(options.evidence ?? 'pending-user-trial')}
      status={options.status}
      document={options.document ?? null}
      failure={options.failure ?? null}
      report={options.report ?? null}
      parseErrorMessage={options.parseErrorMessage ?? null}
      typesetFailureReason={options.typesetFailureReason ?? null}
      availablePlatformNames={options.availablePlatformNames ?? []}
    />,
  )
}

describe('预览区状态', () => {
  it('空稿时给出导入或粘贴的引导，而不是空白画布', () => {
    const html = render({ status: 'empty' })
    expect(html).toContain('左侧还没有源稿')
    expect(html).toContain('不会上传到任何服务器')
    expect(html).toContain('Ctrl / ⌘ + Enter')
  })

  it('有源稿但未排版时提示先点一键排版', () => {
    const html = render({ status: 'ready' })
    expect(html).toContain('源稿已就绪，还没有生成成稿')
    expect(html).toContain('一键排版')
  })

  it('排版中保留上一版并标注正在生成', () => {
    const html = render({
      status: 'typesetting',
      document,
      report: report(),
    })
    expect(html).toContain('正在生成六个版本')
    expect(html).toContain('下方仍是上一版输出')
    expect(html).toContain('data-dimmed="true"')
    expect(html).toContain('正文段落。')
  })

  it('单平台失败时写清失败原因与仍然可用的平台', () => {
    const html = render({
      status: 'typeset',
      failure: {
        platform: 'wechat',
        code: 'render',
        reason: '公众号主题样式表读取失败',
      },
      report: report(),
      availablePlatformNames: ['头条号', '知乎'],
    })
    expect(html).toContain('「微信公众号」本次没有生成成功')
    expect(html).toContain('公众号主题样式表读取失败')
    expect(html).toContain('其它平台仍然可用：头条号、知乎')
  })

  it('输出过期时说明显示的是上一版并暂停复制', () => {
    const html = render({
      status: 'stale',
      document,
      report: report(),
    })
    expect(html).toContain('当前显示的是')
    expect(html).toContain('上一版输出')
    expect(html).toContain('复制保持禁用')
  })

  it('整体解析失败时给原因和下一步', () => {
    const html = render({
      status: 'parse-error',
      report: report({ typesetAt: null, results: [], parseError: '第 4 行表格缺少分隔行' }),
    })
    expect(html).toContain('源稿无法解析，六个平台都没有生成')
    expect(html).toContain('第 4 行表格缺少分隔行')
    expect(html).toContain('下一步')
  })

  it('排版过程抛错时显示「这次排版没有完成」', () => {
    const html = render({
      status: 'ready',
      typesetFailureReason: '内存不足',
    })
    expect(html).toContain('这次排版没有完成')
    expect(html).toContain('内存不足')
  })

  it('成稿渲染标题与正文，并说明标题不包含在正文里', () => {
    const html = render({ status: 'typeset', document, report: report() })
    expect(html).toContain('一篇中文样稿')
    expect(html).toContain('<h2>第一个小标题</h2>')
    expect(html).toContain('标题单独显示、单独复制')
  })

  it('待试用平台写明能力未经真实后台验证', () => {
    const html = render({ status: 'ready', evidence: 'pending-user-trial' })
    expect(html).toContain('该平台能力未经真实后台验证，待你试用')
    expect(html).toContain('微信公众号')
  })

  it('已实测平台不写「待你试用」', () => {
    const html = render({ status: 'ready', evidence: 'user-verified' })
    expect(html).not.toContain('待你试用')
    expect(html).toContain('试用记录确认')
  })
})
