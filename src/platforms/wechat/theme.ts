import { DEFAULT_ARTICLE_FONT } from '@/core/render/article-font'
import type { RenderTheme } from '@/core/render/theme'
import type { PlatformId, WechatTemplateId } from '@/core/types'

/**
 * 公众号排版模板集。
 *
 * 全部样式必须内联：公众号编辑器会丢掉 <style> 和 class。
 *
 * 六套模板共用一套成熟的排印底盘——正文 15–18px、行高 1.8–2.0、段间 16–28px、
 * 一句话只给一种强调手法——差异落在标题形制、列表和引文容器上。
 * 色值与工作台令牌不共用，且在导出时展开为公众号可用的内联颜色。
 */
const MONO_STACK = '"JetBrains Mono","SF Mono",Menlo,Consolas,"Songti SC",monospace'

const BLUE = '#0a5cf6'
const CARD = '#f5f7ff'
const MARK = '#e8efff'

/** 六套版式的基础排印；不要把默认版专用样式继承到其他模板。 */
const WECHAT_BASE_THEME: RenderTheme = {
  id: 'wechat',
  wrapperTag: 'section',
  container: `font-family:${DEFAULT_ARTICLE_FONT};max-width:576px;margin:0 auto;font-size:18px;line-height:2;color:#1f2023;letter-spacing:0.02em;overflow-wrap:anywhere;`,
  paragraph: 'margin:0 0 20px;',
  heading: (level, degraded) => {
    // 降级标题仍是粗体小标题，但必须自带字体：预览层的 class 规则会盖主题。
    if (degraded) {
      return `font-family:${DEFAULT_ARTICLE_FONT};margin:22px 0 10px;font-size:17px;font-weight:700;line-height:1.6;color:#16233c;`
    }
    if (level === 1) {
      return `font-family:${DEFAULT_ARTICLE_FONT};margin:0 0 28px;font-size:23px;font-weight:700;line-height:1.5;letter-spacing:0.02em;color:#16233c;text-align:center;`
    }
    return `font-family:${DEFAULT_ARTICLE_FONT};margin:20px 0 10px;font-size:16px;font-weight:700;line-height:1.6;color:#16233c;`
  },
  blockquoteParagraph: 'margin:0 0 20px;',
  blockquote: `margin:0 0 26px;padding:20px 24px;border-left:4px solid ${BLUE};border-radius:0 10px 10px 0;background-color:${CARD};font-family:${DEFAULT_ARTICLE_FONT};font-size:17px;font-style:italic;line-height:1.95;color:#4c5566;`,
  unorderedList: 'margin:0 0 24px;padding-left:22px;',
  orderedList: 'margin:0 0 24px;padding-left:22px;',
  listItem: 'margin:0 0 10px;',
  codeBlock:
    'margin:0 0 24px;padding:18px 20px;border:1px solid #e3e7f0;border-radius:10px;background-color:#f7f8fb;font-family:' +
    `${MONO_STACK};font-size:13px;line-height:1.75;color:#262a31;white-space:pre-wrap;word-break:break-word;overflow-x:auto;`,
  codeBlockDegraded:
    'margin:0 0 24px;padding:0;background-color:transparent;font-family:' +
    `${MONO_STACK};font-size:13px;line-height:1.8;color:#262a31;white-space:pre-wrap;word-break:break-word;`,
  inlineCode: `font-family:${MONO_STACK};font-size:14px;background-color:#eef2fe;color:#1b4bc4;padding:2px 5px;border-radius:4px;`,
  inlineCodeDegraded: `font-family:${MONO_STACK};font-size:14px;color:#1b4bc4;`,
  table: 'border-collapse:collapse;width:100%;margin:0 0 24px;font-size:14.5px;line-height:1.7;',
  tableHeadCell: `border:none;border-bottom:2px solid ${BLUE};background-color:#f2f5ff;padding:10px 12px;text-align:left;font-weight:700;color:#16233c;`,
  tableCell: 'border:none;border-bottom:1px solid #e6e8ef;padding:10px 12px;color:#33373f;vertical-align:top;',
  image: 'max-width:100%;height:auto;display:block;margin:26px auto;border-radius:8px;',
  link: `color:${BLUE};text-decoration:none;border-bottom:1px solid #b9ccff;word-break:break-all;`,
  // 重点句：加粗 + 淡蓝底，斜体容器里的重点句仍保持正体（参考稿的「核心观点」标签）。
  strong: `font-weight:700;font-style:normal;color:#12306b;background-color:${MARK};padding:2px 3px;border-radius:3px;`,
  emphasis: 'font-style:italic;',
  strike: 'text-decoration:line-through;color:#8a8d96;',
  highlight: 'background-color:#d6e2ff;color:inherit;',
  thematicBreak: 'border:none;border-top:1px dashed #dfe3ef;margin:30px 0;height:0;',
  imageMarker:
    'display:block;margin:0 0 20px;padding:12px 16px;border:1px dashed #9aa7c7;border-radius:8px;background-color:#f2f5ff;color:#4a5573;font-size:14px;line-height:1.6;',
  rawHtml: `display:block;margin:0 0 20px;font-family:${MONO_STACK};font-size:13px;line-height:1.6;color:#4c5566;word-break:break-all;`,
}

