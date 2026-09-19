import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'

// ─── Configure marked with highlight.js ────────────────────────────────────────

marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code: string, lang: string) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value
      }
      // For unknown languages, return escaped code
      return code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
    },
  }),
)

// ─── Math placeholder engine ───────────────────────────────────────────────────

import { blockMathRe, inlineMathRe, extractFormulas } from './mathSyntax'
// 公式语法工具（正则/extractFormulas）已抽取到 core/mathSyntax（零依赖共享），
// 这里保留 re-export 维持原有公共 API 兼容（preflight / 扩展 / 测试共用）。
export { extractFormulas }
export type { ExtractedFormula } from './mathSyntax'

interface MathEntry {
  formula: string
  isBlock: boolean
}

let mathCounter = 0
const mathStore: Record<string, MathEntry> = {}

/**
 * Pre-process raw markdown: extract LaTeX delimiters and replace them
 * with safe placeholders so `marked` doesn't mangle the math content.
 */
export function extractMathPlaceholders(markdown: string): string {
  mathCounter = 0
  // Clear previous store entries but keep the object reference
  for (const key of Object.keys(mathStore)) {
    delete mathStore[key]
  }

  let result = markdown

  // 1) Block math $$...$$  (greedy, multiline)
  result = result.replace(blockMathRe(), (_match, formula: string) => {
    const key = `%%MATH_BLOCK_${mathCounter}%%`
    mathStore[key] = { formula: formula.trim(), isBlock: true }
    mathCounter++
    return key
  })

  // 2) Inline math $...$ (single line, not part of a block formula)
  result = result.replace(
    inlineMathRe(),
    (_match, formula: string) => {
      const key = `%%MATH_INLINE_${mathCounter}%%`
      mathStore[key] = { formula: formula.trim(), isBlock: false }
      mathCounter++
      return key
    },
  )

  return result
}

/**
 * Restore math placeholders in the *final HTML* to DOM-friendly attributes.
 * Each placeholder becomes a `<span class="math-inline">` or `<div class="math-block">`
 * with a `data-formula` attribute that KaTeX can read later.
 */
export function restoreMathInHtml(html: string): string {
  return html.replace(
    /%%MATH_(BLOCK|INLINE)_(\d+)%%/g,
    (_match, type: string, id: string) => {
      const key = `%%MATH_${type}_${id}%%`
      const entry = mathStore[key]
      if (!entry) return _match

      const encoded = encodeURIComponent(entry.formula)
      if (entry.isBlock) {
        return `<div class="math-block" data-formula="${encoded}"></div>`
      }
      return `<span class="math-inline" data-formula="${encoded}"></span>`
    },
  )
}

// ─── Block extensions: 分页符 / 图题表题 ──────────────────────────────────────

/** 统计分页符数量（preflight/统计用） */
export function countPagebreaks(markdown: string): number {
  return (markdown.match(/^[ \t]*<!--\s*pagebreak\s*-->[ \t]*$/gim) || []).length
}

interface CaptionEntry {
  kind: 'fig' | 'tbl'
  text: string
}

let captionCounter = 0
const captionStore: Record<string, CaptionEntry> = {}

/**
 * 块级扩展预处理（在 math 提取、marked 之前执行）：
 *   1. `<!-- pagebreak -->` 独立成行 → %%PAGEBREAK%% 占位
 *   2. `*图：说明*` / `*表：说明*` 独立成行 → %%CAPTION_N%% 占位
 *      （用户手写的编号会被自动编号替换，见 PreviewPanel / exporter）
 * 其余标准 Markdown 完全不受影响。
 */
