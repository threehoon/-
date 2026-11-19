---
title: 复杂元素样稿
---

# 复杂元素样稿

这份样稿在一篇普通文章的基础上，加入了引用、代码、表格、外链和图片，用来检查每个平台的降级规则。

## 引用与强调

> 引用应该保留边界，读者能看出这段话属于引述，而不是正文。
> 第二行仍然在同一个引用块里。

正文里还有 **加粗**、*斜体* 与 `行内代码` 三种强调方式。

## 多行代码

```ts
export function typeset(markdown: string): string {
  const lines = markdown.split('\n')
  return lines.map((line) => line.trim()).join('\n')
}
```

代码块的换行必须原样保留，否则读者无法复制运行。

## 一张对比表

| 平台 | 正文长度 | 是否保留表格 |
| --- | --- | --- |
| 微信公众号 | 长 | 视主题而定 |
| 头条号 | 中 | 否 |
| 知乎 | 长 | 是 |

## 链接与图片

外链写法：[Markdown 规范](https://commonmark.org/help/)。
危险链接写法：[点我](javascript:alert(1))，应当被拦截，只保留文字。

外链图片：![外链示意图](https://example.com/assets/diagram.png)

本地图片：![本地示意图](images/local-shot.png)

原始 HTML：<script>alert('xss')</script>

---

样稿到此结束。
