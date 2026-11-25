import { DEFAULT_ARTICLE_FONT } from '@/core/render/article-font'
import type { RenderTheme } from '@/core/render/theme'
import type { PlatformId, WechatTemplateCategoryId, WechatTemplateId } from '@/core/types'

/**
 * 多平台排版模板集。
 *
 * 全部样式必须内联：公众号编辑器会丢掉 <style> 和 class。
 *
 * 十二套模板分为四大使用场景，共用成熟排印底盘——正文 15–17px、行高 1.8–2.0、段间 15–28px、
 * 一句话只给一种强调手法——差异落在色彩语境、标题形制、列表、代码框与引文容器上。
 * 色值与工作台令牌不共用，且在导出时展开为平台可用的内联颜色。
 */
const MONO_STACK = '"JetBrains Mono","SF Mono",Menlo,Consolas,"Songti SC",monospace'

const BLUE = '#0a5cf6'
const CARD = '#f5f7ff'
const MARK = '#e8efff'

/** 十二套版式的基础排印；不要把默认版专用样式继承到其他模板。 */
const WECHAT_BASE_THEME: RenderTheme = {
  id: 'wechat',
  wrapperTag: 'section',
  container: `font-family:${DEFAULT_ARTICLE_FONT};max-width:576px;margin:0 auto;font-size:16px;line-height:2;color:#1f2023;letter-spacing:0.02em;overflow-wrap:anywhere;`,
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

/** 水墨国风：黛青墨韵、书卷细线标题与青灰素笺引文。 */
const INK_THEME: RenderTheme = {
  ...WECHAT_BASE_THEME,
  id: 'wechat-ink',
  container: `font-family:${DEFAULT_ARTICLE_FONT};font-size:16.5px;line-height:2;color:#1d2624;letter-spacing:0.03em;word-break:break-word;`,
  paragraph: 'margin:0 0 24px;',
  blockquoteParagraph: 'margin:0 0 18px;',
  heading: (level, degraded) => {
    if (degraded) {
      return `font-family:${DEFAULT_ARTICLE_FONT};margin:24px 0 10px;font-size:16.5px;font-weight:700;line-height:1.6;color:#1f3d36;`
    }
    switch (level) {
      case 1:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:0 0 28px;padding:0 0 14px;border-bottom:2px solid #1f3d36;font-size:24px;font-weight:700;line-height:1.45;letter-spacing:0.06em;color:#1f3d36;text-align:center;`
      case 2:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:38px 0 18px;padding:8px 0 10px;border-top:1px solid #cad9d3;border-bottom:2px solid #1f3d36;font-size:19.5px;font-weight:700;line-height:1.5;letter-spacing:0.06em;color:#1f3d36;`
      case 3:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:28px 0 12px;padding-left:12px;border-left:3px solid #3c6e63;font-size:17px;font-weight:700;line-height:1.6;color:#244a42;`
      default:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:22px 0 10px;font-size:16px;font-weight:700;line-height:1.6;color:#244a42;`
    }
  },
  blockquote:
    `margin:0 0 24px;padding:18px 22px;border-left:3px solid #3c6e63;border-radius:0 6px 6px 0;background-color:#f3f7f5;font-family:${DEFAULT_ARTICLE_FONT};font-size:15.5px;line-height:1.95;color:#2c443e;`,
  unorderedList: 'margin:0 0 22px;padding-left:22px;',
  orderedList: 'margin:0 0 22px;padding-left:22px;',
  listItem: 'margin:0 0 9px;',
  codeBlock: `margin:0 0 22px;padding:16px 18px;border:1px solid #d8e2de;border-radius:6px;background-color:#f5f7f6;font-family:${MONO_STACK};font-size:13px;line-height:1.8;color:#1d2624;white-space:pre-wrap;word-break:break-word;overflow-x:auto;`,
  inlineCode: `font-family:${MONO_STACK};font-size:14px;background-color:#eaf1ee;color:#1f3d36;padding:2px 5px;border-radius:3px;`,
  inlineCodeDegraded: `font-family:${MONO_STACK};font-size:14px;color:#1f3d36;`,
  table: 'border-collapse:collapse;width:100%;margin:24px 0;border-top:2px solid #1f3d36;border-bottom:1px solid #cad9d3;font-size:14.5px;line-height:1.8;',
  tableHeadCell:
    'border:none;border-bottom:1px solid #1f3d36;background-color:#edf3f0;padding:10px 12px;text-align:left;font-weight:700;color:#1f3d36;',
  tableCell: 'border:none;border-bottom:1px solid #dde6e2;padding:10px 12px;color:#263330;vertical-align:top;',
  image: 'max-width:100%;height:auto;display:block;margin:26px auto;border-radius:4px;',
  link: 'color:#1f4f45;text-decoration:none;border-bottom:1px solid #9ab9ae;word-break:break-all;',
  strong: 'font-weight:700;font-style:normal;color:#16302a;background-color:#e6efec;padding:1px 4px;border-radius:2px;',
  highlight: 'background-color:#dceae5;color:inherit;',
  thematicBreak: 'border:none;border-top:1px solid #b8cbc4;width:44%;margin:30px auto;height:0;',
  imageMarker:
    'display:block;margin:0 0 20px;padding:12px 16px;border:1px dashed #7ea094;border-radius:6px;background-color:#f3f7f5;color:#2c443e;font-size:14px;line-height:1.6;',
}

/** 深度周刊：专栏通讯风、靛蓝左侧色标与淡靛底卡片引文。 */
const NEWSLETTER_THEME: RenderTheme = {
  ...WECHAT_BASE_THEME,
  id: 'wechat-newsletter',
  container: `font-family:${DEFAULT_ARTICLE_FONT};font-size:15.5px;line-height:1.88;color:#1f2233;letter-spacing:0.015em;word-break:break-word;`,
  paragraph: 'margin:0 0 19px;',
  blockquoteParagraph: 'margin:0 0 15px;',
  heading: (level, degraded) => {
    if (degraded) {
      return `font-family:${DEFAULT_ARTICLE_FONT};margin:20px 0 9px;font-size:15.5px;font-weight:700;line-height:1.55;color:#2d3166;`
    }
    switch (level) {
      case 1:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:0 0 24px;padding:0 0 12px;border-bottom:2px solid #2d3166;font-size:22px;font-weight:700;line-height:1.45;color:#2d3166;`
      case 2:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:30px 0 15px;padding:10px 14px;border-left:5px solid #2d3166;border-radius:0 8px 8px 0;background-color:#f4f5fc;font-size:18px;font-weight:700;line-height:1.5;color:#2d3166;`
      case 3:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:22px 0 10px;padding:0 0 5px;border-bottom:1px solid #d5d9ef;font-size:16.5px;font-weight:700;line-height:1.55;color:#363b7a;`
      default:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:18px 0 9px;font-size:15.5px;font-weight:700;line-height:1.55;color:#363b7a;`
    }
  },
  blockquote:
    'margin:0 0 20px;padding:16px 20px;border:1px solid #dfe2f4;border-left:4px solid #2d3166;border-radius:8px;background-color:#f4f5fc;color:#34395e;font-size:15px;line-height:1.88;',
  unorderedList: 'margin:0 0 19px;padding-left:20px;',
  orderedList: 'margin:0 0 19px;padding-left:20px;',
  listItem: 'margin:0 0 7px;',
  codeBlock: `margin:0 0 20px;padding:15px 18px;border:1px solid #dfe2f4;border-left:3px solid #2d3166;border-radius:6px;background-color:#f5f6fb;font-family:${MONO_STACK};font-size:13px;line-height:1.75;color:#1f2233;white-space:pre-wrap;word-break:break-word;overflow-x:auto;`,
  inlineCode: `font-family:${MONO_STACK};font-size:13.5px;background-color:#eceef9;color:#2d3166;padding:2px 5px;border-radius:4px;`,
  inlineCodeDegraded: `font-family:${MONO_STACK};font-size:13.5px;color:#2d3166;`,
  table: 'border-collapse:collapse;width:100%;margin:22px 0;border:1px solid #dfe2f4;font-size:14px;line-height:1.75;',
  tableHeadCell:
    'border:1px solid #d7dbf0;background-color:#eff0fa;padding:9px 11px;text-align:left;font-weight:700;color:#2d3166;',
  tableCell: 'border:1px solid #e4e6f4;padding:9px 11px;color:#2b2f42;vertical-align:top;',
  image: 'max-width:100%;height:auto;display:block;margin:22px auto;border-radius:8px;',
  link: 'color:#343c8c;text-decoration:none;border-bottom:1px solid #aeb4e6;word-break:break-all;',
  strong: 'font-weight:700;font-style:normal;color:#232757;background-color:#e5e8f8;padding:1px 4px;border-radius:3px;',
  highlight: 'background-color:#dfe3f7;color:inherit;',
  thematicBreak: 'border:none;border-top:2px dotted #c7cce8;margin:26px 0;height:0;',
  imageMarker:
    'display:block;margin:0 0 20px;padding:12px 16px;border:1px dashed #8f96c9;border-radius:8px;background-color:#f4f5fc;color:#34395e;font-size:14px;line-height:1.6;',
}

/** 朱砂快讯：醒目朱砂导语条与快讯标题，白底克制用红。 */
const VERMILION_THEME: RenderTheme = {
  ...WECHAT_BASE_THEME,
  id: 'wechat-vermilion',
  container: `font-family:${DEFAULT_ARTICLE_FONT};font-size:15.5px;line-height:1.86;color:#221d1c;letter-spacing:0.01em;word-break:break-word;`,
  paragraph: 'margin:0 0 17px;',
  blockquoteParagraph: 'margin:0 0 14px;',
  heading: (level, degraded) => {
    if (degraded) {
      return `font-family:${DEFAULT_ARTICLE_FONT};margin:20px 0 8px;font-size:15.5px;font-weight:700;line-height:1.55;color:#7e1f18;`
    }
    switch (level) {
      case 1:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:0 0 22px;padding:0 0 12px;border-bottom:3px solid #a82c22;font-size:22px;font-weight:700;line-height:1.45;color:#7e1f18;`
      case 2:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:28px 0 14px;padding:9px 14px;border-left:4px solid #a82c22;border-radius:0 4px 4px 0;background-color:#fcf5f4;font-size:17.5px;font-weight:700;line-height:1.5;color:#7e1f18;`
      case 3:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:22px 0 10px;padding-left:10px;border-left:2px solid #c65d53;font-size:16px;font-weight:700;line-height:1.55;color:#8e241b;`
      default:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:18px 0 8px;font-size:15px;font-weight:700;line-height:1.55;color:#8e241b;`
    }
  },
  blockquote:
    'margin:0 0 18px;padding:15px 18px;border-left:3px solid #a82c22;border-radius:0 6px 6px 0;background-color:#fcf5f4;color:#4e2f2b;font-size:14.5px;line-height:1.85;',
  unorderedList: 'margin:0 0 17px;padding-left:20px;',
  orderedList: 'margin:0 0 17px;padding-left:20px;',
  listItem: 'margin:0 0 6px;',
  codeBlock: `margin:0 0 18px;padding:14px 16px;border:1px solid #edd8d5;border-radius:6px;background-color:#faf6f5;font-family:${MONO_STACK};font-size:13px;line-height:1.72;color:#221d1c;white-space:pre-wrap;word-break:break-word;overflow-x:auto;`,
  inlineCode: `font-family:${MONO_STACK};font-size:13.5px;background-color:#f7e8e6;color:#7e1f18;padding:2px 5px;border-radius:3px;`,
  inlineCodeDegraded: `font-family:${MONO_STACK};font-size:13.5px;color:#7e1f18;`,
  table: 'border-collapse:collapse;width:100%;margin:20px 0;border-top:2px solid #a82c22;font-size:14px;line-height:1.7;',
  tableHeadCell:
    'border:1px solid #ebd5d2;background-color:#faeeec;padding:9px 10px;text-align:left;font-weight:700;color:#7e1f18;',
  tableCell: 'border:1px solid #f0e1df;padding:9px 10px;color:#2f2726;vertical-align:top;',
  image: 'max-width:100%;height:auto;display:block;margin:20px auto;border-radius:4px;',
  link: 'color:#8f241b;text-decoration:none;border-bottom:1px solid #d99b95;word-break:break-all;',
  strong: 'font-weight:700;font-style:normal;color:#6b1812;background-color:#f7e6e4;padding:1px 4px;border-radius:2px;',
  highlight: 'background-color:#f5dcd8;color:inherit;',
  thematicBreak: 'border:none;border-top:1px solid #e7ccc9;margin:24px 0;height:0;',
  imageMarker:
    'display:block;margin:0 0 20px;padding:12px 16px;border:1px dashed #c9867f;border-radius:6px;background-color:#fcf5f4;color:#4e2f2b;font-size:14px;line-height:1.6;',
}

/** 森系轻读：松林绿强调、薄荷浅底引文与松弛段距。 */
const FOREST_THEME: RenderTheme = {
  ...WECHAT_BASE_THEME,
  id: 'wechat-forest',
  container: `font-family:${DEFAULT_ARTICLE_FONT};font-size:16px;line-height:1.96;color:#1d2b24;letter-spacing:0.025em;word-break:break-word;`,
  paragraph: 'margin:0 0 25px;',
  blockquoteParagraph: 'margin:0 0 18px;',
  heading: (level, degraded) => {
    if (degraded) {
      return `font-family:${DEFAULT_ARTICLE_FONT};margin:24px 0 11px;font-size:16px;font-weight:600;line-height:1.6;color:#154030;`
    }
    switch (level) {
      case 1:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:0 0 28px;font-size:23px;font-weight:600;line-height:1.48;letter-spacing:0.04em;color:#154030;text-align:center;`
      case 2:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:36px 0 16px;padding:6px 14px;border-left:4px solid #1e5641;border-radius:10px;background-color:#f2f8f5;font-size:18.5px;font-weight:600;line-height:1.5;color:#154030;`
      case 3:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:26px 0 12px;padding:0 0 6px;border-bottom:1px solid #cfe3d8;font-size:16.5px;font-weight:600;line-height:1.6;color:#1e5641;`
      default:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:22px 0 10px;font-size:16px;font-weight:600;line-height:1.6;color:#1e5641;`
    }
  },
  blockquote:
    'margin:0 0 25px;padding:18px 22px;border-left:3px solid #1e5641;border-radius:10px;background-color:#f2f8f5;color:#244739;font-size:15.5px;line-height:1.95;',
  unorderedList: 'margin:0 0 24px;padding-left:22px;',
  orderedList: 'margin:0 0 24px;padding-left:22px;',
  listItem: 'margin:0 0 10px;',
  codeBlock: `margin:0 0 24px;padding:16px 18px;border:1px solid #d5e5dc;border-radius:10px;background-color:#f4f9f6;font-family:${MONO_STACK};font-size:13px;line-height:1.8;color:#1d2b24;white-space:pre-wrap;word-break:break-word;overflow-x:auto;`,
  inlineCode: `font-family:${MONO_STACK};font-size:14px;background-color:#e8f3ed;color:#154030;padding:2px 6px;border-radius:4px;`,
  inlineCodeDegraded: `font-family:${MONO_STACK};font-size:14px;color:#154030;`,
  table: 'border-collapse:collapse;width:100%;margin:26px 0;border:1px solid #d5e5dc;font-size:14.5px;line-height:1.8;',
  tableHeadCell:
    'border:1px solid #cfe2d7;background-color:#ecf5f0;padding:10px 12px;text-align:left;font-weight:600;color:#154030;',
  tableCell: 'border:1px solid #dfece4;padding:10px 12px;color:#26382f;vertical-align:top;',
  image: 'max-width:100%;height:auto;display:block;margin:26px auto;border-radius:10px;',
  link: 'color:#1b523d;text-decoration:none;border-bottom:1px solid #9dc4b0;word-break:break-all;',
  strong: 'font-weight:700;font-style:normal;color:#12382a;background-color:#e2f0e8;padding:1px 4px;border-radius:4px;',
  highlight: 'background-color:#d8ebdf;color:inherit;',
  thematicBreak: 'border:none;border-top:1px dashed #b9d4c5;width:48%;margin:30px auto;height:0;',
  imageMarker:
    'display:block;margin:0 0 20px;padding:12px 16px;border:1px dashed #7ba892;border-radius:10px;background-color:#f2f8f5;color:#244739;font-size:14px;line-height:1.6;',
}

/** 操作手册：琥珀棕步骤标题、提示卡片与清晰网格表格。 */
const HANDBOOK_THEME: RenderTheme = {
  ...WECHAT_BASE_THEME,
  id: 'wechat-handbook',
  container: `font-family:${DEFAULT_ARTICLE_FONT};font-size:15.5px;line-height:1.88;color:#241f1a;letter-spacing:0.01em;word-break:break-word;`,
  paragraph: 'margin:0 0 15px;',
  blockquoteParagraph: 'margin:0 0 13px;',
  heading: (level, degraded) => {
    if (degraded) {
      return `font-family:${DEFAULT_ARTICLE_FONT};margin:20px 0 8px;font-size:15.5px;font-weight:700;line-height:1.55;color:#633404;`
    }
    switch (level) {
      case 1:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:0 0 22px;padding:0 0 10px;border-bottom:2px solid #8a4b08;font-size:21.5px;font-weight:700;line-height:1.45;color:#633404;`
      case 2:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:28px 0 14px;padding:9px 14px;border:1px solid #ead8bd;border-left:5px solid #8a4b08;border-radius:4px;background-color:#fbf6ee;font-size:17.5px;font-weight:700;line-height:1.5;color:#633404;`
      case 3:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:22px 0 9px;padding-left:10px;border-left:3px solid #b5732b;font-size:16px;font-weight:700;line-height:1.55;color:#733c05;`
      default:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:18px 0 8px;font-size:15px;font-weight:700;line-height:1.55;color:#733c05;`
    }
  },
  blockquote:
    'margin:0 0 18px;padding:15px 18px;border:1px solid #ead8bd;border-left:4px solid #8a4b08;border-radius:6px;background-color:#fbf6ee;color:#4d3316;font-size:14.5px;line-height:1.86;',
  unorderedList: 'margin:0 0 16px;padding-left:20px;',
  orderedList: 'margin:0 0 16px;padding-left:20px;',
  listItem: 'margin:0 0 6px;',
  codeBlock: `margin:0 0 18px;padding:15px 16px;border:1px solid #e6d4b8;border-top:3px solid #8a4b08;border-radius:6px;background-color:#faf6f0;font-family:${MONO_STACK};font-size:13px;line-height:1.75;color:#241f1a;white-space:pre-wrap;word-break:break-word;overflow-x:auto;`,
  inlineCode: `font-family:${MONO_STACK};font-size:13.5px;background-color:#f5ebdc;color:#633404;padding:2px 5px;border:1px solid #e7d6bc;border-radius:3px;`,
  inlineCodeDegraded: `font-family:${MONO_STACK};font-size:13.5px;color:#633404;`,
  table: 'border-collapse:collapse;width:100%;margin:18px 0;border:1px solid #e2cfa8;font-size:14px;line-height:1.75;',
  tableHeadCell:
    'border:1px solid #e2cfa8;background-color:#f7efe2;padding:9px 10px;text-align:left;font-weight:700;color:#633404;',
  tableCell: 'border:1px solid #ecdfc9;padding:9px 10px;color:#2f2821;vertical-align:top;',
  image: 'max-width:100%;height:auto;display:block;margin:20px auto;border-radius:6px;',
  link: 'color:#753e06;text-decoration:none;border-bottom:1px solid #cfa572;word-break:break-all;',
  strong: 'font-weight:700;font-style:normal;color:#592e03;background-color:#f4e7d3;padding:1px 4px;border-radius:3px;',
  highlight: 'background-color:#f0dec2;color:inherit;',
  thematicBreak: 'border:none;border-top:2px solid #e7d6bc;margin:24px 0;height:0;',
  imageMarker:
    'display:block;margin:0 0 20px;padding:12px 16px;border:1px dashed #b98952;border-radius:6px;background-color:#fbf6ee;color:#4d3316;font-size:14px;line-height:1.6;',
}

/** 极简黑白：瑞士单色网格风、锐利细线与克制中性灰。 */
const MINIMAL_THEME: RenderTheme = {
  ...WECHAT_BASE_THEME,
  id: 'wechat-minimal',
  container: `font-family:${DEFAULT_ARTICLE_FONT};font-size:16px;line-height:1.92;color:#141414;letter-spacing:0.015em;word-break:break-word;`,
  paragraph: 'margin:0 0 21px;',
  blockquoteParagraph: 'margin:0 0 16px;',
  heading: (level, degraded) => {
    if (degraded) {
      return `font-family:${DEFAULT_ARTICLE_FONT};margin:24px 0 10px;font-size:16px;font-weight:700;line-height:1.55;color:#141414;`
    }
    switch (level) {
      case 1:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:0 0 28px;padding:0 0 12px;border-bottom:2px solid #141414;font-size:23px;font-weight:700;line-height:1.45;letter-spacing:0.02em;color:#141414;`
      case 2:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:34px 0 16px;padding:0 0 8px;border-bottom:2px solid #141414;font-size:19px;font-weight:700;line-height:1.5;letter-spacing:0.02em;color:#141414;`
      case 3:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:24px 0 10px;padding:0 0 4px;border-bottom:1px solid #d4d4d4;font-size:16.5px;font-weight:700;line-height:1.55;color:#141414;`
      default:
        return `font-family:${DEFAULT_ARTICLE_FONT};margin:20px 0 8px;font-size:15.5px;font-weight:700;line-height:1.55;color:#141414;`
    }
  },
  blockquote:
    'margin:0 0 22px;padding:4px 0 4px 18px;border-left:2px solid #141414;background-color:transparent;color:#3a3a3a;font-size:15.5px;line-height:1.9;',
  unorderedList: 'margin:0 0 20px;padding-left:20px;',
  orderedList: 'margin:0 0 20px;padding-left:20px;',
  listItem: 'margin:0 0 8px;',
  codeBlock: `margin:0 0 22px;padding:16px 18px;border:1px solid #d9d9d9;border-radius:2px;background-color:#f5f5f5;font-family:${MONO_STACK};font-size:13px;line-height:1.78;color:#141414;white-space:pre-wrap;word-break:break-word;overflow-x:auto;`,
  inlineCode: `font-family:${MONO_STACK};font-size:13.5px;background-color:#efefef;color:#141414;padding:2px 5px;border-radius:2px;`,
  inlineCodeDegraded: `font-family:${MONO_STACK};font-size:13.5px;color:#141414;`,
  table: 'border-collapse:collapse;width:100%;margin:28px 0;border-top:2px solid #141414;border-bottom:2px solid #141414;font-size:14px;line-height:1.75;',
  tableHeadCell:
    'border:none;border-bottom:2px solid #141414;background-color:#f2f2f2;padding:10px 12px;text-align:left;font-weight:700;color:#141414;',
  tableCell: 'border:none;border-bottom:1px solid #dcdcdc;padding:10px 12px;color:#262626;vertical-align:top;',
  image: 'max-width:100%;height:auto;display:block;margin:24px auto;border-radius:0;',
  link: 'color:#141414;text-decoration:underline;word-break:break-all;',
  strong: 'font-weight:700;font-style:normal;color:#141414;border-bottom:1px solid #141414;padding-bottom:1px;',
  highlight: 'background-color:#e4e4e4;color:inherit;',
  thematicBreak: 'border:none;border-top:1px solid #141414;width:28%;margin:32px auto;height:0;',
  imageMarker:
    'display:block;margin:0 0 20px;padding:12px 16px;border:1px dashed #666666;border-radius:2px;background-color:#f5f5f5;color:#262626;font-size:14px;line-height:1.6;',
}

export const DEFAULT_WECHAT_TEMPLATE_ID: WechatTemplateId = 'classic'

export const WECHAT_TEMPLATE_CATEGORIES = [
  {
    id: 'opinion',
    name: '观点长文',
    description: '深度评论、专栏与叙事长文',
  },
  {
    id: 'briefing',
    name: '资讯简报',
    description: '速读要点、行业快讯与周期通讯',
  },
  {
    id: 'lifestyle',
    name: '生活随笔',
    description: '日常记录、散文手记与轻阅读',
  },
  {
    id: 'knowledge',
    name: '知识干货',
    description: '技术专栏、操作手册与方法论',
  },
] as const satisfies readonly {
  readonly id: WechatTemplateCategoryId
  readonly name: string
  readonly description: string
}[]

export const WECHAT_TEMPLATES = [
  {
    id: 'classic',
    category: 'opinion',
    name: '观点蓝调',
    description: '墨蓝章节标题、清晰的小标题与原生列表；章节样式随平台调整。',
    theme: WECHAT_THEME,
  },
  {
    id: 'airy',
    category: 'lifestyle',
    name: '清爽留白',
    description: '大留白、细线小标题，重点句只留一道下划线，适合轻阅读。',
    theme: AIRY_THEME,
  },
  {
    id: 'brief',
    category: 'briefing',
    name: '内容简报',
    description: '紧凑段落与蓝条小标题，信息密度高，适合要点型内容。',
    theme: BRIEF_THEME,
  },
  {
    id: 'editorial',
    category: 'opinion',
    name: '杂志长文',
    description: '衬线正文、首行缩进与双线居中标题，适合需要仪式感的深度长文。',
    theme: EDITORIAL_THEME,
  },
  {
    id: 'warm',
    category: 'lifestyle',
    name: '暖纸手记',
    description: '暖纸底、米色卡片与虚线分隔，适合随笔与手记。',
    theme: WARM_THEME,
  },
  {
    id: 'technical',
    category: 'knowledge',
    name: '技术专栏',
    description: '左条小标题、强调代码框与网格表格，适合技术类内容。',
    theme: TECHNICAL_THEME,
  },
  {
    id: 'ink',
    category: 'opinion',
    name: '水墨国风',
    description: '黛青墨韵、书卷气细线标题与素笺引文，适合文化评论与长篇随笔。',
    theme: INK_THEME,
  },
  {
    id: 'newsletter',
    category: 'briefing',
    name: '深度周刊',
    description: '深靛蓝左侧色标与卡片引文，节奏分明，适合周报与行业通讯。',
    theme: NEWSLETTER_THEME,
  },
  {
    id: 'vermilion',
    category: 'briefing',
    name: '朱砂快讯',
    description: '克制朱砂红导语条与快讯标题，重点突出，适合热点解读与公告。',
    theme: VERMILION_THEME,
  },
  {
    id: 'forest',
    category: 'lifestyle',
    name: '森系轻读',
    description: '松林绿圆润标题与薄荷浅底引文，段距舒展，适合生活方式与游记。',
    theme: FOREST_THEME,
  },
  {
    id: 'handbook',
    category: 'knowledge',
    name: '操作手册',
    description: '琥珀棕步骤标题、提示卡片与清晰网格表，适合教程与 SOP 指南。',
    theme: HANDBOOK_THEME,
  },
  {
    id: 'minimal',
    category: 'knowledge',
    name: '极简黑白',
    description: '瑞士单色网格、锐利细线与中性浅灰代码框，克制呈现信息结构。',
    theme: MINIMAL_THEME,
  },
] as const satisfies readonly {
  readonly id: WechatTemplateId
  readonly category: WechatTemplateCategoryId
  readonly name: string
  readonly description: string
  readonly theme: RenderTheme
}[]

export function resolveArticleTheme(id: WechatTemplateId | undefined, platform: PlatformId): RenderTheme {
  const selected = WECHAT_TEMPLATES.find((template) => template.id === id)
  return !selected || selected.id === DEFAULT_WECHAT_TEMPLATE_ID ? CLASSIC_BY_PLATFORM[platform] : selected.theme
}
