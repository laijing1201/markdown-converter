/**
 * 导出日志（整改要求：导出失败或格式异常时后台记录日志，管理员可查）。
 *
 * - 每次导出（Word/PDF）记录一条结构化事件：时间、格式、结果、耗时、
 *   公式 OMML 转换/降级数、表格数、源文本残留告警。
 * - 只存指标与错误摘要，绝不存正文内容、公式原文。
 * - 最近 MAX_EVENTS 条持久化在 localStorage，供「复制诊断信息」输出与排查。
 */

import { APP_VERSION } from '../version'

export interface ExportLogEvent {
  ts: string
  /** 导出格式 */
  format: 'docx' | 'pdf'
  /** ok=成功 fail=失败 cancel=用户取消 */
  outcome: 'ok' | 'fail' | 'cancel'
  durationMs: number
  pages?: number
  /** 失败/异常时的错误摘要（不含正文） */
  error?: string
  /** 公式质量：总数 / 转 OMML 成功数 / 降级为文本或图片数 */
  mathTotal?: number
  mathOmml?: number
  mathDegraded?: number
  /** 表格数（含从段内 HTML 文本还原的） */
  tables?: number
  /** 源文本残留告警（格式异常预警） */
  warnings?: string[]
}

const STORAGE_KEY = 'markdoc.export-log'
const MAX_EVENTS = 50

export function recordExportEvent(event: ExportLogEvent): void {
  try {
    const log = readLog()
    log.push(event)
    while (log.length > MAX_EVENTS) log.shift()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log))
  } catch {
    // 存储不可用（隐私模式等）时静默：日志绝不影响导出本身
  }
}

export function readExportLog(): ExportLogEvent[] {
  return readLog()
}

/** 诊断信息用的紧凑摘要（最近 N 条） */
export function exportLogSummary(count = 5): string[] {
  const log = readLog()
  if (!log.length) return []
  const lines = [`导出日志（最近 ${Math.min(count, log.length)}/${log.length} 条，共 ${log.length} 条）:`]
  for (const e of log.slice(-count).reverse()) {
    const parts = [
      e.ts,
      e.format.toUpperCase(),
      e.outcome === 'ok' ? '成功' : e.outcome === 'cancel' ? '取消' : '失败',
      `${(e.durationMs / 1000).toFixed(1)}s`,
    ]
    if (e.pages) parts.push(`${e.pages}页`)
    if (e.mathTotal !== undefined) parts.push(`公式 ${e.mathOmml ?? 0}/${e.mathTotal} OMML${e.mathDegraded ? `（降级${e.mathDegraded}）` : ''}`)
    if (e.tables !== undefined) parts.push(`表格 ${e.tables}`)
    if (e.warnings?.length) parts.push(`告警: ${e.warnings.join('、')}`)
    if (e.error) parts.push(`错误: ${e.error.slice(0, 120)}`)
    lines.push(`  - [${parts.join(' · ')}] v${APP_VERSION}`)
  }
  return lines
}

function readLog(): ExportLogEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
