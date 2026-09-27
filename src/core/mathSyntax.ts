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
 * \[...\] 行间公式 —— LaTeX 标准定界符，pandoc/学术 Markdown 常见。
 * 允许 \\[ 双反斜杠变体（AI 输出/JSON 转义常见）。
 */
export function bracketBlockMathRe(): RegExp {
  return /\\{1,2}\[([\s\S]+?)\\{1,2}\]/g
}

/**
 * 行内公式：$ 后不能紧跟空白、闭 $ 前不能是空白，
 * 避免「价格为 $5 与 $10 之间」这类文本被当成公式。
 */
export function inlineMathRe(): RegExp {
  return /(?<!\$)\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g
}

/**
 * \(...\) 行内公式（不跨行）。允许 \\( 双反斜杠变体。
 * 若内容本身含裸括号（如 \(f(x)\)）非贪婪匹配仍能正确闭合到最近的 \)。
 */
export function parenInlineMathRe(): RegExp {
  return /\\{1,2}\((.+?)\\{1,2}\)/g
}

// ─── 粘贴污染修复：三重复制公式还原 ────────────────────────────────────────────
//
// 从 KaTeX 渲染页面整段复制文本时，一个公式常带出三份拷贝：
//   [MathML 文本(Unicode 符号)] + [annotation 里的 LaTeX 源] + [KaTeX-HTML 文本]
// 例如 κ=10kappa=10κ=10、u(−1,t)=u(1,t)=0u(-1,t)=u(1,t)=0u(−1,t)=u(1,t)=0。
// 修复思路：把公式归一化（Unicode 数学符号→命令名、剥掉反斜杠/上下标/花括号/
// 空白）后比较，检出 2~3 段重复结构，保留最像原始 LaTeX 的那一段。

const UNICODE_MATH_MAP: Record<string, string> = {
  '−': '-', '–': '-', '—': '-', '―': '-', '‒': '-',
  '×': 'times', '⋅': 'cdot', '·': 'cdot', '∗': 'star', '⋆': 'star',
  '≈': 'approx', '≅': 'cong', '≃': 'simeq', '≠': 'neq',
  '≤': 'leq', '≥': 'geq', '±': 'pm', '∓': 'mp',
  '→': 'rightarrow', '←': 'leftarrow', '⇒': 'Rightarrow', '⇔': 'Leftrightarrow',
  '∑': 'sum', '∏': 'prod', '∫': 'int', '√': 'sqrt', '∂': 'partial', '∇': 'nabla',
  '∈': 'in', '∖': 'backslash', '∞': 'infty', 'ℓ': 'ell',
  '⟨': 'langle', '⟩': 'rangle', '°': 'circ',
  '…': 'ldots', '⋯': 'cdots',
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon',
  'ϵ': 'epsilon', 'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'ϑ': 'vartheta',
  'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi',
  'π': 'pi', 'ρ': 'rho', 'ϱ': 'varrho', 'σ': 'sigma', 'ς': 'varsigma',
  'τ': 'tau', 'υ': 'upsilon', 'φ': 'phi', 'ϕ': 'varphi', 'χ': 'chi',
  'ψ': 'psi', 'ω': 'omega',
  'Γ': 'Gamma', 'Δ': 'Delta', 'Θ': 'Theta', 'Λ': 'Lambda', 'Ξ': 'Xi',
  'Π': 'Pi', 'Σ': 'Sigma', 'Υ': 'Upsilon', 'Φ': 'Phi', 'Ψ': 'Psi', 'Ω': 'Omega',
}

/** 归一化比较键：抹平「渲染文本 vs LaTeX 源」的表面差异，只留结构 */
function normMathForCompare(s: string): string {
  let out = ''
  for (const ch of s) {
    out += UNICODE_MATH_MAP[ch] ?? ch
  }
  return out.replace(/[\s\\_^{}]/g, '')
}

/** 越像「原始 LaTeX 源」分数越高（含命令、含上下标结构） */
function latexScore(s: string): number {
  let score = 0
  if (/\\[a-zA-Z]+/.test(s)) score += 2
  if (/[_^]/.test(s)) score += 2
  return score
}

/**
 * 尝试把 KaTeX 复制污染的公式还原为单份 LaTeX。
 * 未检出重复结构、或公式过短时原样返回，绝不改动正常公式。
 */
export function repairMangledFormula(raw: string): string {
  const total = raw.length
  if (total < 6 || total > 1200) return raw
  const norm = normMathForCompare(raw)
  if (norm.length < 12) return raw

  // normPrefix[i] = raw[0..i) 的归一化长度，用于 O(1) 判断分段长度是否可能相等
  const normPrefix = new Int32Array(total + 1)
  for (let i = 0; i < total; i++) {
    const mapped = UNICODE_MATH_MAP[raw[i]] ?? raw[i]
    normPrefix[i + 1] = normPrefix[i] + (mapped === '' ? 0 : mapped.length)
  }
  const normSlice = (a: number, b: number) => {
    // 只有当分段内不含被剥除字符时才能用前缀差直接切片；统一走重新归一化
    return normMathForCompare(raw.slice(a, b))
  }
  const segLen = (a: number, b: number) => normPrefix[b] - normPrefix[a]

  const MIN_SEG = 4

  // keepBest：在候选段里挑最像 LaTeX 源的一份
  const keepBest = (segs: string[], preferOdd = -1) => {
    if (preferOdd >= 0) {
      const odd = segs[preferOdd]
      const others = segs.filter((_, idx) => idx !== preferOdd)
      const oddIsLatex = /\\[a-zA-Z]+|[_^]/.test(odd)
      const oddLonger = normMathForCompare(odd).length >= normMathForCompare(others[0]).length
      if (oddIsLatex && oddLonger) return odd.trim()
    }
    let best = segs[0]
    for (const s of segs) {
      if (latexScore(s) > latexScore(best)) best = s
    }
    return best.trim()
  }

  // ── 三段结构：A A A / A A B / A B A / B A A（任意两段相等）──
  let bestTriple: { segs: string[]; equalPair: number } | null = null
  for (let i = MIN_SEG; i <= total - 2 * MIN_SEG; i++) {
    if (segLen(0, i) < MIN_SEG) continue
    for (let j = i + MIN_SEG; j <= total - MIN_SEG; j++) {
      const l1 = segLen(0, i)
      const l2 = segLen(i, j)
      const l3 = segLen(j, total)
      if (l1 < MIN_SEG || l2 < MIN_SEG || l3 < MIN_SEG) continue
      // 长度都不相等就谈不上任何两段相等，跳过昂贵的字符串比较
      if (l1 !== l2 && l1 !== l3 && l2 !== l3) continue
      const s1 = normSlice(0, i)
      const s2 = normSlice(i, j)
      const s3 = normSlice(j, total)
      const eq12 = l1 === l2 && s1 === s2
      const eq13 = l1 === l3 && s1 === s3
      const eq23 = l2 === l3 && s2 === s3
      const matches = (eq12 ? 1 : 0) + (eq13 ? 1 : 0) + (eq23 ? 1 : 0)
      if (matches >= 1) {
        const segs = [raw.slice(0, i), raw.slice(i, j), raw.slice(j)]
        // 相等对之外的那段的下标
        const odd = eq12 && !eq13 && !eq23 ? 2 : eq13 && !eq12 && !eq23 ? 1 : eq23 && !eq12 && !eq13 ? 0 : -1
        bestTriple = { segs, equalPair: odd }
        if (odd >= 0) break
      }
    }
    if (bestTriple && bestTriple.equalPair >= 0) break
  }
  if (bestTriple) {
    const { segs, equalPair } = bestTriple
    if (equalPair >= 0) return keepBest(segs, equalPair)
    // 三段全等：保留结构最完整的一份
    return keepBest(segs)
  }

  // ── 两段结构：A A（渲染+LaTeX 各一份）──
  for (let i = MIN_SEG; i <= total - MIN_SEG; i++) {
    if (segLen(0, i) !== segLen(i, total)) continue
    if (normSlice(0, i) === normSlice(i, total)) {
      return keepBest([raw.slice(0, i), raw.slice(i)])
    }
  }

  return raw
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
  const bracketRe = bracketBlockMathRe()
  while ((m = bracketRe.exec(markdown))) {
    blockRanges.push([m.index, m.index + m[0].length])
    out.push({ formula: m[1].trim(), isBlock: true, line: lineOf(m.index) })
  }

  const inlineRes = [inlineMathRe(), parenInlineMathRe()]
  for (const inlineRe of inlineRes) {
    while ((m = inlineRe.exec(markdown))) {
      const inBlock = blockRanges.some(([s, e]) => m!.index >= s && m!.index < e)
      if (!inBlock) {
        out.push({ formula: m[1].trim(), isBlock: false, line: lineOf(m.index) })
      }
    }
  }
  return out
}