// 观点蓝调的编辑标记：实色托底；青蓝细线和浅底只用来区分层级，不增加正文字符。
const CHAPTER_INK = '#17355f'
const CHAPTER_TEAL = '#20596c'
const CHAPTER_EDGE = '#77b7c5'
const CHAPTER_TEXT = '#f8fbff'
const SUBHEAD_INK = '#1c385d'
const SUBHEAD_PAPER = '#edf3fa'
const SUBHEAD_RULE = '#7594b7'
const LIST_RULE = '#cbd9e8'
const CLASSIC_MUTED = '#4c5566'
const WRAP_TEXT = 'overflow-wrap:anywhere;word-break:break-word;'
const SUBHEAD_LABEL = `box-sizing:border-box;max-width:100%;padding:4px 12px;border-left:1px solid ${SUBHEAD_RULE};border-radius:0 4px 4px 0;background-color:${SUBHEAD_PAPER};font-size:17px;font-weight:700;line-height:1.6;${WRAP_TEXT}color:${SUBHEAD_INK};`

const CHAPTER_TYPE = `font-family:${DEFAULT_ARTICLE_FONT};font-size:20px;font-weight:700;line-height:1.5;${WRAP_TEXT}`
const PAPER_CHAPTER = `${CHAPTER_TYPE}margin:28px 0 16px;padding:8px 12px;border-bottom:2px solid ${SUBHEAD_RULE};background-color:${SUBHEAD_PAPER};color:${CHAPTER_INK};`

/** 默认版：观点蓝调。公众号保留章节签，带行内格式的章节用浅底，避免继承白字或蓝字低对比。 */
export const WECHAT_THEME: RenderTheme = {
  ...WECHAT_BASE_THEME,
  heading: (level, degraded, hasInlineFormatting) => {
    if (!degraded && level === 2) {
      if (hasInlineFormatting) return `${PAPER_CHAPTER}text-align:center;`
      return `${CHAPTER_TYPE}display:table;box-sizing:border-box;max-width:100%;margin:32px auto 24px;padding:8px 20px;border-bottom:2px solid ${CHAPTER_EDGE};border-radius:6px 6px 2px 2px;background-color:${CHAPTER_INK};background-image:linear-gradient(96deg,${CHAPTER_INK},${CHAPTER_TEAL});text-align:center;letter-spacing:0.02em;color:${CHAPTER_TEXT};`
    }
    if (!degraded && level === 3) {
      return `font-family:${DEFAULT_ARTICLE_FONT};display:table;margin:28px 0 12px;${SUBHEAD_LABEL}`
    }
    return WECHAT_BASE_THEME.heading(level, degraded)
  },
  standaloneStrong: `display:inline-block;${SUBHEAD_LABEL}`,
  unorderedList: `margin:0 0 24px;padding:0 0 0 24px;border-left:1px solid ${LIST_RULE};list-style-type:circle;list-style-position:outside;`,
  strike: `text-decoration:line-through;color:${CLASSIC_MUTED};`,
}

