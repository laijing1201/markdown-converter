/**
 * PDF 布局引擎 —— 浏览器实测 + 真分页。
 *
 * 不做第二套 Markdown 解析：预览 DOM（marked + KaTeX + Mermaid 渲染完）就是
 * 三端共用的统一语义模型。本模块把它克隆进隐藏的「导出舞台」，舞台宽度 =
 * 纸张内容区宽度，字体 = 将要嵌入 PDF 的同一批 FontFace，然后逐簇测量文本、
 * 逐块测量装饰，最后按页面高度真分页：
 *   - keep-with-next（标题不孤悬页尾，图与图题同页）
 *   - 孤行/寡行控制（段落拆分时两端至少 2 行）
 *   - 表格跨页 + 表头重复（行不从中间切断）
 *   - 代码块/引用跨页时背景与边框在每页完整闭合
 *   - <!-- pagebreak --> 真分页
 *
 * 坐标约定：舞台坐标 = 内容区左上角为原点的 CSS px；分页发射时把舞台坐标
 * 平移到「页面坐标」（页面内容区左上角为原点）。产物见 types.ts。
 */

import {
  resolveTemplateBase,
  cssVarsFor,
  getPageSizePt,
  getMarginsPt,
  PX_TO_PT,
  type DocSettings,
  type TableStyle,
} from '../templates'
import { ensureMainFontFaces, resolveFontFamily, hasCJK, MAIN_FONT_FILES } from './fonts'
import { walkSvg } from './svg'
import { addNotice, type DrawItem, type LayoutResult, type LayoutImage, type TextItem } from './types'

export type { LayoutResult } from './types'

// ── 常量 ─────────────────────────────────────────────────────────────────────

const STAGE_ID = 'pdf-export-stage'
export const TOC_LINE_PX = 30
export const TOC_TITLE_PX = 70
export const TOC_INDENT_PX = 24

export interface LayoutProgress {
  (phase: 'prepare' | 'images' | 'measure', done: number, total: number): void
}

export interface LayoutHooks {
  onProgress?: LayoutProgress
  checkCancel?: () => void
  imageQuality?: ImageQuality
}

export class LayoutCancelledError extends Error {
  constructor() {
    super('layout cancelled')
    this.name = 'LayoutCancelledError'
  }
}

export type ImageQuality = 'high' | 'standard' | 'compressed'

// ── 原始测量数据 ─────────────────────────────────────────────────────────────

interface RawCluster {
  text: string
  /** 舞台坐标：簇左缘 x、行内盒 top、基线 y */
  x: number
  top: number
  baselineY: number
  height: number
  w: number
  size: number
  fontKey: string
  stdItalic: 'times' | 'helvetica' | null
  color: string
  underline: boolean
  strike: boolean
  linkUrl?: string
  bg?: string
  rowId?: number
}

type RawShape =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill: string }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; width: number; color: string }
  | { t: 'image'; x: number; y: number; w: number; h: number; imageId: string }
  | { t: 'path'; d: string; fill: string | null; stroke: string | null; strokeWidth: number; y: number }

interface RawItem {
  shape: RawShape
  rowId?: number
}

interface LineBox {
  top: number
  bottom: number
  clusters: RawCluster[]
}

type BlockKind =
  | 'heading' | 'para' | 'pre' | 'table' | 'quote' | 'image'
  | 'math' | 'mermaid' | 'caption' | 'hr' | 'pagebreak' | 'list'

interface TableRowPlacement {
  top: number
  bottom: number
  isHeader: boolean
}

interface TableBorders {
  headerBg?: string
  gridColor?: string
  gridWidth: number
  topColor?: string
  topWidth: number
  headerUnderColor?: string
  headerUnderWidth: number
  bottomColor?: string
  bottomWidth: number
}

interface Placement {
  kind: BlockKind
  blockTop: number
  blockBottom: number
  clusters: RawCluster[]
  items: RawItem[]
  lines: LineBox[]
  atomic: boolean
  keepNext: boolean
  groupNext: boolean
  headingLevel: 1 | 2 | 3 | null
  headingText: string
  rows?: TableRowPlacement[]
  borders?: TableBorders
  colEdges?: number[]
  segDecor?: {
    bg?: string
    borderColor?: string
    barColor?: string
    barWidth: number
    left: number
    right: number
  }
}

// ── 舞台 ─────────────────────────────────────────────────────────────────────

interface Stage {
  root: HTMLElement
  stageTop: number
  stageLeft: number
  contentWpx: number
  contentHpx: number
  ascRatio: Map<string, number>
}

/** 并发运行计数：保护共享的测量环境（暗色开关），防止互相破坏 */
let stageRunCount = 0
let stageRemovedDark = false

function injectStageStyle(contentWpx: number): HTMLStyleElement {
  const style = document.createElement('style')
  style.id = 'pdf-export-stage-style'
  style.textContent = `
#${STAGE_ID} {
  position: fixed; left: -20000px; top: 0; z-index: -1;
  background: #ffffff; color: #000000;
  width: ${contentWpx}px; max-width: none; min-height: 0;
  padding: 0 !important; margin: 0 !important; box-shadow: none;
}
#${STAGE_ID} ul, #${STAGE_ID} ol { list-style: none; }
#${STAGE_ID} li { position: relative; }
#${STAGE_ID} .mermaid-rendered svg { max-width: 100% !important; }
#${STAGE_ID} .pdf-li-marker {
  position: absolute; right: 100%; padding-right: 0.45em;
  white-space: pre; text-indent: 0; text-align: left;
}
#${STAGE_ID} .pagebreak { height: 0 !important; border: none !important; margin: 0 !important; }
#${STAGE_ID} pre {
  white-space: pre-wrap;
  overflow-x: hidden;
  word-break: break-word;
}
`
  document.head.appendChild(style)
  return style
}

/** 标题 → 与 Word/预览一致的目录级别；null 表示不进目录 */
function tocLevelOf(el: HTMLElement, settings: DocSettings, state: { h1Count: number }): 1 | 2 | 3 | null {
  const tag = el.tagName.toLowerCase()
  if (!/^h[1-4]$/.test(tag)) return null
  const level = Number(tag[1])
  const academic = resolveTemplateBase(settings.template).academicHeuristics
  if (academic) {
    if (level === 1) {
      state.h1Count++
      return null // 首个 H1 = 论文题目
    }
    if (level === 2) {
      if (el.classList.contains('academic-subtitle') || el.classList.contains('academic-ref-title')) return null
      return 1
    }
    if (level === 3) return 2
    return 3
  }
  if (level === 1) return 1
  if (level === 2) return 2
  if (level === 3) return 3
  return null
}

/** 把克隆 DOM 的字体统一为将要嵌入 PDF 的 FontFace（测量与绘制同一套度量） */
function harmonizeFonts(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('*').forEach((el) => {
    if (el.closest('svg')) return
    const cs = getComputedStyle(el)
    const fam = cs.fontFamily
    if (/katex/i.test(fam)) return
    const bold = Number(cs.fontWeight) >= 600 || cs.fontWeight === 'bold'
    const res = resolveFontFamily(fam, bold, cs.fontStyle === 'italic')
    const def = MAIN_FONT_FILES[res.fontKey]
    if (!def) return
    if (!el.style.fontFamily.includes(def.family)) {
      const generic = def.family === 'MarkDoc Mono' ? 'monospace' : def.family === 'MarkDoc Sans' ? 'sans-serif' : 'serif'
      el.style.fontFamily = `"${def.family}", ${generic}`
    }
  })
}

