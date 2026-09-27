import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  WidthType,
  ImageRun,
  AlignmentType,
  ExternalHyperlink,
  ImportedXmlComponent,
  TableOfContents,
  Footer,
  Header,
  PageNumber,
  LevelFormat,
  LevelSuffix,
  PageBreak,
  PageOrientation,
  ShadingType,
  VerticalMergeType,
} from 'docx'
import { latexToOmml } from './omml'
import {
  resolveTemplateBase,
  getMarginsTwips,
  PAGE_SIZE_TWIPS,
  type DocSettings,
  type TableStyle,
} from './templates'

export interface ExportOptions {
  settings: DocSettings
  /**
   * 「实时预览」容器（公式/Mermaid 截图按它与克隆 DOM 配对）。
   * 缺省取页面上的 #preview-container；批量导出等离屏管线需要显式传入。
   */
  sourceEl?: HTMLElement | null
}

/** 导出质量统计（导出日志 + 导出后「质量自检报告」共用，见 core/exportLog） */
export interface DocxExportStats {
  mathTotal: number
  mathOmml: number
  mathDegraded: number
  /** 转 OMML 失败、被降级处理的公式原文（自检报告逐条列出，可对照行号） */
  degradedFormulas: string[]
  tables: number
  tablesFromEmbeddedText: number
  /** Mermaid 图：预览中成功渲染的总数 / 导出时成功截图嵌入的数量 */
  mermaidTotal: number
  mermaidCaptured: number
}
let lastDocxStats: DocxExportStats | null = null
/** 最近一次 buildDocxBlob 的质量统计（导出完成后读取） */
export function getLastDocxExportStats(): DocxExportStats | null {
  return lastDocxStats
}

// PDF 导出已迁移到 src/core/pdf/*（真正的文本 PDF，见 pdf/export.ts）

// ─── DOCX Export ─────────────────────────────────────────────────────────────

interface ExportContext {
  cfg: ReturnType<typeof resolveTemplateBase>
  settings: DocSettings
  /** 克隆 DOM 中的公式元素 → OMML 公式组件（WeakMap 免去自定义属性） */
  mathMap: WeakMap<HTMLElement, ImportedXmlComponent>
}

interface ParseState {
  h1Count: number
  isReferenceSection: boolean
  figCount: number
  tblCount: number
  /** 引用块嵌套深度（嵌套 blockquote 递归缩进） */
  quoteDepth: number
}

const PREVIEW_ID = 'preview-container'

/** 需要"克隆 DOM ↔ 实时预览"配对捕获的元素 */
const CAPTURE_SELECTOR = '.mermaid-rendered, .math-block, .math-inline'

const HEADING_STYLE_LEVEL: Record<string, number> = { Heading1: 1, Heading2: 2, Heading3: 3 }

/**
 * 构建 DOCX Blob（导出/测试共用）：不做任何下载动作。
 * options.settings 驱动页面几何、字体、行距、边距、标题编号等全部排版项。
 */
export async function buildDocxBlob(innerHtml: string, options: ExportOptions): Promise<Blob> {
  const { settings } = options
  const parser = new DOMParser()
  const doc = parser.parseFromString(
    `<div id="root">${innerHtml}</div>`,
    'text/html',
  )
  const root = doc.getElementById('root')!

  const cfg = resolveTemplateBase(settings.template)
  const ctx: ExportContext = { cfg, settings, mathMap: new WeakMap() }
  lastDocxStats = {
    mathTotal: 0, mathOmml: 0, mathDegraded: 0, degradedFormulas: [],
    tables: 0, tablesFromEmbeddedText: 0, mermaidTotal: 0, mermaidCaptured: 0,
  }

  await prepareAssets(root, ctx, options.sourceEl ?? null)

  // 2. Convert DOM to docx elements
  const state: ParseState = { h1Count: 0, isReferenceSection: false, figCount: 0, tblCount: 0, quoteDepth: 0 }
  let children = parseBlockNodes(root, ctx, state)
  children = children.filter(Boolean)

  // 目录：插入在第一个块（大标题）之后
  if (settings.includeToc && children.length > 0) {
    children = [
      children[0],
      new Paragraph({
        children: [new TextRun({ text: '目  录', bold: true, size: 28, font: { ascii: settings.headingFont, hAnsi: settings.headingFont, eastAsia: settings.headingFont } })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 240 },
        indent: { firstLine: 0 },
      }),
      new TableOfContents('目录', { hyperlink: true, headingStyleRange: '1-3' }),
      ...children.slice(1),
    ]
  }

  // docx 库在 orientation=landscape 时会自行交换宽高，
  // 因此这里始终传该纸张的纵向尺寸，避免双重交换。
  const pageSize = PAGE_SIZE_TWIPS[settings.paper]
  const margins = getMarginsTwips(settings)

  // 页眉 / 页脚：与 PDF 导出共用同一 DocSettings
  const alignOf = () =>
    settings.pageNumberAlign === 'right'
      ? AlignmentType.RIGHT
      : settings.pageNumberAlign === 'left'
        ? AlignmentType.LEFT
        : AlignmentType.CENTER
  const wantsFooter = settings.includePageNumbers || !!settings.footerText.trim()
  const footerChildren: Paragraph[] = wantsFooter
    ? [
        new Paragraph({
          alignment: alignOf(),
          indent: { firstLine: 0 },
          children: [
            ...(settings.footerText.trim() ? [new TextRun({ text: settings.footerText, size: 18, color: '666666' })] : []),
            ...(settings.includePageNumbers
              ? [
                  ...(settings.footerText.trim() ? [new TextRun({ text: '　', size: 18, color: '666666' })] : []),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '666666' }),
                ]
              : []),
          ],
        }),
      ]
    : []
  const headerChildren: Paragraph[] = settings.headerText.trim()
    ? [
        new Paragraph({
          alignment: AlignmentType.LEFT,
          indent: { firstLine: 0 },
          children: [new TextRun({ text: settings.headerText, size: 18, color: '666666' })],
        }),
      ]
    : []
  const titlePage = settings.hideFirstPageNumber

  const docxDoc = new Document({
    features: { updateFields: settings.includeToc },
    numbering: buildNumbering(settings),
    styles: buildStyles(cfg, settings),
    sections: [
      {
        properties: {
          titlePage,
          page: {
            size: {
              width: pageSize.width,
              height: pageSize.height,
              orientation:
                settings.orientation === 'landscape'
                  ? PageOrientation.LANDSCAPE
                  : PageOrientation.PORTRAIT,
            },
            margin: {
              top: margins.top,
              right: margins.right,
              bottom: margins.bottom,
              left: margins.left,
            },
          },
        },
        headers: headerChildren.length
          ? { default: new Header({ children: headerChildren }), ...(titlePage ? { first: new Header({ children: [] }) } : {}) }
          : undefined,
        footers: footerChildren.length
          ? { default: new Footer({ children: footerChildren }), ...(titlePage ? { first: new Footer({ children: [] }) } : {}) }
          : undefined,
        children: children,
      },
    ],
  })

  return Packer.toBlob(docxDoc)
}

