/**
 * 全能型智能排版引擎 (Full-Featured Intelligent Structuring Engine)
 * 包含多级标题推断、表格生成、PDF断行缝合、页码剔除、引用/代码/链接推断及排版美化等。
 */

// ─── 辅助正则表达式 ────────────────────────────────────────────────────────
const REGEX_PAGE_NUMBER = /^\s*(-?\s*(page)?\s*\d+\s*(of\s*\d+)?\s*-?)\s*$/i
const REGEX_URL = /(https?:\/\/[^\s]+)/g
const REGEX_CHINESE = /[\u4e00-\u9fa5]/
const REGEX_ENGLISH_NUM = /[a-zA-Z0-9]/
const REGEX_UNORDERED_LIST = /^\s*([•·*Ø-]|(\d+\.))\s+/

export function smartFormatText(text: string): string {
  if (!text) return ''

  // 1. Noise Removal (页眉页脚与孤立页码剔除)
  let rawLines = text.split('\n')
  rawLines = rawLines.filter(line => !REGEX_PAGE_NUMBER.test(line))

  // 2. Smart Paragraph Joining (PDF断行智能缝合)
  // 如果当前行不是以标点（句号、问号、叹号、冒号、分号）结尾，且下一行开头是中文或小写字母，认为是被错误截断的段落
  const joinedLines: string[] = []
  for (let i = 0; i < rawLines.length; i++) {
    let currentLine = rawLines[i].trimEnd()
    if (!currentLine) {
      joinedLines.push('')
      continue
    }
    
    // 不要缝合看起来像标题、列表、引用或代码边界的行
    const preventJoinPattern = /^[#>\-*\d•·Ø]/
    const codePattern = /^\s*({|}|\[|\]|```|import |def |class |function |<)/
    
    if (preventJoinPattern.test(currentLine.trimStart()) || codePattern.test(currentLine)) {
      joinedLines.push(currentLine)
      continue
    }

    let buf = currentLine
    while (i + 1 < rawLines.length) {
      const nextLine = rawLines[i + 1].trimStart()
      if (!nextLine || preventJoinPattern.test(nextLine) || codePattern.test(nextLine)) break

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

  // 3. Code Snippet Detection (代码片段探测)
  // 如果遇到首行是 { 或者 [，且之后某行是 } 或者 ]，并且中间不含标题，尝试包裹为 ```json
  let iCode = 0;
  while (iCode < joinedLines.length) {
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

  let processedText = joinedLines.join('\n')

  // 4. Typography Polish (中英文排版与标点规范化)
  // 盘古之白：中文与英文字母/数字之间增加空格
  processedText = processedText.replace(/([\u4e00-\u9fa5])([a-zA-Z0-9])/g, '$1 $2')
  processedText = processedText.replace(/([a-zA-Z0-9])([\u4e00-\u9fa5])/g, '$1 $2')
  
  // 标点规范化：中文语境下(前后有中文)，将半角逗号、句号转化为全角
  processedText = processedText.replace(/([\u4e00-\u9fa5])\s*,\s*([\u4e00-\u9fa5])/g, '$1，$2')
  processedText = processedText.replace(/([\u4e00-\u9fa5])\s*\.\s*(?=[\u4e00-\u9fa5]|$)/g, '$1。')

  // 5. Structure Inference (多级标题、无序列表对齐、表格组装)
  const lines = processedText.split('\n')
  const result: string[] = []
  
  const parsedLines = lines.map((line) => {
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
