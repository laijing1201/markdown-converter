/**
 * AI 内容修复（AI → Word 格式断层修复）
 *
 * 定位：解决从 DeepSeek / ChatGPT / 元宝 等 AI 对话界面复制内容（或携带
 * LaTeX 公式 / Mermaid 图表的 Markdown）进入 Word 排版链路时的三类断层：
 *   1. 公式乱码 —— \( \) \[ \] 定界符不被公式管线识别、Word 线性公式残留
 *      （∑_(i=1)^n▒x_i）、裸 \begin{cases} 环境缺少 $$/... 包裹；
 *   2. 图表错位 —— 从对话界面复制时 ```mermaid 围栏被剥离，图表语法变成
 *      散落正文，导出后无法渲染成图；
 *   3. 结构污染 —— 全角字母/数字、零宽字符、NBSP、软连字符等粘贴污染物。
 *
 * 设计约束（与 repair.ts / formatter.ts 一致）：
 *   - 纯函数、零依赖、逐行处理，供 Web / 扩展 / Node 测试直接复用；
 *   - ``` 代码围栏内的内容绝不动；
 *   - 已在 $...$ / $$...$$ 公式内的内容绝不动；
 *   - 中文全角标点（，。！？等）是合法排版，绝不"修复"。
 */

import { extractFormulas } from './mathSyntax'

// ─── 类型 ────────────────────────────────────────────────────────────────────

export type AiWordFixCategory = 'math' | 'chart' | 'structure'

export interface AiWordFix {
  category: AiWordFixCategory
  /** 修复条目名称（同类聚合） */
  label: string
  count: number
  /** 受影响的行号（最多 3 个示例） */
  exampleLines: number[]
}

export interface AiWordFixOptions {
  /** 公式断层：定界符转换 / Word 线性公式 / 裸公式环境 */
  math: boolean
  /** 图表断层：Mermaid 围栏重建 */
  chart: boolean
  /** 结构污染：全角字母数字、零宽字符、NBSP、软连字符 */
  structure: boolean
}

export const DEFAULT_AI_WORD_FIX_OPTIONS: AiWordFixOptions = {
  math: true,
  chart: true,
  structure: true,
}

export interface AiWordFixResult {
  fixed: string
  fixes: AiWordFix[]
}

// ─── 行上下文：围栏 / 块公式 ─────────────────────────────────────────────────

interface LineContext {
  /** 行在 ``` 围栏内（含围栏行本身） */
  inFence: boolean
  /** 行在 $$ 块公式内（含定界行本身） */
  inBlockMath: boolean
}

function buildLineContext(lines: string[]): LineContext[] {
  const ctx: LineContext[] = []
  let fence = false
  let blockMath = false
  for (const line of lines) {
    const t = line.trimStart()
    if (t.startsWith('```') || t.startsWith('~~~')) {
      fence = !fence
      ctx.push({ inFence: true, inBlockMath: false })
      continue
    }
    const inFence = fence
    // 行内成对的 $$（$$x^2$$）不改变跨行状态；奇数个 $$ 才翻转
    const pairs = (line.match(/\$\$/g) || []).length
    const wasInside = blockMath
    if (pairs % 2 !== 0) blockMath = !blockMath
    // 本行属于公式区：行首已在块内，或本行出现了任何 $$ 定界
    ctx.push({ inFence, inBlockMath: wasInside || pairs > 0 })
  }
  return ctx
}

