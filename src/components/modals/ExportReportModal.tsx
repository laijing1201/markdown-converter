/**
 * 导出质量自检报告（Word 导出成功后展示）：
 *   公式 N 个（成功 M 个，逐条列出失败项及源码行号）、表格 N 张、
 *   Mermaid 图 N 张、警告 N 条、耗时。
 * 数据来自 buildDocxBlob 的真实转换统计（getLastDocxExportStats），
 * 不是预估值 —— 「成功」= 已转为 Word 原生 OMML 公式，双击即可编辑。
 */

import { platform } from '../../platform'

export interface ExportQualityReport {
  durationMs: number
  mathTotal: number
  mathOmml: number
  /** 转原生公式失败的公式（附源码行号，匹配不到时为 undefined） */
  degraded: { formula: string; line?: number }[]
  tables: number
  tablesFromEmbeddedText: number
  mermaidTotal: number
  mermaidCaptured: number
  warnings: string[]
}

interface ExportReportModalProps {
  report: ExportQualityReport
  onClose: () => void
}

/** 报告文件名：导出质量报告-20260927-1430.txt/json */
function reportFileStem(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `导出质量报告-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** 报告文本版（甲方「报告可导出为文本」） */
function reportToText(report: ExportQualityReport): string {
  const lines = [
    'MarkDoc 导出质量自检报告',
    `时间：${new Date().toLocaleString()}`,
    `耗时：${(report.durationMs / 1000).toFixed(1)}s`,
    '',
    `公式：共 ${report.mathTotal} 个，成功转换 ${report.mathTotal - report.degraded.length} 个，失败 ${report.degraded.length} 个`,
    ...report.degraded.map((d) => `  - 失败${d.line !== undefined ? `（第 ${d.line} 行）` : ''}：${d.formula}`),
    `表格：共 ${report.tables} 张${report.tablesFromEmbeddedText ? `（含 ${report.tablesFromEmbeddedText} 张由 HTML 文本还原）` : '，均为 Word 原生表格'}`,
    `Mermaid 图：共 ${report.mermaidTotal} 张，成功嵌入 ${report.mermaidCaptured} 张`,
    `警告：${report.warnings.length} 条`,
    ...report.warnings.map((w) => `  - ${w}`),
  ]
  return lines.join('\n') + '\n'
}

function StatChip({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        ok
          ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/30'
          : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/30'
      }`}
    >
      <p className={`text-sm font-semibold ${ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
        {ok ? '✓' : '⚠'} {label}
      </p>
      <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{detail}</p>
    </div>
  )
}

export default function ExportReportModal({ report, onClose }: ExportReportModalProps) {
  const mathOk = report.mathTotal - report.degraded.length
  const allMathOk = report.degraded.length === 0
  const allMermaidOk = report.mermaidCaptured >= report.mermaidTotal
  const noWarnings = report.warnings.length === 0
  const secs = (report.durationMs / 1000).toFixed(1)

  const handleDownloadReport = (fmt: 'txt' | 'json') => {
    const content = fmt === 'json'
      ? JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2)
      : reportToText(report)
    const blob = new Blob([content], { type: fmt === 'json' ? 'application/json' : 'text/plain' })
    // 走平台层：浏览器 = 下载，安卓壳 = 写缓存 + 系统分享面板
    void platform.saveOrDownload(blob, `${reportFileStem()}.${fmt}`)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[520px] max-w-full max-h-[85vh] flex flex-col">
        <div className="px-6 pt-5 pb-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">
            ✅ Word 导出成功 · 质量自检报告
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            耗时 {secs}s · 「成功」= 转为 Word 原生公式，双击即可编辑
          </p>
        </div>

        <div className="px-6 py-4 overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <StatChip
              ok={allMathOk}
              label={`公式 ${mathOk}/${report.mathTotal} 可编辑`}
              detail={allMathOk
                ? '全部转为 Word 原生 OMML 公式'
                : `${report.degraded.length} 个转换失败，以 $…$ 文本保留`}
            />
            <StatChip
              ok
              label={`表格 ${report.tables} 张`}
              detail={report.tablesFromEmbeddedText > 0
                ? `含 ${report.tablesFromEmbeddedText} 张由 HTML 文本还原`
                : '均为 Word 原生表格，可编辑'}
            />
            <StatChip
              ok={allMermaidOk}
              label={`Mermaid 图 ${report.mermaidCaptured}/${report.mermaidTotal}`}
              detail={report.mermaidTotal === 0
                ? '文档中未检测到 Mermaid 图表'
                : allMermaidOk
                  ? '全部以高清图片（3×）嵌入'
                  : `${report.mermaidTotal - report.mermaidCaptured} 张嵌入失败，已保留源码`}
            />
            <StatChip
              ok={noWarnings}
              label={`警告 ${report.warnings.length} 条`}
              detail={noWarnings ? '未发现源文本残留风险' : report.warnings.slice(0, 2).join('；')}
            />
          </div>

          {!allMathOk && (
            <div>
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1.5">
                以下公式未能转为原生公式（已按 $…$ 文本保留在 Word 中，可修正语法后重新导出）：
              </p>
              <ul className="space-y-1.5">
                {report.degraded.slice(0, 10).map((d, i) => (
                  <li
                    key={i}
                    className="text-xs bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-md px-2.5 py-1.5"
                  >
                    {d.line !== undefined && (
                      <span className="text-red-600 dark:text-red-400 font-medium mr-1.5">第 {d.line} 行</span>
                    )}
                    <code className="font-mono break-all text-gray-700 dark:text-gray-200">
                      {d.formula.length > 120 ? `${d.formula.slice(0, 120)}…` : d.formula}
                    </code>
                  </li>
                ))}
                {report.degraded.length > 10 && (
                  <li className="text-xs text-gray-500">…还有 {report.degraded.length - 10} 个</li>
                )}
              </ul>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2">
          <span className="flex gap-2">
            <button
              onClick={() => handleDownloadReport('txt')}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="下载文本版报告"
            >
              导出报告 .txt
            </button>
            <button
              onClick={() => handleDownloadReport('json')}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="下载 JSON 版报告（供系统归档）"
            >
              导出报告 .json
            </button>
          </span>
          <button
            onClick={onClose}
            data-testid="export-report-close"
            className="px-4 py-1.5 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}
