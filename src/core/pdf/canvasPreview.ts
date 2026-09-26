/**
 * 分页预览（近似）—— 把布局产出的 DrawItem 画到 <canvas> 上。
 *
 * 与 PDF 渲染器消费同一份布局模型，用于导出前快速检查分页位置：
 * 哪里换页、表格是否跨页、图片位置等。文本用注册过的同一批 FontFace
 * 绘制，效果接近最终 PDF（canvas 不渲染注解，链接不可点）。
 */

import { PX_TO_PT, type DocSettings } from '../templates'
import { MAIN_FONT_FILES } from './fonts'
import { TOC_INDENT_PX, TOC_LINE_PX, TOC_TITLE_PX } from './layout'
import type { DrawItem, LayoutResult, TextItem } from './types'

function familyOf(item: TextItem): string {
  if (item.fontKey.startsWith('katex:')) return 'KaTeX_Main'
  return MAIN_FONT_FILES[item.fontKey]?.family ?? 'MarkDoc Sans'
}

function italicOf(item: TextItem): boolean {
  if (item.stdItalic) return true
  return item.fontKey.includes('-Italic') || item.fontKey.includes('Math')
}

function boldOf(item: TextItem): boolean {
  return item.fontKey.endsWith('-bold') || item.fontKey.endsWith('-Bold')
}

/** 把一页画到 canvas（canvas 尺寸 = 页面 pt 尺寸 × dpr） */
export function renderPageToCanvas(
  layout: LayoutResult,
  pageIndex: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  settings?: DocSettings,
): void {
  const { pageWpt, pageHpt, marginPt } = layout.geometry
  const dpr = Math.min(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1)
  const scale = (cssWidth / pageWpt) * dpr
  canvas.width = Math.round(pageWpt * scale)
  canvas.height = Math.round(pageHpt * scale)
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssWidth * (pageHpt / pageWpt)}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.save()
  ctx.scale(scale, scale)
  // 白纸
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, pageWpt, pageHpt)

  // 内容区平移（px 坐标 → pt 画布）
  ctx.save()
  ctx.translate(marginPt.left, marginPt.top)
  ctx.scale(PX_TO_PT, PX_TO_PT)
  ctx.textBaseline = 'alphabetic'

  // 页面索引映射：layout.pages 不含目录页（导出时由渲染器补画），
  // 预览的前 tocPageCount 页对应目录，之后才是正文页
  const tocOffset = layout.tocPageCount
  if (pageIndex < tocOffset) {
    drawTocPage(ctx, layout, pageIndex)
  } else {
    const items = layout.pages[pageIndex - tocOffset] ?? []
    for (const item of items) {
      drawItem(ctx, layout, item)
    }
  }
  ctx.restore()

  // 页眉 / 页脚 / 页码（与 render.ts 导出绘制保持一致）
  if (settings) drawHeaderFooter(ctx, layout, pageIndex, settings)
  ctx.restore()
}

/** 页眉 / 页脚 / 页码：坐标与 render.ts 相同（pt 空间，canvas 纵轴向下） */
function drawHeaderFooter(
  ctx: CanvasRenderingContext2D,
  layout: LayoutResult,
  pageIndex: number,
  settings: DocSettings,
): void {
  if (pageIndex === 0 && settings.hideFirstPageNumber) return
  const { pageWpt, pageHpt, marginPt } = layout.geometry
  const gray = '#6b707a'
  ctx.textBaseline = 'alphabetic'

  if (settings.headerText.trim()) {
    ctx.font = '9px "MarkDoc Sans"'
    ctx.fillStyle = gray
    ctx.fillText(settings.headerText, marginPt.left, marginPt.top * 0.5)
  }

  const wantNumber = settings.includePageNumbers
  const footerText = settings.footerText.trim()
  if (!wantNumber && !footerText) return
  const combined = wantNumber && footerText ? `${footerText}　${pageIndex + 1}` : wantNumber ? String(pageIndex + 1) : footerText
  ctx.font = '9px "MarkDoc Serif"'
  const width = ctx.measureText(combined).width
  let x = marginPt.left
  if (settings.pageNumberAlign === 'center') x = (pageWpt - width) / 2
  else if (settings.pageNumberAlign === 'right') x = pageWpt - marginPt.right - width
  ctx.fillStyle = gray
  ctx.fillText(combined, x, pageHpt - marginPt.bottom * 0.42)
}