/** 真实用户导出：构建 Blob 后交给平台层（Web=浏览器下载，Electron=原生另存为） */
export async function exportToDocx(innerHtml: string, filename: string, options: ExportOptions) {
  const blob = await buildDocxBlob(innerHtml, options)
  const { platform } = await import('../platform')
  await platform.saveOrDownload(blob, `${filename}.docx`)
}

// ─── Asset preparation (formulas → OMML, images → dataURL) ──────────────────

/**
 * 导出前的素材准备，全部在克隆 DOM 上进行：
 *
 * 1. 公式：优先 LaTeX→OMML 转成 Word 原生公式；失败才降级为
 *    html2canvas 截图（与实时预览中的元素按下标配对）。
 * 2. Mermaid：始终截图（图形本身就是图）。
 * 3. 外链图片：尝试 fetch 转 base64 嵌入；失败保留 http src，
 *    由解析阶段降级为占位文本。
 * 4. 所有缺少尺寸信息的图片测量并写入宽高，避免导出后变形。
 */
async function prepareAssets(root: HTMLElement, ctx: ExportContext, sourceEl: HTMLElement | null) {
  const liveContainer = sourceEl ?? document.getElementById(PREVIEW_ID)

  // ── 公式与 Mermaid：克隆/实时 DOM 按"同一 innerHTML 快照"按下标配对 ──
  const cloneEls = Array.from(root.querySelectorAll<HTMLElement>(CAPTURE_SELECTOR))
  const liveEls = liveContainer
    ? Array.from(liveContainer.querySelectorAll<HTMLElement>(CAPTURE_SELECTOR))
    : []

  const canPair = liveContainer !== null && cloneEls.length === liveEls.length

  if (!canPair && cloneEls.some((el) => isMathEl(el))) {
    console.warn('export: preview/live element count mismatch, formulas fall back to text')
  }
  if (!canPair && cloneEls.some((el) => el.classList.contains('mermaid-rendered'))) {
    console.warn('export: mermaid capture skipped (live container missing or count mismatch)', {
      hasLiveContainer: liveContainer !== null,
      cloneCount: cloneEls.length,
      liveCount: liveEls.length,
    })
  }

  const tasks: Promise<void>[] = []

  for (let i = 0; i < cloneEls.length; i++) {
    const cloneEl = cloneEls[i]
    if (cloneEl.classList.contains('mermaid-rendered')) {
      if (lastDocxStats) lastDocxStats.mermaidTotal++
      if (canPair) {
        // Mermaid 图形本身是位图/矢量图，用 3× 采样保证打印与缩放清晰（与 PDF 管线一致）
        tasks.push(captureAsImage(cloneEl, liveEls[i], 3).then((ok) => {
          if (ok) {
            if (lastDocxStats) lastDocxStats.mermaidCaptured++
          } else {
            mermaidFallbackToCode(cloneEl)
          }
        }))
      } else {
        // 无实时容器（离屏/无头导出）：无法截图，保留图表源码供用户手动处理
        mermaidFallbackToCode(cloneEl)
      }
      continue
    }

    // math-block / math-inline：先尝试原生 OMML
    const formula = decodeURIComponent(cloneEl.getAttribute('data-formula') || '')
    const displayMode = cloneEl.classList.contains('math-block')
    if (lastDocxStats) lastDocxStats.mathTotal++
    if (formula) {
      const component = latexToOmml(formula, displayMode)
      if (component) {
        ctx.mathMap.set(cloneEl, component)
        if (lastDocxStats) lastDocxStats.mathOmml++
        continue
      }
    }
    if (lastDocxStats) {
      lastDocxStats.mathDegraded++
      lastDocxStats.degradedFormulas.push(formula)
    }
    if (canPair) {
      tasks.push(captureAsImage(cloneEl, liveEls[i], 2).then((ok) => {
        // 截图也失败：退回纯文本，避免解析 .katex 内部结构产生乱码
        if (!ok) cloneEl.textContent = displayMode ? `$$${formula}$$` : `$${formula}$`
      }))
    } else {
      cloneEl.textContent = displayMode ? `$$${formula}$$` : `$${formula}$`
    }
  }

  // ── 外链图片 → base64 ──
  root.querySelectorAll<HTMLImageElement>('img[src^="http"]').forEach((img) => {
    tasks.push(fetchImageIntoClone(img))
  })

  // ── 无尺寸图片 → 测量并写入宽高（含粘贴的 base64 图）──
  root.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    if (img.style.width && img.style.height) return
    const src = img.getAttribute('src') || ''
    if (src.startsWith('data:image')) {
      tasks.push(measureIntoClone(img, src))
    }
  })

  await Promise.allSettled(tasks)
}

