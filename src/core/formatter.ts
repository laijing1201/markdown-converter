/**
 * 全能型智能排版引擎 (Full-Featured Intelligent Structuring Engine)
 * 包含多级标题推断、表格生成、PDF断行缝合（含连字符还原）、页眉页脚剔除、
 * 引用/代码/链接推断、任务清单、ASCII 框线表格还原、Setext 标题、
 * 全半角与中英文排版美化等。
 *
 * 安全规则（回归保护）：已经是合法 Markdown 的内容绝不能被"智能"破坏 ——
 *   1. ``` 代码围栏内的任何行保持原样（不缝合、不改标点、不推结构、不折叠空行）；
 *   2. 以 | 开头的 Markdown 表格行保持原样（不会被段落缝合吞掉；缺分隔线的
 *      连续表格行会补一条分隔线，其余不动）；
 *   3. 标准有序列表（"1. 内容"）与无序列表行不做标题推断、不加粗序号；
 *   4. 行内代码 / 链接 / 图片 / 裸 URL 内部不做任何排版替换；
 *   5. 引用定义行（"[1]: https://..."）原样保留，不做裸链接包裹。
 */

// ─── 基础正则 ────────────────────────────────────────────────────────────────
const REGEX_MD_TABLE_ROW = /^\s*\|.*\|?\s*$/
const REGEX_MD_SEPARATOR_ROW = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/
const REGEX_MD_ORDERED_LIST = /^\s*\d+\.\s+/
const REGEX_MD_UNORDERED_LIST = /^\s*[-*+]\s+/
const REGEX_MD_REF_DEF = /^\s*\[[^\]]+\]:\s*\S/

/** 独立页码：1 / - 3 - / Page 3 / Page 3 of 10 / 3 of 10 */
const REGEX_PAGE_NUMBER = /^\s*(-?\s*(page)?\s*\d+\s*(of\s*\d+)?\s*-?)\s*$/i
/** 中文页码与「Page 3/10」变体：第 3 页 / 第3页 共12页 / 共 12 页 / Page 3/10 */
const REGEX_PAGE_NUMBER_EXTRA =
  /^\s*[-–—=_*·•\s]*(?:第\s*\d+\s*页(?:\s*[,，/／共]\s*(?:共\s*)?\d+\s*页?)?|共\s*\d+\s*页|page\s*\d+\s*[/／ofx×]\s*\d+)\s*$/i

/** 零宽与软连字符等不可见杂质 */
const REGEX_INVISIBLE = /[\u200B\u200C\u200D\uFEFF\u00AD]/g

