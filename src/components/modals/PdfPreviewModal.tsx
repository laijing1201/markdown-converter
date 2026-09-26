import { useEffect, useRef, useState } from 'react'
import { runLayout, type ImageQuality, type LayoutResult } from '../../core/pdf/layout'
import { renderPageToCanvas } from '../../core/pdf/canvasPreview'
import type { DocSettings } from '../../core/templates'

interface PdfPreviewModalProps {
  previewEl: HTMLElement
  settings: DocSettings
  onClose: () => void
  onExport: () => void
  exporting: boolean
  imageQuality?: ImageQuality
}

/**
 * 分页预览（近似）：点击「预览 PDF」时计算一次分页，用 canvas 逐页渲染。
 * 用于在导出前检查分页位置（哪里换页、表格/图片/标题落点）。
 */
export default function PdfPreviewModal({ previewEl, settings, onClose, onExport, exporting, imageQuality }: PdfPreviewModalProps) {
  const [layout, setLayout] = useState<LayoutResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pageWidth, setPageWidth] = useState(560)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Array<HTMLCanvasElement | null>>([])

  useEffect(() => {
    let cancelled = false
    setLayout(null)
    setError(null)
    runLayout(previewEl, settings, {
      imageQuality,
      // StrictMode/快速开关下 effect 会执行两次：让过期运行在检查点中止，
      // 避免它与当前运行争抢共享的测量 stage（样式元素/暗色恢复）导致坐标损坏
      checkCancel: () => cancelled,
    })
      .then((result) => {
        if (!cancelled) setLayout(result)
      })
      .catch((err) => {
        console.error('paginated preview failed', err)
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [previewEl, settings, imageQuality])

  // 渲染就绪后把每页画到 canvas
  useEffect(() => {
    if (!layout) return
    pageRefs.current.forEach((canvas, idx) => {
      if (canvas) renderPageToCanvas(layout, idx, canvas, pageWidth, settings)
    })
  }, [layout, pageWidth, settings])

  const pageCount = layout ? layout.pages.length + layout.tocPageCount : 0

  const changeWidth = (delta: number) => {
    setPageWidth((w) => Math.max(320, Math.min(860, w + delta)))
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-gray-100 dark:bg-gray-900 rounded-xl shadow-2xl w-[92vw] h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">📑 分页预览</h2>
          <span className="text-xs text-gray-400">
            {layout ? `共 ${pageCount} 页 · 近似效果，以导出结果为准` : '正在计算分页…'}
          </span>
          <div className="flex-1" />
          <button onClick={() => changeWidth(-80)} className="px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-700" title="缩小">
            －
          </button>
          <button onClick={() => changeWidth(80)} className="px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-700" title="放大">
            ＋
          </button>
          <button
            onClick={onExport}
            disabled={!layout || exporting}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-md transition-colors"
          >
            {exporting ? '导出中…' : '⬇ 导出 PDF'}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            关闭
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto py-6">
          {error && (
            <div className="mx-auto max-w-md bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm px-4 py-3 rounded-lg">
              分页计算失败：{error}
            </div>
          )}
          {!layout && !error && (
            <div className="flex flex-col items-center gap-3 text-gray-400 py-20">
              <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              <span className="text-sm">正在测量与分页，大文档可能需要几秒…</span>
            </div>
          )}
          {layout && (
            <div className="flex flex-col items-center gap-6">
              {Array.from({ length: pageCount }).map((_, idx) => (
                <div key={idx} className="flex flex-col items-center gap-1.5">
                  <canvas
                    ref={(el) => {
                      pageRefs.current[idx] = el
                    }}
                    className="bg-white rounded shadow-md border border-gray-200 dark:border-gray-700"
                  />
                  <span className="text-[11px] text-gray-400">第 {idx + 1} 页</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
