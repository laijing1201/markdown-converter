/**
 * PDF 渲染器 —— 把布局引擎产出的 DrawItem 页列表绘制成真正的 PDF。
 *
 * 基于 pdf-lib：
 *   - 文本 = 真正的 PDF 文本（可选中/可搜索/可复制），字体子集嵌入
 *   - 表格边框、代码块背景 = 矢量图形
 *   - 图片 = PNG/JPEG 原字节嵌入（不重压缩）
 *   - KaTeX 公式 = 矢量路径 + 嵌入 KaTeX 字体（清晰可缩放）
 *   - 超链接 = Link 注解；目录 = 可跳转的静态目录 + 大纲书签
 *   - 页眉/页脚/页码按 DocSettings 绘制（与 Word 共用设置）
 *
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFName,
  PDFString,
  type PDFFont,
  type PDFPage,
  type PDFRef,
  type PDFImage,
  PDFDict,
  PDFArray,
} from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { PX_TO_PT, type DocSettings } from '../templates'
import { subsetUsedFonts, loadFontBytes, getFontCoverage, ALL_FONT_FILES } from './fonts'
import { TOC_INDENT_PX, TOC_LINE_PX, TOC_TITLE_PX } from './layout'
import type { DrawItem, LayoutResult, TextItem } from './types'

export interface RenderProgress {
  (phase: 'fonts' | 'draw' | 'save', pct: number): void
}

export class PdfRenderError extends Error {
  details: string[]
  constructor(message: string, details: string[] = []) {
    super(message)
    this.name = 'PdfRenderError'
    this.details = details
  }
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  return {
    r: parseInt(full.slice(0, 2), 16) / 255 || 0,
    g: parseInt(full.slice(2, 4), 16) / 255 || 0,
    b: parseInt(full.slice(4, 6), 16) / 255 || 0,
  }
}

interface FontBundle {
  custom: Map<string, PDFFont>
  timesItalic: PDFFont
  helveticaItalic: PDFFont
  times: PDFFont
  helvetica: PDFFont
  fallback: PDFFont
}

/** 目录/页码等渲染期静态文本，一并纳入子集字符集 */
export const STATIC_TEXT_CHARS = '目录0123456789.…—·-Page '