/** 需要被排版步骤保护的行内片段：行内代码 / 链接 / 图片 / 自动链接 / HTML 标签 / 裸 URL */
// eslint-disable-next-line no-useless-escape
const REGEX_PROTECTED_SPAN =
  /(`[^`]*`|!\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\([^)]*\)|<https?:\/\/[^>]+>|<[^>\s]+>|https?:\/\/[^\s<>"'\u4e00-\u9fa5，。；：！？）】》」』、…—–·]+|www\.[^\s<>"'\u4e00-\u9fa5，。；：！？）】》」』、…—–·]+)/g

/** 裸 URL 自动链接（排除已在 () <> "" [] = 上下文中的 URL） */
const REGEX_NAKED_URL =
  /(?<![\(<"'\[=\\])(?:https?:\/\/[^\s<>"'\u4e00-\u9fa5，。；：！？）】》」』、…—–·]+|www\.[^\s<>"'\u4e00-\u9fa5，。；：！？）】》」』、…—–·]+)/g

// ─── 列表符号 ────────────────────────────────────────────────────────────────
/** 可统一为 "-" 的项目符号（PDF 提取常见：• · Ø ‣ ▪ ◦ ● ○ ► ➢ 短横线） */
const REGEX_BULLET = /^\s*([•·Ø*‣▪◦●○►➢‒–])\s+/
const REGEX_BULLET_START = /^[•·Ø*‣▪◦●○►➢‒–]/

/** 任务清单符号：□ ☐ ✗ ✘ 待办；☑ ✓ ✔ 已完成 */
const REGEX_CHECKBOX = /^\s*(\[x\]|\[X\]|\[ \]|☑|✓|✔|☐|□|✗|✘)(\s+|$)/
const CHECKED_MARKS = new Set(['[x]', '[X]', '☑', '✓', '✔'])

// ─── 标题候选 ────────────────────────────────────────────────────────────────
/** 论文章节关键词（精确整行匹配；忽略字间空白与全半角冒号） */
const KEYWORD_HEADINGS = [
  '摘要', 'abstract', '关键词', 'keywords', 'key words', '目录', 'contents',
  '引言', '绪论', '前言', '背景', '研究背景', '问题提出', '问题重述',
  '相关工作', '文献综述', '理论基础', '研究方法', '方法', '材料与方法', '方法与材料',
  '实验', '实验设计', '实验结果', '结果', '结果与分析', '结果与讨论', '分析', '讨论',
  '模型构建', '数据来源', '评价指标', '结论', '研究结论', '总结', '结论与展望',
  '总结与展望', '展望', '局限与展望', '研究局限', '政策建议', '对策建议', '结语',
  '参考文献', 'references', 'bibliography', '致谢', 'acknowledgments', 'acknowledgements',
  '附录', 'appendix',
]

/** 全大写英文短行（如 INTRODUCTION / CONCLUSION AND FUTURE WORK） */
const REGEX_CAPS_HEADING = /^[A-Z][A-Z0-9\s&,'.\-]{2,59}$/

/** 罗马数字编号（I. / II. / IV. …，后接大写或中文才认） */
const REGEX_ROMAN_HEADING = /^(?=[IVX]+\.)[IVX]{1,6}\.(?=\s+[A-Z\u4e00-\u9fa5])\s*/
/** 英文章节词（Chapter 1 / Section 2.3） */
const REGEX_EN_SECTION = /^((?:chapter|part)\s+\d+|(?:section|subsection)\s+\d+(?:\.\d+)?)\s*/i

/** 引用块引导词（注意：/ 警告：/ Warning: …） */
const REGEX_QUOTE = /^(注意|提示|警告|重要|备注|风险|安全|示例|说明|摘要|Note|Tip|Warning|Caution|Important|Example)[:：]\s*/i

interface HeadingPrefix {
  prefix: string
  level: number
  prefixType: string
}

/** 判断一行（已 trimStart）是否为编号式标题候选，返回命中的前缀 */
function headingPrefixOf(trimmed: string): HeadingPrefix | null {
  const chapMatch = trimmed.match(/^第[一二三四五六七八九十百千万0-9]+[章节篇部分]\s*/)
  if (chapMatch) return { prefix: chapMatch[0], level: 2, prefixType: 'chap' }
  const enSecMatch = trimmed.match(REGEX_EN_SECTION)
  if (enSecMatch) {
    return { prefix: enSecMatch[0], level: /^section/i.test(enSecMatch[0]) ? 3 : 2, prefixType: 'ensec' }
  }
  const zhMatch = trimmed.match(/^[一二三四五六七八九十]+、\s*/)
  if (zhMatch) return { prefix: zhMatch[0], level: 3, prefixType: 'zh' }
  const romanMatch = trimmed.match(REGEX_ROMAN_HEADING)
  if (romanMatch) return { prefix: romanMatch[0], level: 3, prefixType: 'roman' }
  const dot3Match = trimmed.match(/^[0-9]+\.[0-9]+\.[0-9]+(\s+|$)/)
  if (dot3Match) return { prefix: dot3Match[0], level: 4, prefixType: 'dot3' }
  const dot2Match = trimmed.match(/^[0-9]+\.[0-9]+(\s+|$)/)
  if (dot2Match) return { prefix: dot2Match[0], level: 3, prefixType: 'dot2' }
  // 无空格的中文序号（"1.第一点"）—— PDF 提取高频形态
  const dot1cMatch = trimmed.match(/^[0-9]+\.(?=[\u4e00-\u9fa5（「【])/)
  if (dot1cMatch) return { prefix: dot1cMatch[0], level: 2, prefixType: 'dot1' }
  const dot1Match = trimmed.match(/^[0-9]+\.(\s+|$)/)
  if (dot1Match) return { prefix: dot1Match[0], level: 2, prefixType: 'dot1' }
  const bracketMatch = trimmed.match(/^(\([0-9]+\)|[0-9]+\)|（[一二三四五六七八九十0-9]+）|\([一二三四五六七八九十0-9]+\))\s*/)
  if (bracketMatch) return { prefix: bracketMatch[0], level: 0, prefixType: 'bracket' }
  return null
}

/** 精确章节关键词（整行），返回关键词本体（去行尾冒号、折叠字间空白如「摘  要」→「摘要」） */
function keywordHeadingOf(trimmed: string): string | null {
  const bare = trimmed.replace(/[:：]\s*$/, '').replace(/[\s\u3000]+/g, '')
  if (!bare) return null
  const low = bare.toLowerCase()
  for (const kw of KEYWORD_HEADINGS) {
    if (low === kw) return bare
  }
  // 附录 A / Appendix B（允许尾部编号）
  const m = bare.match(/^(?:附录|appendix|appendices)([A-Za-z0-9]{1,4})$/i)
  if (m) return `${bare.slice(0, bare.length - m[1].length)} ${m[1]}`
  return null
}

/** 全大写英文短行标题（INTRODUCTION / CONCLUSION AND FUTURE WORK） */
function capsHeadingOf(trimmed: string): boolean {
  if (!REGEX_CAPS_HEADING.test(trimmed) || trimmed.length < 3) return false
  // 过滤孤立缩略词（PDF / IEEE 单独成行多为机构署名）：需 ≥6 字符或含空格
  if (trimmed.length < 6 && !/\s/.test(trimmed)) return false
  return /[A-Z]/.test(trimmed.slice(1))
}

// ─── 断行缝合辅助 ────────────────────────────────────────────────────────────
/** 行首标记：这些行绝不参与缝合（标题/列表/引用/表格/代码/公式/Setext 边界） */
function joinBlocked(trimmed: string): boolean {
  if (!trimmed) return true
  if (/^[#>*|+=—―]/.test(trimmed)) return true
  if (REGEX_BULLET_START.test(trimmed)) return true
  if (REGEX_CHECKBOX.test(trimmed)) return true
  if (/^\d{1,3}[.、)）](\s|$)/.test(trimmed)) return true
  if (/^\[\d+\]/.test(trimmed)) return true
  if (/^\([0-9一二三四五六七八九十]+\)/.test(trimmed)) return true
  if (/^（[0-9一二三四五六七八九十]+）/.test(trimmed)) return true
  if (/^({|}|\[|\]|```|import |from |def |class |function |console\.|print\(|<|\/\/|\/\*|#!|\$\$|\\\(|\\\[)/.test(trimmed)) return true
  if (REGEX_SHELL_CMD.test(trimmed)) return true
  // 编号式标题 / 章节关键词 / 全大写标题：不与上下文缝合
  if (headingPrefixOf(trimmed) || keywordHeadingOf(trimmed) || capsHeadingOf(trimmed)) return true
  return false
}

