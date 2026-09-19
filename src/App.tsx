import { useState, useCallback, useEffect, useMemo, useRef, useDeferredValue } from 'react'
import EditorPanel, { type EditorHandle } from './components/layout/EditorPanel'
import PreviewPanel from './components/layout/PreviewPanel'
import Toolbar from './components/layout/Toolbar'
import StatusBar, { countTables, countMath, countImages } from './components/layout/StatusBar'
import DeepFixModal from './components/modals/DeepFixModal'
import SmartFormatModal from './components/modals/SmartFormatModal'
import DocumentSettingsModal from './components/modals/DocumentSettingsModal'
import HistoryModal from './components/modals/HistoryModal'
import PreExportModal from './components/modals/PreExportModal'
import ExportProgressModal from './components/modals/ExportProgressModal'
import PdfPreviewModal from './components/modals/PdfPreviewModal'
import { validateMarkdown, detectEncodingIssues } from './core/validator'
import { smartFormatText } from './core/formatter'
import { repairAiMarkdown, type RepairFix } from './core/repair'
import { runPreflight, type PreflightResult } from './core/preflight'
import { saveToHistory, consumeHistoryError, type HistoryEntry } from './core/history'
import { buildExportFilename } from './core/filename'
import { exportToDocx } from './core/exporter'
import { exportToPdf, buildPdf, PdfExportCancelledError, PdfExportError, type PdfExportResult } from './core/pdf/export'
import {
  loadDocSettings,
  saveDocSettings,
  loadCustomTemplates,
  getTemplateLabel,
  seedSettingsFromTemplate,
  PAGE_SIZE_PX,
  type DocSettings,
  type CustomTemplate,
  type TemplateId,
} from './core/templates'
import { platform, capabilities } from './platform'

const A4_KEY = 'markdoc.a4mode.v1'

const DEFAULT_CONTENT = `# MarkDoc

把 **ChatGPT / DeepSeek / Kimi** 的回答粘贴到左侧，一键导出排版好的 **Word 和 PDF** —— 公式在 Word 中是原生可编辑公式，在 PDF 中保持矢量清晰，表格自动套用学术三线表。

---

## 🧮 LaTeX 数学公式

行内公式：质能方程 $E = mc^2$ 以及 $\\alpha^2 + \\beta^2 = \\gamma^2$

块级公式：

$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$

$$\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$$

矩阵与分段函数：

$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$

$$\\begin{cases} x^2, & x \\ge 0 \\\\ -x, & x < 0 \\end{cases}$$

## 📋 表格与有序列表

| 模型 | 参数量 | 上下文长度 |
|------|--------|-----------|
| Model A | 7B | 32K |
| Model B | 32B | 128K |

1. 粘贴 AI 回答（格式破损会自动修复）
2. 在右侧确认排版效果，可先「预览 PDF」检查分页
3. 点击「导出 Word」或「导出 PDF」

---

## 📊 Mermaid 流程图

\`\`\`mermaid
graph TD
    A[开始] --> B{判断条件}
    B -->|条件成立| C[执行操作]
    B -->|条件不成立| D[结束]
    C --> D
\`\`\`

## 💻 代码

\`\`\`python
def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    right = [x for x in arr if x >= pivot]
    return quicksort(left) + quicksort(right)
\`\`\`

> 💡 试试右上角的「⚙ 文档设置」切换模板、字体、页眉页脚，还能另存为我的模板。
`

interface ToastState {
  id: number
  icon: string
  message: string
  details?: string[]
  /** 存在时点击 toast 复制诊断信息 */
  diagnostics?: string
}

function loadA4Mode(): boolean {
  try {
    const raw = localStorage.getItem(A4_KEY)
    if (raw !== null) return raw === 'true'
  } catch { /* ignore */ }
  return true
}

