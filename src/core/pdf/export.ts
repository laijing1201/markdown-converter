/**
 * PDF 导出编排 —— 布局 + 渲染 + 下载的一条龙：
 *
 *   预览 DOM → runLayout（测量/分页）→ renderPdf（pdf-lib）→ Blob → 下载
 *
 * 提供：阶段化进度、取消、错误收集（含用户可读明细 + 诊断信息）、字体替代提示。
 * 全程浏览器本地处理，不上传任何内容。
 */

import type { DocSettings } from '../templates'
import { runLayout, LayoutCancelledError, type ImageQuality, type LayoutResult } from './layout'
import { renderPdf, PdfRenderError } from './render'
import { takeFontNotices } from './fonts'

export interface ExportProgress {
  /** pct: 0-100；label: 用户可读阶段文案 */
  (pct: number, label: string): void
}

export interface PdfExportHooks {
  onProgress?: ExportProgress
  checkCancel?: () => void
  imageQuality?: ImageQuality
}

export class PdfExportCancelledError extends Error {
  constructor() {
    super('PDF 导出已取消')
    this.name = 'PdfExportCancelledError'
  }
}

export class PdfExportError extends Error {
  /** 用户可读的问题明细（如“1 张图片无法解析”） */
  details: string[]
  constructor(message: string, details: string[] = []) {
    super(message)
    this.name = 'PdfExportError'
    this.details = details
  }
}

export interface PdfExportResult {
  blob: Blob
  layout: LayoutResult
  /** 字体替代等提示（导出后 toast 展示） */
  notices: string[]
  pages: number
  durationMs: number
}

const PHASE_LABEL: Record<string, string> = {
  prepare: '正在准备内容…',
  fonts: '正在加载字体…',
  images: '正在处理图片…',
  measure: '正在分页…',
  render: '正在生成 PDF…',
  save: '正在生成 PDF…',
}

function reportProgress(hooks: PdfExportHooks, phase: keyof typeof PHASE_LABEL | 'render', pct: number): void {
  hooks.onProgress?.(pct, PHASE_LABEL[phase] ?? '正在处理…')
}

/** 构建完整 PDF（不触发下载），布局与渲染结果一并返回 */
export async function buildPdf(livePreview: HTMLElement, settings: DocSettings, hooks: PdfExportHooks = {}): Promise<PdfExportResult> {
  const start = Date.now()

  reportProgress(hooks, 'prepare', 3)
  const layout = await runLayout(livePreview, settings, {
    imageQuality: hooks.imageQuality,
    checkCancel: () => {
      if (hooks.checkCancel?.()) throw new LayoutCancelledError()
      return false
    },
    onProgress: (phase, done, total) => {
      const base = phase === 'prepare' ? 4 : phase === 'images' ? 10 : 32
      const span = phase === 'prepare' ? 4 : phase === 'images' ? 20 : 28
      const ratio = total > 0 ? done / total : 1
      reportProgress(hooks, phase, Math.round(base + span * Math.min(1, ratio)))
    },
  })

  reportProgress(hooks, 'render', 62)
  const blob = await renderPdf(layout, settings, (phase, pct) => {
    if (phase === 'fonts') reportProgress(hooks, 'fonts', 62 + Math.round((pct / 100) * 6))
    else if (phase === 'draw') reportProgress(hooks, 'render', 68 + Math.round((pct / 100) * 28))
    else reportProgress(hooks, 'save', 96 + Math.round((pct / 100) * 4))
  })

  const notices = [...takeFontNotices(), ...layout.notices]
  return {
    blob,
    layout,
    notices,
    pages: layout.pages.length + layout.tocPageCount,
    durationMs: Date.now() - start,
  }
}

/** 真实用户导出：构建 PDF 并交给平台层（Web=浏览器下载，Electron=原生另存为） */
export async function exportToPdf(
  livePreview: HTMLElement,
  settings: DocSettings,
  filename: string,
  hooks: PdfExportHooks = {},
): Promise<PdfExportResult> {
  try {
    const result = await buildPdf(livePreview, settings, hooks)
    const { platform } = await import('../../platform')
    await platform.saveOrDownload(result.blob, `${filename}.pdf`)
    return result
  } catch (err) {
    if (err instanceof LayoutCancelledError || err instanceof PdfExportCancelledError) {
      throw new PdfExportCancelledError()
    }
    if (err instanceof PdfRenderError) throw err
    // 布局阶段抛出的其他错误：包装成用户可读信息
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[MarkDoc] PDF export failed:', msg, err instanceof Error ? err.stack : '')
    throw new PdfExportError(`PDF 导出失败：${msg}`, collectDiagnostics(err))
  }
}

export function collectDiagnostics(err: unknown): string[] {
  const diag: string[] = []
  if (err instanceof Error) {
    diag.push(`${err.name}: ${err.message}`)
    if (err.stack) diag.push(err.stack.split('\n').slice(0, 6).join('\n'))
  } else {
    diag.push(String(err))
  }
  diag.push(`UA: ${navigator.userAgent}`)
  diag.push(`时间: ${new Date().toISOString()}`)
  return diag
}