export async function renderPdf(
  layout: LayoutResult,
  settings: DocSettings,
  onProgress?: RenderProgress,
  author?: string,
): Promise<Blob> {
  const details: string[] = []
  const { pageWpt, pageHpt, marginPt, contentWpx } = layout.geometry
  const contentTopPt = marginPt.top

  const pdf = await PDFDocument.create()
  // 自定义字体（CJK 子集）嵌入需要 fontkit
  pdf.registerFontkit(fontkit)

  // ── 字体：子集 + 嵌入 ──────────────────────────────────────────────────────
  onProgress?.('fonts', 5)
  const usedChars = new Map<string, Set<string>>(layout.usedChars)
  const addChars = (key: string, text: string) => {
    if (!text) return
    let set = usedChars.get(key)
    if (!set) usedChars.set(key, (set = new Set()))
    for (const ch of text) set.add(ch)
  }
  addChars('serif', STATIC_TEXT_CHARS)
  addChars('sans', STATIC_TEXT_CHARS)
  // 目录标题用 sans-bold、条目/页码用 serif —— 静态字符需覆盖这些字体
  addChars('serif-bold', STATIC_TEXT_CHARS)
  addChars('sans-bold', STATIC_TEXT_CHARS)
  layout.tocEntries.forEach((e) => {
    addChars('serif', e.text)
    addChars('sans', e.text)
  })
  addChars('serif', settings.headerText)
  addChars('serif', settings.footerText)
  addChars('sans', settings.headerText)
  addChars('sans', settings.footerText)

  // ── 缺字回退指派 ────────────────────────────────────────────────────────────
  // Noto Serif/Sans SC 不含的符号（∂ − ⊤ → ★ 等）在子集字体里没有字形，
  // pdf-lib 会画成 .notdef 空方框。这里把缺字字符指派给第一个覆盖它的字体
  //（其他嵌入字体 → KaTeX 数学字体 → 标准 WinAnsi 字体），字形进入该字体的
  // 子集；绘制时按指派逐段换字体。任何字体都不覆盖的字符跳过并提示。
  const WINANSI_EXTRA = [...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'].map((c) => c.codePointAt(0)!)
  const winAnsiCovers = (ch: string): boolean => {
    const cp = ch.codePointAt(0)!
    return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRA.includes(cp)
  }
  const FALLBACK_KEYS = ['sans', 'serif', 'mono', 'katex:Main', 'katex:AMS']
  const covKeys = new Set<string>(FALLBACK_KEYS)
  for (const pageItems of layout.pages) {
    for (const item of pageItems) {
      if (item.kind === 'text' && item.fontKey) covKeys.add(item.fontKey)
    }
  }
  const coverage = new Map<string, Set<number>>()
  await Promise.all(
    [...covKeys].filter((k) => ALL_FONT_FILES[k]).map(async (k) => {
      try {
        coverage.set(k, await getFontCoverage(k))
      } catch { /* 拿不到覆盖率就当不覆盖，走标准字体兜底 */ }
    }),
  )
  const skippedGlyphs = new Set<string>()
  interface RunPlan {
    text: string
    fontKey?: string
    stdFace?: 'times' | 'helvetica' | 'timesItalic' | 'helveticaItalic'
  }
  const runPlans = new Map<TextItem, RunPlan[]>()
  for (const pageItems of layout.pages) {
    for (const item of pageItems) {
      if (item.kind !== 'text') continue
      const primaryCov = item.fontKey ? coverage.get(item.fontKey) : undefined
      const runs: RunPlan[] = []
      let buf = ''
      let bufKey: string | undefined
      let bufStd: RunPlan['stdFace'] | undefined
      const flush = () => {
        if (!buf) return
        runs.push({ text: buf, ...(bufStd ? { stdFace: bufStd } : { fontKey: bufKey }) })
        buf = ''
      }
      for (const ch of item.text) {
        const cp = ch.codePointAt(0)!
        let key: string | undefined
        let stdFace: RunPlan['stdFace'] | undefined
        if (item.fontKey && primaryCov?.has(cp)) {
          key = item.fontKey
        } else {
          const alt = FALLBACK_KEYS.find((k) => k !== item.fontKey && coverage.get(k)?.has(cp))
          if (alt) {
            addChars(alt, ch)
            key = alt
          } else if (winAnsiCovers(ch)) {
            stdFace =
              item.stdItalic === 'times' ? 'timesItalic'
              : item.stdItalic === 'helvetica' ? 'helveticaItalic'
              : item.fontKey?.startsWith('serif')
                ? 'times'
                : 'helvetica'
          } else {
            skippedGlyphs.add(ch)
            continue
          }
        }
        if (buf && key === bufKey && stdFace === bufStd) {
          buf += ch
        } else {
          flush()
          buf = ch
          bufKey = key
          bufStd = stdFace
        }
      }
      flush()
      runPlans.set(item, runs)
    }
  }
  if (skippedGlyphs.size) {
    const msg = `以下字符在嵌入字体中无字形，PDF 中已跳过：${[...skippedGlyphs].join(' ')}`
    details.push(msg)
    if (Array.isArray(layout.notices) && !layout.notices.includes(msg)) layout.notices.push(msg)
  }

  const subsetBytes = await subsetUsedFonts(usedChars, (msg) => details.push(msg))
  const custom = new Map<string, PDFFont>()
  for (const [key, bytes] of subsetBytes) {
    try {
      custom.set(key, await pdf.embedFont(bytes, { subset: false }))
    } catch (err) {
      details.push(`字体 ${key} 嵌入失败：${(err as Error).message}`)
    }
  }
  const bundle: FontBundle = {
    custom,
    timesItalic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
    helveticaItalic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    times: await pdf.embedFont(StandardFonts.TimesRoman),
    helvetica: await pdf.embedFont(StandardFonts.Helvetica),
    fallback: custom.get('sans') ?? (await pdf.embedFont(StandardFonts.Helvetica)),
  }
  onProgress?.('fonts', 100)

  // 记录每个自定义字体实际绘制过的文本：
  // 子集字体里 fontkit 的 layout() 与 glyphForCodePoint() 可能给出不同字形入口，
  // pdf-lib 的 ToUnicode / /W 基于后者，会导致提取错字与数字间距异常。
  // 绘制完成后用 layout 的真实字形重建两张表（见 rebuildFontMaps）。
  const drawnBy = new Map<PDFFont, Set<string>>()
  const recordDrawn = (font: PDFFont, text: string): void => {
    let set = drawnBy.get(font)
    if (!set) drawnBy.set(font, (set = new Set()))
    set.add(text)
  }

  // ── 页面：目录页 + 内容页 ─────────────────────────────────────────────────
  const tocPageCount = layout.tocPageCount
  const totalPages = tocPageCount + layout.pages.length
  const pages: PDFPage[] = []
  for (let i = 0; i < totalPages; i++) {
    pages.push(pdf.addPage([pageWpt, pageHpt]))
  }

  const toPdfX = (xPx: number): number => marginPt.left + xPx * PX_TO_PT
  const toPdfY = (yPx: number): number => pageHpt - contentTopPt - yPx * PX_TO_PT

  // ── 绘制原语 ─────────────────────────────────────────────────────────────
  const fontOfRun = (run: { fontKey?: string; stdFace?: 'times' | 'helvetica' | 'timesItalic' | 'helveticaItalic' }): PDFFont => {
    if (run.stdFace === 'times') return bundle.times
    if (run.stdFace === 'helvetica') return bundle.helvetica
    if (run.stdFace === 'timesItalic') return bundle.timesItalic
    if (run.stdFace === 'helveticaItalic') return bundle.helveticaItalic
    return (run.fontKey && bundle.custom.get(run.fontKey)) || bundle.fallback
  }

  const drawTextItem = (page: PDFPage, item: TextItem): void => {
    const text = item.text
    if (!text.trim()) return
    const size = item.size * PX_TO_PT
    const y = toPdfY(item.y)
    const c = hexToRgb(item.color)
    const color = rgb(c.r, c.g, c.b)
    const runs = runPlans.get(item) ?? [{ text, fontKey: item.fontKey }]
    let xPx = item.x
    for (const run of runs) {
      if (!run.text) continue
      const font = fontOfRun(run)
      try {
        recordDrawn(font, run.text)
        page.drawText(run.text, { x: toPdfX(xPx), y, size, font, color })
      } catch {
        // 子集字体编码不下（理论少见：字形已按覆盖率指派）→ 回退兜底字体
        try {
          page.drawText(run.text, { x: toPdfX(xPx), y, size, font: bundle.fallback, color })
        } catch { /* 彻底画不出的字符跳过 */ }
      }
      // 段内推进用绘制字体自己的宽度；下一段文本项有自己的实测 x，不累积漂移
      xPx += font.widthOfTextAtSize(run.text, size) / PX_TO_PT
    }
    if (item.strike || item.underline) {
      const yLine = item.strike ? item.y - item.size * 0.28 : item.y + item.size * 0.16
      page.drawLine({
        start: { x: toPdfX(item.x), y: toPdfY(yLine) },
        end: { x: toPdfX(item.x + item.w), y: toPdfY(yLine) },
        thickness: Math.max(0.5, (item.size / 15) * PX_TO_PT),
        color,
      })
    }
  }

  const drawShapeItem = (page: PDFPage, item: Exclude<DrawItem, TextItem | { kind: 'image' } | { kind: 'link' }>): void => {
    switch (item.kind) {
      case 'rect': {
        const c = hexToRgb(item.fill)
        page.drawRectangle({
          x: toPdfX(item.x),
          y: toPdfY(item.y + item.h),
          width: Math.max(0.1, item.w * PX_TO_PT),
          height: Math.max(0.1, item.h * PX_TO_PT),
          color: rgb(c.r, c.g, c.b),
        })
        break
      }
      case 'line': {
        const c = hexToRgb(item.color)
        page.drawLine({
          start: { x: toPdfX(item.x1), y: toPdfY(item.y1) },
          end: { x: toPdfX(item.x2), y: toPdfY(item.y2) },
          thickness: Math.max(0.25, item.width * PX_TO_PT),
          color: rgb(c.r, c.g, c.b),
        })
        break
      }
      case 'path': {
        const scale = PX_TO_PT
        const yAnchor = toPdfY(0)
        try {
          if (item.fill) {
            const c = hexToRgb(item.fill)
            page.drawSvgPath(item.d, {
              x: toPdfX(0),
              y: yAnchor,
              scale,
              color: rgb(c.r, c.g, c.b),
              borderColor: undefined,
              borderWidth: 0,
            })
          }
          if (item.stroke) {
            const c = hexToRgb(item.stroke)
            page.drawSvgPath(item.d, {
              x: toPdfX(0),
              y: yAnchor,
              scale,
              borderWidth: Math.max(0.2, item.strokeWidth * scale),
              borderColor: rgb(c.r, c.g, c.b),
              color: undefined,
            })
          }
        } catch { /* 个别路径解析失败跳过 */ }
        break
      }
    }
  }

  const imageCache = new Map<string, PDFImage>()
  const drawImageItem = async (page: PDFPage, item: Extract<DrawItem, { kind: 'image' }>): Promise<void> => {
    const img = layout.images.get(item.imageId)
    if (!img) return
    try {
      const key = `${item.imageId}`
      let embedded = imageCache.get(key)
      if (!embedded) {
        embedded = img.format === 'png' ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes)
        imageCache.set(key, embedded)
      }
      page.drawImage(embedded, {
        x: toPdfX(item.x),
        y: toPdfY(item.y + item.h),
        width: item.w * PX_TO_PT,
        height: item.h * PX_TO_PT,
      })
    } catch (err) {
      details.push(`一张图片嵌入失败：${(err as Error).message}`)
    }
  }

  // ── 内容页绘制（保持 z 序：矩形/线/路径/文本按序，图片最后）───────────────
  for (let i = 0; i < layout.pages.length; i++) {
    const page = pages[tocPageCount + i]
    for (const item of layout.pages[i]) {
      if (item.kind === 'image') continue
      if (item.kind === 'link') continue
      if (item.kind === 'text') drawTextItem(page, item)
      else drawShapeItem(page, item)
    }
    for (const item of layout.pages[i]) {
      if (item.kind === 'image') await drawImageItem(page, item)
    }
    onProgress?.('draw', Math.round(((i + 1) / (layout.pages.length + 2)) * 85))
  }

  // ── 目录页 ───────────────────────────────────────────────────────────────
  const tocLinks: Array<{ pageIdx: number; rect: [number, number, number, number]; destPage: number }> = []
  if (tocPageCount > 0) {
    drawTocPages(pages, layout, bundle, toPdfX, toPdfY, tocLinks, recordDrawn)
  }

  // ── 页眉 / 页脚 / 页码 ───────────────────────────────────────────────────
  const bodyFont = bundle.custom.get('serif') ?? bundle.fallback
  const headerFont = bundle.custom.get('sans') ?? bundle.fallback
  const gray = rgb(0.42, 0.44, 0.48)
  for (let i = 0; i < totalPages; i++) {
    if (i === 0 && settings.hideFirstPageNumber) continue
    const page = pages[i]
    if (settings.headerText.trim()) {
      recordDrawn(headerFont, settings.headerText)
      page.drawText(settings.headerText, {
        x: marginPt.left,
        y: pageHpt - marginPt.top * 0.5,
        size: 9,
        font: headerFont,
        color: gray,
      })
    }
    const wantNumber = settings.includePageNumbers
    const footerText = settings.footerText.trim()
    if (!wantNumber && !footerText) continue
    const combined = wantNumber && footerText ? `${footerText}　${i + 1}` : wantNumber ? String(i + 1) : footerText
    const width = bodyFont.widthOfTextAtSize(combined, 9)
    let x = marginPt.left
    if (settings.pageNumberAlign === 'center') x = (pageWpt - width) / 2
    else if (settings.pageNumberAlign === 'right') x = pageWpt - marginPt.right - width
    recordDrawn(bodyFont, combined)
    page.drawText(combined, { x, y: marginPt.bottom * 0.42, size: 9, font: bodyFont, color: gray })
  }

  // ── 链接注解 ─────────────────────────────────────────────────────────────
  for (let i = 0; i < layout.links.length; i++) {
    const page = pages[tocPageCount + i]
    if (!page) continue
    for (const link of layout.links[i]) {
      if (link.kind !== 'link' || !link.url) continue
      const rect: [number, number, number, number] = [
        toPdfX(link.x),
        toPdfY(link.y + link.h),
        toPdfX(link.x + link.w),
        toPdfY(link.y),
      ]
      addUriLink(pdf, page, rect, link.url)
    }
  }
  for (const tl of tocLinks) {
    const page = pages[tl.pageIdx]
    const target = pages[tl.destPage - 1]
    if (!page || !target) continue
    addDestLink(pdf, page, tl.rect, target)
  }

  // ── 大纲书签 ─────────────────────────────────────────────────────────────
  if (layout.tocEntries.length > 0) {
    addOutline(pdf, layout.tocEntries.map((e) => ({ title: e.text, pageIndex: e.page - 1 })))
  }

  // ── 同步字体字形缓存（提取与间距的准确性关键）────────────────────────────
  // 必须在 save() 之前：save 时才用 glyphCache 生成 ToUnicode 与 /W。
  // 对所有嵌入字体统一同步（包括未绘制到的），确保 save 阶段不再走
  // glyphForCodePoint → 避免子集字体 cmap 兼容性问题。
  for (const [key, font] of custom) {
    const drawn = drawnBy.get(font)
    const subsetText = [...(usedChars.get(key) ?? new Set<string>()), ...STATIC_TEXT_CHARS].join('')
    syncFontGlyphCache(font, drawn ?? new Set([subsetText]))
  }

  // ── 元数据 ───────────────────────────────────────────────────────────────
  const metaTitle = settings.documentTitle.trim() || layout.title || 'MarkDoc 导出'
  pdf.setTitle(metaTitle)
  if (author && author.trim()) pdf.setAuthor(author.trim())
  pdf.setCreator('MarkDoc')
  pdf.setProducer('MarkDoc (pdf-lib)')
  pdf.setCreationDate(new Date())
  pdf.setModificationDate(new Date())

  onProgress?.('save', 96)
  let bytes: Uint8Array
  try {
    bytes = await pdf.save()
  } catch (err) {
    // 逐字体诊断：找出 fontkit 无法解析的子集字体
    const diag: string[] = []
    for (const [key, font] of custom) {
      try {
        void ((font as unknown as { embedder?: { font?: { characterSet?: number[] } } }).embedder?.font?.characterSet)
        diag.push(`${key}: cmap ok`)
      } catch (e) {
        const charset = [...(usedChars.get(key) ?? new Set<string>())].map((c) => c.codePointAt(0)!.toString(16)).slice(0, 40).join(',')
        diag.push(`${key}: cmap 解析失败 —— ${(e as Error).message}（charset: ${charset}）`)
      }
    }
    console.warn('[MarkDoc PDF] font diagnostics:', diag)
    throw new PdfRenderError(
      `PDF 序列化失败：${(err as Error).message}`,
      details.concat(diag),
    )
  }
  onProgress?.('save', 100)
  if (details.length) console.warn('[MarkDoc PDF] render notices:', details)
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
}

