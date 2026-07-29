import { useCallback } from 'react'

/** Generate a timestamp string: YYYYMMDDHHmmss */
function timestampSuffix(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

const EXPORT_NAME_PREFIX = 'MarkDoc'

interface ToolbarProps {
  previewId: string
  onClear: () => void
  onSmartFormat: () => void
  onDeepFix: () => void
  darkMode: boolean
  onToggleDarkMode: () => void
  scrollSyncEnabled: boolean
  onToggleScrollSync: () => void
}

export default function Toolbar({
  previewId,
  onClear,
  onSmartFormat,
  onDeepFix,
  darkMode,
  onToggleDarkMode,
  scrollSyncEnabled,
  onToggleScrollSync,
}: ToolbarProps) {
  // ── Dynamically import & run export functions ────────────────────────────────

  const handleExportDocx = useCallback(async () => {
    const previewEl = document.getElementById(previewId)
    if (!previewEl) return

    try {
      const { exportToDocx } = await import('../../core/exporter')
      const name = `${EXPORT_NAME_PREFIX}-${timestampSuffix()}`
      await exportToDocx(previewEl.innerHTML, name)
    } catch (err) {
      console.error('DOCX export failed:', err)
      alert('DOCX 导出失败，请重试')
    }
  }, [previewId])

  const handleExportPdf = useCallback(async () => {
    const previewEl = document.getElementById(previewId)
    if (!previewEl) return

    try {
      const { exportToPdf } = await import('../../core/exporter')
      const name = `${EXPORT_NAME_PREFIX}-${timestampSuffix()}`
      await exportToPdf(previewEl, name)
    } catch (err) {
      console.error('PDF export failed:', err)
      alert('PDF 导出失败，请重试')
    }
  }, [previewId])

  const handleCopy = useCallback(async () => {
    const previewEl = document.getElementById(previewId)
    if (!previewEl) return

    try {
      await navigator.clipboard.writeText(previewEl.innerText)
    } catch {
      // Fallback: select and copy
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(previewEl)
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.execCommand('copy')
      selection?.removeAllRanges()
    }
  }, [previewId])

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm transition-colors">
      {/* Title */}
      <h1 className="text-base font-semibold text-gray-800 dark:text-gray-200 mr-4 whitespace-nowrap">
        MarkDoc
      </h1>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap items-center">
        <button
          onClick={handleExportDocx}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
        >
          导出 DOCX
        </button>

        <button
          onClick={handleExportPdf}
          className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md transition-colors"
        >
          导出 PDF
        </button>

        <button
          onClick={handleCopy}
          className="px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium rounded-md transition-colors"
        >
          复制内容
        </button>

        <button
          onClick={onClear}
          className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-md transition-colors"
        >
          清空
        </button>

        <button
          onClick={onSmartFormat}
          className="px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium rounded-md transition-colors shadow-sm"
          title="智能识别并转换普通序号为 Markdown 标题"
        >
          ✨ 智能排版
        </button>

        <button
          onClick={onDeepFix}
          className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-sm font-medium rounded-md transition-all shadow-sm"
          title="深度分析并修复编码问题，支持逐项确认"
        >
          🛠 深度修复
        </button>

        <span className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

        <button
          onClick={onToggleScrollSync}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            scrollSyncEnabled
              ? 'bg-teal-600 hover:bg-teal-700 text-white'
              : 'bg-gray-300 hover:bg-gray-400 text-gray-600'
          }`}
          title={scrollSyncEnabled ? '已开启滚动同步' : '已关闭滚动同步'}
        >
          {scrollSyncEnabled ? '🔗 滚动同步' : '⛓ 滚动同步'}
        </button>

        <button
          onClick={onToggleDarkMode}
          className="px-3 py-1.5 bg-gray-500 hover:bg-gray-600 text-white text-sm font-medium rounded-md transition-colors"
          title={darkMode ? '切换亮色模式' : '切换暗色模式'}
        >
          {darkMode ? '☀ 亮色' : '🌙 暗色'}
        </button>
      </div>
    </div>
  )
}
