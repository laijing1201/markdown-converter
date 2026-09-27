/**
 * 预览 DOM 构建 —— 网页预览与扩展导出引擎共用的唯一实现。
 *
 * 输入一段 Markdown + DocSettings，输出一个「渲染完成」的容器 DOM：
 *   markdown → markdownToSafeHtml → 容器 innerHTML
 *   → 学术启发式类名 → 标题自动编号 → 图题表题编号
 *   → KaTeX 渲染 → Mermaid 渲染
 *
 * PreviewPanel（网页实时预览）与 extension/exporter（扩展导出引擎页）
 * 都走这一份代码，保证扩展导出与网页导出消费同一份预览 DOM 结构。
 */

import katex from 'katex'
import mermaid from 'mermaid'
import { markdownToSafeHtml } from './markdown'
import { resolveTemplateBase, type DocSettings } from './templates'
import { createHeadingCounter, HEADING_NUM_CLASS } from './numbering'

// ── KaTeX 渲染缓存（formula → HTML 字符串，LRU）────────────────────────────

const katexCache = new Map<string, string>()
const KATEX_CACHE_MAX = 600

function renderKatexCached(formula: string, displayMode: boolean): string {
  const key = `${displayMode ? 'B' : 'I'}\u0000${formula}`
  const cached = katexCache.get(key)
  if (cached !== undefined) {
    // 命中后移到末尾，维持 LRU 语义
    katexCache.delete(key)
    katexCache.set(key, cached)
    return cached
  }
  const html = katex.renderToString(formula, { displayMode, throwOnError: false })
  if (katexCache.size >= KATEX_CACHE_MAX) {
    katexCache.delete(katexCache.keys().next().value as string)
  }
  katexCache.set(key, html)
  return html
}

// ── Mermaid 初始化（模块级只做一次）───────────────────────────────────────

let mermaidInit = false

function ensureMermaidInit() {
  if (mermaidInit) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'strict',
    fontFamily: 'sans-serif',
  })
  mermaidInit = true
}

// ── 学术启发式（题目/摘要/参考文献识别，仅学术论文模板）─────────────────────

function applyAcademicHeuristics(container: HTMLElement) {
  let h1Count = 0
  let isRef = false

  Array.from(container.children).forEach((el, idx) => {
    const tagName = el.tagName.toLowerCase()
    const text = el.textContent?.trim() || ''

    if (tagName === 'h1') {
      if (h1Count === 0) {
        el.classList.add('academic-title')
        h1Count++
      }
    } else if (tagName === 'h2') {
      if (text.includes('参考文献')) {
        el.classList.add('academic-ref-title')
        isRef = true
      } else if (idx === 1 && h1Count === 1) {
        el.classList.add('academic-subtitle')
      }
    } else if (tagName === 'p') {
      if (isRef) {
        el.classList.add('academic-ref-item')
      } else if (
        text.startsWith('摘要') ||
        text.startsWith('关键词') ||
        text.includes('**摘要**') ||
        text.includes('**关键词**')
      ) {
        el.classList.add('academic-abstract')
      } else if (
        text.startsWith('副标题：') ||
        text.startsWith('——') ||
        text.startsWith('副标题:')
      ) {
        el.classList.add('academic-subtitle-p')
      } else {
        el.classList.add('academic-p')
      }
    } else if (tagName === 'ul' || tagName === 'ol') {
      if (isRef) {
        el.classList.add('academic-ref-list')
      }
    }
  })
}

// ── 标题自动编号（预览侧注入，导出时剥离）─────────────────────────────────

/**
 * 与 exporter 的 Word 映射保持一致：
 *   通用/商务：h1→1、h2→1.1、h3→1.1.1，h4 及以下不编号；
 *   学术：首个 h1 是论文题目（不编号），h2→1、h3→1.1、h4→1.1.1，
 *         副标题/参考文献标题不编号。
 */