/** 每字体族的基线占比校准：baseline = 盒 top + ascRatio × 盒高 */
function calibrateAsc(root: HTMLElement): Map<string, number> {
  const ratios = new Map<string, number>()
  const probe = root.ownerDocument.createElement('div')
  probe.setAttribute('data-pdf-probe', '1')
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;'
  for (const fam of ['MarkDoc Serif', 'MarkDoc Sans', 'MarkDoc Mono', 'KaTeX_Main']) {
    const span = root.ownerDocument.createElement('span')
    span.style.cssText = `font-family:"${fam}";font-size:100px;line-height:normal;white-space:pre;`
    span.textContent = 'Hxdp中g'
    const bl = root.ownerDocument.createElement('span')
    bl.style.cssText = 'display:inline-block;width:0;height:0;overflow:hidden;'
    span.appendChild(bl)
    probe.appendChild(span)
    root.appendChild(probe)
    try {
      const tr = span.getBoundingClientRect()
      const br = bl.getBoundingClientRect()
      if (tr.height > 0 && br.top >= tr.top) {
        ratios.set(fam, Math.min(1.2, Math.max(0.4, (br.top - tr.top) / tr.height)))
      }
    } catch { /* ignore */ } finally {
      probe.remove()
    }
  }
  return ratios
}

// ── 颜色小工具 ───────────────────────────────────────────────────────────────

function hexColor(csColor: string): string {
  const m = csColor.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const parts = m[1].split(/[\s,/]+/).map(Number)
    const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n || 0))).toString(16).padStart(2, '0')
    return `#${hex(parts[0])}${hex(parts[1])}${hex(parts[2])}`
  }
  if (csColor.startsWith('#')) return csColor.slice(0, 7)
  return '#000000'
}

function isTransparent(color: string): boolean {
  return !color || color === 'transparent' || /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(color)
}

// ── 图片预处理 ───────────────────────────────────────────────────────────────

const QUALITY_MAX_DIM: Record<ImageQuality, number> = { high: 4000, standard: 2400, compressed: 1400 }
const QUALITY_JPEG: Record<ImageQuality, number> = { high: 0.92, standard: 0.85, compressed: 0.72 }

async function canvasToBytes(canvas: HTMLCanvasElement, format: 'png' | 'jpeg', quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, format === 'png' ? 'image/png' : 'image/jpeg', quality),
  )
  if (!blob) throw new Error('canvas encode failed')
  return new Uint8Array(await blob.arrayBuffer())
}

function hasAlphaSampled(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const step = Math.max(1, Math.floor(Math.min(w, h) / 16))
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (ctx.getImageData(x, y, 1, 1).data[3] < 250) return true
      }
    }
  } catch { /* 跨域画布读不到：按不透明处理 */ }
  return false
}

interface PreparedImage {
  format: 'png' | 'jpeg'
  bytes: Uint8Array
}