/** Same editorial hierarchy, without sizing the heading as a table or relying on a dark fill. */
const PORTABLE_BODY = `font-family:${DEFAULT_ARTICLE_FONT};font-size:17px;line-height:1.9;`
const PORTABLE_THEME: RenderTheme = {
  ...WECHAT_THEME,
  id: 'classic-portable',
  paragraph: `${PORTABLE_BODY}margin:0 0 20px;${WRAP_TEXT}`,
  listItem: `${PORTABLE_BODY}margin:0 0 10px;${WRAP_TEXT}`,
  heading: (level, degraded) => {
    if (!degraded && level === 2) {
      return `${CHAPTER_TYPE}margin:28px 0 16px;padding:0 0 8px;border-bottom:1px solid ${SUBHEAD_RULE};color:${CHAPTER_INK};`
    }
    if (!degraded && level === 3) {
      return `font-family:${DEFAULT_ARTICLE_FONT};margin:24px 0 12px;font-size:17px;font-weight:700;line-height:1.6;color:${SUBHEAD_INK};${WRAP_TEXT}`
    }
    return WECHAT_BASE_THEME.heading(level, degraded)
  },
  standaloneStrong: `font-weight:700;color:${SUBHEAD_INK};`,
  unorderedList: WECHAT_BASE_THEME.unorderedList,
  blockquote: `margin:0 0 24px;padding:4px 0 4px 14px;border-left:1px solid ${SUBHEAD_RULE};font-size:17px;line-height:1.9;color:${CLASSIC_MUTED};`,
  link: `color:${CHAPTER_INK};text-decoration:underline;${WRAP_TEXT}`,
}

const PAPER_THEME: RenderTheme = {
  ...PORTABLE_THEME,
  id: 'classic-paper',
  heading: (level, degraded) => {
    if (!degraded && level === 2) return PAPER_CHAPTER
    if (!degraded && level === 3) return `font-family:${DEFAULT_ARTICLE_FONT};margin:24px 0 12px;${SUBHEAD_LABEL}`
    return PORTABLE_THEME.heading(level, degraded)
  },
  standaloneStrong: SUBHEAD_LABEL,
  blockquote: `${PORTABLE_THEME.blockquote}padding:12px 16px;background-color:${CARD};`,
}

// Output policies for the trial, not claims about verified third-party editor support.
const CLASSIC_BY_PLATFORM: Readonly<Record<PlatformId, RenderTheme>> = {
  wechat: WECHAT_THEME,
  toutiao: PAPER_THEME,
  sohu: PAPER_THEME,
  baijiahao: PORTABLE_THEME,
  zhihu: PORTABLE_THEME,
  qq: PAPER_THEME,
}

