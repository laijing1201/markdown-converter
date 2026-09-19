/**
 * LaTeX 公式语法工具 —— 轻量、零依赖（可被 content script / Node 测试直接复用，
 * 不拖入 marked / highlight.js 等重型依赖）。
 */

export interface ExtractedFormula {
  formula: string
  isBlock: boolean
  line: number
}

/** 每次调用返回新实例（global 正则有 lastIndex 状态，不能共享） */
export function blockMathRe(): RegExp {
  return /\$\$([\s\S]*?)\$\$/g
}

/**
 * 行内公式：$ 后不能紧跟空白、闭 $ 前不能是空白，
 * 避免「价格为 $5 与 $10 之间」这类文本被当成公式。
 */
export function inlineMathRe(): RegExp {
  return /(?<!\$)\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g
}

/**
 * Extract all LaTeX formulas (with line numbers) — used by preflight checks
 * and the browser extension's content script statistics.
 */
export function extractFormulas(markdown: string): ExtractedFormula[] {
  const out: ExtractedFormula[] = []
  const lineOf = (idx: number) => markdown.slice(0, idx).split('\n').length

  const blockRanges: Array<[number, number]> = []
  let m: RegExpExecArray | null
  const blockRe = blockMathRe()
  while ((m = blockRe.exec(markdown))) {
    blockRanges.push([m.index, m.index + m[0].length])
    out.push({ formula: m[1].trim(), isBlock: true, line: lineOf(m.index) })
  }

  const inlineRe = inlineMathRe()
  while ((m = inlineRe.exec(markdown))) {
    const inBlock = blockRanges.some(([s, e]) => m!.index >= s && m!.index < e)
    if (!inBlock) {
      out.push({ formula: m[1].trim(), isBlock: false, line: lineOf(m.index) })
    }
  }
  return out
}
