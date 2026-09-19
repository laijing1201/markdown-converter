import type { PreflightResult, PreflightTarget } from '../../core/preflight'

interface PreExportModalProps {
  result: PreflightResult
  target: PreflightTarget
  onExport: () => void
  onClose: () => void
}

const ISSUE_ICON = { error: '🔴', warn: '🟡' } as const

export default function PreExportModal({ result, target, onExport, onClose }: PreExportModalProps) {
  const { stats, issues } = result
  const errors = issues.filter((i) => i.level === 'error').length
  const warns = issues.length - errors
  const label = target === 'pdf' ? 'PDF' : 'Word'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-1">📋 导出{label}前检查</h2>
        <p className="text-xs text-gray-400 mb-4">
          发现问题先处理，避免下载后才发现排版损坏
          {stats.chars > 0 && ` · 全文约 ${Math.round(stats.chars / 10000 * 10) / 10} 万字符`}
        </p>

        {/* 统计 */}
        <div className="grid grid-cols-6 gap-2 mb-4">
          {[
            ['标题', stats.headings],
            ['公式', stats.math],
            ['表格', stats.tables],
            ['图片', stats.images],
            ['代码块', stats.codeBlocks],
            ['分页符', stats.pagebreaks],
          ].map(([label2, count]) => (
            <div key={label2 as string} className="text-center py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">{count}</p>
              <p className="text-[11px] text-gray-400">{label2}</p>
            </div>
          ))}
        </div>

        {/* 问题列表 */}
        {issues.length > 0 ? (
          <div className="space-y-1.5 mb-5 max-h-56 overflow-y-auto">
            {issues.map((issue, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg ${
                  issue.level === 'error'
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                    : 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200'
                }`}
              >
                <span className="shrink-0">{ISSUE_ICON[issue.level]}</span>
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-lg mb-5">
            ✓ 检查通过，未发现问题
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            返回修改
          </button>
          <button
            onClick={onExport}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-md transition-colors"
          >
            仍要导出{label}{errors > 0 ? `（${errors} 个错误）` : ''}
          </button>
        </div>
        {warns > 0 && (
          <p className="text-[11px] text-gray-400 mt-2 text-right">
            {warns} 条警告不影响导出
          </p>
        )}
      </div>
    </div>
  )
}