function applyHeadingNumbers(container: HTMLElement, settings: DocSettings) {
  const mode = settings.headingNumbering
  if (mode === 'off') return
  const counter = createHeadingCounter(mode)
  const academic = resolveTemplateBase(settings.template).academicHeuristics
  let h1Count = 0

  Array.from(container.children).forEach((el) => {
    const tag = el.tagName.toLowerCase()
    if (!/^h[1-4]$/.test(tag)) return
    const level = Number(tag[1])
    let numLevel = level
    let skip = false

    if (academic) {
      if (level === 1) {
        h1Count++
        skip = true // 首个是论文题目；后续 h1 在学术映射下是 Heading4，均不编号
      } else if (level === 2) {
        numLevel = 1
        skip = el.classList.contains('academic-subtitle') || el.classList.contains('academic-ref-title')
      } else if (level === 3) {
        numLevel = 2
      } else {
        numLevel = 3
      }
    } else if (level >= 4) {
      skip = true
    }

    const label = counter(numLevel, skip)
    if (label) {
      const span = document.createElement('span')
      span.className = HEADING_NUM_CLASS
      span.textContent = `${label} `
      el.insertBefore(span, el.firstChild)
    }
  })
}

// ── 图题/表题自动编号（图 1、图 2 … 表 1、表 2 …）─────────────────────────

function applyCaptionNumbers(container: HTMLElement) {
  let fig = 0
  let tbl = 0
  container.querySelectorAll<HTMLElement>('.block-caption').forEach((el) => {
    const kind = el.getAttribute('data-kind') === 'tbl' ? 'tbl' : 'fig'
    const num = kind === 'fig' ? ++fig : ++tbl
    const text = el.textContent || ''

    el.textContent = ''
    const numSpan = document.createElement('span')
    numSpan.className = 'caption-num'
    numSpan.textContent = `${kind === 'fig' ? '图' : '表'} ${num}`
    const textSpan = document.createElement('span')
    textSpan.className = 'caption-text'
    textSpan.textContent = text
    el.append(numSpan, textSpan)
  })
}

// ── 表格列宽均衡（防 CJK 长文本被挤成一字一行）─────────────────────────────

/**
 * 浏览器的 auto 表格布局在「列数多 + CJK 长文本」时会把部分列挤到只剩
 * 一两个字的宽度：CJK 任意字符都可断行，这些列的 min-content 极小，
 * 宽度分配会饥饿。这里按各列内容长度加权注入 colgroup 百分比宽度并启用
 * fixed 布局，让列宽与内容量成比例。预览与导出（克隆预览 DOM）两端同时生效。
 */