function isMathEl(el: Element): boolean {
  return el.classList.contains('math-block') || el.classList.contains('math-inline')
}

/**
 * Mermaid 截图失败/无实时容器时的兜底：把渲染占位 div 还原为代码块，
 * 保证「图表源码绝不丢失、也绝不以 SVG 垃圾形式进入正文」——用户在 Word
 * 里看到的是可复制的 mermaid 源码，可修好语法后再来导出。
 */
function mermaidFallbackToCode(cloneEl: HTMLElement) {
  const source = cloneEl.getAttribute('data-mermaid-source') || ''
  const doc = cloneEl.ownerDocument
  const pre = doc.createElement('pre')
  const code = doc.createElement('code')
  code.textContent = source || '（Mermaid 图表源码缺失：渲染失败且未保留原始代码）'
  pre.appendChild(code)
  cloneEl.parentNode?.replaceChild(pre, cloneEl)
}

async function captureAsImage(cloneEl: HTMLElement, liveEl: HTMLElement, scale = 2): Promise<boolean> {
  try {
    const html2canvas = (await import('html2canvas')).default
    const canvas = await html2canvas(liveEl, {
      scale,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    })
    const dataUrl = canvas.toDataURL('image/png')
    const rect = liveEl.getBoundingClientRect()

    const img = cloneEl.ownerDocument.createElement('img')
    img.src = dataUrl
    img.style.width = `${rect.width}px`
    img.style.height = `${rect.height}px`
    cloneEl.parentNode?.replaceChild(img, cloneEl)
    return true
  } catch (err) {
    console.warn('export: mermaid/math capture failed', err instanceof Error ? err.message : err)
    return false
  }
}

async function fetchImageIntoClone(img: HTMLImageElement) {
  const src = img.getAttribute('src') || ''
  if (!/^https?:/i.test(src)) return
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    const res = await fetch(src, { signal: ctrl.signal, mode: 'cors' })
    clearTimeout(timer)
    if (!res.ok) return
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) return
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    img.setAttribute('src', dataUrl)
    await measureIntoClone(img, dataUrl)
  } catch {
    // 保留 http src：解析阶段降级为 [Image: alt] 占位文本
  }
}

async function measureIntoClone(img: HTMLImageElement, src: string) {
  try {
    const dims = await measureImage(src)
    let { width, height } = dims
    const maxW = 560
    if (width > maxW) {
      height = Math.round(height * (maxW / width))
      width = maxW
    }
    img.style.width = `${width}px`
    img.style.height = `${height}px`
  } catch { /* keep defaults */ }
}

function measureImage(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve({ width: im.naturalWidth || 400, height: im.naturalHeight || 300 })
    im.onerror = reject
    im.src = src
  })
}

// ─── Numbering config（有序列表 + 标题多级编号）──────────────────────────────

const ORDERED_NUMBERING = {
  config: [
    {
      reference: 'markdoc-ordered',
      levels: [0, 1, 2, 3, 4].map((level) => ({
        level,
        format: LevelFormat.DECIMAL,
        text: `%${level + 1}.`,
        alignment: AlignmentType.START,
        style: {
          paragraph: { indent: { left: 720 + level * 720, hanging: 360 } },
        },
      })),
    },
  ],
}

/** 标题编号：真正的 Word 多级编号（numPr），TOC 域生成时会带上编号 */
function buildNumbering(settings: DocSettings) {
  if (settings.headingNumbering === 'off') return ORDERED_NUMBERING
  const headingLevel = (text: string, level: number) => ({
    level,
    format: LevelFormat.DECIMAL,
    text,
    suffix: LevelSuffix.SPACE,
    alignment: AlignmentType.START,
    style: {
      paragraph: { indent: { left: 0, hanging: 0 } },
    },
  })
  return {
    config: [
      ...ORDERED_NUMBERING.config,
      {
        reference: 'markdoc-headings',
        levels: [
          headingLevel('%1', 0),
          headingLevel('%1.%2', 1),
          headingLevel('%1.%2.%3', 2),
        ],
      },
    ],
  }
}

// ─── Template styles ─────────────────────────────────────────────────────────

