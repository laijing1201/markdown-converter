/**
 * Markdown validation — detects syntax errors and encoding issues.
 *
 * Designed for "it should tell me there's a problem" feedback in real-time.
 */

export interface ValidationWarning {
  line: number
  message: string
  type: 'error' | 'warn'
}

/**
 * Check for mojibake (garbled Chinese text) patterns.
 * Common signs:
 *   - High density of U+FFFD replacement characters
 *   - Sequences like æˆ‘, çš„, æ˜¯ (Latin-1 misinterpretation of UTF-8 CJK bytes)
 *   - Raw byte sequences like \xe4\xb8\xad appearing as literal text
 */
export function detectEncodingIssues(text: string): ValidationWarning[] {
  const warnings: ValidationWarning[] = []

  // Count replacement characters
  const replacementCount = (text.match(/\uFFFD/g) || []).length
  if (replacementCount > 3) {
    const line = findLineForIndex(text, text.indexOf('\uFFFD'))
    warnings.push({
      line,
      message: `检测到 ${replacementCount} 个替换字符（�），内容可能有编码问题，点击「修复乱码」尝试修复`,
      type: 'warn',
    })
  }

  // Detect common Latin-1 misinterpretation of UTF-8 CJK
  // Patterns like æˆ‘, çš„, æ˜¯ etc.
  const latin1CjkPattern = /[æðþý][\x80-\xBF]|ç[\x80-\xBF]{2}|æ[\x80-\xBF]{3}/g
  const latin1Matches = text.match(latin1CjkPattern)
  if (latin1Matches && latin1Matches.length > 5) {
    const idx = text.indexOf(latin1Matches[0])
    const line = findLineForIndex(text, idx)
    warnings.push({
      line,
      message: `内容显示为乱码（检测到 ${latin1Matches.length} 处编码异常），可能是 UTF-8 被按 Latin-1 解码了，点击「修复乱码」`,
      type: 'warn',
    })
  }

  return warnings
}

/**
 * Validate basic Markdown structure.
 */
export function validateMarkdown(markdown: string): ValidationWarning[] {
  const warnings: ValidationWarning[] = []
  const lines = markdown.split('\n')

  // ── Unclosed fenced code blocks ─────────────────────────────────────────
  let codeFenceCount = 0
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) {
      codeFenceCount++
    }
  }
  if (codeFenceCount % 2 !== 0) {
    // Find the last unclosed fence
    let lastFenceLine = 0
    for (let i = 0; i < lines.length; i++) {
      if (/^```/.test(lines[i])) {
        lastFenceLine = i
      }
    }
    warnings.push({
      line: lastFenceLine + 1,
      message: '代码块未闭合：检测到奇数个 ```，缺少闭合标记',
      type: 'error',
    })
  }

  // ── Unclosed math blocks ($$) ───────────────────────────────────────────
  // Count $$ tokens (not lines): a self-closed single-line "$$x$$" has two.
  {
    let mathTokenCount = 0
    let inFence = false
    let lastMathLine = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trimStart().startsWith('```')) {
        inFence = !inFence
        continue
      }
      if (inFence) continue
      const tokens = (lines[i].match(/\$\$/g) || []).length
      if (tokens > 0) {
        mathTokenCount += tokens
        lastMathLine = i + 1
      }
    }
    if (mathTokenCount % 2 !== 0) {
      warnings.push({
        line: lastMathLine,
        message: '数学公式块未闭合：检测到奇数个 $$，缺少闭合标记',
        type: 'error',
      })
    }
  }

  // ── Empty headers ───────────────────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const headerMatch = lines[i].match(/^(#{1,6})\s*(.*)$/)
    if (headerMatch) {
      const content = headerMatch[2].trim()
      if (!content || content === '') {
        warnings.push({
          line: i + 1,
          message: `空的标题（${headerMatch[1]}），标题后需要跟文字内容`,
          type: 'warn',
        })
      }
    }
  }

  // ── Unclosed inline code (single backtick) ──────────────────────────────
  let inCodeBlock = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    
    if (inCodeBlock) continue

    const backtickMatches = line.match(/`/g)
    if (backtickMatches && backtickMatches.length % 2 !== 0) {
      warnings.push({
        line: i + 1,
        message: '行内代码可能未闭合（奇数个反引号 `）',
        type: 'warn',
      })
    }
  }

  return warnings
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findLineForIndex(text: string, index: number): number {
  if (index < 0) return 1
  return text.substring(0, index).split('\n').length
}
