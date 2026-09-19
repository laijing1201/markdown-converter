/**
 * 全能型智能排版引擎 (Full-Featured Intelligent Structuring Engine)
 * 包含多级标题推断、表格生成、PDF断行缝合、页码剔除、引用/代码/链接推断及排版美化等。
 *
 * 安全规则（回归保护）：已经是合法 Markdown 的内容绝不能被"智能"破坏 ——
 *   1. ``` 代码围栏内的任何行保持原样（不缝合、不改标点、不推结构）；
 *   2. 以 | 开头的 Markdown 表格行保持原样（不会被段落缝合吞掉）；
 *   3. 标准有序列表（"1. 内容"）与无序列表行不做标题推断、不加粗序号。
 */

// ─── 辅助正则表达式 ────────────────────────────────────────────────────────
const REGEX_PAGE_NUMBER = /^\s*(-?\s*(page)?\s*\d+\s*(of\s*\d+)?\s*-?)\s*$/i
const REGEX_MD_TABLE_ROW = /^\s*\|.*\|?\s*$/
const REGEX_MD_SEPARATOR_ROW = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/
const REGEX_MD_ORDERED_LIST = /^\s*\d+\.\s+/
const REGEX_MD_UNORDERED_LIST = /^\s*[-*+]\s+/

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

  // 1. Noise Removal (页眉页脚与孤立页码剔除；围栏内不剔除)
  const rawLines: string[] = []
  const fenceMap: boolean[] = []
  for (let i = 0; i < rawAllLines.length; i++) {
    if (inFence[i] || !REGEX_PAGE_NUMBER.test(rawAllLines[i])) {
      rawLines.push(rawAllLines[i])
      fenceMap.push(inFence[i])
    }
  }

  // 2. Smart Paragraph Joining (PDF断行智能缝合)
  const joinedLines: string[] = []
  for (let i = 0; i < rawLines.length; i++) {
    let currentLine = rawLines[i].trimEnd()
    if (!currentLine) {
      joinedLines.push('')
      continue
    }

    // 围栏内行原样保留
    if (fenceMap[i]) {
      joinedLines.push(rawLines[i])
      continue
    }

    // 不要缝合看起来像标题、列表、引用、代码、表格边界的行
    const preventJoinPattern = /^[#>\-*|•·Ø\d]/
    const codePattern = /^\s*({|}|\[|\]|```|import |def |class |function |<)/

    if (preventJoinPattern.test(currentLine.trimStart()) || codePattern.test(currentLine)) {
      joinedLines.push(currentLine)
      continue
    }

    let buf = currentLine
    while (i + 1 < rawLines.length) {
      const nextLine = rawLines[i + 1].trimStart()
      if (!nextLine || fenceMap[i + 1] || preventJoinPattern.test(nextLine) || codePattern.test(nextLine)) break

      const lastChar = buf.slice(-1)
      const isEndPunctuation = /[。！？：；.!?:]/.test(lastChar)

      // 如果没有结束标点，且下一行有字符，或者是强迫连接的情况
      if (!isEndPunctuation) {
        buf += ' ' + nextLine
        i++
      } else {
        break
      }
    }
    joinedLines.push(buf)
  }

  // 3. Code Snippet Detection (代码片段探测) —— 跳过围栏内与表格行
  {
    // 重新计算 joinedLines 的围栏状态（缝合不合并围栏行，但索引有变化）
    const fence3: boolean[] = []
    let open = false
    for (const l of joinedLines) {
      if (l.trimStart().startsWith('```')) {
        fence3.push(true)
        open = !open
        continue
      }
      fence3.push(open)
    }
    let iCode = 0
    while (iCode < joinedLines.length) {
      if (fence3[iCode] || REGEX_MD_TABLE_ROW.test(joinedLines[iCode])) {
        iCode++
        continue
      }
      const line = joinedLines[iCode].trim()
      if (line === '{' || line === '[' || line.endsWith('{') || line.endsWith('[')) {
        let isCode = false
        let endIdx = iCode
        let braceCount = line.includes('{') ? 1 : 0
        let bracketCount = line.includes('[') ? 1 : 0

        for (let j = iCode + 1; j < Math.min(iCode + 50, joinedLines.length); j++) {
          const nextLine = joinedLines[j].trim()
          if (nextLine.includes('{')) braceCount++
          if (nextLine.includes('}')) braceCount--
          if (nextLine.includes('[')) bracketCount++
          if (nextLine.includes(']')) bracketCount--

          if (braceCount === 0 && bracketCount === 0 && (nextLine === '}' || nextLine === ']' || nextLine.startsWith('}') || nextLine.startsWith(']'))) {
            isCode = true
            endIdx = j
            break
          }
        }

        if (isCode && endIdx > iCode) {
          joinedLines.splice(endIdx + 1, 0, '```')
          joinedLines.splice(iCode, 0, '```json')
          iCode = endIdx + 3 // skip the inserted lines
          continue
        }
      }

      // Python/Generic code log detection (def/import/function/console.log)
      if (/^(def\s+[a-zA-Z_]|import\s+[a-zA-Z]|function\s+[a-zA-Z]|class\s+[a-zA-Z])/.test(line)) {
        let endIdx = iCode
        for (let j = iCode + 1; j < Math.min(iCode + 20, joinedLines.length); j++) {
          if (!joinedLines[j].trim() || /^[#>\-*\d]/.test(joinedLines[j].trimStart())) {
            endIdx = j - 1
            break
          }
          endIdx = j
        }
        if (endIdx > iCode) {
          joinedLines.splice(endIdx + 1, 0, '```')
          joinedLines.splice(iCode, 0, '```python')
          iCode = endIdx + 3
          continue
        }
      }

      iCode++
    }
  }

  // 4. Typography Polish (中英文排版与标点规范化) —— 逐行处理，围栏内与表格行跳过
  const polishedLines = joinedLines.map((line) => {
    if (/^\s*```/.test(line) || REGEX_MD_TABLE_ROW.test(line)) return line
    let out = line
    // 盘古之白：中文与英文字母/数字之间增加空格
    out = out.replace(/([\u4e00-\u9fa5])([a-zA-Z0-9])/g, '$1 $2')
    out = out.replace(/([a-zA-Z0-9])([\u4e00-\u9fa5])/g, '$1 $2')
    // 标点规范化：中文语境下(前后有中文)，将半角逗号、句号转化为全角
    out = out.replace(/([\u4e00-\u9fa5])\s*,\s*([\u4e00-\u9fa5])/g, '$1，$2')
    out = out.replace(/([\u4e00-\u9fa5])\s*\.\s*(?=[\u4e00-\u9fa5]|$)/g, '$1。')
    return out
  })

  // 5. Structure Inference (多级标题、无序列表对齐、表格组装)
  const lines = polishedLines
  const result: string[] = []

  // 围栏状态重算
  const fenceInStep5: boolean[] = []
  fenceOpen = false
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      fenceInStep5.push(true)
      fenceOpen = !fenceOpen
      continue
    }
    fenceInStep5.push(fenceOpen)
  }

  const parsedLines = lines.map((line, idx) => {
    // 围栏内 / 已是 Markdown 表格行 / 已是标准列表行：一律原样保留
    if (fenceInStep5[idx] || REGEX_MD_TABLE_ROW.test(line) || REGEX_MD_SEPARATOR_ROW.test(line)) {
      return { line, trimmed: line.trim(), indent: '', skip: true, type: 'raw' as const }
    }
    if (REGEX_MD_ORDERED_LIST.test(line) || REGEX_MD_UNORDERED_LIST.test(line)) {
      // 无序列表符号统一（• · Ø * → -）仍可安全执行
      const t = line.trimStart()
      const ulMatch = t.match(/^([•·Ø])\s+/)
      if (ulMatch) {
        const indent = line.substring(0, line.length - t.length)
        return { line: indent + '- ' + t.substring(ulMatch[0].length), trimmed: '', indent: '', skip: true as const, type: 'raw' as const }
      }
      return { line, trimmed: line.trim(), indent: '', skip: true, type: 'raw' as const }
    }

    let trimmed = line.trimStart()
    const indent = line.substring(0, line.length - trimmed.length)

    let lineContent = line
    // 无序列表自动统一对齐 (将 •, ·, Ø 转换为 -)
    const ulMatch = trimmed.match(/^([•·Ø*])\s+/)
    if (ulMatch) {
      trimmed = '- ' + trimmed.substring(ulMatch[0].length)
      lineContent = indent + trimmed
    }

    // 兼容已经被错误加粗的序号 (例如 **1.**)
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

    const chapMatch = cleanTrimmed.match(/^第[一二三四五六七八九十百千万0-9]+[章节篇部分]\s*/)
    const zhMatch = cleanTrimmed.match(/^[一二三四五六七八九十]+、\s*/)
    const dot3Match = cleanTrimmed.match(/^[0-9]+\.[0-9]+\.[0-9]+(\s+|$)/)
    const dot2Match = cleanTrimmed.match(/^[0-9]+\.[0-9]+(\s+|$)/)
    const dot1Match = cleanTrimmed.match(/^[0-9]+\.(\s+|$)/)
    const bracketMatch = cleanTrimmed.match(/^(\([0-9]+\)|[0-9]+\)|（[一二三四五六七八九十0-9]+）|\([一二三四五六七八九十0-9]+\))\s*/)

    let prefix = ''
    let level = 0
    let prefixType = ''

    if (chapMatch) { prefix = chapMatch[0]; level = 2; prefixType = 'chap' }
    else if (zhMatch) { prefix = zhMatch[0]; level = 3; prefixType = 'zh' }
    else if (dot3Match) { prefix = dot3Match[0]; level = 4; prefixType = 'dot3' }
    else if (dot2Match) { prefix = dot2Match[0]; level = 3; prefixType = 'dot2' }
    else if (dot1Match) { prefix = dot1Match[0]; level = 2; prefixType = 'dot1' }
    else if (bracketMatch) { prefix = bracketMatch[0]; level = 0; prefixType = 'bracket' }

    // Blockquote inference (注意：，摘要：)
    const quoteMatch = cleanTrimmed.match(/^(注意|摘要|Note|Tip|提示)[:：]\s*/i)

    // References inference [1]
    const refMatch = cleanTrimmed.match(/^\[[0-9]+\]\s*/)

    const isShort = cleanTrimmed.length <= 100 && !/[。！？]/.test(cleanTrimmed)

    return {
      line: lineContent, trimmed: cleanTrimmed, indent, skip: false, type: 'text',
      cols, isPotentialTableRow, quoteMatch, refMatch,
      prefix, level, prefixType, isShort
    }
  })

  // Table Inference
  let i = 0;
  while (i < parsedLines.length) {
    if (parsedLines[i].isPotentialTableRow && !parsedLines[i].skip) {
      let tableEnd = i;
      while (tableEnd + 1 < parsedLines.length && parsedLines[tableEnd + 1].isPotentialTableRow && !parsedLines[tableEnd + 1].skip) {
        tableEnd++;
      }
      if (tableEnd > i) {
        for (let j = i; j <= tableEnd; j++) parsedLines[j].type = 'table_row'
      }
      i = tableEnd + 1;
    } else {
      i++;
    }
  }

  // Heading vs List Inference
  i = 0;
  while (i < parsedLines.length) {
    const pl = parsedLines[i]
    if (pl.type === 'text' && pl.prefixType) {
      let groupEnd = i;
      let hasLong = !pl.isShort;
      let lookAhead = i + 1;
      while (lookAhead < parsedLines.length) {
        const nextPl = parsedLines[lookAhead];
        if (nextPl.skip && !nextPl.trimmed) {
          lookAhead++; continue;
        }
        if (nextPl.type === 'text' && nextPl.prefixType === pl.prefixType) {
          if (!nextPl.isShort) hasLong = true;
          groupEnd = lookAhead;
          lookAhead++;
        } else {
          break;
        }
      }
      for (let j = i; j <= groupEnd; j++) {
        const item = parsedLines[j];
        if (item.type === 'text' && item.prefixType === pl.prefixType) {
          item.type = hasLong ? 'list_item' : 'heading';
        }
      }
      i = groupEnd + 1;
    } else {
      i++;
    }
  }

  // Generate output
  i = 0;
  while (i < parsedLines.length) {
    const pl = parsedLines[i]

    if (pl.skip) {
      result.push(pl.line)
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
      const hashes = '#'.repeat(pl.level || 3)
      if (pl.prefixType === 'bracket') {
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
    if (pl.type === 'list_item' || (pl.type === 'text' && pl.prefix)) {
      const prefixTrimmed = pl.prefix!.trim()
      const space = pl.prefix!.substring(prefixTrimmed.length)
      const rest = pl.trimmed.substring(pl.prefix!.length)
      outputLine = `${pl.indent}**${prefixTrimmed}**${space}${rest}`
    }

    // Naked URL formatting
    outputLine = outputLine.replace(/(?<!\()https?:\/\/[^\s]+(?!\))/g, (url) => {
      // Check if it's already in markdown link or image format
      return `[${url}](${url})`
    })

    result.push(outputLine)
    i++
  }

  return result.join('\n')
}
