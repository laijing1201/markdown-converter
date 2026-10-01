import { useCallback, useRef, useState } from 'react'
import { platform } from '../../platform'
import {
  batchConvertToDocxZip,
  readBatchFiles,
  BatchCancelledError,
  type BatchItem,
  type BatchItemResult,
  type BatchProgress,
} from '../../core/batchExport'
import type { DocSettings } from '../../core/templates'

interface BatchExportModalProps {
  settings: DocSettings
  templateLabel: string
  onToast: (icon: string, message: string, details?: string[]) => void
  onClose: () => void
}

/**
 * 批量转换弹窗（需求 P1-8）：多选 .md 文件 → 统一套用当前模板 →
 * 逐个转 Word → 打包 ZIP 下载；展示逐文件进度与结果汇总。
 */
export default function BatchExportModal({ settings, templateLabel, onToast, onClose }: BatchExportModalProps) {
  const [items, setItems] = useState<BatchItem[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<BatchProgress | null>(null)
  const [results, setResults] = useState<BatchItemResult[] | null>(null)
  const [zipBlob, setZipBlob] = useState<Blob | null>(null)
  const cancelRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const addFiles = useCallback(async (files: File[] | FileList) => {
    const read = await readBatchFiles(files)
    if (read.length === 0) {
      onToast('⚠️', '未找到可导入的文件：仅支持 .md / .markdown / .txt')
      return
    }
    setItems((prev) => {
      const seen = new Set(prev.map((p) => p.fileName))
      return [...prev, ...read.filter((r) => !seen.has(r.fileName))]
    })
    setResults(null)
    setZipBlob(null)
  }, [onToast])

  const handleStart = useCallback(async () => {
    if (items.length === 0) return
    setRunning(true)
    cancelRef.current = false
    setResults(null)
    setZipBlob(null)
    try {
      const outcome = await batchConvertToDocxZip(items, {
        settings,
        onProgress: setProgress,
        checkCancel: () => cancelRef.current,
      })
      setResults(outcome.results)
      setZipBlob(outcome.blob)
      onToast(
        outcome.failCount === 0 ? '✅' : '⚠️',
        `批量转换完成：成功 ${outcome.okCount} 个${outcome.failCount ? `，失败 ${outcome.failCount} 个` : ''}`,
      )
    } catch (err) {
      if (err instanceof BatchCancelledError) {
        setResults(err.outcome.results)
        setZipBlob(err.outcome.blob)
        onToast('ℹ️', `已取消：完成 ${err.outcome.okCount} 个后停止`)
      } else {
        console.error('batch export failed:', err)
        onToast('⚠️', '批量转换失败，请重试')
      }
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }, [items, settings, onToast])

  const handleDownload = useCallback(() => {
    if (!zipBlob) return
    // 走平台层：浏览器 = 下载，安卓壳 = 写缓存 + 系统分享面板
    void platform.saveOrDownload(zipBlob, `MarkDoc批量导出-${new Date().toISOString().slice(0, 10)}.zip`)
  }, [zipBlob])

  const okOf = (r: BatchItemResult) =>
    r.ok && r.stats
      ? `公式 ${r.stats.mathOmml}/${r.stats.mathTotal} OMML · 表格 ${r.stats.tables} · 图表 ${r.stats.mermaidCaptured}/${r.stats.mermaidTotal}`
      : r.ok
        ? '转换成功'
        : r.error ?? '转换失败'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[600px] max-w-full max-h-[85vh] flex flex-col">
        <div className="px-6 pt-5 pb-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">📦 批量转换为 Word</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            一次选择多个 Markdown 文件，统一套用当前模板「{templateLabel}」逐个转为 Word，打包成 ZIP 下载。
          </p>
        </div>

        <div className="px-6 py-4 overflow-y-auto space-y-3 flex-1">
          {/* 拖放 / 选择文件 */}
          {!running && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files)
              }}
              className={`rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
                dragOver
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-gray-600'
              }`}
            >
              <p className="text-sm text-gray-600 dark:text-gray-300">拖入 .md / .txt 文件，或</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-2 px-4 py-1.5 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                选择文件（可多选）
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".md,.markdown,.txt"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void addFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </div>
          )}

          {/* 进度 */}
          {running && progress && (
            <div>
              <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all duration-200"
                  style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {progress.done}/{progress.total} · 正在转换：{progress.current}
              </p>
            </div>
          )}

          {/* 文件列表 / 结果汇总 */}
          {items.length > 0 && (
            <ul className="space-y-1.5" data-testid="batch-file-list">
              {(results ?? items.map((i) => ({ fileName: i.fileName }))).map((entry, idx) => {
                const result = results?.find((r) => r.fileName === (entry as BatchItemResult).fileName) as BatchItemResult | undefined
                const item = items[idx]
                return (
                  <li
                    key={item?.fileName ?? idx}
                    className="text-xs flex items-center gap-2 rounded-md border border-gray-200 dark:border-gray-700 px-2.5 py-1.5"
                  >
                    <span className="shrink-0">
                      {running || !results ? '⏳' : result?.ok ? '✅' : '❌'}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-gray-700 dark:text-gray-200">{item?.fileName ?? (entry as BatchItemResult).fileName}</span>
                      {result && (
                        <span className={`block text-[11px] ${result.ok ? 'text-gray-400 dark:text-gray-500' : 'text-red-500 dark:text-red-400'}`}>
                          {okOf(result)}
                        </span>
                      )}
                    </span>
                    {!running && results && (
                      <button
                        onClick={() => {
                          setItems((prev) => prev.filter((p) => p.fileName !== item?.fileName))
                          setResults(null)
                          setZipBlob(null)
                        }}
                        className="shrink-0 text-gray-300 hover:text-red-500 transition-colors"
                        title="从列表移除"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            全程在浏览器本地完成，文件不会上传服务器
          </span>
          <span className="flex gap-2">
            {running ? (
              <button
                onClick={() => { cancelRef.current = true }}
                className="px-3 py-1.5 text-sm font-medium rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                取消
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm font-medium rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                关闭
              </button>
            )}
            {results && zipBlob ? (
              <button
                onClick={handleDownload}
                data-testid="batch-download"
                className="px-4 py-1.5 text-sm font-semibold rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                下载 ZIP（{results.filter((r) => r.ok).length} 个文件）
              </button>
            ) : (
              <button
                onClick={() => void handleStart()}
                disabled={running || items.length === 0}
                data-testid="batch-start"
                className="px-4 py-1.5 text-sm font-semibold rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
              >
                {running ? '转换中…' : `开始转换（${items.length} 个）`}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}
