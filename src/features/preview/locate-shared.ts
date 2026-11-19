/**
 * 定位结果的共用类型与判据。
 *
 * 三处定位（发布预检、中文校对、兼容清单）都返回同一种结果：命中原文、
 * 只落到段落、或找不到。界面据此给出同一套文案，而不是有的静默、有的报错。
 */

/** 一次定位的结果：命中原文、只落到段落、或完全找不到。 */
export type LocateOutcome =
  | { readonly status: 'located'; readonly range: Range }
  | { readonly status: 'block'; readonly range: Range }
  | { readonly status: 'unavailable'; readonly reason: string }

export function located(range: Range): LocateOutcome {
  return { status: 'located', range }
}

export function block(range: Range): LocateOutcome {
  return { status: 'block', range }
}

export function unavailable(reason: string): LocateOutcome {
  return { status: 'unavailable', reason }
}

export function outcomeRange(outcome: LocateOutcome | null): Range | null {
  return outcome && outcome.status !== 'unavailable' ? outcome.range : null
}

/** 回退到整块前，命中原文与当前块文字至少要有这么长的共同前后缀才算「就是这一段」。 */
const ANCHOR_MIN = 4

/** 原文还剩多少比例能对上：只对上开头几个字不算，说明这一段已经换成别的内容了。 */
const ANCHOR_COVERAGE = 0.5

function commonPrefix(left: string, right: string): number {
  let size = 0
  while (size < left.length && size < right.length && left[size] === right[size]) size += 1
  return size
}

function commonSuffix(left: string, right: string): number {
  let size = 0
  while (size < left.length && size < right.length && left[left.length - 1 - size] === right[right.length - 1 - size]) size += 1
  return size
}

/**
 * 命中片段的文字被改过以后，这一段还是不是「原来那一段」。
 * 只有首或尾还留着足够长的一段原文（且占比过半）才认，否则宁可不定位也不跳到相邻段落。
 */
export function sameBlockAfterEdit(original: string, current: string): boolean {
  if (original === '' || current === '') return false
  const anchor = Math.max(commonPrefix(original, current), commonSuffix(original, current))
  return anchor >= ANCHOR_MIN && anchor / original.length >= ANCHOR_COVERAGE
}