const bodyFontObj = (s: DocSettings) => ({ ascii: s.bodyFontEn, hAnsi: s.bodyFontEn, eastAsia: s.bodyFontZh })
const headingFontObj = (s: DocSettings) => ({ ascii: s.headingFont, hAnsi: s.headingFont, eastAsia: s.headingFont })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildStyles(cfg: ReturnType<typeof resolveTemplateBase>, s: DocSettings): any {
  const heading = (id: string, name: string, size: number, color: string, spacing: { before: number; after: number }, center = false)=> ({
    id, name, basedOn: 'Normal', next: 'Normal', quickFormat: true,
    run: { size, bold: true, font: headingFontObj(s), color },
    paragraph: {
      spacing,
      alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
      indent: { firstLine: 0 },
    },
  })

  const caption = {
    id: 'Caption', name: 'Caption', basedOn: 'Normal', next: 'Normal', quickFormat: true,
    run: { size: 21, bold: true, font: bodyFontObj(s), color: '404040' },
    paragraph: {
      spacing: { before: 60, after: 120, line: 240 },
      alignment: AlignmentType.CENTER,
      indent: { firstLine: 0 },
    },
  }

  const listParagraph = {
    id: 'ListParagraph', name: 'List Paragraph', basedOn: 'Normal', quickFormat: true,
    paragraph: { spacing: { before: 20, after: 40 }, indent: { firstLine: 0 } },
  }

  if (cfg.academicHeuristics) {
    // 学术论文模板：保留完整的论文样式（题目/副标题/摘要/参考文献）
    return {
      default: {
        document: {
          run: { size: s.bodySize, font: bodyFontObj(s), color: '000000' },
          paragraph: {
            spacing: { line: s.lineSpacing, before: Math.round(s.spaceBeforePt * 20), after: Math.round(s.spaceAfterPt * 20) },
            alignment: s.bodyAlign === 'justify' ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
            indent: { firstLine: s.firstLineIndent === '2chars' ? s.bodySize * 20 : 0 },
          },
        },
      },
      paragraphStyles: [
        {
          id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: cfg.h1Size, bold: true, font: headingFontObj(s), color: '000000' },
          paragraph: { spacing: { before: 240, after: 240 }, alignment: AlignmentType.CENTER, indent: { firstLine: 0 } },
        },
        {
          id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, font: { ascii: 'KaiTi', hAnsi: 'KaiTi', eastAsia: 'KaiTi' }, color: '000000' },
          paragraph: { spacing: { before: 120, after: 240 }, alignment: AlignmentType.CENTER, indent: { firstLine: 0 } },
        },
        heading('Heading1', 'Heading 1', cfg.h2Size, cfg.h2Color, { before: 200, after: 120 }, true),
        heading('Heading2', 'Heading 2', cfg.h3Size, cfg.h2Color, { before: 160, after: 80 }),
        heading('Heading3', 'Heading 3', cfg.h4Size, cfg.h2Color, { before: 140, after: 80 }),
        heading('Heading4', 'Heading 4', cfg.h4Size, cfg.h2Color, { before: 100, after: 60 }),
        {
          id: 'AbstractContent', name: 'Abstract Content', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: s.bodySize, font: { ascii: 'KaiTi', hAnsi: 'KaiTi', eastAsia: 'KaiTi' }, color: '000000' },
          paragraph: {
            spacing: { line: s.lineSpacing, before: 120, after: 120 },
            alignment: s.bodyAlign === 'justify' ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
            indent: { firstLine: s.firstLineIndent === '2chars' ? s.bodySize * 20 : 0 },
          },
        },
        {
          id: 'ReferenceTitle', name: 'Reference Title', basedOn: 'Normal', next: 'ReferenceItem', quickFormat: true,
          run: { size: cfg.h2Size, bold: true, font: headingFontObj(s), color: '000000' },
          paragraph: { spacing: { before: 240, after: 240 }, alignment: AlignmentType.CENTER, indent: { firstLine: 0 } },
        },
        {
          id: 'ReferenceItem', name: 'Reference Item', basedOn: 'Normal', next: 'ReferenceItem', quickFormat: true,
          run: { size: 21, font: bodyFontObj(s), color: '000000' },
          paragraph: { spacing: { line: s.lineSpacing, before: 60, after: 60 }, indent: { firstLine: 0, hanging: 420, left: 420 } },
        },
        caption,
        listParagraph,
      ],
    }
  }

  // 通用文档 / 商务报告：左对齐标题层级，无论文启发式
  return {
    default: {
      document: {
        run: { size: s.bodySize, font: bodyFontObj(s), color: '000000' },
        paragraph: {
          spacing: { line: s.lineSpacing, before: Math.round(s.spaceBeforePt * 20), after: Math.round(s.spaceAfterPt * 20) },
          alignment: s.bodyAlign === 'justify' ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
          ...(s.firstLineIndent === '2chars' ? { indent: { firstLine: s.bodySize * 20 } } : {}),
        },
      },
    },
    paragraphStyles: [
      heading('Heading1', 'Heading 1', cfg.h1Size, cfg.h1Color, { before: 240, after: 120 }),
      heading('Heading2', 'Heading 2', cfg.h2Size, cfg.h2Color, { before: 200, after: 80 }),
      heading('Heading3', 'Heading 3', cfg.h3Size, cfg.h2Color, { before: 160, after: 80 }),
      heading('Heading4', 'Heading 4', cfg.h4Size, cfg.h2Color, { before: 120, after: 60 }),
      caption,
      listParagraph,
    ],
  }
}

// ─── Block parsing ───────────────────────────────────────────────────────────

/** 预览注入的编号 span 不能进 Word（Word 用 numPr 编号），解析前剥掉 */
function stripHeadingNumber(el: HTMLElement): HTMLElement {
  if (!el.querySelector('.md-hnum')) return el
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.md-hnum').forEach((n) => n.remove())
  return clone
}

/** 引用块内段落的通用样式（灰色斜体 + 左侧竖线 + 递归缩进） */
function quoteParagraphOptions(state: ParseState, extra: Record<string, unknown> = {}) {
  const depth = Math.max(1, state.quoteDepth)
  return {
    spacing: { before: 120, after: 120 },
    indent: { left: 480 * depth, firstLine: 0 },
    border: { left: { style: BorderStyle.SINGLE, size: 24, color: 'D1D5DB', space: 10 } },
    ...extra,
  }
}

