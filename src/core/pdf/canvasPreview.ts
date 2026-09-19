/**
 * 分页预览（近似）—— 把布局产出的 DrawItem 画到 <canvas> 上。
 *
 * 与 PDF 渲染器消费同一份布局模型，用于导出前快速检查分页位置：
 * 哪里换页、表格是否跨页、图片位置等。文本用注册过的同一批 FontFace
 * 绘制，效果接近最终 PDF（canvas 不渲染注解，链接不可点）。
 */

import { PX_TO_PT } from '../templates'
import { MAIN_FONT_FILES } from './fonts'
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
export function renderPageToCanvas(layout: LayoutResult, pageIndex: number, canvas: HTMLCanvasElement, cssWidth: number): void {
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

  const items = layout.pages[pageIndex] ?? []
  for (const item of items) {
    drawItem(ctx, layout, item)
  }
  ctx.restore()
  ctx.restore()
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