function balanceTableColumns(container: HTMLElement): void {
  container.querySelectorAll('table').forEach((table) => {
    if (table.querySelector('colgroup')) return // 已有列宽定义，不覆盖
    const rows = Array.from(table.rows)
    let colCount = 0
    for (const tr of rows) colCount = Math.max(colCount, tr.cells.length)
    if (colCount < 2) return

    // 权重 = 该列最长单元格的近似渲染宽度：CJK/全角字符按 2 单位、其余按 1
    // （总长截到 80，最长不可断单词截到 120 —— URL/长标识符列需要保底宽度）。
    // colspan 不计入。
    const unitLen = (s: string): number => {
      let n = 0
      for (const ch of s) n += /[\u1100-\u11FF\u2E80-\uA4CF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 2 : 1
      return n
    }
    const weights = new Array<number>(colCount).fill(0)
    const longestPx = new Array<number>(colCount).fill(0)
    // 不可断 token 宽度用 canvas 按单元格自身字体实测；
    // 无 canvas 环境（jsdom）退化为字符数 × 8px 估算
    let measurer: CanvasRenderingContext2D | null = null
    try {
      measurer = container.ownerDocument!.createElement('canvas').getContext('2d')
    } catch { /* ignore */ }
    const tokenPx = (token: string, cell: HTMLElement): number => {
      if (!measurer) return token.length * 8
      const cs = getComputedStyle(cell)
      measurer.font = `${cs.fontSize} ${cs.fontFamily}`
      // ×1.2：PDF 嵌入的 Noto 系字体拉丁字形比预览字体（宋体系）更宽
      return measurer.measureText(token).width * 1.2
    }
    for (const tr of rows) {
      for (const cell of Array.from(tr.cells)) {
        if (cell.colSpan > 1) continue
        const idx = cell.cellIndex
        if (idx < 0 || idx >= colCount) continue
        const text = (cell.textContent || '').replace(/\s+/g, ' ').trim()
        // 不可断 token = 不含 CJK/全角字符与空格的连续串：
        // CJK 任意字符都可断行，不构成 min-content；Latin/URL/标识符才会
        let longest = 0
        let longestToken = ''
        for (const token of text.split(/[\u1100-\u11FF\u2E80-\uA4CF\uF900-\uFAFF\uFF00-\uFFEF\s]+/)) {
          if (token && unitLen(token) > longest) {
            longest = unitLen(token)
            longestToken = token
          }
        }
        longestPx[idx] = Math.max(longestPx[idx], longestToken ? tokenPx(longestToken, cell) : 0)
        weights[idx] = Math.max(weights[idx], Math.max(Math.min(unitLen(text), 80), Math.min(longest, 120)))
      }
    }
    const total = weights.reduce((a, b) => a + b, 0)
    if (total <= 0) return

    // 每列保底「均值一半」的百分比，防止极短列仍被压到一字宽；
    // 另外保底「最长不可断 token」的实测宽度（+ 单元格内边距/边框约 30px），
    // 与浏览器 auto 布局的 min-content 行为对齐，避免 Woodbury 这类单词被截断
    const minPct = 50 / colCount
    const tableW = table.clientWidth || 0
    const floors = weights.map((_, i) => {
      const minContentPct = tableW > 0 && measurer
        ? ((Math.min(longestPx[i], 900) + 30) / tableW) * 100
        : 0
      return Math.max(minPct, minContentPct)
    })
    let pcts = weights.map((w, i) => Math.max((w / total) * 100, floors[i]))
    const pctsTotal = pcts.reduce((a, b) => a + b, 0)
    if (pctsTotal > 100) {
      // 超预算：只从高于保底的列按盈余比例扣（水位法），保底列不动；
      // 连保底都放不下时整体等比压缩（此时单词断行不可避免）
      const surplusTotal = pcts.reduce((a, p, i) => a + Math.max(0, p - floors[i]), 0)
      const deficit = pctsTotal - 100
      if (surplusTotal > deficit) {
        const keep = (surplusTotal - deficit) / surplusTotal
        pcts = pcts.map((p, i) => floors[i] + Math.max(0, p - floors[i]) * keep)
      } else {
        pcts = pcts.map((p) => (p / pctsTotal) * 100)
      }
    }

    const colgroup = table.ownerDocument!.createElement('colgroup')
    pcts.forEach((pct) => {
      const col = table.ownerDocument!.createElement('col')
      col.style.width = `${pct.toFixed(2)}%`
      colgroup.appendChild(col)
    })
    table.insertBefore(colgroup, table.firstChild)
    ;(table as HTMLTableElement).style.tableLayout = 'fixed'
  })
}

// ── KaTeX / Mermaid 渲染 ─────────────────────────────────────────────────

/** 把容器内 .math-inline / .math-block[data-formula] 渲染成 KaTeX HTML */
export function renderMathIn(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('.math-inline').forEach((el) => {
    if (el.querySelector('.katex')) return // already rendered
    const raw = el.getAttribute('data-formula')
    if (!raw) return
    const formula = decodeURIComponent(raw)
    try {
      el.innerHTML = renderKatexCached(formula, false)
    } catch {
      el.textContent = `$${formula}$`
    }
  })

  container.querySelectorAll<HTMLElement>('.math-block').forEach((el) => {
    if (el.querySelector('.katex')) return // already rendered
    const raw = el.getAttribute('data-formula')
    if (!raw) return
    const formula = decodeURIComponent(raw)
    try {
      el.innerHTML = renderKatexCached(formula, true)
    } catch {
      el.textContent = `$$${formula}$$`
    }
  })
}

/** 把容器内 pre>code.language-mermaid 渲染成 .mermaid-rendered SVG（异步） */
export async function renderMermaidIn(container: HTMLElement): Promise<void> {
  ensureMermaidInit()

  const els = container.querySelectorAll<HTMLElement>('pre > code')
  if (els.length === 0) return

  const tasks: Promise<void>[] = []

  els.forEach((codeEl) => {
    const pre = codeEl.parentElement
    if (!pre) return

    const isMermaid = codeEl.className.includes('mermaid') || codeEl.classList.contains('language-mermaid')
    if (!isMermaid) return
    if (pre.dataset.mermaidRendered === 'true') return

    pre.dataset.mermaidRendered = 'true'
    const diagramText = codeEl.textContent || ''
    const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    const task = mermaid
      .render(id, diagramText)
      .then(({ svg }) => {
        const wrapper = document.createElement('div')
        wrapper.className = 'mermaid-rendered my-6 flex justify-center'
        wrapper.innerHTML = svg
        // 记录图表源码：导出截图失败时据此还原为代码块（见 exporter.mermaidFallbackToCode）
        wrapper.setAttribute('data-mermaid-source', diagramText)
        pre.parentNode?.replaceChild(wrapper, pre)
      })
      .catch((err: unknown) => {
        console.error('Mermaid render error:', err)
        const errDiv = document.createElement('div')
        // tailwind 类在网页端生效；扩展导出页没有 tailwind，退回 .mermaid-error 基础样式
        errDiv.className =
          'mermaid-error my-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm'
        const msg = document.createElement('p')
        msg.className = 'mermaid-error-msg font-medium'
        msg.textContent = '⚠ Mermaid 图表渲染失败，请检查图表语法是否正确（详情见浏览器控制台）'
        // 原始代码必须保留（预览可见、导出为代码块），供用户修正语法后重新导出
        const srcPre = document.createElement('pre')
        srcPre.className = 'mermaid-error-code mt-2 text-xs whitespace-pre-wrap font-mono'
        const srcCode = document.createElement('code')
        srcCode.textContent = diagramText
        srcPre.appendChild(srcCode)
        errDiv.appendChild(msg)
        errDiv.appendChild(srcPre)
        pre.parentNode?.replaceChild(errDiv, pre)
      })

    tasks.push(task)
  })

  await Promise.allSettled(tasks)
}

// ── 完整管线 ─────────────────────────────────────────────────────────────

/**
 * 把 Markdown 渲染进容器（清空原内容）。
 * 返回的 Promise 在 KaTeX + Mermaid 全部完成后 resolve。
 * container 应带 .md-preview 与模板 class（md-preview tpl-xxx a4-page）。
 */
export async function renderPreviewDom(container: HTMLElement, content: string, settings: DocSettings): Promise<void> {
  // 1. markdown → safe HTML
  const html = markdownToSafeHtml(content)

  // 2. 写入 DOM
  container.innerHTML = html

  // 3. 学术启发式（只在学术论文模板下启用）
  if (resolveTemplateBase(settings.template).academicHeuristics) {
    applyAcademicHeuristics(container)
  }

  applyHeadingNumbers(container, settings)
  applyCaptionNumbers(container)
  balanceTableColumns(container)

  // 4. KaTeX + Mermaid（需要 DOM 已存在；等一帧与网页预览行为一致）
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  renderMathIn(container)
  await renderMermaidIn(container)
}