function parseBlockNodes(container: HTMLElement, ctx: ExportContext, state: ParseState): any[] {
  const blocks: any[] = []
  const { cfg, settings } = ctx
  const academic = cfg.academicHeuristics

  Array.from(container.childNodes).forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim()
      if (text) {
        if (academic && state.isReferenceSection) {
          blocks.push(new Paragraph({ children: [new TextRun(text)], style: 'ReferenceItem' }))
        } else if (state.quoteDepth > 0) {
          blocks.push(new Paragraph({
            children: [new TextRun({ text, color: '6B7280', italics: true })],
            ...quoteParagraphOptions(state),
          }))
        } else {
          blocks.push(new Paragraph({ children: [new TextRun(text)] }))
        }
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      const tagName = el.tagName.toLowerCase()

      if (/^h[1-6]$/.test(tagName)) {
        const level = parseInt(tagName[1])
        const headingEl = stripHeadingNumber(el)
        const textContent = headingEl.textContent?.trim() || ''

        if (academic && level === 1 && state.h1Count === 0) {
          state.h1Count++
          blocks.push(new Paragraph({ children: parseInlineNodes(headingEl, {}, ctx), style: 'Title' }))
        } else if (academic && level === 2 && textContent.includes('参考文献')) {
          state.isReferenceSection = true
          blocks.push(new Paragraph({ children: parseInlineNodes(headingEl, {}, ctx), style: 'ReferenceTitle' }))
        } else if (academic && level === 2 && blocks.length === 1 && state.h1Count === 1) {
          blocks.push(new Paragraph({ children: parseInlineNodes(headingEl, {}, ctx), style: 'Subtitle' }))
        } else {
          // 通用映射：Markdown H1→Heading1、H2→Heading2 …（学术模板下整体降一级）
          const styleName = academic
            ? (level === 2 ? 'Heading1' : level === 3 ? 'Heading2' : level === 4 ? 'Heading3' : 'Heading4')
            : (level === 1 ? 'Heading1' : level === 2 ? 'Heading2' : level === 3 ? 'Heading3' : 'Heading4')
          const numLevel = HEADING_STYLE_LEVEL[styleName]
          const numbering =
            settings.headingNumbering !== 'off' && numLevel
              ? { reference: 'markdoc-headings', level: numLevel - 1 }
              : undefined
          blocks.push(new Paragraph({
            children: parseInlineNodes(headingEl, {}, ctx),
            style: styleName,
            ...(numbering ? { numbering } : {}),
          }))
        }
      } else if (tagName === 'p') {
        const textContent = el.textContent?.trim() || ''
        const embeddedTable = tryParseEmbeddedHtmlTable(el, cfg.tableStyle, ctx)
        if (embeddedTable) {
          blocks.push(embeddedTable)
          if (lastDocxStats) {
            lastDocxStats.tables++
            lastDocxStats.tablesFromEmbeddedText++
          }
          blocks.push(new Paragraph({ text: '' }))
        } else if (academic && state.isReferenceSection) {
          blocks.push(new Paragraph({ children: parseInlineNodes(el, {}, ctx), style: 'ReferenceItem' }))
        } else if (
          academic &&
          (textContent.startsWith('摘要') || textContent.startsWith('关键词') ||
            textContent.includes('**摘要**') || textContent.includes('**关键词**'))
        ) {
          blocks.push(new Paragraph({ children: parseInlineNodes(el, {}, ctx), style: 'AbstractContent' }))
        } else if (
          academic &&
          (textContent.startsWith('副标题：') || textContent.startsWith('——') || textContent.startsWith('副标题:'))
        ) {
          blocks.push(new Paragraph({ children: parseInlineNodes(el, {}, ctx), style: 'Subtitle' }))
        } else if (state.quoteDepth > 0) {
          blocks.push(new Paragraph({
            children: parseInlineNodes(el, { color: '6B7280', italics: true }, ctx),
            ...quoteParagraphOptions(state),
          }))
        } else {
          blocks.push(new Paragraph({ children: parseInlineNodes(el, {}, ctx) }))
        }
      } else if (tagName === 'ul' || tagName === 'ol') {
        if (academic && state.isReferenceSection) {
          Array.from(el.children).forEach((li, idx) => {
            if (li.tagName.toLowerCase() === 'li') {
              const marker = tagName === 'ol' ? `[${idx + 1}] ` : '• '
              const runs = [new TextRun(marker), ...parseInlineNodes(li as HTMLElement, {}, ctx)]
              blocks.push(new Paragraph({ children: runs, style: 'ReferenceItem' }))
            }
          })
        } else {
          const taskList = tagName === 'ul' && el.classList.contains('task-list')
          blocks.push(...parseListNodes(el, 0, tagName === 'ol', ctx, taskList))
        }
      } else if (tagName === 'blockquote') {
        if (academic && blocks.length > 0 && state.h1Count === 1 && blocks.length < 3) {
          blocks.push(new Paragraph({ children: parseInlineNodes(el, {}, ctx), style: 'Subtitle' }))
        } else {
          // 嵌套引用：递归解析子块，深度控制缩进，外层竖线只画一份
          state.quoteDepth++
          blocks.push(...parseBlockNodes(el, ctx, state))
          state.quoteDepth--
        }
      } else if (tagName === 'pre') {
        const codeText = (el.textContent || '').replace(/\n$/, '')
        const codeLines = codeText.split('\n')
        const runs = codeLines.map((line, i) =>
          new TextRun({
            text: line,
            font: 'Consolas',
            size: 20,
            color: '24292F',
            ...(i > 0 ? { break: 1 } : {}),
          }),
        )
        blocks.push(new Paragraph({
          children: runs,
          alignment: AlignmentType.LEFT,
          spacing: { before: 160, after: 160 },
          indent: { firstLine: 0 },
          shading: { type: ShadingType.CLEAR, fill: 'F6F8FA' },
          border: {
            top: { style: BorderStyle.SINGLE, size: 6, color: 'D0D7DE', space: 8 },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D0D7DE', space: 8 },
            left: { style: BorderStyle.SINGLE, size: 6, color: 'D0D7DE', space: 8 },
            right: { style: BorderStyle.SINGLE, size: 6, color: 'D0D7DE', space: 8 }
          }
        }))
      } else if (tagName === 'table') {
        blocks.push(parseTableNode(el, cfg.tableStyle, ctx))
        if (lastDocxStats) lastDocxStats.tables++
        blocks.push(new Paragraph({ text: "" }))
      } else if (tagName === 'hr') {
        blocks.push(new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "e5e7eb" } }
        }))
      } else if (tagName === 'div' && el.classList.contains('pagebreak')) {
        // 真正的 Word 分页符（w:br type="page"），不是空行
        blocks.push(new Paragraph({
          children: [new PageBreak()],
          spacing: { before: 0, after: 0 },
          indent: { firstLine: 0 },
        }))
      } else if (tagName === 'div' && el.classList.contains('block-caption')) {
        const kind = el.getAttribute('data-kind') === 'tbl' ? 'tbl' : 'fig'
        const text = (el.querySelector('.caption-text')?.textContent ?? el.textContent ?? '').trim()
        if (text) {
          const label =
            kind === 'fig'
              ? `图 ${++state.figCount}`
              : `表 ${++state.tblCount}`
          blocks.push(new Paragraph({
            children: [new TextRun({ text: `${label}　${text}` })],
            style: 'Caption',
          }))
        }
      } else if (tagName === 'div' && el.classList.contains('math-block')) {
        const mathComp = ctx.mathMap.get(el)
        if (mathComp) {
          // Word 原生公式（oMathPara 自带居中）
          blocks.push(new Paragraph({
            children: [mathComp as any],
            spacing: { before: 120, after: 120 },
            indent: { firstLine: 0 },
          }))
        } else {
          blocks.push(new Paragraph({
            children: parseInlineNodes(el, {}, ctx),
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
            indent: { firstLine: 0 },
          }))
        }
      } else if (tagName === 'div' && el.classList.contains('mermaid-rendered')) {
        blocks.push(new Paragraph({
          children: parseInlineNodes(el, {}, ctx),
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 120 },
          indent: { firstLine: 0 },
        }))
      } else if (tagName === 'img') {
        // 顶层图片（mermaid 截图、独立图片节点）：居中成段。
        // parseInlineNodes 只遍历子节点，这里包一层 <p> 复用 img→ImageRun 的内联逻辑。
        // （此前落入 else 分支被静默丢弃 —— 网页版与扩展导出都受影响。）
        const wrap = el.ownerDocument.createElement('p')
        wrap.appendChild(el.cloneNode(true))
        blocks.push(new Paragraph({
          children: parseInlineNodes(wrap, {}, ctx),
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 120 },
          indent: { firstLine: 0 },
        }))
      } else {
        blocks.push(...parseBlockNodes(el, ctx, state))
      }
    }
  })

  return blocks
}

