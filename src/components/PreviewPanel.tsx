import { useEffect, useRef, useCallback } from 'react'
import katex from 'katex'
import mermaid from 'mermaid'
import { markdownToSafeHtml } from '../utils/markdownProcessor'

interface PreviewPanelProps {
  content: string
  previewId: string
  onScrollContainerReady: (el: HTMLElement | null) => void
}

// Track Mermaid initialisation so we only call .initialize() once
let mermaidInit = false

export default function PreviewPanel({ content, previewId, onScrollContainerReady }: PreviewPanelProps) {
  const previewRef = useRef<HTMLDivElement>(null)
  const renderKeyRef = useRef(0) // bump on every render to avoid stale closures

  // Expose the scroll wrapper to parent for scroll sync
  const setScrollWrapperRef = useCallback((node: HTMLDivElement | null) => {
    onScrollContainerReady(node)
  }, [onScrollContainerReady])

  // ── KaTeX ──────────────────────────────────────────────────────────────────
  const renderMath = useCallback(() => {
    const container = previewRef.current
    if (!container) return

    const key = renderKeyRef.current

    // Inline math
    container.querySelectorAll<HTMLElement>('.math-inline').forEach((el) => {
      if (el.querySelector('.katex')) return // already rendered
      const raw = el.getAttribute('data-formula')
      if (!raw) return
      const formula = decodeURIComponent(raw)
      try {
        katex.render(formula, el, { displayMode: false, throwOnError: false })
      } catch {
        el.textContent = `$${formula}$`
      }
    })

    // Block math
    container.querySelectorAll<HTMLElement>('.math-block').forEach((el) => {
      if (el.querySelector('.katex')) return // already rendered
      const raw = el.getAttribute('data-formula')
      if (!raw) return
      const formula = decodeURIComponent(raw)
      try {
        katex.render(formula, el, { displayMode: true, throwOnError: false })
      } catch {
        el.textContent = `$$${formula}$$`
      }
    })

    // Safety: if a new render started while we were running, stop
    if (renderKeyRef.current !== key) return
  }, [])

  // ── Mermaid ────────────────────────────────────────────────────────────────
  const renderMermaid = useCallback(async () => {
    const container = previewRef.current
    if (!container) return

    const key = renderKeyRef.current

    // Init once
    if (!mermaidInit) {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
        fontFamily: 'sans-serif',
      })
      mermaidInit = true
    }

    const els = container.querySelectorAll<HTMLElement>('pre > code')
    if (els.length === 0) return

    // Collect render tasks
    const tasks: Promise<void>[] = []

    els.forEach((codeEl) => {
      const pre = codeEl.parentElement
      if (!pre) return
      
      // Check if it's a mermaid block (could be language-mermaid or just mermaid)
      const isMermaid = codeEl.className.includes('mermaid') || codeEl.classList.contains('language-mermaid')
      if (!isMermaid) return

      // Already rendered?
      if (pre.dataset.mermaidRendered === 'true') return

      pre.dataset.mermaidRendered = 'true'
      // Get text content, and decode any HTML entities just in case
      let diagramText = codeEl.textContent || ''
      
      const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

      const task = mermaid
        .render(id, diagramText)
        .then(({ svg }) => {
          if (renderKeyRef.current !== key) return // stale
          const wrapper = document.createElement('div')
          wrapper.className = 'mermaid-rendered my-6 flex justify-center'
          wrapper.innerHTML = svg
          pre.parentNode?.replaceChild(wrapper, pre)
        })
        .catch((err: unknown) => {
          console.error('Mermaid render error:', err)
          if (renderKeyRef.current !== key) return // stale
          const errDiv = document.createElement('div')
          errDiv.className =
            'mermaid-error my-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm'
          errDiv.textContent = `⚠ Mermaid 渲染失败: ${err instanceof Error ? err.message : String(err)}`
          pre.parentNode?.replaceChild(errDiv, pre)
        })

      tasks.push(task)
    })

    await Promise.allSettled(tasks)
  }, [])

  // ── Main render effect ────────────────────────────────────────────────────
  useEffect(() => {
    renderKeyRef.current++

    // 1. Convert markdown → safe HTML
    const html = markdownToSafeHtml(content)

    // 2. Write to DOM
    if (previewRef.current) {
      previewRef.current.innerHTML = html
    }

    // 3. Render KaTeX + Mermaid (needs DOM to be present)
    const frameId = requestAnimationFrame(() => {
      renderMath()
      renderMermaid()
    })

    return () => {
      cancelAnimationFrame(frameId)
    }
  }, [content, renderMath, renderMermaid])

  return (
    <div ref={setScrollWrapperRef} className="h-full overflow-y-auto">
      <div
        id={previewId}
        ref={previewRef}
        className="p-6 prose prose-sm max-w-none dark:prose-invert bg-white dark:bg-gray-900 transition-colors min-h-full"
      />
    </div>
  )
}