export default function App() {
  const [markdownContent, setMarkdownContent] = useState('')
  const [darkMode, setDarkMode] = useState(false)
  const [scrollSyncEnabled, setScrollSyncEnabled] = useState(true)
  const [editorScrollEl, setEditorScrollEl] = useState<HTMLElement | null>(null)
  const [previewScrollEl, setPreviewScrollEl] = useState<HTMLElement | null>(null)
  const [dismissedWarnings, setDismissedWarnings] = useState<number>(0)
  const [showDeepFix, setShowDeepFix] = useState(false)
  const [showSmartFormat, setShowSmartFormat] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [settings, setSettings] = useState<DocSettings>(loadDocSettings)
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>(loadCustomTemplates)
  const [a4Mode, setA4Mode] = useState<boolean>(loadA4Mode)
  const [mobileTab, setMobileTab] = useState<'editor' | 'preview'>('editor')
  const [preflight, setPreflight] = useState<PreflightResult | null>(null)
  const [pendingExport, setPendingExport] = useState<'docx' | 'pdf' | null>(null)
  const [busy, setBusy] = useState(false)
  const [exportProgress, setExportProgress] = useState<{ pct: number; label: string } | null>(null)
  const [showPdfPreview, setShowPdfPreview] = useState(false)
  const exportCancelRef = useRef(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<EditorHandle>(null)
  const previewId = 'preview-container'

  /** 大文档性能：预览渲染与告警扫描使用延迟值，输入不被阻塞 */
  const deferredContent = useDeferredValue(markdownContent)

  const lastExportRef = useRef<'ok' | 'fail' | null>(null)
  const lastPreflightRef = useRef<PreflightResult | null>(null)
  const lastHistoryToastRef = useRef<string>('')

  // ── Settings / A4 persistence ────────────────────────────────────────────
  useEffect(() => {
    saveDocSettings(settings)
  }, [settings])
  useEffect(() => {
    localStorage.setItem(A4_KEY, a4Mode ? 'true' : 'false')
  }, [a4Mode])

  // ── Toast auto dismiss ───────────────────────────────────────────────────
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const showToast = useCallback((icon: string, message: string, details?: string[], diagnostics?: string) => {
    setToast({ id: Date.now(), icon, message, details, diagnostics })
  }, [])

  // ── 浏览器扩展导入桥（#ext-import=<id>）────────────────────────────────────
  //  流程：扩展把内容存入临时区（30 分钟 TTL，一次性）→ 打开本站 →
  //  本站 postMessage 请求 → 扩展桥 content script 转发 → 内容回填编辑器。
  useEffect(() => {
    const m = window.location.hash.match(/^#ext-import=([A-Za-z0-9_-]+)$/)
    if (!m) return
    const importId = m[1]
    let settled = false

    const finish = (payload: { markdown?: string; documentTitle?: string; platform?: string } | null) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      if (payload?.markdown) {
        const { fixed, fixes } = repairAiMarkdown(payload.markdown)
        setMarkdownContent(fixed)
        const from = payload.platform ? `来自 ${payload.platform}` : '来自扩展'
        showToast('✅', `${from}：已导入「${payload.documentTitle || '未命名内容'}」到编辑器`,
          fixes.length > 0 ? [`已自动修复 ${fixes.length} 处 AI 格式问题`] : undefined)
      } else {
        showToast('⚠️', '未能取回扩展内容：导入已过期（30 分钟有效期）或扩展未启用')
      }
      // 清理 hash，避免刷新重复导入
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      const data = event.data as { source?: string; type?: string; id?: string; payload?: unknown } | null
      if (!data || data.source !== 'markdoc-ext' || data.type !== 'EXT_IMPORT_CONTENT' || data.id !== importId) return
      finish((data.payload as { markdown?: string; documentTitle?: string; platform?: string }) ?? null)
    }
    window.addEventListener('message', onMessage)

    // 请求内容（扩展桥收到后转发给 background）
    window.postMessage({ source: 'markdoc-web', type: 'EXT_IMPORT_REQUEST', id: importId }, window.location.origin)
    // 桥未就绪时重试一次；5s 超时给出明确提示
    const retry = setTimeout(() => {
      if (!settled) window.postMessage({ source: 'markdoc-web', type: 'EXT_IMPORT_REQUEST', id: importId }, window.location.origin)
    }, 800)
    const timeout = setTimeout(() => {
      if (!settled) {
        showToast('💡', '未检测到 MarkDoc 扩展响应：内容只经扩展本地通道传输，请确认已安装并启用扩展')
        settled = true
        window.removeEventListener('message', onMessage)
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      }
    }, 5000)

    return () => {
      settled = true
      clearTimeout(retry)
      clearTimeout(timeout)
      window.removeEventListener('message', onMessage)
    }
  }, [showToast])

  // ── Validation (live banner) ─────────────────────────────────────────────
  const warnings = useMemo(() => {
    if (!deferredContent) return []
    const mdWarnings = validateMarkdown(deferredContent)
    const encWarnings = detectEncodingIssues(deferredContent)
    return [...mdWarnings, ...encWarnings]
  }, [deferredContent])

  useEffect(() => {
    setDismissedWarnings(0)
  }, [warnings.length])

  // ── Scroll sync ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!scrollSyncEnabled || !editorScrollEl || !previewScrollEl) return

    let isSyncing = false
    let rafId = 0

    const onEditor = () => {
      if (isSyncing) return
      isSyncing = true
      const ratio = editorScrollEl.scrollTop / (editorScrollEl.scrollHeight - editorScrollEl.clientHeight)
      previewScrollEl.scrollTop = ratio * (previewScrollEl.scrollHeight - previewScrollEl.clientHeight)
      rafId = requestAnimationFrame(() => { isSyncing = false })
    }
    const onPreview = () => {
      if (isSyncing) return
      isSyncing = true
      const ratio = previewScrollEl.scrollTop / (previewScrollEl.scrollHeight - previewScrollEl.clientHeight)
      editorScrollEl.scrollTop = ratio * (editorScrollEl.scrollHeight - editorScrollEl.clientHeight)
      rafId = requestAnimationFrame(() => { isSyncing = false })
    }

    editorScrollEl.addEventListener('scroll', onEditor, { passive: true })
    previewScrollEl.addEventListener('scroll', onPreview, { passive: true })

    return () => {
      cancelAnimationFrame(rafId)
      editorScrollEl.removeEventListener('scroll', onEditor)
      previewScrollEl.removeEventListener('scroll', onPreview)
    }
  }, [scrollSyncEnabled, editorScrollEl, previewScrollEl])

  // ── Dark mode ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [darkMode])

  // ── Local history autosave (debounced) + failure notice ─────────────────
  useEffect(() => {
    if (!markdownContent) return
    const t = setTimeout(() => {
      saveToHistory(markdownContent)
      const err = consumeHistoryError()
      // 同一条错误只提示一次，避免连续编辑时反复打扰
      if (err && err !== lastHistoryToastRef.current) {
        lastHistoryToastRef.current = err
        showToast('⚠️', err)
      }
    }, 1500)
    return () => clearTimeout(t)
  }, [markdownContent, showToast])

  // ── Basic handlers ───────────────────────────────────────────────────────
  const handleContentChange = useCallback((value: string) => {
    setMarkdownContent(value)
  }, [])

  const handleClear = useCallback(() => {
    setMarkdownContent('')
  }, [])

  const handleLoadExample = useCallback(() => {
    setMarkdownContent(DEFAULT_CONTENT)
    showToast('💡', '已载入示例内容')
  }, [showToast])

  const handleImportFile = useCallback(async (file: File) => {
    try {
      const text = await file.text()
      setMarkdownContent(text)
      showToast('📂', `已导入 ${file.name}`)
    } catch {
      showToast('⚠️', '文件读取失败，请重试')
    }
  }, [showToast])

  /** 快速模式：工具栏模板缩略图一键切换（语义与高级设置里的系统模板一致） */
  const handleTemplateChange = useCallback((id: TemplateId) => {
    setSettings(seedSettingsFromTemplate(id, settings))
  }, [settings])

  /** 桌面版：原生对话框打开本地 Markdown；Web 回退到文件选择 input */
  const handleOpenLocalFile = useCallback(async () => {
    if (capabilities.openLocalFile) {
      const opened = await platform.openMarkdownFile()
      if (opened) {
        setMarkdownContent(opened.content)
        showToast('📂', `已导入 ${opened.name}`)
      }
      return
    }
    fileInputRef.current?.click()
  }, [showToast])

  /** 桌面版：Markdown 另存为本地文件（Web 无此能力，按钮不显示） */
  const handleSaveLocalFile = useCallback(async () => {
    if (!markdownContent.trim()) {
      showToast('💡', '当前没有可保存的内容')
      return
    }
    const name = buildExportFilename(markdownContent, settings.documentTitle)
    const result = await platform.saveMarkdownFile(name, markdownContent)
    if (result === 'saved') showToast('💾', '已保存到本地')
    else if (result === 'cancelled') showToast('ℹ️', '已取消保存')
  }, [markdownContent, settings.documentTitle, showToast])

  /** 空状态「从剪贴板粘贴」：读不到时给出人话提示 */
  const handleClipboardPaste = useCallback(async () => {
    try {
      if (!navigator.clipboard?.readText) {
        throw new Error('Clipboard API unavailable')
      }
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        showToast('📋', '剪贴板是空的，请先复制 AI 的回答')
        return
      }
      const { fixed, fixes } = repairAiMarkdown(text)
      setMarkdownContent(fixed)
      if (fixes.length > 0) {
        showToast(
          '✨',
          `已粘贴并自动修复 ${fixes.length} 处 AI 格式问题`,
          fixes.slice(0, 4).map((f) => `第 ${f.line} 行：${f.message}`),
        )
      } else {
        showToast('✅', '已粘贴剪贴板内容')
      }
    } catch (err) {
      console.warn('clipboard read failed', err)
      showToast('⚠️', '无法读取剪贴板，请在编辑器中按 Ctrl+V 粘贴')
    }
  }, [showToast])

  const handlePasteRepaired = useCallback((fixes: RepairFix[]) => {
    showToast(
      '✨',
      `已自动修复 ${fixes.length} 处 AI 格式问题`,
      fixes.slice(0, 4).map((f) => `第 ${f.line} 行：${f.message}`),
    )
  }, [showToast])

  const handleRepairFormat = useCallback(() => {
    if (!markdownContent.trim()) return
    const { fixed, fixes } = repairAiMarkdown(markdownContent)
    if (fixes.length === 0) {
      showToast('✓', '未发现可自动修复的问题')
      return
    }
    setMarkdownContent(fixed)
    showToast('🪄', `已修复 ${fixes.length} 处格式问题`, fixes.slice(0, 4).map((f) => `第 ${f.line} 行：${f.message}`))
  }, [markdownContent, showToast])

  const handleDeepFixApply = useCallback((fixed: string) => {
    setMarkdownContent(fixed)
  }, [])

  const handleSmartFormatApply = useCallback(() => {
    setMarkdownContent(prev => smartFormatText(prev))
    setShowSmartFormat(false)
  }, [])

  // ── Export orchestration: preflight → modal or direct export ────────────
  const doExportDocx = useCallback(async () => {
    const previewEl = document.getElementById(previewId)
    if (!previewEl || !markdownContent.trim()) return
    setBusy(true)
    try {
      const name = buildExportFilename(markdownContent, settings.documentTitle)
      await exportToDocx(previewEl.innerHTML, name, { settings })
      lastExportRef.current = 'ok'
      showToast('✅', 'Word 导出成功，公式可在 Word 中直接编辑')
    } catch (err) {
      lastExportRef.current = 'fail'
      console.error('DOCX export failed:', err)
      showToast('⚠️', 'DOCX 导出失败，请重试')
    } finally {
      setBusy(false)
    }
  }, [markdownContent, settings, showToast])

  const doExportPdf = useCallback(async () => {
    const previewEl = document.getElementById(previewId)
    if (!previewEl || !markdownContent.trim()) return
    setBusy(true)
    exportCancelRef.current = false
    setExportProgress({ pct: 0, label: '正在准备…' })
    try {
      const name = buildExportFilename(markdownContent, settings.documentTitle)
      const result = await exportToPdf(previewEl, settings, name, {
        checkCancel: () => exportCancelRef.current,
        onProgress: (pct, label) => setExportProgress({ pct, label }),
      })
      lastExportRef.current = 'ok'
      const pages = result.pages
      const secs = (result.durationMs / 1000).toFixed(1)
      showToast(
        '✅',
        `PDF 导出成功（${pages} 页 · ${secs}s）`,
        result.notices.length > 0 ? result.notices.slice(0, 4) : undefined,
      )
    } catch (err) {
      if (err instanceof PdfExportCancelledError) {
        showToast('ℹ️', '已取消 PDF 导出')
      } else if (err instanceof PdfExportError) {
        lastExportRef.current = 'fail'
        console.error('PDF export failed:', err, err.details)
        showToast('⚠️', err.message, err.details.slice(0, 3), err.details.join('\n'))
      } else {
        lastExportRef.current = 'fail'
        console.error('PDF export failed:', err)
        const details = err instanceof Error ? err.message : String(err)
        showToast('⚠️', 'PDF 导出失败，请重试', undefined, details)
      }
    } finally {
      setBusy(false)
      setExportProgress(null)
    }
  }, [markdownContent, settings, showToast])

  const handleExport = useCallback((target: 'docx' | 'pdf') => {
    const previewEl = document.getElementById(previewId)
    if (!previewEl || !markdownContent.trim()) {
      showToast('💡', '请先在左侧输入或粘贴内容')
      return
    }
    const result = runPreflight(markdownContent, previewEl.innerHTML, target)
    lastPreflightRef.current = result
    if (result.issues.length > 0) {
      setPendingExport(target)
      setPreflight(result)
    } else if (target === 'docx') {
      void doExportDocx()
    } else {
      void doExportPdf()
    }
  }, [markdownContent, doExportDocx, doExportPdf, showToast])

  const handleExportWord = useCallback(() => handleExport('docx'), [handleExport])
  const handleExportPdf = useCallback(() => handleExport('pdf'), [handleExport])

  const handleConfirmExport = useCallback(() => {
    const target = pendingExport
    setPreflight(null)
    setPendingExport(null)
    if (target === 'pdf') void doExportPdf()
    else void doExportDocx()
  }, [pendingExport, doExportDocx, doExportPdf])

  const handlePreviewPdf = useCallback(() => {
    if (!markdownContent.trim()) {
      showToast('💡', '请先在左侧输入或粘贴内容')
      return
    }
    setShowPdfPreview(true)
  }, [markdownContent, showToast])

  const handlePreviewExport = useCallback(async () => {
    setShowPdfPreview(false)
    await doExportPdf()
  }, [doExportPdf])

  // ── Rich copy（粘贴进 Word 保留排版）──────────────────────────────────────
  const handleCopyRich = useCallback(async () => {
    const previewEl = document.getElementById(previewId)
    if (!previewEl) return
    const plain = previewEl.innerText
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const item = new ClipboardItem({
          'text/html': new Blob([previewEl.innerHTML], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        })
        await navigator.clipboard.write([item])
      } else {
        await navigator.clipboard.writeText(plain)
      }
      showToast('📋', '已复制渲染内容，直接粘贴进 Word 可保留排版')
    } catch {
      try {
        await navigator.clipboard.writeText(plain)
        showToast('📋', '已复制纯文本内容')
      } catch {
        showToast('⚠️', '复制失败，请手动选择内容复制')
      }
    }
  }, [showToast])

  const handleRestoreHistory = useCallback((entry: HistoryEntry) => {
    setMarkdownContent(entry.content)
    setShowHistory(false)
    showToast('🕘', '已恢复历史文档')
  }, [showToast])

  const templateLabel = getTemplateLabel(settings.template, customTemplates)

  // ── 状态条统计（轻量正则，不渲染 DOM）──────────────────────────────────────
  const docStats = useMemo(() => ({
    chars: deferredContent.replace(/\s+/g, '').length,
    math: countMath(deferredContent),
    tables: countTables(deferredContent),
    images: countImages(deferredContent),
  }), [deferredContent])

  /** 预计页数：A4 视图按预览高度估算（预览渲染完成后刷新），否则按字数粗估 */
  const [previewTick, setPreviewTick] = useState(0)
  const onPreviewRendered = useCallback(() => setPreviewTick(t => t + 1), [])
  const estPages = useMemo(() => {
    void previewTick
    if (!deferredContent.trim()) return null
    if (a4Mode) {
      const el = document.getElementById(previewId)
      if (el && el.scrollHeight > 0) {
        const pageH = PAGE_SIZE_PX[settings.paper].height
        return Math.max(1, Math.round(el.scrollHeight / pageH))
      }
    }
    return Math.max(1, Math.ceil(deferredContent.replace(/\s+/g, '').length / 900))
  }, [deferredContent, a4Mode, settings.paper, previewTick])

  /** 状态条点击：打开导出前 Preflight 报告（默认按 PDF 目标，检查项最全） */
  const handleOpenPreflight = useCallback(() => {
    const previewEl = document.getElementById(previewId)
    if (!previewEl || !markdownContent.trim()) {
      showToast('💡', '请先在左侧输入或粘贴内容')
      return
    }
    const result = runPreflight(markdownContent, previewEl.innerHTML, 'pdf')
    lastPreflightRef.current = result
    setPendingExport('pdf')
    setPreflight(result)
  }, [markdownContent, showToast])

  // E2E 测试钩子（仅测试环境使用）：让自动化脚本注入内容并等待渲染完成
  useEffect(() => {
    const w = window as unknown as { __MARKDOC_TEST__?: unknown }
    w.__MARKDOC_TEST__ = {
      setContent: (md: string) => setMarkdownContent(md),
      getContent: () => markdownContent,
      getSettings: () => settings,
      setSettings: (s: DocSettings) => setSettings(s),
      ready: true,
    }
  }, [markdownContent, settings])

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900 transition-colors">
      <Toolbar
        busy={busy}
        onExportWord={handleExportWord}
        onExportPdf={handleExportPdf}
        onPreviewPdf={handlePreviewPdf}
        onCopyRich={() => void handleCopyRich()}
        onSmartFormat={() => setShowSmartFormat(true)}
        onDeepFix={() => setShowDeepFix(true)}
        onRepairFormat={handleRepairFormat}
        onOpenSettings={() => setShowSettings(true)}
        onOpenHistory={() => setShowHistory(true)}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(v => !v)}
        scrollSyncEnabled={scrollSyncEnabled}
        onToggleScrollSync={() => setScrollSyncEnabled(v => !v)}
        templateId={settings.template}
        onTemplateChange={handleTemplateChange}
        desktop={capabilities.desktop}
      />

      {/* ── 移动端编辑/预览切换 ──────────────────────────────────────── */}
      <div className="md:hidden shrink-0 flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        {(['editor', 'preview'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mobileTab === tab
                ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {tab === 'editor' ? '✏️ 编辑' : '👁 预览'}
          </button>
        ))}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────── */}
      {showDeepFix && (
        <DeepFixModal
          content={markdownContent}
          onApply={handleDeepFixApply}
          onClose={() => setShowDeepFix(false)}
        />
      )}

      {showSmartFormat && (
        <SmartFormatModal
          onApply={handleSmartFormatApply}
          onClose={() => setShowSmartFormat(false)}
        />
      )}

      {showSettings && (
        <DocumentSettingsModal
          settings={settings}
          customs={customTemplates}
          onChange={setSettings}
          onCustomsChange={setCustomTemplates}
          onClose={() => setShowSettings(false)}
          diagnosticsProvider={() => ({
            markdown: markdownContent,
            preflight: lastPreflightRef.current,
            lastExport: lastExportRef.current,
          })}
          onToast={(icon, message) => showToast(icon, message)}
        />
      )}

      {showHistory && (
        <HistoryModal
          onRestore={handleRestoreHistory}
          onClose={() => setShowHistory(false)}
        />
      )}

      {preflight && (
        <PreExportModal
          result={preflight}
          target={pendingExport ?? 'docx'}
          onExport={handleConfirmExport}
          onClose={() => {
            setPreflight(null)
            setPendingExport(null)
          }}
        />
      )}

      {exportProgress && (
        <ExportProgressModal
          label={exportProgress.label}
          pct={exportProgress.pct}
          onCancel={() => {
            exportCancelRef.current = true
          }}
        />
      )}

      {showPdfPreview && (
        <PdfPreviewModal
          previewEl={document.getElementById(previewId) as HTMLElement}
          settings={settings}
          onClose={() => setShowPdfPreview(false)}
          onExport={() => void handlePreviewExport()}
          exporting={busy}
        />
      )}

      {/* ── Validation warnings ─────────────────────────────────────── */}
      {warnings.length > 0 && dismissedWarnings < warnings.length && (
        <div className="flex items-start gap-2 px-4 py-2 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 text-sm">
          <span className="mt-0.5 shrink-0" title="警告">⚠️</span>
          <div className="flex-1 space-y-0.5">
            {warnings.slice(0, 3).map((w, i) => (
              <div key={i} className={`${w.type === 'error' ? 'text-red-700 dark:text-red-300 font-medium' : 'text-yellow-800 dark:text-yellow-200'}`}>
                {w.type === 'error' ? '🔴 ' : '🟡 '}第 {w.line} 行：{w.message}
              </div>
            ))}
            {warnings.length > 3 && (
              <div className="text-gray-500 dark:text-gray-400 text-xs">
                …还有 {warnings.length - 3} 个警告
              </div>
            )}
          </div>
          <button
            onClick={() => setDismissedWarnings(warnings.length)}
            className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none"
            title="关闭"
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* ── Editor ──────────────────────────────────────────────────── */}
        <div className={`${mobileTab === 'editor' ? 'flex' : 'hidden md:flex'} w-full md:w-1/2 h-full border-r border-gray-200 dark:border-gray-700 flex-col`}>
          <div className="shrink-0 px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-400 flex items-center justify-between gap-2">
            <span>输入内容（支持粘贴 AI 回答 / 截图，拖入 .md 文件）</span>
            <span className="flex gap-1 shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.markdown,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleImportFile(f)
                  e.target.value = ''
                }}
              />
              <button
                onClick={() => void handleOpenLocalFile()}
                className="px-2 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                title={capabilities.openLocalFile ? '用系统文件选择器打开 .md / .txt 文件' : '导入 .md / .txt 文件'}
              >
                📂 导入
              </button>
              {capabilities.nativeSave && (
                <button
                  onClick={() => void handleSaveLocalFile()}
                  className="px-2 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  title="另存为本地 .md 文件（桌面版功能）"
                >
                  💾 保存
                </button>
              )}
              <button
                onClick={handleLoadExample}
                className="px-2 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                title="载入示例内容"
              >
                💡 示例
              </button>
              <button
                onClick={() => editorRef.current?.insertSnippet('\n<!-- pagebreak -->\n')}
                className="px-2 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                title="在光标处插入分页符，导出 Word 时会真正分页"
              >
                📄 分页符
              </button>
              <button
                onClick={handleClear}
                className="px-2 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                title="清空编辑器"
              >
                ✕ 清空
              </button>
            </span>
          </div>

          {/* ── 首次使用空状态（输入后自然消失，不遮挡编辑区） ── */}
          {!markdownContent && (
            <div className="shrink-0 px-6 pt-8 pb-4 flex justify-center bg-gray-100 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
              <div className="text-center max-w-md pointer-events-auto">
                <p className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-1.5">
                  把 AI 回答一键变成排版好的 Word / PDF
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                  支持 ChatGPT、DeepSeek、Claude 等 AI 内容，自动处理 Markdown、LaTeX 公式、表格、图片和代码
                </p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <button
                    onClick={() => void handleClipboardPaste()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-md shadow-sm transition-colors"
                  >
                    📋 从剪贴板粘贴
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    📂 导入文件
                  </button>
                  <button
                    onClick={handleLoadExample}
                    className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    💡 查看示例
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3.5">
                  无需登录 · 内容本地处理 · Word 公式可编辑 · PDF 文字可搜索
                </p>
              </div>
            </div>
          )}

          <div className="flex-1 min-h-0">
            <EditorPanel
              ref={editorRef}
              value={markdownContent}
              placeholderText={DEFAULT_CONTENT}
              onChange={handleContentChange}
              onScrollContainerReady={setEditorScrollEl}
              onRepaired={handlePasteRepaired}
              onReplaceContent={setMarkdownContent}
            />
          </div>

          {/* ── 文档状态条 ── */}
          {!!markdownContent && (
            <StatusBar
              stats={docStats}
              estPages={estPages}
              issueCount={warnings.length}
              onOpenPreflight={handleOpenPreflight}
            />
          )}
        </div>

        {/* ── Preview ─────────────────────────────────────────────────── */}
        <div className={`${mobileTab === 'preview' ? 'flex' : 'hidden md:flex'} w-full md:w-1/2 h-full flex-col`}>
          <div className="shrink-0 px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-400 flex items-center justify-between gap-2">
            <span>
              排版预览
              <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[10px]">
                {templateLabel}
              </span>
            </span>
            <span className="flex gap-1 shrink-0 items-center">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 hidden sm:inline" title="所有内容仅在浏览器本地处理，不上传服务器">
                🔒 本地处理
              </span>
              {/* 编辑 / 最终效果 正式区分：最终效果 = 真实分页 + 页眉页脚 + 页码 */}
              <div className="hidden sm:flex rounded-md overflow-hidden border border-gray-200 dark:border-gray-600 text-[11px]" role="tablist" aria-label="预览模式">
                <button
                  role="tab"
                  aria-selected={!showPdfPreview}
                  className={`px-2 py-0.5 transition-colors ${
                    !showPdfPreview
                      ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-300 font-semibold'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                  title="编辑时的排版预览（随输入实时更新）"
                >
                  排版预览
                </button>
                <button
                  role="tab"
                  aria-selected={showPdfPreview}
                  data-testid="tab-final-preview"
                  onClick={handlePreviewPdf}
                  className={`px-2 py-0.5 transition-colors ${
                    showPdfPreview
                      ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-300 font-semibold'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                  title="最终效果：真实分页、页眉页脚、页码，导出前先看「第 3 页是什么样」"
                >
                  最终效果
                </button>
              </div>
              <button
                onClick={() => setA4Mode(v => !v)}
                className={`px-2 py-0.5 rounded transition-colors ${
                  a4Mode
                    ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                    : 'hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
                title="切换 A4 纸张视图"
              >
                {a4Mode ? `📄 ${settings.paper === 'letter' ? 'Letter' : 'A4'}${settings.orientation === 'landscape' ? ' 横' : ''}` : '🖥 网页'}
              </button>
            </span>
          </div>
          <div className="flex-1 min-h-0 relative">
            {!markdownContent && (
              <div className="absolute top-4 right-4 text-xs font-semibold px-2 py-1 bg-green-100 text-green-700 rounded-md z-10 opacity-70 pointer-events-none">
                示例预览模式
              </div>
            )}
            <PreviewPanel
              content={deferredContent || DEFAULT_CONTENT}
              previewId={previewId}
              settings={settings}
              a4Mode={a4Mode}
              onScrollContainerReady={setPreviewScrollEl}
              onRendered={onPreviewRendered}
            />
          </div>
        </div>
      </div>

      {/* ── Toast ─────────────────────────────────────────────────────── */}
      {toast && (
        <div
          key={toast.id}
          onClick={() => {
            if (toast.diagnostics && navigator.clipboard?.writeText) {
              void navigator.clipboard.writeText(toast.diagnostics).then(() => {
                setToast({ id: Date.now(), icon: '📋', message: '诊断信息已复制到剪贴板' })
              }).catch(() => setToast(null))
            } else {
              setToast(null)
            }
          }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] cursor-pointer bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-xl px-4 py-3 max-w-md animate-[toast-in_.2s_ease-out]"
        >
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
            {toast.icon} {toast.message}
          </p>
          {toast.details && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
              {toast.details.map((d, i) => (
                <li key={i}>· {d}</li>
              ))}
              {toast.details.length >= 4 && <li>…</li>}
            </ul>
          )}
          {toast.diagnostics && (
            <p className="mt-1 text-[11px] text-blue-500">点击复制诊断信息（详见浏览器控制台）</p>
          )}
        </div>
      )}
    </div>
  )
}