/** 清爽留白：大留白、细线标题、重点句只留一道下划线。 */
const AIRY_THEME: RenderTheme = {
  ...WECHAT_BASE_THEME,
  id: 'wechat-airy',
  container: `font-family:${DEFAULT_ARTICLE_FONT};font-size:16px;line-height:2;color:#25272c;letter-spacing:0.03em;word-break:break-word;`,
  paragraph: 'margin:0 0 28px;',
  heading: (level, degraded) => {
    if (degraded) {
      return `font-family:${DEFAULT_ARTICLE_FONT};margin:28px 0 12px;font-size:16px;font-weight:600;line-height:1.6;color:#123a7a;`
    }
    switch (level) {
      case 1:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:0 0 32px;font-size:22px;font-weight:600;line-height:1.5;letter-spacing:0.06em;color:#123a7a;text-align:center;`
      case 2:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:44px 0 18px;padding:0 0 12px;border-bottom:1px solid #e6e8ef;font-size:19px;font-weight:600;line-height:1.5;letter-spacing:0.05em;color:#123a7a;`
      case 3:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:32px 0 14px;font-size:16.5px;font-weight:600;line-height:1.6;color:#123a7a;`
      default:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:26px 0 12px;font-size:16px;font-weight:600;line-height:1.6;color:#123a7a;`
    }
  },
  blockquote:
    'margin:0 0 28px;padding:2px 0 2px 20px;border-left:2px solid #c8d4ea;background-color:transparent;color:#5b6472;font-size:15.5px;line-height:2;',
  unorderedList: 'margin:0 0 28px;padding-left:20px;',
  orderedList: 'margin:0 0 28px;padding-left:20px;',
  listItem: 'margin:0 0 12px;',
  codeBlock: `margin:30px 0;padding:20px;border:none;border-radius:6px;background-color:#f7f8fb;font-family:${MONO_STACK};font-size:13px;line-height:1.85;color:#25272c;white-space:pre-wrap;word-break:break-word;overflow-x:auto;`,
  table: 'border-collapse:collapse;width:100%;margin:32px 0;font-size:14.5px;line-height:1.8;',
  tableHeadCell:
    'border:none;border-bottom:1px solid #25272c;background-color:transparent;padding:12px 10px;text-align:left;font-weight:600;color:#25272c;',
  tableCell: 'border:none;border-bottom:1px solid #eef0f4;padding:12px 10px;color:#33363d;vertical-align:top;',
  image: 'max-width:100%;height:auto;display:block;margin:30px auto;border-radius:4px;',
  link: `color:${BLUE};text-decoration:none;border-bottom:1px solid #cfe0ff;word-break:break-all;`,
  strong: 'font-weight:700;font-style:normal;color:#10233f;border-bottom:2px solid #d7e3fb;padding-bottom:1px;',
  highlight: 'background-color:#e2eafd;color:inherit;',
  thematicBreak: 'border:none;border-top:1px solid #eceef4;width:32%;margin:36px auto;height:0;',
}

/** 内容简报：紧凑段落、蓝条标题、密排表格，适合要点型内容。 */
const BRIEF_THEME: RenderTheme = {
  ...WECHAT_BASE_THEME,
  id: 'wechat-brief',
  container: `font-family:${DEFAULT_ARTICLE_FONT};font-size:15px;line-height:1.8;color:#24262b;letter-spacing:0.01em;word-break:break-word;`,
  paragraph: 'margin:0 0 16px;',
  heading: (level, degraded) => {
    if (degraded) {
      return `font-family:${DEFAULT_ARTICLE_FONT};margin:18px 0 8px;font-size:15px;font-weight:700;line-height:1.5;color:#0f2b5c;`
    }
    switch (level) {
      case 1:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:0 0 20px;font-size:20px;font-weight:700;line-height:1.5;color:#0f2b5c;`
      case 2:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:24px 0 14px;padding:10px 14px;border-left:4px solid ${BLUE};border-radius:0 6px 6px 0;background-color:#eef3fd;font-size:17px;font-weight:700;line-height:1.5;color:#0f2b5c;`
      case 3:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:20px 0 10px;padding:0 0 6px;border-bottom:1px dotted #c3cfe6;font-size:16px;font-weight:700;line-height:1.5;color:#16233c;`
      default:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:16px 0 8px;font-size:15px;font-weight:700;line-height:1.5;color:#16233c;`
    }
  },
  blockquoteParagraph: 'margin:0 0 14px;',
  blockquote:
    'margin:0 0 16px;padding:16px 18px;border:none;border-radius:0;background-color:#f2f5fa;color:#3d4657;font-size:14.5px;line-height:1.85;',
  unorderedList: 'margin:0 0 16px;padding-left:20px;',
  orderedList: 'margin:0 0 16px;padding-left:20px;',
  listItem: 'margin:0 0 6px;',
  codeBlock: `margin:0 0 16px;padding:14px 16px;border:1px solid #e3e8f2;border-radius:6px;background-color:#f7f8fb;font-family:${MONO_STACK};font-size:12.5px;line-height:1.7;color:#24262b;white-space:pre-wrap;word-break:break-word;overflow-x:auto;`,
  table: 'border-collapse:collapse;width:100%;margin:0 0 16px;font-size:14px;line-height:1.7;',
  tableHeadCell:
    'border:1px solid #dbe3f0;background-color:#eef3fd;padding:8px 10px;text-align:left;font-weight:700;color:#0f2b5c;',
  tableCell: 'border:1px solid #e4e8f0;padding:8px 10px;color:#33363d;vertical-align:top;',
  image: 'max-width:100%;height:auto;display:block;margin:18px auto;border-radius:4px;',
  strong: 'font-weight:700;font-style:normal;color:#10233f;background-color:#dfe9ff;padding:0 3px;border-radius:2px;',
  highlight: 'background-color:#d7e4ff;color:inherit;',
  thematicBreak: 'border:none;border-top:1px solid #dfe3ec;margin:20px 0;height:0;',
}