// ─── List parsing（有序编号、嵌套层级、任务列表）─────────────────────────────

function parseListNodes(
  listEl: HTMLElement,
  level: number,
  ordered: boolean,
  ctx: ExportContext,
  taskList = false,
): Paragraph[] {
  const blocks: Paragraph[] = []

  Array.from(listEl.children).forEach(li => {
    if (li.tagName.toLowerCase() !== 'li') return

    // li 的直接内容与嵌套列表分开处理，嵌套列表递归并提升层级。
    // 注意：cloneNode 会生成新对象，mathMap（WeakMap 按对象身份）必须重新绑定，
    // 否则列表项里的公式永远命中不了 OMML，退化为 KaTeX 内部文本。
    const inlineWrap = li.ownerDocument.createElement('span')
    const nestedLists: HTMLElement[] = []
    const liMathEls = Array.from(li.querySelectorAll<HTMLElement>('.math-inline, .math-block'))
    const liMathComps = liMathEls.map(el => ctx.mathMap.get(el) ?? null)
    Array.from(li.childNodes).forEach(n => {
      if (n.nodeType === Node.ELEMENT_NODE && /^(ul|ol)$/i.test((n as HTMLElement).tagName)) {
        nestedLists.push(n as HTMLElement)
      } else {
        inlineWrap.appendChild(n.cloneNode(true))
      }
    })
    Array.from(inlineWrap.querySelectorAll<HTMLElement>('.math-inline, .math-block')).forEach((el, idx) => {
      const comp = liMathComps[idx]
      if (comp) ctx.mathMap.set(el, comp)
    })

    const children = parseInlineNodes(inlineWrap, {}, ctx)
    if (!children.length) children.push(new TextRun(''))

    if (taskList) {
      // 任务列表：☑/☐ 由内联 input 转换而来，不再叠加圆点（无 bullet/numbering，
      // docx 库不会自动加 ListParagraph，这里需要显式指定样式）
      blocks.push(new Paragraph({
        children,
        style: 'ListParagraph',
        indent: { left: 720 + level * 720, firstLine: 0 },
      }))
    } else {
      // 有 bullet/numbering 时 docx 库会自动写入 ListParagraph pStyle，
      // 再显式传 style 会产生重复的 <w:pStyle>（不符合 OOXML schema）
      blocks.push(new Paragraph({
        children,
        ...(ordered
          ? { numbering: { reference: 'markdoc-ordered', level: Math.min(level, 4) } }
          : { bullet: { level } }),
      }))
    }

    nestedLists.forEach(nl => {
      const nestedTask = nl.tagName.toLowerCase() === 'ul' && nl.classList.contains('task-list')
      blocks.push(...parseListNodes(nl, Math.min(level + 1, 4), nl.tagName.toLowerCase() === 'ol', ctx, nestedTask))
    })
  })

  return blocks
}