export function extractBlockExtensions(markdown: string): string {
  captionCounter = 0
  for (const key of Object.keys(captionStore)) delete captionStore[key]

  let result = markdown.replace(
    /^[ \t]*<!--\s*pagebreak\s*-->[ \t]*$/gim,
    () => '%%PAGEBREAK%%',
  )

  result = result.replace(
    /^[ \t]*([*_])[ \t]*(图|表|Figure|Table|Fig\.?)[ \t]*\d*[ \t]*[:：][ \t]*(.*?)[ \t]*\1[ \t]*$/gim,
    (_m, _mark: string, kindWord: string, text: string) => {
      const kind = /^(图|Figure|Fig)/i.test(kindWord) ? 'fig' : 'tbl'
      const key = `%%CAPTION_${captionCounter}%%`
      captionStore[key] = { kind, text: text.trim() }
      captionCounter++
      return key
    },
  )

  return result
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 把分页符/caption 占位还原为带语义 class 的 div；顺便补 task-list 类名 */
export function restoreBlockExtensions(html: string): string {
  let result = html.replace(
    /<p>(?:\s*%%PAGEBREAK%%\s*)+<\/p>/g,
    '<div class="pagebreak"></div>',
  )
  // 极端情况：占位和其他文本挤进同一个 <p>（连续两行分页符等），拆开段落
  result = result.replace(/%%PAGEBREAK%%/g, '</p><div class="pagebreak"></div><p>')

  result = result.replace(
    /<p>\s*%%CAPTION_(\d+)%%\s*<\/p>/g,
    (_m, id: string) => {
      const entry = captionStore[`%%CAPTION_${id}%%`]
      if (!entry) return _m
      return `<div class="block-caption" data-kind="${entry.kind}">${escapeHtmlText(entry.text)}</div>`
    },
  )
  result = result.replace(/%%CAPTION_(\d+)%%/g, (_m, id: string) => {
    const entry = captionStore[`%%CAPTION_${id}%%`]
    if (!entry) return _m
    return `</p><div class="block-caption" data-kind="${entry.kind}">${escapeHtmlText(entry.text)}</div><p>`
  })

  // GFM task list：marked 不给 ul/li 加类名，这里补齐（供预览样式与导出识别）
  result = result.replace(
    /<li>(\s*<p>)?\s*<input([^>]*type="checkbox")/g,
    '<li class="task-list-item">$1<input$2',
  )
  result = result.replace(
    /<ul>\s*<li class="task-list-item"/g,
    '<ul class="task-list"><li class="task-list-item"',
  )

  return result
}

// ─── Full pipeline ─────────────────────────────────────────────────────────────

/**
 * Convert a raw markdown string to a safe, render-ready HTML string.
 *
 * Pipeline:
 *   raw MD  →  block extensions (pagebreak/caption)  →  extract math placeholders
 *   →  marked (with highlight.js)  →  restore math  →  restore block extensions
 *   →  DOMPurify  →  output
 */
export function markdownToSafeHtml(markdown: string): string {
  // Step 1 – pagebreak / caption 语法预处理
  const withExtensions = extractBlockExtensions(markdown)

  // Step 2 – protect LaTeX
  const withPlaceholders = extractMathPlaceholders(withExtensions)

  // Step 3 – marked parse (handles code blocks, tables, etc.)
  const rawHtml = marked.parse(withPlaceholders) as string

  // Step 4 – put math markers back as HTML elements
  const htmlWithMath = restoreMathInHtml(rawHtml)

  // Step 5 – pagebreak / caption 占位还原 + task-list 类名
  const htmlRestored = restoreBlockExtensions(htmlWithMath)

  // Step 6 – sanitise (allow data-* for our math markers, checkbox input for task list)
  const clean = DOMPurify.sanitize(htmlRestored, {
    ADD_TAGS: [
      'math', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac',
      'mrow', 'msqrt', 'mover', 'munder', 'mtable', 'mtd', 'mtr',
      'input',
    ],
    ADD_ATTR: ['data-formula', 'data-kind', 'type', 'checked', 'disabled'],
  })

  return clean
}

// ─── Encoding repair (深度编码修复) ─────────────────────────────────────

export interface FixCandidate {
  text: string
  label: string
  displayName: string
  /** Number of U+FFFD replacement characters (0 = clean). */
  replacementCount: number
  isDifferent: boolean
  /** 0–100 confidence that the rendered text is valid. */
  quality: number
  /** True if this candidate is better than the original text. */
  isRecommended: boolean
}

/**
 * Convert a JS string to "Latin-1 bytes" — treat each character as a single byte.
 *
 * This is THE fundamental operation for mojibake repair:
 *   garbled text → Latin-1 bytes (= original raw bytes) → decode in correct encoding
 *
 * Characters > U+00FF are clamped to 0xFF (safety; should not occur in mojibake).
 */
function toLatin1Bytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xFF
  }
  return bytes
}

/**
 * Ratio of "reasonable" Unicode characters in the text.
 * Higher = more likely the text is correctly decoded.
 */
function textQuality(text: string): number {
  if (!text) return 0
  let valid = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    const ok =
      // CJK
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      // CJK punctuation
      (code >= 0x3000 && code <= 0x303F) ||
      // Fullwidth
      (code >= 0xFF00 && code <= 0xFFEF) ||
      // Basic Latin printable (ASCII)
      (code >= 0x20 && code <= 0x7E) ||
      // Latin-1 Supplement
      (code >= 0xA0 && code <= 0xFF) ||
      // General punctuation, currency, math
      (code >= 0x2000 && code <= 0x206F) ||
      (code >= 0x2100 && code <= 0x214F) ||
      // Hiragana / Katakana
      (code >= 0x3040 && code <= 0x30FF) ||
      // Hangul
      (code >= 0xAC00 && code <= 0xD7AF) ||
      // Common symbols (arrows, geometric shapes)
      (code >= 0x2190 && code <= 0x21FF) ||
      (code >= 0x25A0 && code <= 0x25FF)
    if (ok) valid++
  }
  return valid / text.length
}