// ── 目录页绘制 ───────────────────────────────────────────────────────────────

function drawTocPages(
  pages: PDFPage[],
  layout: LayoutResult,
  fonts: FontBundle,
  toPdfX: (x: number) => number,
  toPdfY: (y: number) => number,
  tocLinks: Array<{ pageIdx: number; rect: [number, number, number, number]; destPage: number }>,
  recordDrawn: (font: PDFFont, text: string) => void,
): void {
  const { pageWpt, marginPt, contentWpx } = layout.geometry
  const serif = fonts.custom.get('serif') ?? fonts.fallback
  const sansBold = fonts.custom.get('sans-bold') ?? fonts.fallback
  const black = rgb(0, 0, 0)
  const gray = rgb(0.32, 0.34, 0.38)
  const dotColor = rgb(0.62, 0.64, 0.67)

  const entries = layout.tocEntries
  const bodyStartPx = TOC_TITLE_PX
  const perPage = Math.max(1, Math.floor((layout.geometry.contentHpx - bodyStartPx) / TOC_LINE_PX))
  const sizePt = 12

  let pageIndex = 0
  let lineIdx = 0
  entries.forEach((entry, entryIdx) => {
    if (pageIndex >= pages.length) return
    const page = pages[pageIndex]
    if (lineIdx === 0) {
      const title = '目  录'
      const titleSize = 16
      const w = sansBold.widthOfTextAtSize(title, titleSize)
      recordDrawn(sansBold, title)
      page.drawText(title, {
        x: (pageWpt - w) / 2,
        y: toPdfY(TOC_TITLE_PX * 0.55),
        size: titleSize,
        font: sansBold,
        color: black,
      })
    }

    const indent = (entry.level - 1) * TOC_INDENT_PX
    const pageLabel = String(entry.page)
    const numW = serif.widthOfTextAtSize(pageLabel, sizePt)
    const maxX = contentWpx - 4
    const availPt = (maxX - indent) * PX_TO_PT - numW - 24
    let text = entry.text
    while (text.length > 1 && serif.widthOfTextAtSize(text + '…', sizePt) > availPt) {
      text = text.slice(0, -2)
    }
    if (text !== entry.text) text += '…'

    const baseYpx = bodyStartPx + lineIdx * TOC_LINE_PX
    const yPt = toPdfY(baseYpx)
    const color = entry.level === 1 ? black : gray
    recordDrawn(serif, text)
    recordDrawn(serif, pageLabel)
    page.drawText(text, { x: toPdfX(indent), y: yPt, size: sizePt, font: serif, color })
    page.drawText(pageLabel, { x: toPdfX(maxX) - numW, y: yPt, size: sizePt, font: serif, color })

    const textEndPt = toPdfX(indent) + serif.widthOfTextAtSize(text, sizePt)
    const numStartPt = toPdfX(maxX) - numW - 8
    if (numStartPt - textEndPt > 14) {
      const dotW = serif.widthOfTextAtSize('.', sizePt)
      const count = Math.max(2, Math.floor((numStartPt - textEndPt - 6) / (dotW * 2.2)))
      if (count > 0) {
        const dots = '.'.repeat(count)
        recordDrawn(serif, dots)
        page.drawText(dots, { x: textEndPt + 4, y: yPt, size: sizePt, font: serif, color: dotColor })
      }
    }

    tocLinks.push({
      pageIdx: pageIndex,
      rect: [toPdfX(indent), toPdfY(baseYpx + TOC_LINE_PX * 0.45), toPdfX(maxX), toPdfY(baseYpx - TOC_LINE_PX * 0.75)],
      destPage: entry.page,
    })

    lineIdx++
    if (lineIdx >= perPage && entryIdx < entries.length - 1) {
      pageIndex++
      lineIdx = 0
    }
  })
}