function removeCodeSpans(line: string): string {
  const n = (line.match(/`/g) || []).length
  if (n === 0 || n % 2 !== 0) return line
  return line.replace(/`[^`]*`/g, '')
}

/** 去掉行内的代码段与 $/$$ 公式段，只留普通文本（用于特征检测） */
function removeMathAndCode(line: string): string {
  return removeCodeSpans(line)
    .replace(/\$\$[^$]*\$\$/g, '')
    .replace(/\$[^$\n]+\$/g, '')
}

// ─── 修复报告收集 ────────────────────────────────────────────────────────────

class FixCollector {
  private map = new Map<string, AiWordFix>()

  add(category: AiWordFixCategory, label: string, line: number) {
    const key = `${category}:${label}`
    const cur = this.map.get(key)
    if (cur) {
      cur.count++
      if (cur.exampleLines.length < 3 && !cur.exampleLines.includes(line)) cur.exampleLines.push(line)
    } else {
      this.map.set(key, { category, label, count: 1, exampleLines: [line] })
    }
  }

  list(): AiWordFix[] {
    return [...this.map.values()]
  }
}

// ─── 1. 公式断层 ─────────────────────────────────────────────────────────────

/** Unicode 数学符号 → LaTeX（Word 线性公式 / 网页复制残留的常见集合） */
const MATH_SYMBOL_MAP: Record<string, string> = {
  '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint',
  '√': '\\sqrt', '∞': '\\infty', '∂': '\\partial', '∇': '\\nabla',
  'π': '\\pi', 'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
  'Δ': '\\Delta', 'ε': '\\epsilon', 'θ': '\\theta', 'λ': '\\lambda', 'μ': '\\mu',
  'σ': '\\sigma', 'φ': '\\phi', 'ω': '\\omega', 'Ω': '\\Omega', 'Γ': '\\Gamma',
  '≤': '\\le', '≥': '\\ge', '≠': '\\ne', '≈': '\\approx', '≡': '\\equiv',
  '±': '\\pm', '∓': '\\mp', '×': '\\times', '÷': '\\div', '⋅': '\\cdot',
  '∝': '\\propto', '∈': '\\in', '∉': '\\notin', '⊂': '\\subset', '⊆': '\\subseteq',
  '∪': '\\cup', '∩': '\\cap', '∅': '\\emptyset', '∀': '\\forall', '∃': '\\exists',
  '→': '\\to', '←': '\\leftarrow', '⇒': '\\Rightarrow', '⇐': '\\Leftarrow',
  '⇔': '\\Leftrightarrow', '∘': '\\circ', '′': "'", '″': "''", '⋯': '\\cdots',
}

/**
 * Word 线性公式特征：▒ 分隔符（U+2592，Word 公式复制为文本的标志）、
 * _(...) 与 ^(...) 括号参数（Word 线性格式的上下标写法）。
 */
const WORD_LINEAR_MARK_RE = /▒|_\(|\^\(/

/** 裸 LaTeX 环境名（复制时 $$ 被剥掉的常见形态） */
const LATEX_ENV_RE = /^(aligned|align|cases|pmatrix|bmatrix|vmatrix|matrix|array|gathered|split|Bmatrix|Vmatrix|smallmatrix)/

/**
 * Word 线性公式 → LaTeX：
 *   ∑_(i=1)^n▒x_i  →  \sum_{i=1}^{n} x_i
 *   (x+1)^(2)      →  (x+1)^{2}
 */
function wordLinearToLatex(line: string): string {
  let s = line.replace(/▒/g, ' ')
  // _(a+b) → _{a+b}，^(2) → ^{2}（跑两遍处理一层嵌套）
  for (let i = 0; i < 2; i++) {
    s = s.replace(/_\(([^()]*)\)/g, '_{$1}')
    s = s.replace(/\^\(([^()]*)\)/g, '^{$1}')
  }
  // Unicode 数学符号 → LaTeX 命令（映射表键均为符号，不会误伤字母/数字）。
  // 命令后紧跟字母时补空格，避免 \pi + r 粘成未知命令 \pir
  const chars = [...s]
  let out = ''
  for (let i = 0; i < chars.length; i++) {
    const mapped = MATH_SYMBOL_MAP[chars[i]]
    if (mapped === undefined) {
      out += chars[i]
      continue
    }
    const next = chars[i + 1] ?? ''
    out += /[a-zA-Z]/.test(next) && /[a-zA-Z]$/.test(mapped) ? `${mapped} ` : mapped
  }
  return out
}

/** 公式断层修复：定界符转换 + Word 线性公式 + 裸环境包裹 */
function fixMathIssues(lines: string[], fixes: FixCollector): string[] {
  const out = [...lines]
  let ctx = buildLineContext(out)

  // 1a. \( \) \[ \] → $ / $$（对话界面常见的定界符风格，公式管线只认 $）。
  // 注意：replace 的替换串里 $ 有特殊含义，必须用函数替换
  for (let i = 0; i < out.length; i++) {
    if (ctx[i].inFence) continue
    let line = out[i]
    let changed = false
    if (line.includes('\\(') && line.includes('\\)')) {
      line = line.replace(/\\\(/g, () => '$').replace(/\\\)/g, () => '$')
      fixes.add('math', 'LaTeX 定界符转换：\\(…\\) → $…$', i + 1)
      changed = true
    }
    const bracketOpen = line.includes('\\[')
    const bracketClose = line.includes('\\]')
    if (bracketOpen && bracketClose) {
      // 同行成对：\[…\] → $$…$$（函数替换返回的是字面量，不会触发 $ 模式）
      line = line.replace(/\\\[/g, () => '$$').replace(/\\\]/g, () => '$$')
      fixes.add('math', 'LaTeX 定界符转换：\\[…\\] → $$…$$', i + 1)
      changed = true
    } else if (bracketOpen !== bracketClose && line.trim().match(/^\\(\[|\])$/)) {
      // 跨行定界：独立成行的 \[ 或 \] → $$
      line = '$$'
      fixes.add('math', 'LaTeX 定界符转换：\\[…\\] → $$…$$', i + 1)
      changed = true
    }
    if (changed) out[i] = line
  }
  ctx = buildLineContext(out)

  // 1b. Word 线性公式 → LaTeX（仅限 ▒ / _() / ^() 高置信特征行）
  //   纯公式行（无中文）→ 整行转 $$ 块公式；
  //   中文句内嵌公式（最常见场景）→ 按非中文片段转换并局部包裹 $…$，
  //   保证句子保留、公式能进 OMML 管线。
  const NON_CJK_RUN_RE = /[^\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u201c\u201d\u2018\u2019]+/g
  for (let i = 0; i < out.length; i++) {
    if (ctx[i].inFence || ctx[i].inBlockMath) continue
    const bare = removeMathAndCode(out[i])
    if (!WORD_LINEAR_MARK_RE.test(bare)) continue

    if (!/[\u4e00-\u9fff]/.test(out[i])) {
      const converted = wordLinearToLatex(bare).trim()
      if (converted) {
        out[i] = converted.startsWith('$$') ? converted : `$$${converted}$$`
        fixes.add('math', 'Word 线性公式转 LaTeX（∑_(i=1)^n▒x_i 形态）', i + 1)
      }
    } else {
      let changed = false
      const newLine = out[i].replace(NON_CJK_RUN_RE, (seg) => {
        if (!WORD_LINEAR_MARK_RE.test(seg)) return seg
        const converted = wordLinearToLatex(seg).trim()
        if (!converted) return seg
        changed = true
        return `$${converted}$`
      })
      if (changed) {
        out[i] = newLine
        fixes.add('math', 'Word 线性公式转 LaTeX（∑_(i=1)^n▒x_i 形态）', i + 1)
      }
    }
  }
  ctx = buildLineContext(out)

  // 1c. 裸 \begin{env}…\end{env} 包裹 $$（不在公式/围栏内时）
  for (let i = 0; i < out.length; i++) {
    if (ctx[i].inFence || ctx[i].inBlockMath) continue
    const m = out[i].trim().match(/^\\begin\{([a-zA-Z*]+)\}/)
    if (!m || !LATEX_ENV_RE.test(m[1])) continue
    let j = i
    while (j < out.length && !new RegExp(`\\\\end\\{${m[1]}\\}`).test(out[j])) j++
    if (j >= out.length) continue
    const before = i > 0 ? out[i - 1].trim() : ''
    const after = j + 1 < out.length ? out[j + 1].trim() : ''
    if (before === '$$' && after === '$$') continue
    // 插入 $$ 定界（先尾后头，避免索引位移）
    out.splice(j + 1, 0, '$$')
    out.splice(i, 0, '$$')
    fixes.add('math', '裸公式环境包裹 $$（\\begin{cases}…\\end{cases} 形态）', i + 1)
    ctx = buildLineContext(out)
    i = j + 2 // 跳过已处理的环境块（含插入的 $$）
  }
  return out
}

// ─── 2. 图表断层：Mermaid 围栏重建 ───────────────────────────────────────────

const MERMAID_HEADER_RE = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap|journey|gitGraph|requirementDiagram)\b/i
const MERMAID_ARROW_RE = /-->|-\.->|==>|->>|-{3,}|─{2,}>/

function isTableOrListLine(line: string): boolean {
  const t = line.trimStart()
  return t.startsWith('|') || /^\d+\.\s/.test(t) || /^[-*+]\s/.test(t) || t.startsWith('#')
}

/** 孤儿图表语法（围栏被对话界面复制剥掉）→ 重建 ```mermaid 围栏 */
function fixMermaidFences(lines: string[], ctx: LineContext[], fixes: FixCollector): string[] {
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    if (ctx[i].inFence) {
      out.push(lines[i])
      i++
      continue
    }
    // 收集连续的疑似图表行
    let j = i
    while (j < lines.length && !ctx[j].inFence && !isTableOrListLine(lines[j]) &&
           (MERMAID_HEADER_RE.test(lines[j].trim()) || MERMAID_ARROW_RE.test(lines[j]))) {
      j++
    }
    const runLen = j - i
    const first = lines[i]?.trim() ?? ''
    // 高置信：首行是图表类型声明且 ≥2 行；或 ≥3 行连续箭头语法
    const headerHit = MERMAID_HEADER_RE.test(first) && runLen >= 2
    const arrowHit = runLen >= 3 && lines.slice(i, j).filter((l) => MERMAID_ARROW_RE.test(l)).length >= 2
    if (headerHit || arrowHit) {
      out.push('```mermaid')
      for (let k = i; k < j; k++) out.push(lines[k])
      out.push('```')
      fixes.add('chart', `重建 Mermaid 围栏（${runLen} 行图表语法）`, i + 1)
      i = j
    } else {
      out.push(lines[i])
      i++
    }
  }
  return out
}

// ─── 3. 结构污染清理 ─────────────────────────────────────────────────────────

function cleanSymbols(line: string, fixes: FixCollector, lineNo: number): string {
  let s = line
  // 零宽字符与软连字符
  const zw = (s.match(/[\u200B\u200C\u200D\uFEFF\u00AD]/g) || []).length
  if (zw > 0) {
    s = s.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '')
    fixes.add('structure', '清理零宽字符 / 软连字符', lineNo)
  }
  // 不换行空格
  const nbsp = (s.match(/\u00A0/g) || []).length
  if (nbsp > 0) {
    s = s.replace(/\u00A0/g, ' ')
    fixes.add('structure', '不换行空格（NBSP）转普通空格', lineNo)
  }
  // 全角字母/数字（ＡＢＣ１２３）→ 半角。全角标点（，。！？）是合法中文排版，不动
  let fwCount = 0
  s = [...s].map((ch) => {
    const code = ch.charCodeAt(0)
    const isFull = (code >= 0xff10 && code <= 0xff19) || (code >= 0xff21 && code <= 0xff3a) || (code >= 0xff41 && code <= 0xff5a)
    if (isFull) {
      fwCount++
      return String.fromCharCode(code - 0xfee0)
    }
    return ch
  }).join('')
  if (fwCount > 0) {
    fixes.add('structure', '全角字母/数字转半角（ＡＢＣ１２３ 形态）', lineNo)
  }
  return s
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 诊断并修复 AI 内容进入 Word 链路的格式断层。
 * 返回修复后的文本与按类别聚合的修复报告（供弹窗展示）。
 */
export function fixAiWordContent(text: string, options: AiWordFixOptions = DEFAULT_AI_WORD_FIX_OPTIONS): AiWordFixResult {
  const fixes = new FixCollector()
  if (!text) return { fixed: text, fixes: fixes.list() }

  let lines = text.split('\n')
  let ctx = buildLineContext(lines)

  // 1. 公式断层
  if (options.math) {
    lines = fixMathIssues(lines, fixes)
    ctx = buildLineContext(lines)
  }

  // 2. 图表断层
  if (options.chart) {
    lines = fixMermaidFences(lines, ctx, fixes)
    ctx = buildLineContext(lines)
  }

  // 3. 结构污染（围栏内不动 —— 代码里的零宽字符可能是有意的）
  if (options.structure) {
    for (let i = 0; i < lines.length; i++) {
      if (ctx[i].inFence) continue
      lines[i] = cleanSymbols(lines[i], fixes, i + 1)
    }
  }

  return { fixed: lines.join('\n'), fixes: fixes.list() }
}

/**
 * 诊断模式：只统计问题，不修改内容（弹窗先展示"发现了什么"）。
 * 与修复共用同一套逻辑，保证诊断结果与修复结果一致。
 */
export function analyzeAiWordProblems(text: string): AiWordFix[] {
  return fixAiWordContent(text, DEFAULT_AI_WORD_FIX_OPTIONS).fixes
}

/**
 * 公式就绪度：修复后公式能否被导出管线（$/$$ → OMML）识别。
 * convertible = 可识别公式数；suspiciousLines = 疑似仍为纯文本公式的行数。
 */
export function formulaReadiness(text: string): { convertible: number; suspiciousLines: number } {
  const convertible = extractFormulas(text).length
  let suspiciousLines = 0
  const lines = text.split('\n')
  const ctx = buildLineContext(lines)
  for (let i = 0; i < lines.length; i++) {
    if (ctx[i].inFence || ctx[i].inBlockMath) continue
    const bare = removeMathAndCode(lines[i])
    if (WORD_LINEAR_MARK_RE.test(bare)) suspiciousLines++
  }
  return { convertible, suspiciousLines }
}
