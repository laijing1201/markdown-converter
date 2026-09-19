/**
 * PDF 布局产物 —— 统一的「绘制条目」模型。
 *
 * 布局引擎（layout.ts）在真实浏览器布局之上测量语义 DOM，产出按页分组的
 * DrawItem 列表；PDF 渲染器（render.ts）与分页预览（canvasPreview.ts）
 * 消费同一份模型，保证「预览 ≈ 导出」。
 *
 * 坐标系：页面内容区左上角为原点，单位 CSS px（1px = 0.75pt），y 向下。
 */

export interface TextItem {
  kind: 'text'
  text: string
  /** 基线 x/y（px） */
  x: number
  y: number
  /** 簇宽（px） */
  w: number
  /** 字号（px） */
  size: number
  /** fonts.ts 注册表里的 fontKey */
  fontKey: string
  /** 拉丁斜体：使用标准 14 字体的 Times/Helvetica Italic */
  stdItalic: 'times' | 'helvetica' | null
  color: string
  underline?: boolean
  strike?: boolean
  linkUrl?: string
  /** 目录内部跳转目标页（1-based），用于 TOC 行 */
  destPage?: number
}

export interface RectItem {
  kind: 'rect'
  x: number
  y: number
  w: number
  h: number
  fill: string
}

export interface LineItem {
  kind: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
  color: string
  dashed?: boolean
}

export interface ImageItem {
  kind: 'image'
  x: number
  y: number
  w: number
  h: number
  /** 注册表 id（layout.images 里取字节） */
  imageId: string
}

/** 烘焙好变换的矢量路径（KaTeX 定界符等），坐标为舞台 px */
export interface PathItem {
  kind: 'path'
  d: string
  fill: string | null
  stroke: string | null
  strokeWidth: number
}

export interface LinkItem {
  kind: 'link'
  x: number
  y: number
  w: number
  h: number
  url?: string
  /** 文档内跳转目标页（1-based） */
  destPage?: number
}

export type DrawItem = TextItem | RectItem | LineItem | ImageItem | PathItem | LinkItem

export interface TocEntry {
  text: string
  level: 1 | 2 | 3
  /** 1-based 页码（含目录页偏移） */
  page: number
}

export interface LayoutImage {
  format: 'png' | 'jpeg'
  bytes: Uint8Array
}

export interface LayoutResult {
  /** pages[i] 为第 i+1 页内容（不含页眉页脚页码，渲染器负责） */
  pages: DrawItem[][]
  /** 每页的链接热区（与 pages 同长度） */
  links: DrawItem[][]
  /** 目录条目（pages 已含目录页偏移） */
  tocEntries: TocEntry[]
  /** 目录占用页数（includeToc=false 时为 0） */
  tocPageCount: number
  /** 文档标题（第一标题，元数据/文件名兜底） */
  title: string
  /** 嵌入图片注册表 */
  images: Map<string, LayoutImage>
  /** 用户可见提示（字体替代、图片降级、表格缩放等） */
  notices: string[]
  /** 各字体实际用到的字符（渲染前做子集化） */
  usedChars: Map<string, Set<string>>
  /** 页面几何（px 与 pt） */
  geometry: {
    pageWpt: number
    pageHpt: number
    marginPt: { top: number; right: number; bottom: number; left: number }
    contentWpx: number
    contentHpx: number
  }
}

/** 导出过程的用户提示 */
export function addNotice(list: string[], msg: string): void {
  if (!list.includes(msg)) list.push(msg)
}
