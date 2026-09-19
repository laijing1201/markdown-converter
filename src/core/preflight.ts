/**
 * 导出前质量检查 —— 在用户点「导出 Word」时跑一遍：
 *   - 复用 validator 的结构/编码检查
 *   - 逐条公式用 KaTeX 严格模式试渲染，找出语法错误
 *   - 检测外链图片（导出 Word 时可能因跨域无法嵌入）
 *   - 标题层级跳跃 / 空标题
 *   - 预览 DOM 上的实测：图片加载失败、图片过大、超宽表格、Mermaid 失败
 *   - 不支持的媒体节点 / 文档规模 / 本地存储空间
 *
 * 分级：绿色（通过）/ 黄色（警告）/ 红色（错误）。
 * 只有会内容丢失或严重排版损坏的才标红；所有问题都不强制阻止导出。
 */

import katex from 'katex'
import { validateMarkdown, detectEncodingIssues } from './validator'
import { extractFormulas, countPagebreaks } from './markdown'
import { consumeHistoryError } from './history'

export type PreflightTarget = 'docx' | 'pdf'

export interface PreflightStats {
  headings: number
  math: number
  tables: number
  images: number
  codeBlocks: number
  pagebreaks: number
  chars: number
}

export interface PreflightIssue {
  level: 'error' | 'warn'
  message: string
}

export interface PreflightResult {
  stats: PreflightStats
  issues: PreflightIssue[]
}

const MAX_DOC_CHARS = 150_000
const MAX_IMAGE_PX = 3000
const MAX_TABLE_COLS = 9

