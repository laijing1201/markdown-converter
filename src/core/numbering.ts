/**
 * 标题自动编号 —— 网页预览与 Word 导出共用的计数逻辑。
 *
 * Word 侧通过 numbering.xml 的多级编号（numPr 挂在标题段落上）实现，
 * TOC 域会自动带上编号；预览侧用同一个计数器在渲染后给标题注入
 * `<span class="md-hnum">1.1 </span>`（exporter 解析预览 HTML 时会剥掉，
 * 不会二次编号，也不会改动用户的 Markdown 原文）。
 */

import type { HeadingNumberingMode } from './templates'

export function createHeadingCounter(mode: HeadingNumberingMode) {
  let h1 = 0
  let h2 = 0
  let h3 = 0
  return (level: number, skip: boolean): string | null => {
    if (mode === 'off' || skip) return null
    if (level === 1) {
      h1++
      h2 = 0
      h3 = 0
      return `${h1}`
    }
    if (level === 2) {
      if (mode === '1') return null
      h2++
      h3 = 0
      return `${h1}.${h2}`
    }
    if (level === 3) {
      if (mode !== '1.1.1') return null
      h3++
      return `${h1}.${h2}.${h3}`
    }
    return null
  }
}

/**
 * 预览注入的编号 span 类名。exporter 解析预览 HTML 时据此剥离，
 * 避免 Word 侧编号 + 预览文本编号双重叠加。
 */
export const HEADING_NUM_CLASS = 'md-hnum'
