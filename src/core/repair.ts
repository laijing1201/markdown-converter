/**
 * AI Markdown 自动修复 —— 针对 ChatGPT / DeepSeek 等输出中最常见的格式破损：
 *   - 未闭合的 ``` 代码块 / $$ 公式块 / $ 行内公式 / ** 粗体 / ` 行内代码
 *   - 标题 # 后缺少空格（"#标题"）
 *   - 表格行缺少末尾 | 或缺失单元格
 *
 * 设计为纯函数：粘贴片段和整篇文档都可以直接喂进来。
 * 安全规则（回归保护）：合法内容绝不能被"修复"破坏 ——
 *   1. $$ 公式块内部的行原样保留（合法 LaTeX 不补 $ 不补 **）；
 *   2. 行内 $ 补全只在行内出现公式特征（^、_、\frac 等）时触发，
 *      「请支付 $100」这类货币文本不动；
 *   3. 表格修复覆盖「表头+分隔行+表体」的完整形态，分隔行不切断扫描。
 */

export interface RepairFix {
  line: number
  message: string
}

export interface RepairResult {
  fixed: string
  fixes: RepairFix[]
}

/** 行内公式特征：出现这些记号时，奇数个 $ 才大概率是漏闭合的公式而非货币符号 */
const MATH_SIGNAL = /\\frac|\\int|\\sum|\\sqrt|\\times|\\left|\\right|\\begin\{|\\end\{|\\alpha|\\beta|\\gamma|\\delta|\\pi|\\mu|\\lambda|\\omega|\^|_/

/** 移除完整的行内代码 `...`（反引号数为偶时才可靠） */
function removeCodeSpans(line: string): string {
  const n = (line.match(/`/g) || []).length
  if (n === 0 || n % 2 !== 0) return line
  return line.replace(/`[^`]*`/g, '')
}

/** 移除单行内成对的 $$...$$ */
function removeBlockMath(line: string): string {
  return line.replace(/\$\$[^$]*\$\$/g, '')
}

/** 统计未被 \ 转义的 $ 数量 */
function countDollars(line: string): number {
  let count = 0
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '$' && line[i - 1] !== '\\') count++
  }
  return count
}

/** 是否是表格行（以 | 开头且不是分隔行） */
function isTableRow(line: string): boolean {
  const t = line.trim()
  if (!t.startsWith('|') || t.length < 2) return false
  // 分隔行 |---|:--:| 等，保持原样
  if (/^[\s|:\-]+$/.test(t)) return false
  return true
}

/** 是否是表格分隔行（|---|:--:| 形态；独立的 --- 水平线不算） */
function isSeparatorRow(line: string): boolean {
  const t = line.trim()
  return t.startsWith('|') && t.length >= 3 && /^[\s|:\-]+$/.test(t)
}

/** 一行表格的单元格数 */
function tableCellCount(line: string): number {
  const t = line.trim()
  const parts = t.split('|')
  return t.endsWith('|') ? parts.length - 2 : parts.length - 1
}

export function repairAiMarkdown(text: string): RepairResult {
  const fixes: RepairFix[] = []
  if (!text) return { fixed: text, fixes }

  const lines = text.split('\n')
  let inFence = false
  let inBlockMath = false
  let blockMathTokens = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmedStart = lines[i].trimStart()
    if (trimmedStart.startsWith('```') || trimmedStart.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    // $$ 块状态跟踪：奇数个定界符切换进出块
    const mathDelims = (lines[i].match(/\$\$/g) || []).length
    blockMathTokens += mathDelims
    if (mathDelims % 2 !== 0) inBlockMath = !inBlockMath
    // 公式块内部行：原样保留（合法 LaTeX 不补 $、不补 **、不补 `）
    if (inBlockMath && mathDelims === 0) continue

    let line = lines[i]

    // 1. 标题 # 后缺空格："#标题" → "# 标题"
    const heading = line.match(/^(\s*#{1,6})([^#\s].*)$/)
    if (heading) {
      line = `${heading[1]} ${heading[2]}`
      fixes.push({ line: i + 1, message: '标题 # 后缺少空格' })
    }

    // 2. 未闭合的行内代码
    if ((line.match(/`/g) || []).length % 2 !== 0) {
      line = `${line}\``
      fixes.push({ line: i + 1, message: '补全未闭合的行内代码 ` ' })
    }

    // 3. 未闭合的粗体
    const boldCount = (removeCodeSpans(line).match(/\*\*/g) || []).length
    if (boldCount % 2 !== 0) {
      line = `${line}**`
      fixes.push({ line: i + 1, message: '补全未闭合的粗体 ** ' })
    }

    // 4. 未闭合的行内公式：仅当行内带公式特征时才补，
    //    避免把「请支付 $100」这类货币文本改坏成 $100$
    const mathish = removeBlockMath(removeCodeSpans(line))
    const dollars = countDollars(mathish)
    if (dollars % 2 !== 0 && MATH_SIGNAL.test(mathish)) {
      line = `${line}$`
      fixes.push({ line: i + 1, message: '补全未闭合的行内公式 $ ' })
    }

    lines[i] = line
  }

  // 5. 表格修复：补末尾 | 与缺失单元格（分隔行在扫描中穿越不切断；
  //    表头列数以分隔行之前一行为基准，覆盖「表头+分隔行+单行表体」最常见形态）
  let i = 0
  while (i < lines.length) {
    if (!isTableRow(lines[i]) && !isSeparatorRow(lines[i])) {
      i++
      continue
    }
    let j = i
    while (j + 1 < lines.length && (isTableRow(lines[j + 1]) || isSeparatorRow(lines[j + 1]))) j++

    const contentIdx: number[] = []
    let sepIdx = -1
    for (let k = i; k <= j; k++) {
      if (isSeparatorRow(lines[k])) {
        if (sepIdx < 0) sepIdx = k
      } else {
        contentIdx.push(k)
      }
    }
    // 有分隔行的完整表格：≥1 行表体都修；无分隔行的裸行组保持旧行为（≥2 行才视为表格）
    if ((sepIdx >= 0 && contentIdx.length >= 1) || (sepIdx < 0 && contentIdx.length >= 2)) {
      const beforeSep = sepIdx >= 0 ? contentIdx.filter((k) => k < sepIdx) : []
      const headerLine = lines[beforeSep.length > 0 ? beforeSep[beforeSep.length - 1] : contentIdx[0]]
      const headerCount = tableCellCount(headerLine)
      for (const k of contentIdx) {
        let t = lines[k].trimEnd()
        let changed = false
        if (!t.trim().endsWith('|')) {
          t = `${t} |`
          fixes.push({ line: k + 1, message: '表格行补全末尾的 |' })
          changed = true
        }
        let cells = tableCellCount(t)
        if (cells < headerCount) {
          while (cells < headerCount) {
            t = t.replace(/\|\s*$/, '| |')
            cells++
          }
          fixes.push({ line: k + 1, message: '表格行补全缺失的空单元格' })
          changed = true
        }
        if (changed) lines[k] = t
      }
    }
    i = j + 1
  }

  // 6. 未闭合的公式块（代码块未闭合时不动，避免把 $$ 修进代码里）
  if (blockMathTokens % 2 !== 0) {
    lines.push('$$')
    fixes.push({ line: lines.length, message: '补全未闭合的公式块 $$ ' })
  }

  // 7. 未闭合的代码块
  if (inFence) {
    lines.push('```')
    fixes.push({ line: lines.length, message: '补全未闭合的代码块 ``` ' })
  }

  return { fixed: lines.join('\n'), fixes }
}