// ─── Inline parsing ──────────────────────────────────────────────────────────

function parseInlineNodes(container: HTMLElement, currentStyle: any = {}, ctx?: ExportContext): any[] {
  let runs: any[] = []

  Array.from(container.childNodes).forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent
      if (text) {
        const emojiRegex = /([\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?)/gu
        if (emojiRegex.test(text)) {
          emojiRegex.lastIndex = 0
          const parts = text.split(emojiRegex)
          parts.forEach(part => {
            if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?$/u.test(part)) {
              runs.push(new TextRun({
                text: part,
                bold: currentStyle.bold,
                italics: currentStyle.italics,
                strike: currentStyle.strike,
                font: 'Segoe UI Emoji'
              }))
            } else if (part) {
              runs.push(new TextRun({
                text: part,
                bold: currentStyle.bold,
                italics: currentStyle.italics,
                strike: currentStyle.strike,
                font: currentStyle.font
              }))
            }
          })
        } else {
          runs.push(new TextRun({
            text: text,
            bold: currentStyle.bold,
            italics: currentStyle.italics,
            strike: currentStyle.strike,
            font: currentStyle.font
          }))
        }
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      const tagName = el.tagName.toLowerCase()

      // Word 原生公式（行内）
      const mathComp = ctx?.mathMap.get(el)
      if (mathComp) {
        runs.push(mathComp)
        return
      }

      // 兜底：公式元素没有命中 OMML 映射（转换失败/截图失败/映射丢失）时，
      // 绝不能把 KaTeX 内部 DOM 当普通内联内容展开（会输出三份乱码文本），
      // 降级为单个 $...$ 文本占位，保证 Word 里可读、可编辑。
      if (isMathEl(el) && el.getAttribute('data-formula')) {
        const formula = decodeURIComponent(el.getAttribute('data-formula') || '')
        if (formula) {
          runs.push(new TextRun({ text: `$${formula}$`, italics: true, font: currentStyle.font }))
          return
        }
      }

      if (tagName === 'strong' || tagName === 'b') {
        runs.push(...parseInlineNodes(el, { ...currentStyle, bold: true }, ctx))
      } else if (tagName === 'em' || tagName === 'i') {
        runs.push(...parseInlineNodes(el, { ...currentStyle, italics: true }, ctx))
      } else if (tagName === 'del' || tagName === 's') {
        runs.push(...parseInlineNodes(el, { ...currentStyle, strike: true }, ctx))
      } else if (tagName === 'input') {
        // GFM 任务列表复选框
        const checked = el.getAttribute('checked') !== null
        runs.push(new TextRun({ text: checked ? '☑ ' : '☐ ' }))
      } else if (tagName === 'code') {
        runs.push(...parseInlineNodes(el, { ...currentStyle, font: "Consolas", color: "D92D20", size: 21 }, ctx))
      } else if (tagName === 'a') {
        const href = el.getAttribute('href') || ''
        runs.push(new ExternalHyperlink({
          children: parseInlineNodes(el, { ...currentStyle, color: "2563eb" }, ctx),
          link: href
        }))
      } else if (tagName === 'img') {
        const src = el.getAttribute('src')
        if (src && src.startsWith('data:image')) {
          const base64Data = src.split(',')[1]
          let width = 400
          let height = 300

          if (el.style.width) width = parseFloat(el.style.width)
          if (el.style.height) height = parseFloat(el.style.height)

          if (width > 600) {
            height = height * (600 / width)
            width = 600
          }

          runs.push(new ImageRun({
            data: Uint8Array.from(atob(base64Data), c => c.charCodeAt(0)),
            transformation: { width, height }
          }))
        } else {
          // fetch 失败的外链图片：降级为占位文本
          const alt = el.getAttribute('alt') || 'image'
          runs.push(new TextRun({ text: `[Image: ${alt}]`, italics: true }))
        }
      } else if (tagName === 'br') {
        runs.push(new TextRun({ text: "", break: 1 }))
      } else {
        runs.push(...parseInlineNodes(el, currentStyle, ctx))
      }
    }
  })

  return runs
}

// ─── Tables ──────────────────────────────────────────────────────────────────

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'ffffff' }

/**
 * 兜底：段落文本整体是一个 <table>…</table> 片段（源 Markdown 里被转义/
 * 挤进段落的 HTML 表格）时，还原为 Word 原生表格，绝不让 HTML 标签漏进正文。
 * 预览层已由 markdown.ts 的 hoistEmbeddedHtmlTables 处理，这里覆盖
 * 直接喂 DOM 快照等旁路入口。
 */
function tryParseEmbeddedHtmlTable(
  el: HTMLElement,
  tableStyle: TableStyle,
  ctx?: ExportContext,
): Table | null {
  const trimmed = (el.textContent || '').trim()
  if (!trimmed || !/^<table[\s>]/i.test(trimmed) || !/<\/table>$/i.test(trimmed)) return null
  if (el.querySelector('table')) return null // 已是真表格节点，走正常解析
  try {
    const frag = new DOMParser().parseFromString(trimmed, 'text/html')
    const tbl = frag.querySelector('table')
    if (!tbl || !tbl.querySelector('tr')) return null
    return parseTableNode(tbl as HTMLElement, tableStyle, ctx)
  } catch {
    return null
  }
}

