import { useEffect, useRef, useCallback } from 'react'
import { renderPreviewDom } from '../../core/previewDom'
import { resolveTemplateBase, cssVarsFor, type DocSettings } from '../../core/templates'

interface PreviewPanelProps {
  content: string
  previewId: string
  settings: DocSettings
  a4Mode: boolean
  onScrollContainerReady: (el: HTMLElement | null) => void
  /** 每次预览渲染管线完成时回调（KaTeX/Mermaid 均就位），供状态条估算页数等 */
  onRendered?: () => void
  /** 渲染管线完成时回调本轮渲染对应的 content（供导出链路确认预览已追平目标内容） */
  onContentRendered?: (content: string) => void
}

/**
 * 预览面板：把渲染管线（markdown → HTML → 学术启发式 → 编号 → KaTeX → Mermaid）
 * 委托给 core/previewDom —— 网页预览与扩展导出引擎共用同一份实现。
 */
export default function PreviewPanel({ content, previewId, settings, a4Mode, onScrollContainerReady, onRendered, onContentRendered }: PreviewPanelProps) {
  const previewRef = useRef<HTMLDivElement>(null)
  const renderKeyRef = useRef(0) // bump on every render to avoid stale closures

  // Expose the scroll wrapper to parent for scroll sync
  const setScrollWrapperRef = useCallback((node: HTMLDivElement | null) => {
    onScrollContainerReady(node)
  }, [onScrollContainerReady])

  // ── Main render effect ────────────────────────────────────────────────────
  useEffect(() => {
    renderKeyRef.current++
    const key = renderKeyRef.current
    const container = previewRef.current
    if (!container) return

    const task = renderPreviewDom(container, content, settings)
    void task.then(() => {
      // Safety: if a new render started while we were running, do nothing here
      if (renderKeyRef.current !== key) return
      onContentRendered?.(content)
      onRendered?.()
    })

    return () => {
      renderKeyRef.current++
    }
  }, [content, settings, onRendered, onContentRendered])

  const styleVars = cssVarsFor(settings) as React.CSSProperties

  return (
    <div ref={setScrollWrapperRef} className="h-full overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div
        id={previewId}
        ref={previewRef}
        style={styleVars}
        className={`md-preview tpl-${resolveTemplateBase(settings.template).id} ${
          a4Mode ? 'a4-page' : 'p-6'
        } max-w-none bg-white transition-colors min-h-full`}
      />
    </div>
  )
}
