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

  await prepareAssets(root, ctx)

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
async function prepareAssets(root: HTMLElement, ctx: ExportContext) {
  const liveContainer = document.getElementById(PREVIEW_ID)

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
      if (canPair) tasks.push(captureAsImage(cloneEl, liveEls[i]))
      continue
    }

    // math-block / math-inline：先尝试原生 OMML
    const formula = decodeURIComponent(cloneEl.getAttribute('data-formula') || '')
    const displayMode = cloneEl.classList.contains('math-block')
    if (formula) {
      const component = latexToOmml(formula, displayMode)
      if (component) {
        ctx.mathMap.set(cloneEl, component)
        continue
      }
    }
    if (canPair) {
      tasks.push(captureAsImage(cloneEl, liveEls[i], () => {
        // 截图也失败：退回纯文本，避免解析 .katex 内部结构产生乱码
        cloneEl.textContent = displayMode ? `$$${formula}$$` : `$${formula}$`
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

async function captureAsImage(cloneEl: HTMLElement, liveEl: HTMLElement, onFail?: () => void) {
  try {
    const html2canvas = (await import('html2canvas')).default
    const canvas = await html2canvas(liveEl, {
      scale: 2,
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
  } catch (err) {
    console.warn('export: mermaid/math capture failed', err instanceof Error ? err.message : err)
    onFail?.()
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
      spacing: { before: 60, after: 160, line: 240 },
      alignment: AlignmentType.CENTER,
      indent: { firstLine: 0 },
    },
  }

  const listParagraph = {
    id: 'ListParagraph', name: 'List Paragraph', basedOn: 'Normal', quickFormat: true,
    paragraph: { spacing: { before: 100, after: 100 }, indent: { firstLine: 0 } },
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
        heading('Heading1', 'Heading 1', cfg.h2Size, cfg.h2Color, { before: 240, after: 240 }, true),
        heading('Heading2', 'Heading 2', cfg.h3Size, cfg.h2Color, { before: 200, after: 120 }),
        heading('Heading3', 'Heading 3', cfg.h4Size, cfg.h2Color, { before: 160, after: 120 }),
        heading('Heading4', 'Heading 4', cfg.h4Size, cfg.h2Color, { before: 120, after: 120 }),
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
      heading('Heading1', 'Heading 1', cfg.h1Size, cfg.h1Color, { before: 280, after: 160 }),
      heading('Heading2', 'Heading 2', cfg.h2Size, cfg.h2Color, { before: 240, after: 120 }),
      heading('Heading3', 'Heading 3', cfg.h3Size, cfg.h2Color, { before: 180, after: 100 }),
      heading('Heading4', 'Heading 4', cfg.h4Size, cfg.h2Color, { before: 140, after: 80 }),
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
    spacing: { before: 200, after: 200 },
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
        if (academic && state.isReferenceSection) {
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
        blocks.push(parseTableNode(el, cfg.tableStyle))
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

    // li 的直接内容与嵌套列表分开处理，嵌套列表递归并提升层级
    const inlineWrap = li.ownerDocument.createElement('span')
    const nestedLists: HTMLElement[] = []
    Array.from(li.childNodes).forEach(n => {
      if (n.nodeType === Node.ELEMENT_NODE && /^(ul|ol)$/i.test((n as HTMLElement).tagName)) {
        nestedLists.push(n as HTMLElement)
      } else {
        inlineWrap.appendChild(n.cloneNode(true))
      }
    })

    const children = parseInlineNodes(inlineWrap, {}, ctx)
    if (!children.length) children.push(new TextRun(''))

    if (taskList) {
      // 任务列表：☑/☐ 由内联 input 转换而来，不再叠加圆点
      blocks.push(new Paragraph({
        children,
        style: 'ListParagraph',
        indent: { left: 720 + level * 720, firstLine: 0 },
      }))
    } else {
      blocks.push(new Paragraph({
        children,
        style: 'ListParagraph',
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

function parseTableNode(tableEl: HTMLElement, tableStyle: TableStyle): Table {
  const rows: TableRow[] = []
  const shading = tableStyle === 'shaded' ? { type: ShadingType.CLEAR, fill: 'EEF2F8', color: 'auto' } : undefined

  const buildCell = (td: HTMLElement, position: 'header' | 'body', isLastRow: boolean) => {
    const children = parseInlineNodes(td, {}, undefined)
    return new TableCell({
      children: [new Paragraph({
        children,
        alignment: position === 'header' ? AlignmentType.CENTER : AlignmentType.LEFT,
        indent: { firstLine: 0 },
      })],
      borders: cellBorders(tableStyle, position, isLastRow),
      ...(position === 'header' && shading ? { shading } : {}),
    })
  }

  const thead = tableEl.querySelector('thead')
  if (thead) {
    Array.from(thead.querySelectorAll('tr')).forEach(tr => {
      const cells = Array.from(tr.querySelectorAll('th, td')).map(td => buildCell(td as HTMLElement, 'header', false))
      rows.push(new TableRow({ children: cells, tableHeader: true }))
    })
  }

  const tbody = tableEl.querySelector('tbody')
  if (tbody) {
    const trs = Array.from(tbody.querySelectorAll('tr'))
    trs.forEach((tr, index) => {
      const isLast = index === trs.length - 1
      const cells = Array.from(tr.querySelectorAll('th, td')).map(td => buildCell(td as HTMLElement, 'body', isLast))
      rows.push(new TableRow({ children: cells }))
    })
  }

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