/** 目录页：结构与 render.ts drawTocPages 对齐（px 空间，简化点线） */
function drawTocPage(ctx: CanvasRenderingContext2D, layout: LayoutResult, tocIndex: number): void {
  const entries = layout.tocEntries
  if (entries.length === 0) return
  const { contentWpx, contentHpx } = layout.geometry
  const bodyStartPx = TOC_TITLE_PX
  const perPage = Math.max(1, Math.floor((contentHpx - bodyStartPx) / TOC_LINE_PX))
  const start = tocIndex * perPage
  if (start >= entries.length) return

  const black = '#000000'
  const gray = '#525761'
  const dotColor = '#9ea3ab'
  const titlePx = 16 / PX_TO_PT
  const sizePx = 12 / PX_TO_PT

  // 标题（导出端每个目录页都会画；按整页宽居中，换算回内容区 px 坐标）
  ctx.font = `700 ${titlePx}px "MarkDoc Sans"`
  ctx.fillStyle = black
  ctx.textAlign = 'center'
  const centerXpx = (layout.geometry.pageWpt / 2 - layout.geometry.marginPt.left) / PX_TO_PT
  ctx.fillText('目  录', centerXpx, bodyStartPx * 0.55)
  ctx.textAlign = 'left'

  const maxX = contentWpx - 4
  entries.slice(start, start + perPage).forEach((entry, lineIdx) => {
    const indent = (entry.level - 1) * TOC_INDENT_PX
    const pageLabel = String(entry.page)
    ctx.font = `${sizePx}px "MarkDoc Serif"`
    const numW = ctx.measureText(pageLabel).width
    const availPx = maxX - indent - numW - 24 / PX_TO_PT
    let text = entry.text
    while (text.length > 1 && ctx.measureText(`${text}…`).width > availPx) {
      text = text.slice(0, -2)
    }
    if (text !== entry.text) text += '…'

    const baseYpx = bodyStartPx + lineIdx * TOC_LINE_PX
    ctx.fillStyle = entry.level === 1 ? black : gray
    ctx.fillText(text, indent, baseYpx)
    ctx.fillText(pageLabel, maxX - numW, baseYpx)

    const textEnd = indent + ctx.measureText(text).width
    const numStart = maxX - numW - 8 / PX_TO_PT
    if (numStart - textEnd > 14 / PX_TO_PT) {
      const dotW = ctx.measureText('.').width
      const count = Math.max(2, Math.floor((numStart - textEnd - 6 / PX_TO_PT) / (dotW * 2.2)))
      if (count > 0) {
        ctx.fillStyle = dotColor
        ctx.fillText('.'.repeat(count), textEnd + 4, baseYpx)
      }
    }
  })
}

async function drawItem(ctx: CanvasRenderingContext2D, layout: LayoutResult, item: DrawItem): Promise<void> {
  switch (item.kind) {
    case 'text': {
      const style = `${italicOf(item) ? 'italic ' : ''}${boldOf(item) ? 700 : 400} ${item.size}px "${familyOf(item)}"`
      ctx.font = style
      ctx.fillStyle = item.color
      ctx.fillText(item.text, item.x, item.y)
      if (item.strike || item.underline) {
        const y = item.strike ? item.y - item.size * 0.28 : item.y + item.size * 0.16
        ctx.strokeStyle = item.color
        ctx.lineWidth = Math.max(0.6, item.size / 15)
        ctx.beginPath()
        ctx.moveTo(item.x, y)
        ctx.lineTo(item.x + item.w, y)
        ctx.stroke()
      }
      break
    }
    case 'rect': {
      ctx.fillStyle = item.fill
      ctx.fillRect(item.x, item.y, item.w, item.h)
      break
    }
    case 'line': {
      ctx.strokeStyle = item.color
      ctx.lineWidth = Math.max(0.4, item.width)
      ctx.beginPath()
      ctx.moveTo(item.x1, item.y1)
      ctx.lineTo(item.x2, item.y2)
      ctx.stroke()
      break
    }
    case 'image': {
      const img = layout.images.get(item.imageId)
      if (!img) break
      try {
        const blob = new Blob([img.bytes as unknown as BlobPart], { type: img.format === 'png' ? 'image/png' : 'image/jpeg' })
        const bitmap = await createImageBitmap(blob)
        ctx.drawImage(bitmap, item.x, item.y, item.w, item.h)
        bitmap.close()
      } catch { /* 预览缺图不影响导出 */ }
      break
    }
    case 'path': {
      try {
        const path = new Path2D(item.d)
        if (item.fill) {
          ctx.fillStyle = item.fill
          ctx.fill(path)
        }
        if (item.stroke) {
          ctx.strokeStyle = item.stroke
          ctx.lineWidth = Math.max(0.3, item.strokeWidth)
          ctx.stroke(path)
        }
      } catch { /* ignore */ }
      break
    }
    case 'link':
      break
  }
}