/**
 * Run all encoding-repair strategies and return every candidate with scores.
 *
 * ⚠️  CRITICAL RULE: always use `toLatin1Bytes()` (charCodeAt & 0xFF)
 *     to get the "raw bytes" from garbled text.  NEVER use
 *     `TextEncoder().encode()` — it produces UTF-8 bytes and will
 *     RE-ENCODE already-garbled text, making it WORSE.
 *
 * Strategies (all convert Latin-1 bytes → target encoding):
 *   1. UTF-8  — most common: UTF-8 byte stream displayed as Latin-1
 *   2. GBK    — GBK-encoded Chinese text displayed as Latin-1
 *   3. Big5   — Big5-encoded text displayed as Latin-1
 *   4. Double — rare double-encoding: undo two levels of misinterpretation
 */
export function deepAnalyzeEncoding(text: string): FixCandidate[] {
  if (!text || text.length < 2) return []

  const candidates: FixCandidate[] = []

  const originalReplacementCount = (text.match(/\uFFFD/g) || []).length
  const originalQuality = Math.round(textQuality(text) * 100)

  // Always include the original text for comparison
  candidates.push({
    text,
    label: 'original',
    displayName: '原始文本',
    replacementCount: originalReplacementCount,
    isDifferent: false,
    quality: originalQuality,
    isRecommended: false,
  })

  function add(label: string, displayName: string, fixed: string) {
    if (fixed === text || candidates.some((c) => c.text === fixed)) return
    
    const replacementCount = (fixed.match(/\uFFFD/g) || []).length
    const quality = Math.round(textQuality(fixed) * 100)
    
    // It is recommended if it has fewer missing chars, OR same missing chars but much higher quality
    const isRecommended = (replacementCount < originalReplacementCount) || 
                          (replacementCount === originalReplacementCount && quality > originalQuality + 10)

    candidates.push({
      text: fixed,
      label,
      displayName,
      replacementCount,
      isDifferent: true,
      quality,
      isRecommended,
    })
  }

  // ── Latin-1 bytes (the ONLY correct byte representation of garbled text) ─
  const latin1Bytes = toLatin1Bytes(text)

  // ── Strategy 1: UTF-8 ───────────────────────────────────────────────────
  //  中文 (UTF-8: E4 B8 AD E6 96 87) → shown as "ä¸­æ–‡"
  //  toLatin1Bytes("ä¸­æ–‡") → [E4, B8, AD, E6, 96, 87]
  //  decode as UTF-8 → "中文" ✓
  try {
    const fixed = new TextDecoder('utf-8', { fatal: false }).decode(latin1Bytes)
    add('utf8', 'UTF-8 重解码', fixed)
  } catch { /* skip */ }

  // ── Strategy 2: GBK ─────────────────────────────────────────────────────
  try {
    const fixed = new TextDecoder('gbk', { fatal: false }).decode(latin1Bytes)
    add('gbk', 'GBK 解码', fixed)
  } catch { /* skip */ }

  // ── Strategy 3: Big5 ────────────────────────────────────────────────────
  try {
    const fixed = new TextDecoder('big5', { fatal: false }).decode(latin1Bytes)
    add('big5', 'Big5 解码', fixed)
  } catch { /* skip */ }

  // ── Strategy 4: Double decode ───────────────────────────────────────────
  //  Level 1: Latin-1 bytes → UTF-8
  //  Level 2: result's Latin-1 bytes → UTF-8 again
  try {
    const level1 = new TextDecoder('utf-8', { fatal: false }).decode(latin1Bytes)
    if (level1 !== text) {
      const level1Bytes = toLatin1Bytes(level1)
      const level2 = new TextDecoder('utf-8', { fatal: false }).decode(level1Bytes)
      if (level2 !== text && level2 !== level1) {
        add('double-utf8', '双重 UTF-8 解码', level2)
      }
    }
  } catch { /* skip */ }

  // ── Rank: recommended first, fewest U+FFFD, then highest quality ─────────────────────
  candidates.sort((a, b) => {
    if (a.label === 'original') return -1 // Keep original at top
    if (b.label === 'original') return 1
    if (a.isRecommended && !b.isRecommended) return -1
    if (!a.isRecommended && b.isRecommended) return 1
    const d = a.replacementCount - b.replacementCount
    if (d !== 0) return d
    return b.quality - a.quality
  })

  return candidates
}

/**
 * Legacy auto-fix: only applies if the best candidate is significantly better
 * than the original (fewer replacement chars AND quality ≥ 70).
 */
export function fixEncoding(text: string): string {
  const candidates = deepAnalyzeEncoding(text)
  if (candidates.length <= 1) return text
  const original = candidates.find((c) => c.label === 'original')!
  const best = candidates[0]
  if (best.label === 'original') return text
  // Only auto-apply when the fix is clearly better
  if (best.quality >= 65 && best.replacementCount <= original.replacementCount) {
    return best.text
  }
  return text
}