/** 杂志长文：衬线正文、首行缩进、双线居中标题与横线引文。 */
const EDITORIAL_THEME: RenderTheme = {
  ...WECHAT_BASE_THEME,
  id: 'wechat-editorial',
  container: `font-family:${DEFAULT_ARTICLE_FONT};font-size:17px;line-height:1.95;color:#232324;letter-spacing:0.01em;word-break:break-word;`,
  paragraph: 'margin:0 0 20px;text-indent:2em;',
  heading: (level, degraded) => {
    if (degraded) {
      return `font-family:${DEFAULT_ARTICLE_FONT};margin:28px 0 12px;font-size:17px;font-weight:700;line-height:1.6;color:#14304f;`
    }
    switch (level) {
      case 1:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:0 0 30px;padding:0 0 16px;border-bottom:1px solid #14304f;font-size:25px;font-weight:700;line-height:1.45;letter-spacing:0.04em;color:#14304f;text-align:center;`
      case 2:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:44px 0 22px;padding:14px 0;border-top:3px double #14304f;border-bottom:3px double #14304f;font-size:20px;font-weight:700;line-height:1.5;letter-spacing:0.12em;color:#14304f;text-align:center;`
      case 3:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:30px 0 14px;font-size:18px;font-weight:700;line-height:1.6;letter-spacing:0.02em;color:#14304f;`
      default:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:24px 0 12px;font-size:17px;font-weight:700;line-height:1.6;color:#14304f;`
    }
  },
  blockquoteParagraph: 'margin:0 0 18px;text-indent:0;',
  blockquote:
    'margin:32px 0;padding:20px 16px;border:none;border-top:1px solid #d9dce4;border-bottom:1px solid #d9dce4;background-color:transparent;color:#4a4f5b;font-size:16.5px;line-height:1.95;font-style:italic;',
  unorderedList: 'margin:0 0 20px;padding-left:24px;',
  orderedList: 'margin:0 0 20px;padding-left:24px;',
  listItem: 'margin:0 0 8px;',
  codeBlock: `margin:26px 0;padding:18px;border:none;border-top:2px solid #14304f;border-bottom:1px solid #dfe2e9;background-color:#f5f6f8;font-family:${MONO_STACK};font-size:13px;line-height:1.8;color:#232324;white-space:pre-wrap;word-break:break-word;overflow-x:auto;`,
  table: `border-collapse:collapse;width:100%;margin:30px 0;border-top:2px solid #14304f;border-bottom:2px solid #14304f;font-family:${DEFAULT_ARTICLE_FONT};font-size:15px;line-height:1.8;`,
  tableHeadCell:
    'border:none;border-bottom:1px solid #14304f;background-color:transparent;padding:12px;text-align:left;font-weight:700;color:#14304f;',
  tableCell: 'border:none;border-bottom:1px solid #e6e8ee;padding:12px;color:#33363d;vertical-align:top;',
  image: 'max-width:100%;height:auto;display:block;margin:28px auto;border-radius:0;',
  link: 'color:#14304f;text-decoration:underline;word-break:break-all;',
  strong: 'font-weight:700;font-style:normal;color:#14304f;',
  emphasis: 'font-style:italic;color:#33363d;',
  highlight: 'background-color:#dfe7f2;color:inherit;',
  thematicBreak: 'border:none;border-top:1px dashed #d9dce4;width:30%;margin:32px auto;height:0;',
}

