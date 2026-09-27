/**
 * 批量转换（需求 P1-8）：多个 .md 文件 → 逐个走与单篇导出完全相同的管线
 * （markdownToSafeHtml → 离屏预览渲染（KaTeX/Mermaid）→ buildDocxBlob）→
 * 统一套用当前模板样式 → 打包 ZIP 下载。
 *
 * 逐个串行处理：html2canvas 截图与字体子集化都吃内存，串行更稳；
 * 每完成一个文件回调一次进度，全部结束后返回逐项结果汇总。
 */

import { markdownToSafeHtml } from './markdown'
import { buildDocxBlob, getLastDocxExportStats, type DocxExportStats } from './exporter'
import { resolveTemplateBase, cssVarsFor, type DocSettings } from './templates'
import { recordExportEvent } from './exportLog'

export interface BatchItem {
  fileName: string
  content: string
}

export interface BatchItemResult {
  fileName: string
  ok: boolean
  error?: string
  sizeBytes?: number
  /** 与单篇导出同一来源的质量统计（getLastDocxExportStats） */
  stats?: Pick<DocxExportStats, 'mathTotal' | 'mathOmml' | 'mathDegraded' | 'tables' | 'mermaidTotal' | 'mermaidCaptured'> | null
}

export interface BatchProgress {
  done: number
  total: number
  current: string
}

export interface BatchOptions {
  settings: DocSettings
  onProgress?: (p: BatchProgress) => void
  /** 返回 true 时中止剩余文件（已完成的文件仍打包返回） */
  checkCancel?: () => boolean
  /**
   * 预览渲染注入点（默认 renderPreviewDom，含 KaTeX/Mermaid）。
   * previewDom 依赖完整浏览器 DOM（mermaid），单测注入轻量实现。
   */
  render?: (container: HTMLElement, content: string, settings: DocSettings) => Promise<void>
}

export interface BatchOutcome {
  blob: Blob | null
  results: BatchItemResult[]
  okCount: number
  failCount: number
}

export class BatchCancelledError extends Error {
  constructor(readonly outcome: BatchOutcome) {
    super('批量转换已取消')
    this.name = 'BatchCancelledError'
  }
}

/** 读取用户选择的文件（.md/.markdown/.txt，UTF-8） */
export async function readBatchFiles(files: File[] | FileList): Promise<BatchItem[]> {
  const out: BatchItem[] = []
  for (const f of Array.from(files)) {
    if (!/\.(md|markdown|txt)$/i.test(f.name)) continue
    out.push({ fileName: f.name, content: await f.text() })
  }
  return out
}

/** ZIP 内文件名：去扩展名、替换非法字符、限长；同名冲突由 caller 用 renameZipUnique 处理 */
export function sanitizeZipName(fileName: string): string {
  const base = fileName.replace(/\.(md|markdown|txt)$/i, '')
  const safe = base.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim()
  return (safe || '未命名').slice(0, 80)
}

/** 同名文件去重：报告.docx × 3 → 报告.docx、报告(2).docx、报告(3).docx */
export function renameZipUnique(fileName: string, used: Set<string>): string {
  if (!used.has(fileName)) {
    used.add(fileName)
    return fileName
  }
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  for (let i = 2; ; i++) {
    const candidate = `${stem}(${i})${ext}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

/**
 * 批量转换主入口。返回的 blob 为 null 仅当没有任何文件成功。
 * 单个文件失败不影响其它文件（结果里逐项标注原因）。
 */
export async function batchConvertToDocxZip(items: BatchItem[], opts: BatchOptions): Promise<BatchOutcome> {
  const { settings, onProgress, checkCancel, render } = opts
  const results: BatchItemResult[] = []
  const usedNames = new Set<string>()
  const zipEntries: { name: string; data: Uint8Array }[] = []

  for (let i = 0; i < items.length; i++) {
    if (checkCancel?.()) {
      const blob = await zipResults(zipEntries)
      throw new BatchCancelledError(makeOutcome(blob, results))
    }
    const item = items[i]
    onProgress?.({ done: i, total: items.length, current: item.fileName })
    try {
      const docxBlob = await convertOne(item, settings, render)
      const data = new Uint8Array(await docxBlob.arrayBuffer())
      const name = renameZipUnique(`${sanitizeZipName(item.fileName)}.docx`, usedNames)
      zipEntries.push({ name, data })
      const stats = getLastDocxExportStats()
      results.push({
        fileName: item.fileName,
        ok: true,
        sizeBytes: data.length,
        stats: stats
          ? {
              mathTotal: stats.mathTotal, mathOmml: stats.mathOmml, mathDegraded: stats.mathDegraded,
              tables: stats.tables, mermaidTotal: stats.mermaidTotal, mermaidCaptured: stats.mermaidCaptured,
            }
          : null,
      })
      recordExportEvent({
        ts: new Date().toISOString(), format: 'docx', outcome: 'ok',
        durationMs: 0, ...(stats ?? {}),
      })
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      results.push({ fileName: item.fileName, ok: false, error: message })
      recordExportEvent({
        ts: new Date().toISOString(), format: 'docx', outcome: 'fail',
        durationMs: 0, error: `批量[${sanitizeZipName(item.fileName)}] ${message.slice(0, 100)}`,
      })
    }
  }

  onProgress?.({ done: results.length, total: items.length, current: '' })
  const blob = await zipResults(zipEntries)
  return makeOutcome(blob, results)
}

function makeOutcome(blob: Blob | null, results: BatchItemResult[]): BatchOutcome {
  return {
    blob,
    results,
    okCount: results.filter((r) => r.ok).length,
    failCount: results.filter((r) => !r.ok).length,
  }
}

/** 单文件转换：与网页预览同一条渲染管线，保证「预览看到什么、Word 就是什么」 */
async function convertOne(
  item: BatchItem,
  settings: DocSettings,
  render?: (container: HTMLElement, content: string, settings: DocSettings) => Promise<void>,
): Promise<Blob> {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;overflow:hidden;visibility:hidden;pointer-events:none;'
  const container = document.createElement('div')
  container.className = `md-preview tpl-${resolveTemplateBase(settings.template).id}`
  const vars = cssVarsFor(settings) as Record<string, string>
  for (const [k, v] of Object.entries(vars)) container.style.setProperty(k, v)
  host.appendChild(container)
  document.body.appendChild(host)

  try {
    if (render) {
      await render(container, item.content, settings)
    } else {
      const { renderPreviewDom } = await import('./previewDom')
      await renderPreviewDom(container, item.content, settings)
    }
    return await buildDocxBlob(container.innerHTML, { settings, sourceEl: container })
  } finally {
    host.remove()
  }
}

async function zipResults(zipEntries: { name: string; data: Uint8Array }[]): Promise<Blob | null> {
  if (zipEntries.length === 0) return null
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  for (const { name, data } of zipEntries) zip.file(name, data)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}
