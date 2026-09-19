interface ExportProgressModalProps {
  label: string
  pct: number
  onCancel?: () => void
  title?: string
}

/** 导出进度弹窗：阶段化进度 + 可取消（大文档 PDF 导出防“页面假死”） */
export default function ExportProgressModal({ label, pct, onCancel, title = '正在导出 PDF' }: ExportProgressModalProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)))
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 w-[340px] mx-4">
        <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-1">{title}</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{label}</p>
        <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all duration-200"
            style={{ width: `${clamped}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-gray-400">{clamped}%</span>
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-3 py-1 text-xs font-medium rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              取消
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