// ── 注解 / 大纲（pdf-lib 低层 API）────────────────────────────────────────────

function addUriLink(pdf: PDFDocument, page: PDFPage, rect: [number, number, number, number], url: string): void {
  try {
    const annot = pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: rect,
      Border: [0, 0, 0],
      A: {
        Type: 'Action',
        S: 'URI',
        URI: PDFString.of(url),
      },
    })
    const ref = pdf.context.register(annot)
    page.node.addAnnot(ref)
  } catch (err) {
    console.warn('link annot failed', err)
  }
}

function addDestLink(pdf: PDFDocument, page: PDFPage, rect: [number, number, number, number], target: PDFPage): void {
  try {
    const annot = pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: rect,
      Border: [0, 0, 0],
      Dest: pdf.context.obj([target.ref, PDFName.of('Fit')]),
    })
    const ref = pdf.context.register(annot)
    page.node.addAnnot(ref)
  } catch (err) {
    console.warn('dest link annot failed', err)
  }
}

function addOutline(pdf: PDFDocument, entries: Array<{ title: string; pageIndex: number }>): void {
  try {
    const pages = pdf.getPages()
    const valid = entries.filter((e) => e.pageIndex >= 0 && e.pageIndex < pages.length)
    if (!valid.length) return
    const outlinesRef: PDFRef = pdf.context.nextRef()
    const itemRefs = valid.map(() => pdf.context.nextRef())
    valid.forEach((e, i) => {
      const dict: Record<string, unknown> = {
        Title: PDFString.of(e.title),
        Parent: outlinesRef,
        Dest: pdf.context.obj([pages[e.pageIndex].ref, PDFName.of('Fit')]),
      }
      if (i > 0) dict.Prev = itemRefs[i - 1]
      if (i < valid.length - 1) dict.Next = itemRefs[i + 1]
      pdf.context.assign(itemRefs[i], pdf.context.obj(dict as never))
    })
    pdf.context.assign(
      outlinesRef,
      pdf.context.obj({
        Type: 'Outlines',
        First: itemRefs[0],
        Last: itemRefs[itemRefs.length - 1],
        Count: valid.length,
      }),
    )
    pdf.catalog.set(PDFName.of('Outlines'), outlinesRef)
  } catch (err) {
    console.warn('outline failed', err)
  }
}