async function loadImageEl(src: string): Promise<HTMLImageElement | null> {
  return await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function brokenPlaceholder(img: HTMLImageElement): HTMLElement {
  const span = img.ownerDocument.createElement('span')
  const alt = (img.getAttribute('alt') || '图片').slice(0, 40)
  span.setAttribute('data-pdf-placeholder', '1')
  span.style.cssText = 'color:#9ca3af;font-style:italic;'
  span.textContent = `[图片: ${alt}]`
  return span
}

/** 单图处理：解码 → 按质量档缩放/重编码 → 字节；失败返回 null（占位提示） */
async function processImageToBytes(img: HTMLImageElement, quality: ImageQuality, targetWpx: number): Promise<PreparedImage | null> {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (!nw || !nh) return null

  const src = img.getAttribute('src') || ''
  const isSvg = /image\/svg|\.svg(\?|$)/i.test(src)
  let scale = 1
  if (isSvg && targetWpx > 0) {
    scale = Math.min(4, Math.max(1, (targetWpx * 3) / nw))
  }
  let w = Math.round(nw * scale)
  let h = Math.round(nh * scale)
  const maxDim = QUALITY_MAX_DIM[quality]
  const biggest = Math.max(w, h)
  if (biggest > maxDim) {
    const k = maxDim / biggest
    w = Math.max(1, Math.round(w * k))
    h = Math.max(1, Math.round(h * k))
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, w, h)

  const looksPng = /image\/png|\.png(\?|$)/i.test(src) || isSvg
  if (looksPng) {
    if (hasAlphaSampled(ctx, w, h)) return { format: 'png', bytes: await canvasToBytes(canvas, 'png', 1) }
    if (quality === 'high' && w * h <= 1_200_000) return { format: 'png', bytes: await canvasToBytes(canvas, 'png', 1) }
  }
  return { format: 'jpeg', bytes: await canvasToBytes(canvas, 'jpeg', QUALITY_JPEG[quality]) }
}

/**
 * 处理克隆 DOM 中的全部图片 + Mermaid SVG 光栅化。
 * 成功的图片注册到 images 并写入 data-pdf-image id；失败替换为占位文字。
 */
async function prepareImages(
  root: HTMLElement,
  images: Map<string, LayoutImage>,
  quality: ImageQuality,
  notices: string[],
  onProgress?: (done: number, total: number) => void,
  checkCancel?: () => void,
): Promise<void> {
  // 1) Mermaid：SVG → 3x PNG（保证文字/线条清晰），注册后替换为 img 占位
  const mermaidSvgs = Array.from(root.querySelectorAll<SVGSVGElement>('.mermaid-rendered svg'))
  let mermaidDone = 0
  for (const svg of mermaidSvgs) {
    checkCancel?.()
    mermaidDone++
    onProgress?.(mermaidDone, mermaidSvgs.length)
    // mermaid 的 svg 带 width="100%"：无 max-width 约束时会撑满内容区被放大。
    // 收缩回 viewBox 的自然像素尺寸（与网页预览观感一致）。
    try {
      const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
      if (vb.length === 4 && vb[2] > 0) {
        const naturalW = vb[2]
        if (svg.getBoundingClientRect().width > naturalW + 2) {
          svg.style.width = `${naturalW}px`
          svg.style.height = 'auto'
          svg.style.maxWidth = 'none'
        }
      }
    } catch { /* ignore */ }
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    const xml = new XMLSerializer().serializeToString(svg)
    const img = await loadImageEl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`)
    if (!img) {
      addNotice(notices, '一个 Mermaid 图表无法转换到 PDF，已跳过')
      svg.remove()
      continue
    }
    const scale = Math.min(3, 6000 / Math.max(rect.width, rect.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(rect.width * scale))
    canvas.height = Math.max(1, Math.round(rect.height * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const bytes = await canvasToBytes(canvas, 'png', 1)
    const id = `img-mermaid-${mermaidDone}`
    images.set(id, { format: 'png', bytes })
    const holder = svg.ownerDocument.createElement('img')
    holder.setAttribute('data-pdf-image', id)
    holder.style.cssText = `width:${rect.width}px;height:${rect.height}px;display:inline-block;`
    svg.parentNode?.replaceChild(holder, svg)
  }

  // 2) 普通图片：data:/blob:/http(s:) → 统一处理为 PNG/JPEG 字节
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img')).filter((el) => !el.getAttribute('data-pdf-image'))
  let done = 0
  for (const img of imgs) {
    checkCancel?.()
    done++
    onProgress?.(done, Math.max(imgs.length, 1))
    const src = img.getAttribute('src') || ''
    if (!src) continue
    const decoded = img.complete && img.naturalWidth > 0 ? img : await loadImageEl(src)
    if (!decoded) {
      addNotice(notices, `图片无法加载，PDF 中以占位文字代替（${(img.getAttribute('alt') || '未命名').slice(0, 20)}）`)
      img.parentNode?.replaceChild(brokenPlaceholder(img), img)
      continue
    }
    const rect = img.getBoundingClientRect()
    let prepared: PreparedImage | null = null
    try {
      prepared = await processImageToBytes(decoded, quality, rect.width)
    } catch {
      prepared = null
    }
    if (!prepared) {
      addNotice(notices, '一张图片处理失败，PDF 中以占位文字代替')
      img.parentNode?.replaceChild(brokenPlaceholder(img), img)
      continue
    }
    const id = `img-${images.size}`
    images.set(id, prepared)
    img.setAttribute('data-pdf-image', id)
  }
}

// ── 克隆 DOM 变换 ────────────────────────────────────────────────────────────

/** 有序/无序列表标记（与 Word numbering 同语义：各级十进制、按父级重启） */
export function buildListMarkers(root: HTMLElement): void {
  const markerOf = (doc: Document, text: string): HTMLElement => {
    const marker = doc.createElement('span')
    marker.className = 'pdf-li-marker'
    marker.textContent = text
    return marker
  }
  const walkOl = (list: Element, level: number, counters: number[]) => {
    let idx = 0
    Array.from(list.children).forEach((li) => {
      if (li.tagName.toLowerCase() !== 'li') return
      idx++
      const next = [...counters]
      next[level] = idx
      if (!li.classList.contains('task-list-item')) {
        li.insertBefore(markerOf(li.ownerDocument!, `${next[level]}.`), li.firstChild)
      }
      Array.from(li.children).forEach((child) => {
        const t = child.tagName.toLowerCase()
        if (t === 'ol') walkOl(child, level + 1, next)
        else if (t === 'ul') walkUl(child, level + 1)
      })
    })
  }
  const walkUl = (list: Element, level: number) => {
    Array.from(list.children).forEach((li) => {
      if (li.tagName.toLowerCase() !== 'li') return
      if (!li.classList.contains('task-list-item')) {
        li.insertBefore(markerOf(li.ownerDocument!, '•'), li.firstChild)
      }
      Array.from(li.children).forEach((child) => {
        const t = child.tagName.toLowerCase()
        if (t === 'ul') walkUl(child, level + 1)
        else if (t === 'ol') walkOl(child, level + 1, [])
      })
    })
  }
  const scan = (parent: HTMLElement, depth: number) => {
    if (depth > 8) return
    Array.from(parent.children).forEach((el) => {
      const tag = el.tagName.toLowerCase()
      if (tag === 'ol') walkOl(el, 0, [])
      else if (tag === 'ul') walkUl(el, 0)
      else if (tag === 'blockquote' || (tag === 'div' && !el.classList.contains('pagebreak'))) scan(el as HTMLElement, depth + 1)
    })
  }
  scan(root, 0)
}

/** 任务列表 checkbox → 矢量复选框（Noto 无 ☑/☐ 字形，用 SVG 保证任何环境不缺字） */
function replaceTaskCheckboxes(root: HTMLElement): void {
  root.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    const checked = input.getAttribute('checked') !== null
    const span = input.ownerDocument.createElement('span')
    span.style.cssText = 'display:inline-block;width:0.95em;height:0.95em;vertical-align:-0.08em;margin-right:0.35em;'
    const stroke = checked ? '#2563eb' : '#9ca3af'
    const checkPath = checked
      ? '<path d="M2.2 5.4 L4.4 7.6 L8 2.6" fill="none" stroke="#2563eb" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
      : ''
    span.innerHTML =
      '<svg viewBox="0 0 10 10" width="100%" height="100%">' +
      `<rect x="0.6" y="0.6" width="8.8" height="8.8" rx="1.5" fill="${checked ? '#eff6ff' : '#ffffff'}" stroke="${stroke}" stroke-width="0.9"/>` +
      checkPath +
      '</svg>'
    input.parentNode?.replaceChild(span, input)
  })
}

/** 超宽表格：transform 等比缩放进内容区（文字同步缩小，不裁右侧） */
function fitWideTables(root: HTMLElement, contentWpx: number, notices: string[]): void {
  root.querySelectorAll('table').forEach((table) => {
    if (table.closest('[data-pdf-scale]')) return
    const overflow = table.scrollWidth - contentWpx
    if (overflow <= 2) return
    const scale = contentWpx / table.scrollWidth
    const wrapper = table.ownerDocument!.createElement('div')
    wrapper.setAttribute('data-pdf-scale', String(scale))
    const h = table.getBoundingClientRect().height
    wrapper.style.cssText = `transform:scale(${scale});transform-origin:top left;height:${h * scale}px;width:${contentWpx}px;`
    table.parentNode?.insertBefore(wrapper, table)
    wrapper.appendChild(table)
    addNotice(notices, '有表格超出页面宽度，PDF 中已等比缩放显示（文字随之变小）')
  })
}

// ── 文本簇测量 ───────────────────────────────────────────────────────────────

interface WalkCtx {
  stage: Stage
  scale: number
  rowId?: number
  usedChars: Map<string, Set<string>>
  linkHref?: string
}

interface WalkOut {
  clusters: RawCluster[]
  items: RawItem[]
}

function processTextNode(node: Text, ctx: WalkCtx, out: WalkOut): void {
  const parent = node.parentElement
  if (!parent) return
  const tag = parent.tagName.toLowerCase()
  if (tag === 'script' || tag === 'style' || tag === 'svg') return
  const text = node.textContent ?? ''
  if (!text) return

  const cs = getComputedStyle(parent)
  const size = parseFloat(cs.fontSize) * ctx.scale
  if (!(size > 0)) return
  const bold = Number(cs.fontWeight) >= 600 || cs.fontWeight === 'bold'
  const italic = cs.fontStyle === 'italic' || cs.fontStyle === 'oblique'
  const res = resolveFontFamily(cs.fontFamily, bold, italic)
  const family = res.fontKey.startsWith('katex:')
    ? cs.fontFamily.match(/KaTeX_[A-Za-z]+/)?.[0] ?? 'KaTeX_Main'
    : MAIN_FONT_FILES[res.fontKey]?.family ?? 'MarkDoc Sans'
  const color = hexColor(cs.color)
  const decoration = cs.textDecorationLine || ''
  const underline = decoration.includes('underline')
  const strike = decoration.includes('line-through')
  const link = ctx.linkHref ?? (parent.closest('a[href]') as HTMLAnchorElement | null)?.getAttribute('href') ?? undefined
  const bg = tag === 'code' && !isTransparent(cs.backgroundColor) ? hexColor(cs.backgroundColor) : undefined
  const asc = ctx.stage.ascRatio.get(family) ?? 0.8

  const range = node.ownerDocument!.createRange()
  const len = text.length
  let i = 0
  while (i < len) {
    range.setStart(node, i)
    range.setEnd(node, i + 1)
    const first = range.getBoundingClientRect()
    if (first.width === 0 && first.height === 0) {
      i++
      continue
    }
    const startTop = first.top
    const startIsCJK = hasCJK(text[i])
    let j = i + 1
    while (j < len) {
      const ch = text[j]
      if (/\s/.test(ch)) break
      if (hasCJK(ch) !== startIsCJK) break
      // 用“单字符矩形”检测换行：跨行 range 的 union 矩形 top 不变，
      // 会漏检折行导致巨型跨行簇（文字横向溢出页面）。
      range.setStart(node, j)
      range.setEnd(node, j + 1)
      const rc = range.getBoundingClientRect()
      if (rc.width === 0 || Math.abs(rc.top - startTop) > 2) break
      j++
    }
    range.setStart(node, i)
    range.setEnd(node, j)
    range.setStart(node, i)
    range.setEnd(node, j)
    const rr = range.getBoundingClientRect()
    if (rr.width > 0 || rr.height > 0) {
      const clusterText = text.slice(i, j)
      // 纯空白簇不绘制：阅读器按位置间隙重建空格（画出来反而会以
      // 错误的流顺序参与复制/搜索，且两端对齐时位置可能失真）
      if (!clusterText.trim()) {
        i = j
        continue
      }
      // 等宽字体没有中文字形：CJK 簇回退到黑体（嵌入字体保证不缺字）
      let clusterFontKey = res.fontKey
      let clusterFamily = family
      if (clusterFontKey.startsWith('mono') && hasCJK(clusterText)) {
        clusterFontKey = res.fontKey.endsWith('-bold') ? 'sans-bold' : 'sans'
        clusterFamily = 'MarkDoc Sans'
      }
      const cluster: RawCluster = {
        text: clusterText,
        x: rr.left - ctx.stage.stageLeft,
        top: rr.top - ctx.stage.stageTop,
        baselineY: rr.top - ctx.stage.stageTop + asc * rr.height,
        height: rr.height,
        w: rr.width,
        size,
        fontKey: clusterFontKey,
        stdItalic: italic && !hasCJK(clusterText) ? res.stdItalic : null,
        color,
        underline,
        strike,
        ...(link ? { linkUrl: link } : {}),
        ...(bg ? { bg } : {}),
        ...(ctx.rowId !== undefined ? { rowId: ctx.rowId } : {}),
      }
      out.clusters.push(cluster)
      let set = ctx.usedChars.get(clusterFontKey)
      if (!set) ctx.usedChars.set(clusterFontKey, (set = new Set()))
      for (const ch of clusterText) set.add(ch)
    }
    i = j
  }
}

function pathMinY(d: string): number {
  const nums = d.match(/-?\d+(\.\d+)?/g)
  if (!nums) return 0
  let min = Infinity
  for (let i = 1; i < nums.length; i += 2) min = Math.min(min, parseFloat(nums[i]))
  return Number.isFinite(min) ? min : 0
}

/** 递归走查：文本簇 + 装饰（行内代码背景、KaTeX 分数线、行内图、公式 SVG） */
function walkElement(el: Element, ctx: WalkCtx, out: WalkOut): void {
  const tag = el.tagName.toLowerCase()

  // KaTeX 的无障碍 MathML 副本：1px clip 视觉隐藏，绘制出来会与公式重叠
  if (el.classList.contains('katex-mathml')) return

  const scaleAttr = (el as HTMLElement).dataset?.pdfScale
  if (scaleAttr) ctx = { ...ctx, scale: ctx.scale * (parseFloat(scaleAttr) || 1) }

  const rowTag = ctx.rowId !== undefined ? { rowId: ctx.rowId } : {}

  if (tag === 'svg') {
    const stageRect = new DOMRect(ctx.stage.stageLeft, ctx.stage.stageTop, ctx.stage.contentWpx, ctx.stage.contentHpx)
    const res = walkSvg(el as SVGSVGElement, stageRect)
    res.paths.forEach((p) => {
      out.items.push({
        shape: { t: 'path', d: p.d, fill: p.fill, stroke: p.stroke, strokeWidth: p.strokeWidth * ctx.scale, y: pathMinY(p.d) },
        ...rowTag,
      })
    })
    return
  }
  if (tag === 'img') {
    const img = el as HTMLImageElement
    const id = img.getAttribute('data-pdf-image')
    if (!id) return
    const rect = img.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      out.items.push({
        shape: {
          t: 'image',
          x: rect.left - ctx.stage.stageLeft,
          y: rect.top - ctx.stage.stageTop,
          w: rect.width,
          h: rect.height,
          imageId: id,
        },
        ...rowTag,
      })
    }
    return
  }
  if (tag === 'br' || tag === 'script' || tag === 'style' || tag === 'input') return

  // KaTeX 内部的横线（分数、上下划线）
  if (el.closest('.katex')) {
    const cs = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    if (rect.width > 0) {
      const bt = parseFloat(cs.borderTopWidth)
      const bb = parseFloat(cs.borderBottomWidth)
      if (bt >= 0.5 && !isTransparent(cs.borderTopColor)) {
        out.items.push({
          shape: {
            t: 'line',
            x1: rect.left - ctx.stage.stageLeft,
            y1: rect.top - ctx.stage.stageTop + bt / 2,
            x2: rect.right - ctx.stage.stageLeft,
            y2: rect.top - ctx.stage.stageTop + bt / 2,
            width: bt,
            color: hexColor(cs.borderTopColor),
          },
          ...rowTag,
        })
      }
      if (bb >= 0.5 && !isTransparent(cs.borderBottomColor)) {
        out.items.push({
          shape: {
            t: 'line',
            x1: rect.left - ctx.stage.stageLeft,
            y1: rect.bottom - ctx.stage.stageTop - bb / 2,
            x2: rect.right - ctx.stage.stageLeft,
            y2: rect.bottom - ctx.stage.stageTop - bb / 2,
            width: bb,
            color: hexColor(cs.borderBottomColor),
          },
          ...rowTag,
        })
      }
    }
  }
  // 行内 code 的背景不在这里画：processTextNode 已把 bg 附着到文字簇上
  //（emitCluster 在文字之前绘制）。若在此处再按元素推一个背景矩形，
  // items 会后于文字绘制，粉色底色会把代码文字整个盖住（只剩色块）。

  const prevLink = ctx.linkHref
  if (tag === 'a') ctx.linkHref = (el as HTMLAnchorElement).getAttribute('href') || undefined

  Array.from(el.childNodes).forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) processTextNode(child as Text, ctx, out)
    else if (child.nodeType === Node.ELEMENT_NODE) walkElement(child as Element, ctx, out)
  })
  ctx.linkHref = prevLink
}

// ── 块收集 ───────────────────────────────────────────────────────────────────

function collectLines(clusters: RawCluster[]): LineBox[] {
  const sorted = [...clusters].sort((a, b) => a.top - b.top || a.x - b.x)
  const lines: LineBox[] = []
  for (const c of sorted) {
    const last = lines[lines.length - 1]
    const tolerance = Math.max(3, c.height * 0.6)
    if (last && Math.abs(c.top - last.top) <= tolerance) {
      last.clusters.push(c)
      last.bottom = Math.max(last.bottom, c.top + c.height)
    } else {
      lines.push({ top: c.top, bottom: c.top + c.height, clusters: [c] })
    }
  }
  return lines.sort((a, b) => a.top - b.top)
}

function classifyBlock(el: HTMLElement): BlockKind {
  const tag = el.tagName.toLowerCase()
  if (/^h[1-4]$/.test(tag)) return 'heading'
  if (tag === 'pre') return 'pre'
  if (tag === 'table' || (tag === 'div' && el.querySelector('table'))) return 'table'
  if (tag === 'blockquote') return 'quote'
  if (tag === 'img') return 'image'
  if (tag === 'hr') return 'hr'
  if (tag === 'ul' || tag === 'ol') return 'list'
  if (el.classList.contains('math-block')) return 'math'
  if (el.classList.contains('mermaid-rendered')) return 'mermaid'
  if (el.classList.contains('block-caption')) return 'caption'
  if (el.classList.contains('pagebreak')) return 'pagebreak'
  return 'para'
}

function tableBordersOf(table: HTMLElement, style: TableStyle): TableBorders {
  const fallback: Record<TableStyle, TableBorders> = {
    threeline: {
      gridWidth: 0,
      topColor: '#374151', topWidth: 2,
      headerUnderColor: '#374151', headerUnderWidth: 1,
      bottomColor: '#374151', bottomWidth: 2,
    },
    grid: {
      gridColor: '#e5e7eb', gridWidth: 1,
      topColor: '#e5e7eb', topWidth: 1,
      headerUnderColor: '#9ca3af', headerUnderWidth: 2,
      bottomColor: '#e5e7eb', bottomWidth: 1,
    },
    shaded: {
      gridColor: '#dbe2ea', gridWidth: 1,
      topColor: '#dbe2ea', topWidth: 1,
      headerUnderColor: '#1f4e79', headerUnderWidth: 2,
      bottomColor: '#dbe2ea', bottomWidth: 1,
    },
  }
  const borders: TableBorders = { ...fallback[style] }
  const th = table.querySelector('th')
  if (th) {
    const cs = getComputedStyle(th)
    if (!isTransparent(cs.backgroundColor)) borders.headerBg = hexColor(cs.backgroundColor)
    const bw = parseFloat(cs.borderBottomWidth)
    if (bw >= 1 && !isTransparent(cs.borderBottomColor)) {
      borders.headerUnderColor = hexColor(cs.borderBottomColor)
      borders.headerUnderWidth = bw
    }
  }
  const td = table.querySelector('td')
  if (td) {
    const cs = getComputedStyle(td)
    const lw = parseFloat(cs.borderLeftWidth)
    if (lw >= 0.5 && !isTransparent(cs.borderLeftColor)) {
      borders.gridColor = hexColor(cs.borderLeftColor)
      borders.gridWidth = lw
    } else {
      borders.gridColor = undefined
      borders.gridWidth = 0
    }
  }
  const thead = table.querySelector('thead')
  if (thead) {
    const cs = getComputedStyle(thead)
    const tw = parseFloat(cs.borderTopWidth)
    if (tw >= 1 && !isTransparent(cs.borderTopColor)) {
      borders.topColor = hexColor(cs.borderTopColor)
      borders.topWidth = tw
    }
  }
  const tbody = table.querySelector('tbody')
  if (tbody) {
    const cs = getComputedStyle(tbody)
    const bw = parseFloat(cs.borderBottomWidth)
    if (bw >= 1 && !isTransparent(cs.borderBottomColor)) {
      borders.bottomColor = hexColor(cs.borderBottomColor)
      borders.bottomWidth = bw
    }
  }
  return borders
}

function measurePlacement(
  el: HTMLElement,
  kind: BlockKind,
  stage: Stage,
  settings: DocSettings,
  state: CollectState,
): Placement {
  const p: Placement = {
    kind,
    blockTop: 0,
    blockBottom: 0,
    clusters: [],
    items: [],
    lines: [],
    atomic: false,
    keepNext: false,
    groupNext: false,
    headingLevel: null,
    headingText: '',
  }
  const rect = el.getBoundingClientRect()
  const top = rect.top - stage.stageTop

  if (kind === 'pagebreak') {
    p.atomic = true
    return p
  }

  if (kind === 'hr') {
    const cs = getComputedStyle(el)
    const y = top + rect.height / 2
    p.items.push({
      shape: {
        t: 'line',
        x1: rect.left - stage.stageLeft,
        y1: y,
        x2: rect.right - stage.stageLeft,
        y2: y,
        width: Math.max(1, parseFloat(cs.borderTopWidth) || 1),
        color: isTransparent(cs.borderTopColor) ? '#e5e7eb' : hexColor(cs.borderTopColor),
      },
    })
    p.atomic = true
    p.blockTop = top
    p.blockBottom = top + rect.height
    return p
  }

  if (kind === 'table') {
    const table = el.tagName.toLowerCase() === 'table' ? el : (el.querySelector('table') as HTMLElement)
    const ctx: WalkCtx = { stage, scale: 1, usedChars: state.usedChars }
    const allRows = Array.from(table.querySelectorAll('tr'))
    allRows.forEach((tr, rowId) => {
      const rowCtx: WalkCtx = { ...ctx, rowId }
      tr.querySelectorAll('th, td').forEach((cell) => walkElement(cell, rowCtx, { clusters: p.clusters, items: p.items }))
    })
    const isHeaderRow = (tr: Element) => tr.parentElement?.tagName.toLowerCase() === 'thead'
    p.rows = allRows.map((tr) => {
      const r = tr.getBoundingClientRect()
      return { top: r.top - stage.stageTop, bottom: r.bottom - stage.stageTop, isHeader: isHeaderRow(tr) }
    })
    p.borders = tableBordersOf(table, resolveTemplateBase(settings.template).tableStyle)
    const edges = new Set<number>()
    allRows.slice(0, 2).forEach((tr) =>
      tr.querySelectorAll('th, td').forEach((cell) => {
        const r = cell.getBoundingClientRect()
        edges.add(Math.round(r.left - stage.stageLeft))
        edges.add(Math.round(r.right - stage.stageLeft))
      }),
    )
    p.colEdges = [...edges].sort((a, b) => a - b)
    p.blockTop = p.rows.length ? p.rows[0].top : top
    p.blockBottom = p.rows.length ? p.rows[p.rows.length - 1].bottom : top + rect.height
    return p
  }

  if (kind === 'image' || kind === 'mermaid' || kind === 'math' || kind === 'caption') {
    const ctx: WalkCtx = { stage, scale: 1, usedChars: state.usedChars }
    const out: WalkOut = { clusters: [], items: [] }
    walkElement(el, ctx, out)
    p.clusters = out.clusters
    p.items = out.items
    const ext = extentOf(p)
    p.blockTop = ext.top
    p.blockBottom = ext.bottom
    p.atomic = true
    if ((kind === 'image' || kind === 'mermaid') && el.nextElementSibling?.classList.contains('block-caption')) {
      p.groupNext = true
    }
    return p
  }

  if (kind === 'heading') {
    const ctx: WalkCtx = { stage, scale: 1, usedChars: state.usedChars }
    const out: WalkOut = { clusters: [], items: [] }
    walkElement(el, ctx, out)
    p.clusters = out.clusters
    p.items = out.items
    const ext = extentOf(p)
    p.blockTop = ext.top
    p.blockBottom = ext.bottom
    p.lines = collectLines(p.clusters)
    p.keepNext = true
    p.atomic = true
    p.headingLevel = tocLevelOf(el, settings, state.h1State)
    if (p.headingLevel) {
      p.headingText = (el.textContent || '').replace(/\s+/g, ' ').trim()
      state.tocRaw.push({ text: p.headingText, level: p.headingLevel, blockTop: p.blockTop })
    }
    return p
  }

  if (kind === 'pre' || kind === 'quote') {
    const ctx: WalkCtx = { stage, scale: 1, usedChars: state.usedChars }
    const out: WalkOut = { clusters: [], items: [] }
    const cs = getComputedStyle(el)
    p.blockTop = top
    p.blockBottom = top + rect.height
    if (kind === 'pre') {
      walkElement(el, ctx, out)
    } else {
      Array.from(el.children).forEach((child) => walkElement(child, ctx, out))
      if (!out.clusters.length && !out.items.length) walkElement(el, ctx, out)
    }
    p.clusters = out.clusters
    p.items = out.items
    p.lines = collectLines(p.clusters)
    p.segDecor = {
      bg: isTransparent(cs.backgroundColor) ? undefined : hexColor(cs.backgroundColor),
      borderColor: kind === 'pre' && !isTransparent(cs.borderTopColor) ? hexColor(cs.borderTopColor) : undefined,
      barColor: kind === 'quote' && !isTransparent(cs.borderLeftColor) ? hexColor(cs.borderLeftColor) : undefined,
      barWidth: kind === 'quote' ? parseFloat(cs.borderLeftWidth) || 4 : 0,
      left: rect.left - stage.stageLeft,
      right: rect.right - stage.stageLeft,
    }
    return p
  }

  // para / list
  const ctx: WalkCtx = { stage, scale: 1, usedChars: state.usedChars }
  const out: WalkOut = { clusters: [], items: [] }
  walkElement(el, ctx, out)
  p.clusters = out.clusters
  p.items = out.items
  const ext = extentOf(p)
  p.blockTop = ext.top
  p.blockBottom = ext.bottom
  p.lines = collectLines(p.clusters)
  return p
}

function extentOf(p: { clusters: RawCluster[]; items: RawItem[] }): { top: number; bottom: number } {
  let top = Infinity
  let bottom = -Infinity
  p.clusters.forEach((c) => {
    top = Math.min(top, c.top)
    bottom = Math.max(bottom, c.top + c.height)
  })
  p.items.forEach(({ shape }) => {
    if (shape.t === 'image' || shape.t === 'rect') {
      top = Math.min(top, shape.y)
      bottom = Math.max(bottom, shape.y + shape.h)
    } else if (shape.t === 'line') {
      top = Math.min(top, Math.min(shape.y1, shape.y2))
      bottom = Math.max(bottom, Math.max(shape.y1, shape.y2))
    } else {
      top = Math.min(top, shape.y)
      bottom = Math.max(bottom, shape.y + 8)
    }
  })
  if (!Number.isFinite(top)) return { top: 0, bottom: 0 }
  return { top, bottom }
}

interface CollectState {
  settings: DocSettings
  usedChars: Map<string, Set<string>>
  tocRaw: Array<{ text: string; level: 1 | 2 | 3; blockTop: number }>
  h1State: { h1Count: number }
}

// ── 分页发射 ─────────────────────────────────────────────────────────────────

interface PageCtx {
  pages: DrawItem[][]
  links: DrawItem[][]
  cursor: number
  contentHpx: number
}

function newPage(pageCtx: PageCtx): void {
  pageCtx.pages.push([])
  pageCtx.links.push([])
  pageCtx.cursor = 0
}

/** 簇 → 页面条目（delta = 页面内容顶与舞台坐标的位移） */
function emitCluster(page: DrawItem[], c: RawCluster, delta: number): void {
  if (c.bg) {
    page.push({
      kind: 'rect',
      x: c.x - 1.5,
      y: c.top + delta - c.size * 0.22,
      w: c.w + 3,
      h: c.height + c.size * 0.34,
      fill: c.bg,
    })
  }
  const text: TextItem = {
    kind: 'text',
    text: c.text,
    x: c.x,
    y: c.baselineY + delta,
    w: c.w,
    size: c.size,
    fontKey: c.fontKey,
    stdItalic: c.stdItalic,
    color: c.color,
    ...(c.underline ? { underline: true } : {}),
    ...(c.strike ? { strike: true } : {}),
    ...(c.linkUrl ? { linkUrl: c.linkUrl } : {}),
  }
  page.push(text)
  if (c.strike) {
    page.push({ kind: 'line', x1: c.x, y1: c.baselineY + delta - c.size * 0.28, x2: c.x + c.w, y2: c.baselineY + delta - c.size * 0.28, width: Math.max(0.7, c.size / 15), color: c.color })
  }
  if (c.underline) {
    page.push({ kind: 'line', x1: c.x, y1: c.baselineY + delta + c.size * 0.16, x2: c.x + c.w, y2: c.baselineY + delta + c.size * 0.16, width: Math.max(0.7, c.size / 15), color: c.color })
  }
}

function emitLinkIfAny(pageCtx: PageCtx, c: RawCluster, delta: number): void {
  if (!c.linkUrl) return
  const pageIndex = pageCtx.pages.length - 1
  pageCtx.links[pageIndex].push({
    kind: 'link',
    x: c.x,
    y: c.baselineY + delta - c.size * 0.85,
    w: c.w,
    h: c.size * 1.25,
    url: c.linkUrl,
  })
}

function shiftShape(shape: RawShape, delta: number): DrawItem {
  switch (shape.t) {
    case 'rect':
      return { kind: 'rect', x: shape.x, y: shape.y + delta, w: shape.w, h: shape.h, fill: shape.fill }
    case 'line':
      return { kind: 'line', x1: shape.x1, y1: shape.y1 + delta, x2: shape.x2, y2: shape.y2 + delta, width: shape.width, color: shape.color }
    case 'image':
      return { kind: 'image', x: shape.x, y: shape.y + delta, w: shape.w, h: shape.h, imageId: shape.imageId }
    case 'path':
      return { kind: 'path', d: shape.d, fill: shape.fill, stroke: shape.stroke, strokeWidth: shape.strokeWidth }
  }
}

/** 发射舞台区间 [yFrom, yTo) 的内容到当前页，contentTopY 为 yFrom 对应的页面 y */
function emitRange(
  p: Placement,
  yFrom: number,
  yTo: number,
  contentTopY: number,
  pageCtx: PageCtx,
  lineFrom?: number,
  lineTo?: number,
  seg?: { isFirst: boolean; isLast: boolean },
): void {
  const page = pageCtx.pages[pageCtx.pages.length - 1]
  const delta = contentTopY - yFrom

  // 装饰（pre 背景/边框、引用背景/竖线）按片段闭合
  if (p.segDecor) {
    const decor = p.segDecor
    const isFirst = seg?.isFirst ?? true
    const isLast = seg?.isLast ?? true
    const segTop = isFirst ? p.blockTop : yFrom
    const segBottom = isLast ? p.blockBottom : yTo
    if (decor.bg) {
      page.push({ kind: 'rect', x: decor.left, y: segTop + delta, w: decor.right - decor.left, h: segBottom - segTop, fill: decor.bg })
    }
    if (decor.barColor) {
      page.push({ kind: 'rect', x: decor.left, y: segTop + delta, w: decor.barWidth, h: segBottom - segTop, fill: decor.barColor })
    }
    if (decor.borderColor) {
      page.push({ kind: 'line', x1: decor.left, y1: segTop + delta, x2: decor.right, y2: segTop + delta, width: 1, color: decor.borderColor })
      if (isLast) {
        page.push({ kind: 'line', x1: decor.left, y1: segBottom + delta, x2: decor.right, y2: segBottom + delta, width: 1, color: decor.borderColor })
      }
      page.push({ kind: 'line', x1: decor.left, y1: segTop + delta, x2: decor.left, y2: segBottom + delta, width: 1, color: decor.borderColor })
      page.push({ kind: 'line', x1: decor.right - 1, y1: segTop + delta, x2: decor.right - 1, y2: segBottom + delta, width: 1, color: decor.borderColor })
    }
  }

  if (lineFrom !== undefined && lineTo !== undefined) {
    for (let li = lineFrom; li < lineTo; li++) {
      const line = p.lines[li]
      for (const c of line.clusters) {
        emitCluster(page, c, delta)
        emitLinkIfAny(pageCtx, c, delta)
      }
    }
  } else {
    p.clusters.forEach((c) => {
      emitCluster(page, c, delta)
      emitLinkIfAny(pageCtx, c, delta)
    })
  }

  p.items.forEach(({ shape }) => {
    const y = shape.t === 'image' || shape.t === 'rect' ? shape.y : shape.t === 'line' ? Math.min(shape.y1, shape.y2) : shape.y
    if (y >= yFrom - 8 && y < yTo) {
      page.push(shiftShape(shape, delta))
    }
  })
}

/**
 * 行级拆分的孤行/寡行控制（纯函数，单元测试覆盖）：
 * - 最多 maxFit 行可放入当前页
 * - 拆分后下页只剩 1 行（寡行）→ 本页少放 1 行
 * - 本页只剩 1 行（孤行）→ 整块移到下页
 */
export function computeSplitCount(totalLines: number, maxFit: number): number {
  if (totalLines <= 0 || maxFit <= 0) return 0
  let k = Math.min(maxFit, totalLines)
  if (k >= totalLines) return k
  if (totalLines - k === 1 && k > 1) k -= 1
  if (k === 1 && totalLines > 1) k = 0
  return k
}

function placeSplittable(p: Placement, pageCtx: PageCtx, checkCancel?: () => void): void {
  const total = p.lines.length
  if (!total) {
    // 无行文本（纯图等）：按 atomic 处理
    placeAtomic(p, pageCtx)
    return
  }
  let lineFrom = 0
  let firstSegment = true
  while (lineFrom < total) {
    const available = pageCtx.contentHpx - pageCtx.cursor
    const relTop = p.lines[lineFrom].top - p.blockTop
    let maxFit = 0
    for (let i = lineFrom; i < total; i++) {
      const relBottom = p.lines[i].bottom - p.blockTop
      if (relBottom - relTop <= available) maxFit = i - lineFrom + 1
      else break
    }
    let k = firstSegment ? computeSplitCount(total, maxFit) : maxFit
    if (k <= 0) {
      if (pageCtx.cursor === 0 && !firstSegment) {
        // 极端：单行超过页高 → 强制放一行防死循环
        k = 1
      } else {
        newPage(pageCtx)
        firstSegment = false
        continue
      }
    }
    const lineFromY = p.lines[lineFrom].top
    const yTo = p.lines[Math.min(lineFrom + k, total) - 1].bottom
    const isLast = lineFrom + k >= total
    // 首段从块顶（含 padding）发射：背景/边框与文本整体落在 cursor 之后
    const segFrom = firstSegment ? p.blockTop : lineFromY
    const segTo = isLast ? p.blockBottom : yTo
    emitRange(p, segFrom, segTo, pageCtx.cursor, pageCtx, lineFrom, lineFrom + k, {
      isFirst: firstSegment,
      isLast,
    })
    pageCtx.cursor += segTo - segFrom
    lineFrom += k
    firstSegment = false
    if (lineFrom < total) {
      newPage(pageCtx)
      checkCancel?.()
    }
  }
}

function placeAtomic(p: Placement, pageCtx: PageCtx): void {
  const h = p.blockBottom - p.blockTop
  if (pageCtx.cursor > 0 && pageCtx.cursor + h > pageCtx.contentHpx) {
    newPage(pageCtx)
  }
  emitRange(p, p.blockTop, p.blockBottom + 0.01, pageCtx.cursor, pageCtx, undefined, undefined, {
    isFirst: true,
    isLast: true,
  })
  pageCtx.cursor += h
}

function lookAheadNeed(next: Placement | undefined): number {
  if (!next) return 0
  const h = next.blockBottom - next.blockTop
  if (next.atomic || !next.lines.length) return h
  if (next.lines.length >= 2) return Math.min(h, next.lines[1].bottom - next.blockTop)
  return h
}

function placeTable(p: Placement, pageCtx: PageCtx, checkCancel?: () => void): void {
  const rows = p.rows ?? []
  if (!rows.length) return
  const clustersByRow = new Map<number, RawCluster[]>()
  p.clusters.forEach((c) => {
    if (c.rowId === undefined) return
    const arr = clustersByRow.get(c.rowId) ?? []
    arr.push(c)
    clustersByRow.set(c.rowId, arr)
  })
  const itemsByRow = new Map<number, RawShape[]>()
  p.items.forEach(({ shape, rowId }) => {
    if (rowId === undefined) return
    const arr = itemsByRow.get(rowId) ?? []
    arr.push(shape)
    itemsByRow.set(rowId, arr)
  })

  const borders = p.borders
  const colEdges = p.colEdges ?? []
  const tableLeft = colEdges[0] ?? 0
  const tableRight = colEdges[colEdges.length - 1] ?? 0
  const headerRowIdxs = rows.map((r, i) => (r.isHeader ? i : -1)).filter((i) => i >= 0)
  const headerTop = headerRowIdxs.length ? rows[headerRowIdxs[0]].top : 0
  const headerH = headerRowIdxs.length
    ? rows[headerRowIdxs[headerRowIdxs.length - 1]].bottom - headerTop
    : 0

  /** 连续放在同一页上的表格区域（页面坐标） */
  interface TableSegment {
    pageIdx: number
    topY: number
    bottomY: number
    boundaries: number[]
    hasHeader: boolean
  }
  const segments: TableSegment[] = []
  let currentSeg: TableSegment | null = null

  const startSegment = (hasHeader: boolean): TableSegment => {
    const seg: TableSegment = {
      pageIdx: pageCtx.pages.length - 1,
      topY: pageCtx.cursor,
      bottomY: pageCtx.cursor,
      boundaries: [],
      hasHeader,
    }
    segments.push(seg)
    currentSeg = seg
    return seg
  }

  const emitHeaderAt = (contentTopY: number): void => {
    const page = pageCtx.pages[pageCtx.pages.length - 1]
    if (borders?.headerBg) {
      page.push({ kind: 'rect', x: tableLeft, y: contentTopY, w: tableRight - tableLeft, h: headerH, fill: borders.headerBg })
    }
    headerRowIdxs.forEach((rowIdx) => {
      const row = rows[rowIdx]
      const delta = contentTopY - row.top
      for (const c of clustersByRow.get(rowIdx) ?? []) {
        emitCluster(page, c, delta)
        emitLinkIfAny(pageCtx, c, delta)
      }
      for (const shape of itemsByRow.get(rowIdx) ?? []) page.push(shiftShape(shape, delta))
    })
  }

  const emitBodyRow = (rowIdx: number): void => {
    const row = rows[rowIdx]
    const delta = pageCtx.cursor - row.top
    const page = pageCtx.pages[pageCtx.pages.length - 1]
    for (const c of clustersByRow.get(rowIdx) ?? []) {
      emitCluster(page, c, delta)
      emitLinkIfAny(pageCtx, c, delta)
    }
    for (const shape of itemsByRow.get(rowIdx) ?? []) page.push(shiftShape(shape, delta))
    pageCtx.cursor += row.bottom - row.top
    currentSeg!.bottomY = pageCtx.cursor
    currentSeg!.boundaries.push(pageCtx.cursor)
  }

  // 逐行放置；放不下 → 换页并重复表头
  startSegment(headerRowIdxs.length > 0)
  if (headerRowIdxs.length) {
    emitHeaderAt(pageCtx.cursor)
    pageCtx.cursor += headerH
    currentSeg!.bottomY = pageCtx.cursor
  }
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx]
    if (row.isHeader) continue
    const rowH = row.bottom - row.top
    if (pageCtx.cursor > 0 && pageCtx.cursor + rowH > pageCtx.contentHpx) {
      newPage(pageCtx)
      checkCancel?.()
      const repeated = headerRowIdxs.length > 0
      startSegment(repeated)
      if (repeated) {
        emitHeaderAt(pageCtx.cursor)
        pageCtx.cursor += headerH
        currentSeg!.bottomY = pageCtx.cursor
      }
    }
    emitBodyRow(idx)
  }

  // 画边框
  if (borders) {
    segments.forEach((seg, segIdx) => {
      const page = pageCtx.pages[seg.pageIdx]
      if (!page) return
      const isFirst = segIdx === 0
      const isLast = segIdx === segments.length - 1
      if (colEdges.length >= 2 && borders.gridColor && borders.gridWidth > 0) {
        for (const x of colEdges) {
          page.push({ kind: 'line', x1: x, y1: seg.topY, x2: x, y2: seg.bottomY, width: borders.gridWidth, color: borders.gridColor })
        }
        for (const b of seg.boundaries) {
          if (b > seg.topY + 0.5 && b < seg.bottomY - 0.5) {
            page.push({ kind: 'line', x1: tableLeft, y1: b, x2: tableRight, y2: b, width: borders.gridWidth, color: borders.gridColor })
          }
        }
      }
      if (isFirst && borders.topColor && borders.topWidth > 0) {
        page.push({ kind: 'line', x1: tableLeft, y1: seg.topY, x2: tableRight, y2: seg.topY, width: borders.topWidth, color: borders.topColor })
      }
      if (seg.hasHeader && borders.headerUnderColor && borders.headerUnderWidth > 0) {
        const underlineY = seg.topY + headerH
        if (underlineY <= seg.bottomY + 0.5) {
          page.push({ kind: 'line', x1: tableLeft, y1: underlineY, x2: tableRight, y2: underlineY, width: borders.headerUnderWidth, color: borders.headerUnderColor })
        }
      }
      if (isLast && borders.bottomColor && borders.bottomWidth > 0) {
        page.push({ kind: 'line', x1: tableLeft, y1: seg.bottomY, x2: tableRight, y2: seg.bottomY, width: borders.bottomWidth, color: borders.bottomColor })
      }
    })
  }
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

export async function runLayout(
  livePreview: HTMLElement,
  settings: DocSettings,
  hooks: LayoutHooks = {},
): Promise<LayoutResult> {
  const notices: string[] = []
  const checkCancel = () => {
    if (hooks.checkCancel?.()) throw new LayoutCancelledError()
  }

  // 1. 几何
  const pagePt = getPageSizePt(settings)
  const marginPt = getMarginsPt(settings)
  const contentWpx = Math.round((pagePt.width - marginPt.left - marginPt.right) / PX_TO_PT)
  const contentHpx = Math.round((pagePt.height - marginPt.top - marginPt.bottom) / PX_TO_PT)

  // 2. 舞台（导出期间强制亮色，避免暗色主题进入 PDF）
  const prevDark = document.documentElement.classList.contains('dark')
  stageRunCount++
  if (prevDark && stageRunCount === 1 && !stageRemovedDark) {
    document.documentElement.classList.remove('dark')
    stageRemovedDark = true
  }
  const stageStyleEl = injectStageStyle(contentWpx)
  const stageRoot = document.createElement('div')
  stageRoot.id = STAGE_ID
  document.body.appendChild(stageRoot)

  try {
    hooks.onProgress?.('prepare', 0, 1)
    await ensureMainFontFaces()
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready

    // 3. 克隆预览 DOM 并做导出变换
    const clone = livePreview.cloneNode(true) as HTMLElement
    const vars = { ...cssVarsFor(settings) }
    if (vars['--pd-body-font']) vars['--pd-body-font'] = '"MarkDoc Serif", serif'
    if (vars['--pd-heading-font']) vars['--pd-heading-font'] = '"MarkDoc Sans", sans-serif'
    clone.setAttribute('style', Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';'))
    clone.className = `${livePreview.className.replace(/a4-page|p-6/g, '').trim()} md-preview`
    clone.classList.add('md-preview')
    clone.removeAttribute('id')
    stageRoot.appendChild(clone)

    replaceTaskCheckboxes(clone)
    buildListMarkers(clone)
    fitWideTables(clone, contentWpx, notices)
    harmonizeFonts(clone)

    const rect = clone.getBoundingClientRect()
    const stage: Stage = {
      root: clone,
      stageTop: rect.top,
      stageLeft: rect.left,
      contentWpx,
      contentHpx,
      ascRatio: calibrateAsc(clone),
    }

    // 4. 图片 & Mermaid
    const images = new Map<string, LayoutImage>()
    hooks.onProgress?.('images', 0, 1)
    await prepareImages(clone, images, hooks.imageQuality ?? 'standard', notices, (done, total) => {
      hooks.onProgress?.('images', done, Math.max(total, 1))
    }, checkCancel)

    // 5. 块收集 + 测量
    const state: CollectState = {
      settings,
      usedChars: new Map(),
      tocRaw: [],
      h1State: { h1Count: 0 },
    }
    const placements: Placement[] = []
    const topChildren = Array.from(clone.children) as HTMLElement[]
    let blockIdx = 0
    for (const el of topChildren) {
      checkCancel()
      blockIdx++
      if (blockIdx % 6 === 0) {
        hooks.onProgress?.('measure', blockIdx, topChildren.length)
        await new Promise<void>((r) => {
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => r())
          else r()
        })
      }
      const tag = el.tagName.toLowerCase()
      if (tag === 'div' && !el.classList.contains('math-block') && !el.classList.contains('mermaid-rendered') &&
          !el.classList.contains('block-caption') && !el.classList.contains('pagebreak') && !el.dataset?.pdfScale) {
        collectChildBlocks(el, stage, state, placements, 1)
        continue
      }
      const kind = classifyBlock(el)
      if (kind === 'pagebreak' && placements.length === 0) continue
      const p = measurePlacement(el, kind, stage, settings, state)
      if (p.clusters.length || p.items.length || (p.rows?.length ?? 0) > 0 || p.kind === 'pagebreak') {
        placements.push(p)
      }
    }
    hooks.onProgress?.('measure', topChildren.length, topChildren.length)

    // 6. 分页
    const pageCtx: PageCtx = { pages: [], links: [], cursor: 0, contentHpx }
    newPage(pageCtx)
    const headingPageByTop = new Map<number, number>()
    let lastStageBottom: number | null = null
    let i = 0
    while (i < placements.length) {
      checkCancel()
      const p = placements[i]
      const next = placements[i + 1]

      if (p.kind === 'pagebreak') {
        if (pageCtx.cursor > 0 || pageCtx.pages.length > 1) newPage(pageCtx)
        lastStageBottom = null
        i++
        continue
      }

      // 块间真实间距（stage 坐标里的 margin），页面顶部不补
      if (lastStageBottom !== null && pageCtx.cursor > 0) {
        const gap = Math.max(0, Math.min(p.blockTop - lastStageBottom, 120))
        if (gap > 0 && pageCtx.cursor + gap <= contentHpx) {
          pageCtx.cursor += gap
        }
      }
      lastStageBottom = p.blockBottom

      if (p.groupNext && next && next.kind === 'caption') {
        const groupH = (p.blockBottom - p.blockTop) + (next.blockBottom - next.blockTop)
        if (pageCtx.cursor > 0 && pageCtx.cursor + groupH > contentHpx) newPage(pageCtx)
        placeAtomic(p, pageCtx)
        placeAtomic(next, pageCtx)
        i += 2
        continue
      }

      if (p.atomic) {
        const h = p.blockBottom - p.blockTop
        if (h > contentHpx + 2 && (p.kind === 'image' || p.kind === 'mermaid')) {
          addNotice(notices, '有一张图片/图表高度超过一页，PDF 中可能被裁剪')
        }
        if (p.keepNext && pageCtx.cursor > 0) {
          // keep-with-next：标题后至少要跟得下下一块的开头
          const need = h + lookAheadNeed(next)
          if (pageCtx.cursor + need > contentHpx) newPage(pageCtx)
        }
        placeAtomic(p, pageCtx)
        if (p.headingLevel) headingPageByTop.set(Math.round(p.blockTop), pageCtx.pages.length)
        i++
        continue
      }

      if (p.kind === 'table') {
        placeTable(p, pageCtx, checkCancel)
        i++
        continue
      }

      placeSplittable(p, pageCtx, checkCancel)
      i++
    }

    // 7. 目录（页码 = 内容页 + 目录页偏移）
    const includeToc = settings.includeToc && state.tocRaw.length > 0
    const tocPageCount = includeToc
      ? Math.max(1, Math.ceil((TOC_TITLE_PX + state.tocRaw.length * TOC_LINE_PX) / contentHpx))
      : 0

    return {
      pages: pageCtx.pages,
      links: pageCtx.links,
      tocEntries: includeToc
        ? state.tocRaw.map((e) => ({
            text: e.text,
            level: e.level,
            page: (headingPageByTop.get(Math.round(e.blockTop)) ?? 1) + tocPageCount,
          }))
        : [],
      tocPageCount,
      title: (state.tocRaw.find((e) => e.level === 1)?.text ?? state.tocRaw[0]?.text ?? '').trim(),
      images,
      notices,
      usedChars: state.usedChars,
      geometry: {
        pageWpt: pagePt.width,
        pageHpt: pagePt.height,
        marginPt,
        contentWpx,
        contentHpx,
      },
    }
  } finally {
    stageRoot.remove()
    stageStyleEl.remove()
    stageRunCount--
    if (stageRunCount === 0 && stageRemovedDark) {
      document.documentElement.classList.add('dark')
      stageRemovedDark = false
    }
  }
}

/** 未知容器（div 等）下钻收集子块 */
function collectChildBlocks(parent: HTMLElement, stage: Stage, state: CollectState, out: Placement[], depth: number): void {
  if (depth > 8) return
  Array.from(parent.children).forEach((el) => {
    const he = el as HTMLElement
    const tag = el.tagName.toLowerCase()
    if (tag === 'div' && !el.classList.contains('math-block') && !el.classList.contains('mermaid-rendered') &&
        !el.classList.contains('block-caption') && !el.classList.contains('pagebreak') && !(he.dataset?.pdfScale)) {
      collectChildBlocks(he, stage, state, out, depth + 1)
      return
    }
    const kind = classifyBlock(he)
    if (kind === 'pagebreak' && out.length === 0) return
    const p = measurePlacement(he, kind, stage, state.settings, state)
    if (p.clusters.length || p.items.length || (p.rows?.length ?? 0) > 0 || p.kind === 'pagebreak') {
      out.push(p)
    }
  })
}
