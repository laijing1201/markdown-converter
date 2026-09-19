/**
 * DOM → Markdown 提取引擎（扩展侧核心）。
 *
 * 提取优先级（按规范第十二节）：
 *   1. 平台可访问的原始 LaTeX 源（KaTeX annotation / MathJax script）
 *   2. 语义 HTML（标题/列表/表格/代码/链接/图片）
 *   3. DOM → Markdown（递归序列化）
 *   4. textContent（最后兜底）
 *
 * 注意：这里产出的 Markdown 之后由 MarkDoc 网页版核心的
 * markdownToSafeHtml（DOMPurify）统一清洗 —— 扩展侧不再写第二套 sanitizer。
 */

export interface ExtractedSource {
  url: string
  text: string
}

export interface ExtractResult {
  markdown: string
  formulas: number
  /** 无法恢复 LaTeX 源、只能用文本兜底的公式数 */
  formulasDegraded: number
  codeBlocks: number
  mermaidBlocks: number
  tables: number
  images: { src: string; alt: string }[]
  links: ExtractedSource[]
}

export interface ExtractOptions {
  /** 每条消息允许的最大字符数（防御极端长内容） */
  maxChars?: number
}

// ─── 转义 ────────────────────────────────────────────────────────────────────

/**
 * 行内文本转义 —— 只在【文本节点】层调用，转义会破坏 Markdown 结构的字符。
 * 绝不能对组装后的 Markdown 再转义（会破坏已生成的链接/公式/代码围栏）。
 */