/** 拼接两行：中文侧直连（盘古之白由排版步骤补）；英文侧补空格；行尾连字符智能还原 */
function joinLines(buf: string, next: string): string {
  // PDF 断词还原：communi- / cation → communication（过短前缀如 e- / mail 保留连字符直连）
  if (/[a-zA-Z]-$/.test(buf) && /^[a-z]/.test(next)) {
    const stem = buf.replace(/-$/, '')
    return /[a-zA-Z]{3,}$/.test(stem) ? stem + next : buf + next
  }
  // 任一端是中文/全角标点 → 直连，避免插入多余空格
  if (/[\u4e00-\u9fa5，。、；：！？…）】》」』\]]$/.test(buf) || /^[\u4e00-\u9fa5]/.test(next)) return buf + next
  return buf + ' ' + next
}

/** 行尾是否为收束标点（收到这里就不再向后缝合） */
function endsSentence(buf: string): boolean {
  return /[。！？：；.!?:…]$/.test(buf)
}

// ─── 代码块探测辅助 ──────────────────────────────────────────────────────────
const REGEX_SHELL_CMD =
  /^(\$\s+\S|\s{0,4}(npm|npx|yarn|pnpm|pip3?|python3?|node|git|docker|kubectl|curl|wget|sudo|apt(?:-get)?|brew|cargo)\s+[a-zA-Z])/

// ─── ASCII 框线表格（+---+---+ | a | b |）───
const REGEX_ASCII_BORDER = /^\s*\+[-=]{2,}\+(?:[-=]{2,}\+)+\s*$/
const REGEX_GRID_CONTENT = /^\s*\|.*\|\s*$/

/** 分隔线（———、****、____、===、······ 等变体 → ---） */
function hrLineOf(line: string): boolean {
  return /^[ \t]*(?:[-*_—–─·＝=][ \t]*){3,}$/.test(line)
}

/** 把 ASCII 表格行段还原为 Markdown 表格；不构成表格（内容行 < 2 或无框线）时返回 null */
function asciiTableRows(rows: string[]): string[] | null {
  const content = rows.filter((r) => REGEX_GRID_CONTENT.test(r))
  if (content.length < 2 || content.length === rows.length) return null
  const grid = content.map((r) =>
    r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()),
  )
  const cols = Math.max(...grid.map((g) => g.length))
  const out: string[] = []
  for (let i = 0; i < grid.length; i++) {
    const cells = grid[i]
    while (cells.length < cols) cells.push('')
    out.push(`| ${cells.join(' | ')} |`)
    if (i === 0) out.push(`|${Array.from({ length: cols }, () => '---').join('|')}|`)
  }
  return out
}