/** 暖纸手记：暖纸底、米色卡片、虚线分隔。 */
const WARM_THEME: RenderTheme = {
  ...WECHAT_BASE_THEME,
  id: 'wechat-warm',
  container: `font-family:${DEFAULT_ARTICLE_FONT};font-size:16.5px;line-height:1.95;color:#4a3f33;letter-spacing:0.02em;word-break:break-word;background-color:#fdfaf4;padding:28px 22px;`,
  paragraph: 'margin:0 0 22px;',
  blockquoteParagraph: 'margin:0 0 16px;',
  heading: (level, degraded) => {
    if (degraded) {
      return `font-family:${DEFAULT_ARTICLE_FONT};margin:24px 0 10px;font-size:16.5px;font-weight:600;line-height:1.6;color:#7a4a2a;`
    }
    switch (level) {
      case 1:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:0 0 26px;padding:0 0 14px;border-bottom:2px solid #c9a878;font-size:24px;font-weight:600;line-height:1.45;color:#5f3c1e;`
      case 2:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:34px 0 16px;padding:0 0 10px;border-bottom:2px solid #d9c0a0;font-size:21px;font-weight:600;line-height:1.5;letter-spacing:0.03em;color:#7a4a2a;`
      case 3:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:26px 0 12px;padding-left:10px;border-left:3px solid #c9a878;font-size:17.5px;font-weight:600;line-height:1.6;color:#7a4a2a;`
      default:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:22px 0 10px;font-size:16.5px;font-weight:600;line-height:1.6;color:#7a4a2a;`
    }
  },
  blockquote:
    'margin:0 0 22px;padding:18px 22px;border-left:3px solid #c9a878;border-radius:0 8px 8px 0;background-color:#f7efe0;color:#6b5946;font-size:15.5px;line-height:1.9;font-style:italic;',
  unorderedList: 'margin:0 0 20px;padding-left:22px;',
  orderedList: 'margin:0 0 20px;padding-left:22px;',
  listItem: 'margin:0 0 8px;',
  codeBlock: `margin:0 0 20px;padding:16px;border:1px solid #e6d5ba;border-radius:6px;background-color:#f5ecdc;font-family:${MONO_STACK};font-size:13px;line-height:1.75;color:#4a3f33;white-space:pre-wrap;word-break:break-word;overflow-x:auto;`,
  inlineCode: `font-family:${MONO_STACK};font-size:14px;background-color:#f3e8d6;color:#7a4a2a;padding:2px 5px;border-radius:3px;`,
  table: 'border-collapse:collapse;width:100%;margin:0 0 20px;font-size:14.5px;line-height:1.8;',
  tableHeadCell:
    'border:1px solid #e0cfb4;background-color:#f3e8d6;padding:10px;text-align:left;font-weight:600;color:#7a4a2a;',
  tableCell: 'border:1px solid #e6d7bf;background-color:#fdfaf4;padding:10px;color:#4a3f33;vertical-align:top;',
  image: 'max-width:100%;height:auto;display:block;margin:24px auto;border-radius:8px;',
  link: 'color:#8a5a33;text-decoration:none;border-bottom:1px solid #d9b98c;word-break:break-all;',
  strong: 'font-weight:700;font-style:normal;color:#5d3b1f;background-color:#f5e3c8;padding:1px 3px;border-radius:2px;',
  highlight: 'background-color:#f2dcb8;color:inherit;',
  thematicBreak: 'border:none;border-top:1px dashed #d9c7ab;margin:26px 0;height:0;',
}