/** 轻量探测 localStorage 是否还有写入空间（探测值立即删除） */
function probeLocalStorageOk(): boolean {
  try {
    const key = 'markdoc.quota-probe'
    localStorage.setItem(key, 'x'.repeat(256 * 1024))
    localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

/** 从 Markdown 源码提取标题行（跳过代码块内），返回 {level, line} */
function scanHeadings(markdown: string): Array<{ level: number; line: number }> {
  const out: Array<{ level: number; line: number }> = []
  const lines = markdown.split('\n')
  let inFence = false
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence
      return
    }
    if (inFence) return
    const m = line.match(/^(#{1,6})\s+\S/)
    if (m) out.push({ level: m[1].length, line: i + 1 })
  })
  return out
}

export function runPreflight(markdown: string, previewHtml: string, target: PreflightTarget = 'docx'): PreflightResult {
  const issues: PreflightIssue[] = []
  const isPdf = target === 'pdf'

  const headings = (markdown.match(/^#{1,6}\s+\S/gm) || []).length
  const codeFences = (markdown.match(/^```/gm) || []).length
  const tableRows = (markdown.match(/^\|.+\|\s*$/gm) || []).filter(
    (l) => !/^[\s|:\-]+$/.test(l.trim()),
  ).length
  const images = (markdown.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length
  const formulas = extractFormulas(markdown)
  const pagebreaks = countPagebreaks(markdown)

  // 结构与编码警告
  for (const w of [...validateMarkdown(markdown), ...detectEncodingIssues(markdown)]) {
    issues.push({ level: w.type, message: `第 ${w.line} 行：${w.message}` })
  }

  // 公式语法：KaTeX 严格试渲染
  formulas.forEach((f) => {
    try {
      katex.renderToString(f.formula, {
        displayMode: f.isBlock,
        throwOnError: true,
        strict: false,
      })
    } catch {
      const preview = f.formula.length > 32 ? `${f.formula.slice(0, 32)}…` : f.formula
      issues.push({
        level: 'error',
        message: `第 ${f.line} 行：公式无法解析，请检查括号与符号是否完整（${preview}），导出后会以原文显示`,
      })
    }
  })

  // 标题层级跳跃（如 H1 直接跳 H4）
  const headingSeq = scanHeadings(markdown)
  for (let i = 1; i < headingSeq.length; i++) {
    const prev = headingSeq[i - 1]
    const cur = headingSeq[i]
    if (cur.level > prev.level + 1) {
      issues.push({
        level: 'warn',
        message: `第 ${cur.line} 行：标题层级跳跃（H${prev.level} → H${cur.level}），可能影响目录层级`,
      })
    }
  }

  // 外链图片（预览 HTML 中非 data: 的图片）
  if (previewHtml) {
    const doc = new DOMParser().parseFromString(`<div>${previewHtml}</div>`, 'text/html')
    const externalImages = Array.from(doc.querySelectorAll('img')).filter((img) =>
      /^https?:/i.test(img.getAttribute('src') || ''),
    )
    if (externalImages.length > 0) {
      issues.push({
        level: 'warn',
        message: `检测到 ${externalImages.length} 张网络图片，若对方网站禁止跨域，导出时无法载入该图片`,
      })
    }

    // 不支持的媒体/嵌入节点（导出会丢失）
    const unsupported = doc.querySelectorAll('video, audio, iframe, object, embed, canvas')
    if (unsupported.length > 0) {
      issues.push({
        level: 'warn',
        message: `包含 ${unsupported.length} 个视频/音频/网页嵌入等元素，${isPdf ? 'PDF' : 'Word'} 不支持，导出时会丢失`,
      })
    }
  }

  // ── 依赖实时预览 DOM 的实测检查（jsdom/测试环境没有实时预览时自动跳过）──
  const livePreview = typeof document !== 'undefined' ? document.getElementById('preview-container') : null
  if (livePreview) {
    // 图片加载失败
    const brokenImages = Array.from(livePreview.querySelectorAll('img')).filter(
      (img) => img.complete && img.naturalWidth === 0,
    )
    if (brokenImages.length > 0) {
      issues.push({
        level: 'warn',
        message: `${brokenImages.length} 张图片加载失败，导出的${isPdf ? ' PDF' : ' Word'}中会以占位文字代替，请检查图片链接`,
      })
    }

    // 图片分辨率过大
    const oversized = Array.from(livePreview.querySelectorAll('img')).filter(
      (img) => img.naturalWidth > MAX_IMAGE_PX,
    )
    if (oversized.length > 0) {
      issues.push({
        level: 'warn',
        message: `${oversized.length} 张图片分辨率超过 ${MAX_IMAGE_PX}px，导出的文件可能非常大`,
      })
    }

    // 超大 Base64 图片（会把 PDF 撑大）
    if (isPdf) {
      const hugeDataImages = Array.from(livePreview.querySelectorAll('img')).filter((img) => {
        const src = img.getAttribute('src') || ''
        return src.startsWith('data:image') && src.length > 2_800_000 // ≈ 2MB base64
      })
      if (hugeDataImages.length > 0) {
        issues.push({
          level: 'warn',
          message: `${hugeDataImages.length} 张图片体积较大（>2MB），可能使 PDF 文件显著增大；可在导出时选择「标准」图片质量`,
        })
      }
    }

    // 超宽表格（预览已出现横向溢出）
    let wideTables = 0
    let manyCols = 0
    livePreview.querySelectorAll('table').forEach((table) => {
      if (table.scrollWidth > table.clientWidth + 8) wideTables++
      else {
        const cols = table.querySelector('tr')?.children.length ?? 0
        if (cols >= MAX_TABLE_COLS) manyCols++
      }
    })
    if (wideTables > 0) {
      issues.push({
        level: 'warn',
        message: isPdf
          ? `${wideTables} 张表格超出页面宽度，PDF 中会等比缩放显示（文字变小），建议减少列数`
          : `${wideTables} 张表格超出页面宽度，建议减少列数或缩短单元格文字`,
      })
    } else if (manyCols > 0) {
      issues.push({
        level: 'warn',
        message: `${manyCols} 张表格列数较多（≥${MAX_TABLE_COLS} 列），导出后可能偏挤`,
      })
    }

    // Mermaid 渲染失败
    const mermaidErrors = livePreview.querySelectorAll('.mermaid-error').length
    if (mermaidErrors > 0) {
      issues.push({
        level: 'warn',
        message: `${mermaidErrors} 个 Mermaid 图表渲染失败，导出的${isPdf ? ' PDF' : ' Word'}中不会包含该图，请检查图表语法`,
      })
    }
  }

  // 文档规模
  if (markdown.length > MAX_DOC_CHARS) {
    issues.push({
      level: 'warn',
      message: `文档较大（约 ${Math.round(markdown.length / 10000)} 万字符），导出可能需要一些时间，请耐心等待`,
    })
  }

  // 本地存储：历史保存失败 / 配额紧张
  const historyError = consumeHistoryError()
  if (historyError) {
    issues.push({ level: 'warn', message: `本地历史：${historyError}，建议清理历史或先导出备份` })
  }
  if (typeof localStorage !== 'undefined' && !probeLocalStorageOk()) {
    issues.push({
      level: 'warn',
      message: '浏览器本地存储空间不足，历史记录与设置可能无法保存（不影响本次导出）',
    })
  }

  return {
    stats: {
      headings,
      math: formulas.length,
      tables: tableRows,
      images,
      codeBlocks: Math.floor(codeFences / 2),
      pagebreaks,
      chars: markdown.length,
    },
    issues,
  }
}