function escapeInlineText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/([*_`\[\]])/g, '\\$1')
}

/** 表格单元格内转义 */
function escapeCellText(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

// ─── 公式恢复 ────────────────────────────────────────────────────────────────

interface MathRecovery {
  latex: string
  display: boolean
  recovered: boolean
}

/**
 * 从渲染后的公式元素恢复 LaTeX 源码：
 *   - KaTeX: .katex / .katex-display，annotation[encoding="application/x-tex"]
 *   - MathJax v3: mjx-container > script[type^="math/tex"]
 * 恢复失败时返回 { recovered: false, latex: textContent 兜底 }。
 */
export function recoverMath(element: Element): MathRecovery {
  // KaTeX 路径：annotation 编码为 x-tex 的节点里是原始 LaTeX
  const annotation = element.querySelector('annotation[encoding="application/x-tex"], .katex-mathml annotation')
  if (annotation?.textContent) {
    const display =
      element.classList.contains('katex-display') ||
      !!element.querySelector('.katex-display')
    return { latex: annotation.textContent.trim(), display, recovered: true }
  }

  // MathJax v3 路径：原始 TeX 保留在 <script type="math/tex">
  const script = element.querySelector('script[type^="math/tex"]')
  if (script?.textContent) {
    const display = (script.getAttribute('type') || '').includes('mode=display')
    return { latex: script.textContent.trim(), display, recovered: true }
  }

  // 兜底：文本近似（禁止截图；此处退化记录计数）
  const text = (element.textContent || '').trim()
  return { latex: text, display: element.tagName !== 'SPAN', recovered: false }
}

// ─── 代码块 ──────────────────────────────────────────────────────────────────

const COMMON_LANGS = new Set([
  'python', 'py', 'javascript', 'js', 'typescript', 'ts', 'java', 'cpp', 'c++', 'c',
  'csharp', 'go', 'rust', 'sql', 'shell', 'bash', 'sh', 'powershell', 'html', 'css',
  'json', 'yaml', 'yml', 'xml', 'markdown', 'md', 'mermaid', 'r', 'matlab', 'swift',
  'kotlin', 'php', 'ruby', 'perl', 'scala', 'dart', 'lua', 'toml', 'ini', 'dockerfile',
])

function codeLanguage(codeEl: Element): string {
  const classes = (codeEl.getAttribute('class') || '').split(/\s+/)
  for (const cls of classes) {
    if (cls.startsWith('language-')) {
      const lang = cls.slice('language-'.length).toLowerCase()
      if (lang && COMMON_LANGS.has(lang)) return lang
      if (lang) return lang
    }
  }
  // ChatGPT 代码块头部的语言标签（data-language 属性出现过）
  const dataLang = codeEl.getAttribute('data-language') || codeEl.parentElement?.getAttribute('data-language')
  if (dataLang) return dataLang.toLowerCase()
  return ''
}

/** pre 元素 → fenced code block。只取 code 的文本，天然排除 Copy/复制 等按钮。 */
function serializePre(pre: Element, result: ExtractResult): string {
  const codeEl = pre.querySelector('code') ?? pre
  const raw = codeEl.textContent || ''
  const lang = codeLanguage(codeEl)
  if (lang === 'mermaid') result.mermaidBlocks++
  else result.codeBlocks++
  const fence = raw.includes('```') ? '````' : '```'
  const body = raw.replace(/\n$/, '')
  return `${fence}${lang}\n${body}\n${fence}`
}

// ─── 表格 ────────────────────────────────────────────────────────────────────

function serializeTable(table: Element, result: ExtractResult): string {
  const allRows = Array.from(table.querySelectorAll('tr'))
  if (allRows.length === 0) return (table.textContent || '').trim()

  const cellText = (cell: Element) => {
    // 单元格内先做行内序列化（保留加粗/链接/公式）
    const inner = serializeInline(cell, result).replace(/\n+/g, ' ').trim()
    return escapeCellText(inner)
  }

  const headerCells = allRows[0].querySelectorAll('th, td')
  const colCount = Math.max(...allRows.map((tr) => tr.querySelectorAll('th, td').length))
  if (colCount === 0) return (table.textContent || '').trim()
  result.tables++

  const headerLine: string[] = []
  for (let i = 0; i < colCount; i++) {
    const cell = headerCells[i]
    headerLine.push(cell ? cellText(cell) : ' ')
  }
  const sep = Array.from({ length: colCount }, () => '---')
  const bodyLines: string[] = []
  const bodyRows = allRows.slice(1)
  for (const tr of bodyRows) {
    const cells = tr.querySelectorAll('th, td')
    const line: string[] = []
    for (let i = 0; i < colCount; i++) line.push(cells[i] ? cellText(cells[i]) : ' ')
    bodyLines.push(`| ${line.join(' | ')} |`)
  }

  return [`| ${headerLine.join(' | ')} |`, `| ${sep.join(' | ')} |`, ...bodyLines].join('\n')
}

// ─── 图片 ────────────────────────────────────────────────────────────────────

function shouldSkipImage(img: HTMLImageElement): boolean {
  if (img.getAttribute('aria-hidden') === 'true') return true
  if (img.closest('button')) return true
  const cls = img.getAttribute('class') || ''
  // 头像 / 图标类
  if (/\b(avatar|icon)\b/i.test(cls)) return true
  // 空占位
  const src = img.getAttribute('src') || ''
  if (!src || src.startsWith('data:image/svg')) return true
  return false
}

function serializeImage(img: HTMLImageElement, result: ExtractResult): string {
  if (shouldSkipImage(img)) return ''
  const src = img.getAttribute('src') || ''
  const alt = (img.getAttribute('alt') || '').replace(/[\[\]]/g, '')
  result.images.push({ src, alt })
  return `![${alt}](${src})`
}

// ─── 行内序列化 ──────────────────────────────────────────────────────────────

function serializeInline(node: Node, result: ExtractResult): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || ''
    return escapeInlineText(text.replace(/\s+/g, ' '))
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as Element
  switch (el.tagName) {
    case 'BR':
      return '\n'
    case 'STRONG':
    case 'B': {
      const inner = serializeChildren(el, result).trim()
      return inner ? `**${inner.replace(/^\*\*|\*\*$/g, '')}**` : ''
    }
    case 'EM':
    case 'I': {
      const inner = serializeChildren(el, result).trim()
      return inner ? `*${inner.replace(/^\*|\*$/g, '')}*` : ''
    }
    case 'CODE': {
      const inner = el.textContent || ''
      if (!inner) return ''
      const tick = inner.includes('`') ? '``' : '`'
      return `${tick}${inner}${tick}`
    }
    case 'DEL':
    case 'S':
      return `~~${serializeChildren(el, result)}~~`
    case 'A': {
      const href = el.getAttribute('href') || ''
      // 链接标签用原始文本（不在文本节点层转义）；引用式标签 [N] 去掉外层括号
      let text = serializeChildrenRaw(el).replace(/\s+/g, ' ').trim()
      text = text.replace(/^\[(.+)\]$/, '$1')
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return text
      result.links.push({ url: href, text })
      return `[${text}](${href})`
    }
    case 'IMG':
      return serializeImage(el as HTMLImageElement, result)
    case 'SUP': {
      // 引用上标：保留数字，丢失可接受；若包含链接则按链接处理
      const a = el.querySelector('a')
      if (a) return serializeInline(a, result)
      return el.textContent || ''
    }
    case 'SPAN': {
      // KaTeX 公式（含 display 包裹）
      if (el.classList.contains('katex-display')) return serializeMath(el, result, true)
      if (el.classList.contains('katex')) return serializeMath(el, result, false)
      return serializeChildren(el, result)
    }
    case 'BUTTON':
    case 'SVG':
      return ''
    default: {
      // 数学容器（MathJax）
      if (el.tagName === 'MJX-CONTAINER') return serializeMath(el, result, false)
      return serializeChildren(el, result)
    }
  }
}

function serializeChildren(node: Node, result: ExtractResult): string {
  let out = ''
  for (const child of Array.from(node.childNodes)) {
    out += serializeInline(child, result)
  }
  return out
}

/** 原始文本（不做 Markdown 转义）—— 用于链接标签等已成形的上下文 */
function serializeChildrenRaw(node: Node): string {
  let out = ''
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent || ''
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element
      if (el.tagName === 'BR') out += ' '
      else out += serializeChildrenRaw(el)
    }
  }
  return out
}

function serializeMath(el: Element, result: ExtractResult, display: boolean): string {
  const m = recoverMath(el)
  result.formulas++
  if (!m.recovered) result.formulasDegraded++
  const latex = m.latex.replace(/\s*\\[\r\n]+\s*/g, ' ')
  return display ? `$$\n${latex}\n$$` : `$${latex}$`
}

// ─── 块级序列化 ──────────────────────────────────────────────────────────────

/** 应当整体跳过的元素（AI 网站操作按钮、折叠思考过程等） */
function shouldSkipBlock(el: Element): boolean {
  const cls = el.getAttribute('class') || ''
  const testId = el.getAttribute('data-testid') || ''
  // ChatGPT 思考过程折叠区
  if (el.tagName === 'DETAILS' && /thought|思考/i.test(el.querySelector('summary')?.textContent || '')) return true
  if (testId === 'think-tag' || cls.includes('thinking')) return true
  // 语音/操作条
  if (testId === 'composer-action-buttons' || testId === 'ftip-button' || testId === 'tts-button') return true
  // 代码块头部工具条（语言标签 + Copy 按钮）等「短文本 + 按钮」组合
  if ((el.tagName === 'DIV' || el.tagName === 'HEADER') && el.querySelector(':scope > button')) {
    const ownText = (el.textContent || '').trim()
    if (ownText.length <= 24) return true
  }
  return false
}

/** 块级元素标签：内联内容遇到它们要分段 */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE', 'PRE',
  'BLOCKQUOTE', 'HR', 'SECTION', 'ARTICLE', 'MAIN', 'FIGURE', 'DL', 'DETAILS', 'HEADER', 'FOOTER',
])

function isBlockNode(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return false
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  const el = node as Element
  if (BLOCK_TAGS.has(el.tagName)) return true
  // 块级公式容器：必须独占一段，否则相邻公式会连成 $$$$
  if (el.classList.contains('katex-display')) return true
  if (el.tagName === 'MJX-CONTAINER') return true
  return false
}

/** 把一段连续的内联节点序列化为一个段落 */
function serializeInlineRun(nodes: Node[], result: ExtractResult): string {
  let text = ''
  for (const n of nodes) text += serializeInline(n, result)
  return text.replace(/[ \t]+\n/g, '\n').trim()
}

function serializeBlockChildren(el: Element, result: ExtractResult, listDepth = 0): string {
  const parts: string[] = []
  let inlineBuffer: Node[] = []

  const flushInline = () => {
    if (inlineBuffer.length > 0) {
      const text = serializeInlineRun(inlineBuffer, result)
      if (text) parts.push(text)
      inlineBuffer = []
    }
  }

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if ((child.textContent || '').trim()) inlineBuffer.push(child)
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    if (!isBlockNode(child)) {
      inlineBuffer.push(child)
      continue
    }
    flushInline()
    const block = serializeBlock(child as Element, result, listDepth)
    if (block) parts.push(block)
  }
  flushInline()
  return parts.join('\n\n')
}

function serializeList(list: Element, result: ExtractResult, depth: number, ordered: boolean): string {
  const lines: string[] = []
  let index = 1
  for (const li of Array.from(list.children)) {
    if (li.tagName !== 'LI') continue
    const indent = '    '.repeat(depth)
    const marker = ordered ? `${index}. ` : '- '
    // task list
    const checkbox = li.querySelector('input[type="checkbox"]')
    let taskPrefix = ''
    if (checkbox) {
      taskPrefix = (checkbox as HTMLInputElement).checked ? '[x] ' : '[ ] '
    }
    // li 内部：行内内容 + 嵌套块（嵌套列表等）
    const liParts: string[] = []
    for (const child of Array.from(li.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = (child.textContent || '').replace(/\s+/g, ' ').trim()
        if (t) liParts.push(escapeInlineText(t))
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const cEl = child as Element
      if (cEl.tagName === 'UL' || cEl.tagName === 'OL') continue // 嵌套列表单独处理
      if (cEl.tagName === 'INPUT') continue
      const nested = depth < 4 ? serializeBlock(cEl, result, depth) : serializeInline(cEl, result)
      if (nested) liParts.push(nested)
    }
    const content = liParts.join('\n\n').replace(/\n{2,}/g, '\n\n')
    lines.push(`${indent}${marker}${taskPrefix}${content}`)

    // 嵌套列表
    for (const child of Array.from(li.children)) {
      if (child.tagName === 'UL') lines.push(serializeList(child, result, depth + 1, false))
      if (child.tagName === 'OL') lines.push(serializeList(child, result, depth + 1, true))
    }
    index++
  }
  return lines.filter(Boolean).join('\n')
}

export function serializeBlock(el: Element, result: ExtractResult, listDepth = 0): string {
  if (shouldSkipBlock(el)) return ''
  switch (el.tagName) {
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
      const level = Number(el.tagName[1])
      const text = serializeChildren(el, result).replace(/\s+/g, ' ').trim()
      return text ? `${'#'.repeat(level)} ${text}` : ''
    }
    case 'P':
    case 'DIV': {
      // 容器型 DIV：递归块级；文本型 DIV：行内处理
      const hasBlockChildren = Array.from(el.children).some((c) =>
        /^(P|DIV|H[1-6]|UL|OL|TABLE|PRE|BLOCKQUOTE|HR|SECTION|ARTICLE|FIGURE|DL|DETAILS)$/i.test(c.tagName),
      )
      if (el.tagName === 'P' || !hasBlockChildren) {
        // 行内元素组成
        let text = serializeChildren(el, result)
        // 公式块容器（katex-display）
        const display = el.querySelector?.('.katex-display, mjx-container[display="true"]')
        if (display && el.querySelectorAll('.katex-display, mjx-container').length === 1 && !text.replace(/\s/g, '')) {
          return serializeMath(display as Element, result, true)
        }
        text = text.replace(/[ \t]+\n/g, '\n').trim()
        return text
      }
      return serializeBlockChildren(el, result, listDepth)
    }
    case 'SECTION': case 'ARTICLE': case 'MAIN': case 'BODY':
      return serializeBlockChildren(el, result, listDepth)
    case 'UL':
      return serializeList(el, result, listDepth, false)
    case 'OL':
      return serializeList(el, result, listDepth, true)
    case 'TABLE':
      return serializeTable(el, result)
    case 'PRE':
      return serializePre(el, result)
    case 'IMG':
      return serializeImage(el as HTMLImageElement, result)
    case 'BLOCKQUOTE': {
      const inner = serializeBlockChildren(el, result, listDepth)
      if (!inner) return ''
      return inner.split('\n').map((line) => `> ${line}`.trimEnd()).join('\n')
    }
    case 'HR':
      return '---'
    case 'FIGURE': {
      const img = el.querySelector('img')
      const caption = el.querySelector('figcaption')
      const parts: string[] = []
      if (img) parts.push(serializeImage(img as HTMLImageElement, result))
      if (caption) {
        const capText = serializeChildren(caption, result).trim()
        if (capText) parts.push(`*图：${capText}*`)
      }
      return parts.join('\n\n')
    }
    case 'DETAILS': {
      // 折叠内容：展开取正文（summary 若是「思考」类则整个跳过）
      return serializeBlockChildren(el, result, listDepth)
    }
    case 'SUMMARY':
      return ''
    case 'SCRIPT': case 'STYLE': case 'NOSCRIPT': case 'BUTTON':
    case 'SVG': case 'NAV': case 'ASIDE': case 'IFRAME':
      return ''
    case 'MERMAID-CONTAINER': case 'PRE_MERMAID':
      return ''
    default: {
      // 行内公式容器
      if (el.classList.contains('katex-display')) return serializeMath(el, result, true)
      if (el.classList.contains('katex')) return serializeMath(el, result, false)
      if (el.tagName === 'MJX-CONTAINER') return serializeMath(el, result, false)
      // mermaid 渲染容器（保留源码优先，见 serializePre；此处处理渲染后的 svg 容器）
      if (el.classList.contains('mermaid') || el.querySelector?.(':scope > svg')) {
        const src = el.getAttribute('data-mermaid-src') || ''
        if (src) {
          result.mermaidBlocks++
          return '```mermaid\n' + src + '\n```'
        }
        return ''
      }
      const text = serializeChildren(el, result).replace(/[ \t]+\n/g, '\n').trim()
      return text
    }
  }
}

// ─── 对外入口 ────────────────────────────────────────────────────────────────

/**
 * 把一条消息的 DOM 容器序列化为 Markdown。
 * root 一般是平台渲染 assistant 回答的 .markdown 容器（或整条消息元素）。
 */
export function extractMarkdown(root: Element, options: ExtractOptions = {}): ExtractResult {
  const result: ExtractResult = {
    markdown: '',
    formulas: 0,
    formulasDegraded: 0,
    codeBlocks: 0,
    mermaidBlocks: 0,
    tables: 0,
    images: [],
    links: [],
  }

  const parts: string[] = []
  let inlineBuffer: Node[] = []

  const flushInline = () => {
    if (inlineBuffer.length > 0) {
      const text = serializeInlineRun(inlineBuffer, result)
      if (text) parts.push(text)
      inlineBuffer = []
    }
  }

  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if ((child.textContent || '').trim()) inlineBuffer.push(child)
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    if (!isBlockNode(child)) {
      inlineBuffer.push(child)
      continue
    }
    flushInline()
    const block = serializeBlock(child as Element, result)
    if (block.trim()) parts.push(block.trim())
  }
  flushInline()

  let markdown = parts.join('\n\n')
  if (options.maxChars && markdown.length > options.maxChars) {
    markdown = markdown.slice(0, options.maxChars) + '\n\n…（内容过长已截断）'
  }
  result.markdown = markdown
  return result
}