/** 技术专栏：左条标题、强调代码框与网格表格。 */
const TECHNICAL_THEME: RenderTheme = {
  ...WECHAT_BASE_THEME,
  id: 'wechat-technical',
  container: `font-family:${DEFAULT_ARTICLE_FONT};font-size:15px;line-height:1.85;color:#1f2329;letter-spacing:0.01em;word-break:break-word;`,
  paragraph: 'margin:0 0 18px;',
  heading: (level, degraded) => {
    if (degraded) {
      return `font-family:${DEFAULT_ARTICLE_FONT};margin:22px 0 10px;font-size:15px;font-weight:700;line-height:1.6;color:#0b2540;`
    }
    switch (level) {
      case 1:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:0 0 22px;font-size:21px;font-weight:700;line-height:1.5;color:#0b2540;`
      case 2:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:30px 0 16px;padding:0 0 10px 12px;border-left:5px solid ${BLUE};border-bottom:1px solid #e3e7ee;font-size:18px;font-weight:700;line-height:1.5;color:#0b2540;`
      case 3:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:24px 0 10px;padding-left:10px;border-left:3px solid #9fbdf0;font-size:16px;font-weight:700;line-height:1.55;color:#0a3d7a;`
      default:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:20px 0 10px;font-size:15px;font-weight:700;line-height:1.6;color:#0a3d7a;`
    }
  },
  blockquote:
    'margin:0 0 18px;padding:16px 18px;border:1px solid #e1e6ee;border-left:4px solid #0a5cf6;border-radius:4px;background-color:#f2f5f9;color:#3d4a5c;font-size:14.5px;line-height:1.9;',
  unorderedList: 'margin:0 0 18px;padding-left:20px;',
  orderedList: 'margin:0 0 18px;padding-left:20px;',
  listItem: 'margin:0 0 6px;',
  codeBlock: `margin:0 0 20px;padding:16px 18px;border:1px solid #dfe4ec;border-top:3px solid ${BLUE};border-radius:6px;background-color:#f7f9fc;font-family:${MONO_STACK};font-size:13px;line-height:1.75;color:#1f2329;white-space:pre-wrap;word-break:break-word;overflow-x:auto;`,
  inlineCode: `font-family:${MONO_STACK};font-size:13.5px;background-color:#eef1f6;color:#0a3d7a;padding:2px 5px;border:1px solid #dde3ec;border-radius:3px;`,
  table: 'border-collapse:collapse;width:100%;margin:0 0 20px;font-size:13.5px;line-height:1.7;',
  tableHeadCell:
    'border:1px solid #dde3ec;background-color:#eef2f8;padding:9px 10px;text-align:left;font-weight:700;color:#0b2540;',
  tableCell: 'border:1px solid #e4e9f1;padding:9px 10px;color:#2a2f36;vertical-align:top;',
  image: 'max-width:100%;height:auto;display:block;margin:22px auto;border-radius:6px;',
  strong: 'font-weight:700;font-style:normal;color:#0b2540;background-color:#dfe8f6;padding:1px 4px;border-radius:3px;',
  highlight: 'background-color:#e2eaf4;color:inherit;',
  thematicBreak: 'border:none;border-top:2px solid #e3e7ee;margin:26px 0;height:0;',
}

export const DEFAULT_WECHAT_TEMPLATE_ID: WechatTemplateId = 'classic'

export const WECHAT_TEMPLATES = [
  {
    id: 'classic',
    name: '观点蓝调',
    description: '墨蓝章节标题、清晰的小标题与原生列表；章节样式随平台调整。',
    theme: WECHAT_THEME,
  },
  {
    id: 'airy',
    name: '清爽留白',
    description: '大留白、细线小标题，重点句只留一道下划线，适合轻阅读。',
    theme: AIRY_THEME,
  },
  {
    id: 'brief',
    name: '内容简报',
    description: '紧凑段落与蓝条小标题，信息密度高，适合要点型内容。',
    theme: BRIEF_THEME,
  },
  {
    id: 'editorial',
    name: '杂志长文',
    description: '衬线正文、首行缩进与双线居中标题，适合需要仪式感的深度长文。',
    theme: EDITORIAL_THEME,
  },
  {
    id: 'warm',
    name: '暖纸手记',
    description: '暖纸底、米色卡片与虚线分隔，适合随笔与手记。',
    theme: WARM_THEME,
  },
  {
    id: 'technical',
    name: '技术专栏',
    description: '左条小标题、强调代码框与网格表格，适合技术类内容。',
    theme: TECHNICAL_THEME,
  },
] as const satisfies readonly {
  readonly id: WechatTemplateId
  readonly name: string
  readonly description: string
  readonly theme: RenderTheme
}[]

export function resolveArticleTheme(id: WechatTemplateId | undefined, platform: PlatformId): RenderTheme {
  const selected = WECHAT_TEMPLATES.find((template) => template.id === id)
  return !selected || selected.id === DEFAULT_WECHAT_TEMPLATE_ID ? CLASSIC_BY_PLATFORM[platform] : selected.theme
}