function cellBorders(tableStyle: TableStyle, position: 'header' | 'body', isLastRow: boolean) {
  if (tableStyle === 'threeline') {
    if (position === 'header') {
      return {
        top: { style: BorderStyle.SINGLE, size: 12, color: '000000' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
        left: NO_BORDER,
        right: NO_BORDER,
      }
    }
    return {
      left: NO_BORDER,
      right: NO_BORDER,
      top: NO_BORDER,
      bottom: isLastRow ? { style: BorderStyle.SINGLE, size: 12, color: '000000' } : NO_BORDER,
    }
  }

  // grid / shaded：细灰网格，表头底边加重
  const line = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' }
  return {
    top: line,
    bottom: position === 'header'
      ? { style: BorderStyle.SINGLE, size: 8, color: '9CA3AF' }
      : isLastRow
        ? { style: BorderStyle.SINGLE, size: 8, color: '9CA3AF' }
        : line,
    left: line,
    right: line,
  }
}

function parseTableNode(tableEl: HTMLElement, tableStyle: TableStyle, ctx?: ExportContext): Table {
  const shading = tableStyle === 'shaded' ? { type: ShadingType.CLEAR, fill: 'EEF2F8', color: 'auto' } : undefined

  // ── 合并单元格（colspan/rowspan）：按网格游标遍历 ──
  // colspan → w:gridSpan；rowspan → 首格 w:vMerge restart，后续行同列补
  // w:vMerge continue 延续格。宽格覆盖到的延续列直接吸收（gridSpan 覆盖）。
  const clampSpan = (v: string | null) => {
    const n = parseInt(v || '1', 10)
    return Number.isFinite(n) ? Math.min(Math.max(n, 1), 200) : 1
  }
  const active: number[] = [] // 每列剩余延续行数

  const makeCell = (td: HTMLElement, position: 'header' | 'body', isLastRow: boolean, cs: number, rs: number) =>
    new TableCell({
      children: [new Paragraph({
        children: parseInlineNodes(td, {}, ctx),
        alignment: position === 'header' ? AlignmentType.CENTER : AlignmentType.LEFT,
        indent: { firstLine: 0 },
      })],
      borders: cellBorders(tableStyle, position, isLastRow),
      ...(position === 'header' && shading ? { shading } : {}),
      ...(cs > 1 ? { columnSpan: cs } : {}),
      ...(rs > 1 ? { verticalMerge: VerticalMergeType.RESTART } : {}),
    })

  const continueCell = (position: 'header' | 'body', isLastRow: boolean) =>
    new TableCell({
      children: [new Paragraph({ children: [], indent: { firstLine: 0 } })],
      borders: cellBorders(tableStyle, position, isLastRow),
      verticalMerge: VerticalMergeType.CONTINUE,
    })

  // 收集行序列（thead 在前，thead/tbody 缺失时回退平铺行）
  const rowInfos: Array<{ tr: HTMLElement; position: 'header' | 'body'; isLast: boolean }> = []
  const thead = tableEl.querySelector('thead')
  const tbodies = tableEl.querySelectorAll('tbody')
  const pushRow = (tr: HTMLElement, position: 'header' | 'body', isLast: boolean) =>
    rowInfos.push({ tr, position, isLast })
  if (thead) {
    Array.from(thead.querySelectorAll('tr')).forEach(tr => pushRow(tr, 'header', false))
  }
  if (tbodies.length) {
    Array.from(tbodies).forEach(tbody => {
      const trs = Array.from(tbody.querySelectorAll('tr'))
      trs.forEach((tr, i) => pushRow(tr, 'body', i === trs.length - 1))
    })
  } else {
    const trs = Array.from(tableEl.querySelectorAll('tr')).filter(tr => !tr.closest('thead'))
    trs.forEach((tr, i) => pushRow(tr, 'body', i === trs.length - 1))
  }

  const rows: TableRow[] = rowInfos.map(({ tr, position, isLast }) => {
    const cells: TableCell[] = []
    let col = 0
    const tds = Array.from(tr.children).filter(c => /^(td|th)$/i.test(c.tagName)) as HTMLElement[]
    for (const td of tds) {
      // 补齐游标扫过的延续格
      while (active[col] > 0) {
        cells.push(continueCell(position, isLast))
        active[col]--
        col++
      }
      const cs = clampSpan(td.getAttribute('colspan'))
      const rs = clampSpan(td.getAttribute('rowspan'))
      cells.push(makeCell(td, position, isLast, cs, rs))
      // 登记未来行的延续 + 吸收宽格覆盖到的延续列
      for (let c = col; c < col + cs; c++) {
        active[c] = rs > 1 ? rs - 1 : 0
      }
      col += cs
    }
    // 行尾仍在生效的延续格
    for (let c = col; c < active.length; c++) {
      if (active[c] > 0) {
        cells.push(continueCell(position, isLast))
        active[c]--
      }
    }
    return new TableRow({ children: cells, cantSplit: true, ...(position === 'header' ? { tableHeader: true } : {}) })
  })

  const tableBorders = tableStyle === 'threeline'
    ? {
        top: { style: BorderStyle.SINGLE, size: 12, color: '000000' },
        bottom: { style: BorderStyle.SINGLE, size: 12, color: '000000' },
        left: NO_BORDER,
        right: NO_BORDER,
        insideHorizontal: NO_BORDER,
        insideVertical: NO_BORDER,
      }
    : {
        top: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
        left: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
        right: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
        insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
      }

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders
  })
}