// ── 字体字形缓存同步 ─────────────────────────────────────────────────────────

/**
 * 把 embedder 的 glyphCache 换成 fontkit layout() 实际产生的字形集合。
 *
 * 背景：harfbuzz 子集字体中，layout() 与 glyphForCodePoint() 对同一字符可能给出
 * 不同字形入口（子集保留了两条 cmap 映射路径），而 pdf-lib 生成 ToUnicode（gid→Unicode）
 * 和 /W（gid→宽度）都用 glyphForCodePoint(characterSet)，与内容流里 layout 写出的
 * GID 不一致 —— 导致文本提取错字（如 123 → ghi）、数字间距异常（宽度缺省 1000）。
 *
 * pdf-lib 在 save() 时才用 glyphCache 构建字体字典，因此在 save 前替换缓存即可，
 * 内容流的 encodeText 本来就基于 layout()，两边从此一致。
 */
function syncFontGlyphCache(pdfFont: PDFFont, texts: Set<string>): void {
  try {
    interface FkGlyph {
      id: number
      codePoints: ArrayLike<number>
      advanceWidth: number
    }
    interface FkFont {
      layout(t: string): { glyphs: FkGlyph[] }
    }
    const embedder = (pdfFont as unknown as { embedder?: { font?: FkFont; glyphCache: unknown } }).embedder
    const fkFont = embedder?.font
    if (!fkFont || typeof fkFont.layout !== 'function') return

    const byId = new Map<number, FkGlyph>()
    for (const t of texts) {
      if (!t) continue
      try {
        const { glyphs } = fkFont.layout(t)
        for (const g of glyphs) {
          if (!byId.has(g.id)) byId.set(g.id, g)
        }
      } catch {
        // 单条文本 layout 失败跳过（不阻塞整份导出）
      }
    }
    if (!byId.size) return

    const sorted = [...byId.values()].sort((a, b) => a.id - b.id)
    ;(embedder as { glyphCache: unknown }).glyphCache = { access: () => sorted }
  } catch (err) {
    console.warn('syncFontGlyphCache failed (文本提取可能受影响)', err)
  }
}