/** 代码连续段扫描（def/import/console/print…）：遇空行、列表、引用、表格、正文句即止 */
function scanCodeRun(lines: string[], start: number, fence: boolean[]): number {
  let end = start
  for (let j = start + 1; j < Math.min(start + 20, lines.length); j++) {
    if (fence[j]) break
    const t = lines[j].trim()
    if (!t || /^[#>\-*\d|]/.test(t)) break
    // 中文正文句（以句号等收尾）不属于代码块
    if (/[\u4e00-\u9fa5]/.test(t) && /[。！？；]$/.test(t)) break
    end = j
  }
  return end > start ? end : -1
}

/**
 * 智能排版主入口：剔噪 → 缝合 → 探测 → 规范化 → 结构推断 → 输出。
 */
export function smartFormatText(text: string): string {
  if (!text) return ''

  // 0. 代码围栏状态：围栏内一切保持原样
  const rawAllLines = text.split('\n')
  const inFence: boolean[] = []
  let fenceOpen = false
  for (const line of rawAllLines) {
    if (line.trimStart().startsWith('```')) {
      inFence.push(true) // 围栏本身也保持原样
      fenceOpen = !fenceOpen
      continue
    }
    inFence.push(fenceOpen)
  }

  // 1a. 页眉页脚剔除（独立页码 + 中英文页码变体；围栏内不剔除）
  const step1: string[] = []
  const fence1: boolean[] = []
  for (let i = 0; i < rawAllLines.length; i++) {
    const isNoise = !inFence[i] && (REGEX_PAGE_NUMBER.test(rawAllLines[i]) || REGEX_PAGE_NUMBER_EXTRA.test(rawAllLines[i]))
    if (!isNoise) {
      step1.push(rawAllLines[i])
      fence1.push(inFence[i])
    }
  }

  // 1b. 重复页眉/页脚剔除：同一短行出现 ≥3 次视为版式重复（要求文档足够长，避免误伤短文）。
  //     三重安全阀（防数据丢失）：① 全文去重后仍有 ≥10 个不同行（真正 repetitive
  //     的正文不当页眉删）；② 可剔除行占非空行比例 ≤15%（真实页眉每页一条约 1~5%）；
  //     ③ 剔除后必须还剩内容——绝不整篇删光。
  {
    const counts = new Map<string, number>()
    for (let i = 0; i < step1.length; i++) {
      if (fence1[i]) continue
      const t = step1[i].trim()
      if (t.length >= 2 && t.length <= 60 && /[\u4e00-\u9fa5a-zA-Z]/.test(t)) {
        counts.set(t, (counts.get(t) ?? 0) + 1)
      }
    }
    const repeated = new Set([...counts.entries()].filter(([, n]) => n >= 3).map(([t]) => t))
    if (repeated.size > 0 && step1.length >= 30) {
      const nonBlankTotal = step1.filter((l) => l.trim()).length
      const distinct = new Set(step1.filter((l) => l.trim()).map((l) => l.trim())).size
      if (distinct >= 10) {
        const removableIdx: number[] = []
        for (let i = 0; i < step1.length; i++) {
          if (fence1[i]) continue
          const t = step1[i].trim()
          // 列表 / 引用 / 表格 / 标题起始行绝不剔除
          if (repeated.has(t) && !/^[#>*|+\-]/.test(t)) removableIdx.push(i)
        }
        if (
          removableIdx.length > 0 &&
          removableIdx.length < nonBlankTotal &&
          removableIdx.length / nonBlankTotal <= 0.15
        ) {
          for (let k = removableIdx.length - 1; k >= 0; k--) {
            const idx = removableIdx[k]
            step1.splice(idx, 1)
            fence1.splice(idx, 1)
          }
        }
      }
    }
  }

  // 2. Smart Paragraph Joining (PDF断行智能缝合：中文直连 / 英文补空格 / 连字符还原)
  const joinedLines: string[] = []
  for (let i = 0; i < step1.length; i++) {
    const currentLine = step1[i].trimEnd()
    if (!currentLine) {
      joinedLines.push('')
      continue
    }
    // 围栏内行原样保留
    if (fence1[i]) {
      joinedLines.push(step1[i])
      continue
    }

    if (joinBlocked(currentLine.trimStart())) {
      joinedLines.push(currentLine)
      continue
    }

    let buf = currentLine
    while (i + 1 < step1.length) {
      const nextRaw = step1[i + 1]
      const nextLine = nextRaw.trimStart()
      if (!nextLine || fence1[i + 1] || joinBlocked(nextLine)) break
      if (endsSentence(buf)) break
      buf = joinLines(buf, nextRaw.trim())
      i++
    }
    joinedLines.push(buf)
  }

  // 3. Code Snippet Detection (代码片段探测：JSON / Python / JS / Shell) —— 跳过围栏内与表格行
  {
    let fence3 = computeFenceMap(joinedLines)
    const isTable = (l: string) => REGEX_MD_TABLE_ROW.test(l) || REGEX_MD_SEPARATOR_ROW.test(l)
    let iCode = 0
    while (iCode < joinedLines.length) {
      if (fence3[iCode] || isTable(joinedLines[iCode])) {
        iCode++
        continue
      }
      const line = joinedLines[iCode].trim()

      // 3a. JSON 对象/数组（以 { 或 [ 起，配对闭合）
      if (line === '{' || line === '[' || line.endsWith('{') || line.endsWith('[')) {
        const found = findBalancedBlock(joinedLines, iCode)
        if (found > iCode) {
          joinedLines.splice(found + 1, 0, '```')
          joinedLines.splice(iCode, 0, '```json')
          iCode = found + 3
          fence3 = computeFenceMap(joinedLines)
          continue
        }
      }

      // 3b. Python/JS 代码（def/import/from/class/function/console/print）
      const pyMatch = line.match(
        /^(def\s+[a-zA-Z_]|import\s+[a-zA-Z]|from\s+[a-zA-Z_.]+\s+import\s|class\s+[a-zA-Z]|function\s+[a-zA-Z]|console\.(?:log|error|warn|info|debug|table)\s*\(|print\s*\()/,
      )
      if (pyMatch) {
        const lang = /^console\./.test(pyMatch[0]) ? 'js' : 'python'
        const end = scanCodeRun(joinedLines, iCode, fence3)
        if (end > iCode) {
          joinedLines.splice(end + 1, 0, '```')
          joinedLines.splice(iCode, 0, '```' + lang)
          iCode = end + 3
          fence3 = computeFenceMap(joinedLines)
          continue
        }
      }

      // 3c. Shell 命令（"$ cmd" 单行即认；npm/pip/git 等需连续 ≥2 行，避免误伤正文）
      if (REGEX_SHELL_CMD.test(line)) {
        const dollar = /^\$\s/.test(line)
        let end = iCode
        for (let j = iCode + 1; j < Math.min(iCode + 20, joinedLines.length); j++) {
          const t = joinedLines[j].trim()
          if (!t || fence3[j] || isTable(joinedLines[j]) || /^[#>\-*\d]/.test(t)) break
          if (!REGEX_SHELL_CMD.test(t)) break
          end = j
        }
        if (end > iCode || dollar) {
          joinedLines.splice(end + 1, 0, '```')
          joinedLines.splice(iCode, 0, '```bash')
          iCode = end + 3
          fence3 = computeFenceMap(joinedLines)
          continue
        }
      }

      iCode++
    }
  }

  // 4. Typography Polish（中英文排版与标点规范化）—— 保护行内代码/链接/图片/URL
  const polishedLines = joinedLines.map((line) => {
    if (/^\s*```/.test(line) || REGEX_MD_TABLE_ROW.test(line) || REGEX_MD_SEPARATOR_ROW.test(line)) return line
    const polished = line
      .split(REGEX_PROTECTED_SPAN)
      .map((seg, idx) => (idx % 2 === 1 ? seg : polishSegment(seg)))
      .join('')
    // 行尾空白：保留恰好两个空格的硬换行，其余清除（段级做会把片段间空格误删）
    return polished.replace(/[ \t]+$/, (m) => (m.length >= 2 ? '  ' : ''))
  })

  // 5a. Setext 标题（文字行 + ===== 下划线 → # 标题）与分隔线变体（——— → ---）
  {
    const fence5 = computeFenceMap(polishedLines)
    const isPlain = (l: string, i: number) =>
      !!l.trim() && !fence5[i] && !REGEX_MD_TABLE_ROW.test(l) && !REGEX_MD_SEPARATOR_ROW.test(l) &&
      !REGEX_MD_ORDERED_LIST.test(l) && !REGEX_MD_UNORDERED_LIST.test(l) && !/^[#>]/.test(l.trimStart())
    for (let i = 0; i < polishedLines.length; i++) {
      const line = polishedLines[i]
      if (fence5[i] || !line.trim()) continue
      const prev = polishedLines[i - 1] ?? ''
      const next = polishedLines[i + 1] ?? ''
      if (/^\s*={2,}\s*$/.test(line)) {
        if (isPlain(prev, i - 1)) {
          polishedLines[i - 1] = `# ${prev.trim()}`
          polishedLines[i] = ''
        } else if (!prev.trim()) {
          polishedLines[i] = '---'
        }
        continue
      }
      if (hrLineOf(line) && (!prev.trim() || !next.trim())) {
        polishedLines[i] = '---'
      }
    }
  }

  // 5b. ASCII 框线表格还原（+---+---+ … | a | b | … → Markdown 表格）
  {
    const fence5b = computeFenceMap(polishedLines)
    let i = 0
    while (i < polishedLines.length) {
      const isGridRow = (l: string) => REGEX_ASCII_BORDER.test(l) || REGEX_GRID_CONTENT.test(l)
      if (fence5b[i] || !isGridRow(polishedLines[i])) {
        i++
        continue
      }
      let end = i
      while (end + 1 < polishedLines.length && !fence5b[end + 1] && isGridRow(polishedLines[end + 1])) end++
      const built = asciiTableRows(polishedLines.slice(i, end + 1))
      if (built) {
        polishedLines.splice(i, end - i + 1, ...built)
        i += built.length
      } else {
        i = end + 1
      }
    }
  }

  // 6. Structure Inference（多级标题、列表统一、任务清单、表格组装）
  const lines = polishedLines
  const result: string[] = []

  const fenceInStep6 = computeFenceMap(lines)

  const parsedLines = lines.map((line, idx) => {
    // 围栏内 / 已是 Markdown 表格行 / 分隔行 / 引用定义行：一律原样保留
    if (fenceInStep6[idx] || REGEX_MD_TABLE_ROW.test(line) || REGEX_MD_SEPARATOR_ROW.test(line) || REGEX_MD_REF_DEF.test(line)) {
      return { line, trimmed: line.trim(), indent: '', skip: true, type: 'raw' as const }
    }

    // 任务清单：□ ☐ ☑ ✓ ✗ → - [ ] / - [x]
    const cbMatch = line.match(REGEX_CHECKBOX)
    if (cbMatch) {
      const t = line.trimStart()
      const indent = line.substring(0, line.length - t.length)
      const checked = CHECKED_MARKS.has(cbMatch[1])
      const rest = t.substring(cbMatch[0].length)
      return { line: `${indent}- [${checked ? 'x' : ' '}] ${rest}`, trimmed: '', indent: '', skip: true as const, type: 'raw' as const }
    }

    // 项目符号统一（• · Ø ‣ ▪ ◦ ● ○ ► ➢ ‒ – → -）
    const bulletMatch = line.match(REGEX_BULLET)
    if (bulletMatch) {
      const t = line.trimStart()
      const indent = line.substring(0, line.length - t.length)
      return { line: `${indent}- ${t.substring(bulletMatch[0].length)}`, trimmed: '', indent: '', skip: true as const, type: 'raw' as const }
    }

    if (REGEX_MD_ORDERED_LIST.test(line) || REGEX_MD_UNORDERED_LIST.test(line)) {
      return { line, trimmed: line.trim(), indent: '', skip: true, type: 'raw' as const }
    }

    const trimmed = line.trimStart()
    const indent = line.substring(0, line.length - trimmed.length)
    const lineContent = line

    // 兼容已经被错误加粗的序号（例如 **1.**）
    let cleanTrimmed = trimmed
    const boldPrefixMatch = trimmed.match(/^\*\*([^\*]+)\*\*\s*/)
    if (boldPrefixMatch) {
      cleanTrimmed = boldPrefixMatch[1] + ' ' + trimmed.substring(boldPrefixMatch[0].length)
    }

    if (!cleanTrimmed || /^(#|```|> )/.test(cleanTrimmed)) {
      return { line: lineContent, trimmed: cleanTrimmed, indent, skip: true, type: 'raw' }
    }

    const cols = cleanTrimmed.split(/\t|\s{2,}/).map(s => s.trim()).filter(Boolean)
    const isPotentialTableRow = cols.length > 1 && !/^[0-9]+\./.test(cleanTrimmed)

    // 编号式标题候选（章/节/数字/罗马/英文 Section）
    const hp = headingPrefixOf(cleanTrimmed)

    // 引用块（注意：/ 警告：/ Warning: …）
    const quoteMatch = cleanTrimmed.match(REGEX_QUOTE)

    // 参考文献 [1]
    const refMatch = cleanTrimmed.match(/^\[[0-9]+\]\s*/)

    // 精确章节关键词（摘要 / Abstract / 参考文献 …）
    const kw = quoteMatch ? null : keywordHeadingOf(cleanTrimmed)

    // 全大写英文短行（INTRODUCTION …）
    const caps = !kw && !hp && !refMatch && capsHeadingOf(cleanTrimmed)

    const isShort = cleanTrimmed.length <= 100 && !/[。！？]/.test(cleanTrimmed)

    return {
      line: lineContent, trimmed: cleanTrimmed, indent, skip: false, type: 'text',
      cols, isPotentialTableRow, quoteMatch, refMatch, kw, caps,
      hp, isShort,
    }
  })

  // Table Inference（2 列以上、制表符/多空格分隔的纯文本数据行）
  let i = 0
  while (i < parsedLines.length) {
    if (parsedLines[i].isPotentialTableRow && !parsedLines[i].skip) {
      let tableEnd = i
      while (tableEnd + 1 < parsedLines.length && parsedLines[tableEnd + 1].isPotentialTableRow && !parsedLines[tableEnd + 1].skip) {
        tableEnd++
      }
      if (tableEnd > i) {
        for (let j = i; j <= tableEnd; j++) parsedLines[j].type = 'table_row'
      }
      i = tableEnd + 1
    } else {
      i++
    }
  }

  // Heading vs List Inference：同前缀连续段——出现长行整段按列表加粗，否则整段按标题
  i = 0
  while (i < parsedLines.length) {
    const pl = parsedLines[i]
    const pfx = pl.hp?.prefixType
    if (pl.type === 'text' && pfx) {
      let groupEnd = i
      let hasLong = !pl.isShort
      let lookAhead = i + 1
      while (lookAhead < parsedLines.length) {
        const nextPl = parsedLines[lookAhead]
        if (nextPl.skip && !nextPl.trimmed) {
          lookAhead++; continue
        }
        if (nextPl.type === 'text' && nextPl.hp?.prefixType === pfx) {
          if (!nextPl.isShort) hasLong = true
          groupEnd = lookAhead
          lookAhead++
        } else {
          break
        }
      }
      for (let j = i; j <= groupEnd; j++) {
        const item = parsedLines[j]
        if (item.type === 'text' && item.hp?.prefixType === pfx) {
          item.type = hasLong ? 'list_item' : 'heading'
        }
      }
      i = groupEnd + 1
    } else {
      i++
    }
  }

  // 原生表格行补分隔线：连续 ≥2 行 "| … |" 但整段没有分隔线时，首行后补一条（其余不动）
  const injectSeparator = new Map<number, number>()
  i = 0
  while (i < parsedLines.length) {
    if (parsedLines[i].skip && REGEX_MD_TABLE_ROW.test(parsedLines[i].line)) {
      let end = i
      while (end + 1 < parsedLines.length && parsedLines[end + 1].skip && REGEX_MD_TABLE_ROW.test(parsedLines[end + 1].line)) end++
      const run = parsedLines.slice(i, end + 1)
      if (end > i && !run.some((p) => REGEX_MD_SEPARATOR_ROW.test(p.line))) {
        const cols = parsedLines[i].line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length
        injectSeparator.set(i, cols)
      }
      i = end + 1
    } else {
      i++
    }
  }

  // Generate output
  i = 0
  while (i < parsedLines.length) {
    const pl = parsedLines[i]

    if (pl.skip) {
      result.push(pl.line)
      const sepCols = injectSeparator.get(i)
      if (sepCols) result.push(`|${Array.from({ length: sepCols }, () => '---').join('|')}|`)
      i++
      continue
    }

    // 精确关键词标题：## 摘要（去行尾冒号、折叠字间空白）
    if (pl.kw) {
      result.push(`${pl.indent}## ${pl.kw}`)
      i++
      continue
    }

    // 全大写英文短行标题
    if (pl.caps) {
      result.push(`${pl.indent}### ${pl.trimmed}`)
      i++
      continue
    }

    if (pl.type === 'table_row') {
      result.push(`| ${pl.cols!.join(' | ')} |`)
      if (i === 0 || parsedLines[i - 1].type !== 'table_row') {
        result.push(`|${pl.cols!.map(() => '---').join('|')}|`)
      }
      i++
      continue
    }

    if (pl.type === 'heading') {
      const hashes = '#'.repeat(pl.hp!.level || 3)
      if (pl.hp!.prefixType === 'bracket') {
        result.push(`${pl.indent}**${pl.trimmed}**`)
      } else {
        result.push(`${pl.indent}${hashes} ${pl.trimmed}`)
      }
      i++
      continue
    }

    if (pl.quoteMatch) {
      result.push(`${pl.indent}> **${pl.quoteMatch[1]}**：${pl.trimmed.substring(pl.quoteMatch[0].length)}`)
      i++
      continue
    }

    if (pl.refMatch) {
      result.push(`${pl.indent}**${pl.refMatch[0].trim()}** ${pl.trimmed.substring(pl.refMatch[0].length)}`)
      i++
      continue
    }

    let outputLine = pl.line
    if (pl.type === 'list_item' && pl.hp?.prefix) {
      const prefixTrimmed = pl.hp.prefix.trim()
      const space = pl.hp.prefix.substring(prefixTrimmed.length)
      const rest = pl.trimmed.substring(pl.hp.prefix.length)
      outputLine = `${pl.indent}**${prefixTrimmed}**${space}${rest}`
    }

    // Naked URL formatting：跳过已在链接/自动链接/属性内的 URL，剥离尾部标点
    outputLine = wrapNakedUrls(outputLine)

    result.push(outputLine)
    i++
  }

  // 7. 收尾：折叠围栏外的连续空行（围栏内不动）
  const out: string[] = []
  let blankRun = 0
  fenceOpen = false
  for (const line of result) {
    if (line.trimStart().startsWith('```')) {
      fenceOpen = !fenceOpen
      out.push(line)
      blankRun = 0
      continue
    }
    if (!fenceOpen && !line.trim()) {
      blankRun++
      if (blankRun <= 1) out.push(line)
      continue
    }
    blankRun = 0
    out.push(line)
  }

  const finalOut = out.join('\n')
  // 全局数据安全网：非空输入绝不产出空结果（任何一步过度剔除都回落到原文）
  if (text.trim() && !finalOut.trim()) return text
  return finalOut
}

// ─── 通用辅助函数 ────────────────────────────────────────────────────────────

/** 计算每行是否处于 ``` 围栏内 */
function computeFenceMap(lines: string[]): boolean[] {
  const map: boolean[] = []
  let open = false
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      map.push(true)
      open = !open
      continue
    }
    map.push(open)
  }
  return map
}

/** 从 start 行起找 {} / [] 配对闭合的行号；未闭合返回 -1 */
function findBalancedBlock(lines: string[], start: number): number {
  const opener = lines[start].includes('{') ? '{' : '['
  const closer = opener === '{' ? '}' : ']'
  let depth = 0
  for (let j = start; j < Math.min(start + 50, lines.length); j++) {
    for (const ch of lines[j]) {
      if (ch === opener) depth++
      else if (ch === closer) depth--
    }
    if (depth <= 0 && j > start) return j
  }
  return -1
}

/** 单段文本的排版规范化（仅在 Protected span 之外调用） */
function polishSegment(seg: string): string {
  let out = seg
  // 不可见杂质：零宽字符、软连字符
  out = out.replace(REGEX_INVISIBLE, '')
  // 全角字母/数字 → 半角（ＡＢＣ１２３）
  out = out.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
  // 全角空格 → 半角
  out = out.replace(/\u3000/g, ' ')
  // 盘古之白：中文与英文字母/数字之间增加空格
  out = out.replace(/([\u4e00-\u9fa5])([a-zA-Z0-9])/g, '$1 $2')
  out = out.replace(/([a-zA-Z0-9])([\u4e00-\u9fa5])/g, '$1 $2')
  // 中文与全角标点之间的多余空格
  out = out.replace(/([\u4e00-\u9fa5])[ \t]+([，。！？；：、）】》」』\]])/g, '$1$2')
  out = out.replace(/([（【《「『])[ \t]+([\u4e00-\u9fa5])/g, '$1$2')
  // 标点规范化：中文语境下的半角标点转全角
  out = out.replace(/([\u4e00-\u9fa5])\s*,\s*(?=[\u4e00-\u9fa5]|$)/g, '$1，')
  out = out.replace(/([\u4e00-\u9fa5])\s*\.(?=[\u4e00-\u9fa5]|$)/g, '$1。')
  out = out.replace(/([\u4e00-\u9fa5])\s*;(?=[\u4e00-\u9fa5]|$)/g, '$1；')
  out = out.replace(/([\u4e00-\u9fa5])\s*:(?=[\u4e00-\u9fa5]|$)/g, '$1：')
  out = out.replace(/([\u4e00-\u9fa5])\s*\?(?=[\u4e00-\u9fa5]|$)/g, '$1？')
  out = out.replace(/([\u4e00-\u9fa5])\s*!(?=[\u4e00-\u9fa5]|$)/g, '$1！')
  return out
}

/** 裸 URL 自动链接：排除已在链接/属性内的 URL；剥离中英文尾标点（右括号平衡时保留） */
function wrapNakedUrls(line: string): string {
  return line.replace(REGEX_NAKED_URL, (url) => {
    let end = url.length
    while (end > 0 && /[.,;:!?)\]}>'"’”」』】〉，。；：！？、…]/.test(url[end - 1])) {
      // 括号未闭合时保留右括号（如 Wikipedia 链接）
      if (url[end - 1] === ')' && countChar(url, '(', 0, end) > countChar(url, ')', 0, end - 1)) break
      end--
    }
    const bare = url.slice(0, end)
    const href = /^www\./.test(bare) ? `https://${bare}` : bare
    return `[${bare}](${href})${url.slice(end)}`
  })
}

function countChar(s: string, ch: string, from: number, to: number): number {
  let n = 0
  for (let i = from; i < to; i++) if (s[i] === ch) n++
  return n
}
