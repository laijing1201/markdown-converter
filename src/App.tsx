import { useState, useCallback, useEffect, useMemo } from 'react'
import EditorPanel from './components/layout/EditorPanel'
import PreviewPanel from './components/layout/PreviewPanel'
import Toolbar from './components/layout/Toolbar'
import DeepFixModal from './components/modals/DeepFixModal'
import SmartFormatModal from './components/modals/SmartFormatModal'
import { validateMarkdown, detectEncodingIssues } from './core/validator'
import { smartFormatText } from './core/formatter'

const DEFAULT_CONTENT = `# MarkDoc

欢迎使用 **MarkDoc** — 将 Markdown 转为 Word/PDF！在左侧编辑 Markdown 内容，右侧实时预览渲染效果。

---

## 📝 基本语法

### 文本格式

- **加粗文字** 和 *斜体文字*
- ~~删除线~~ 和 \`行内代码\`
- 有序列表：
  1. 第一项
  2. 第二项
- 无序列表：
  - 项目 A
  - 项目 B

### 链接与图片

[访问 GitHub](https://github.com)
![示例图片](https://via.placeholder.com/150)

---

## 🧮 LaTeX 数学公式

行内公式示例：$E = mc^2$ 以及 $\\alpha^2 + \\beta^2 = \\gamma^2$

块级公式：

$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$

$$\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$$

---

## 📊 Mermaid 流程图

### 流程图

\`\`\`mermaid
graph TD
    A[开始] --> B{判断条件}
    B -->|条件成立| C[执行操作]
    B -->|条件不成立| D[结束]
    C --> D
\`\`\`

### 时序图

\`\`\`mermaid
sequenceDiagram
    participant 用户
    participant 系统
    用户->>系统: 发送请求
    系统-->>用户: 返回结果
    用户->>系统: 确认完成
\`\`\`

---

## 💻 代码语法高亮

\`\`\`javascript
function fibonacci(n) {
  if (n <= 1) return n
  return fibonacci(n - 1) + fibonacci(n - 2)
}

// 计算斐波那契数列前 10 项
for (let i = 0; i < 10; i++) {
  console.log(fibonacci(i))
}
\`\`\`

\`\`\`python
def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + middle + quicksort(right)

print(quicksort([3, 6, 8, 10, 1, 2, 1]))
\`\`\`

\`\`\`typescript
interface User {
  id: number
  name: string
  email: string
}

async function fetchUser(id: number): Promise<User> {
  const response = await fetch(\`/api/users/\${id}\`)
  return response.json()
}
\`\`\`

---

## 📋 表格

| 功能 | 状态 | 说明 |
|------|------|------|
| Markdown 编辑 | ✅ | 语法高亮支持 |
| 数学公式 | ✅ | LaTeX 行内/块级 |
| 流程图 | ✅ | Mermaid 渲染 |
| 代码高亮 | ✅ | 多语言支持 |
| DOCX 导出 | ✅ | 保留格式 |
| PDF 导出 | ✅ | A4 排版 |

---

## ✅ 任务列表

- [x] 已完成的功能
- [x] Markdown 实时预览
- [ ] 待开发功能
- [ ] 自定义主题
`

export default function App() {
  const [markdownContent, setMarkdownContent] = useState('')
  const [darkMode, setDarkMode] = useState(false)
  const [scrollSyncEnabled, setScrollSyncEnabled] = useState(true)
  const [editorScrollEl, setEditorScrollEl] = useState<HTMLElement | null>(null)
  const [previewScrollEl, setPreviewScrollEl] = useState<HTMLElement | null>(null)
  const [dismissedWarnings, setDismissedWarnings] = useState<number>(0)
  const [showDeepFix, setShowDeepFix] = useState(false)
  const [showSmartFormat, setShowSmartFormat] = useState(false)
  const previewId = 'preview-container'

  // ── Validation ────────────────────────────────────────────────────────────
  const warnings = useMemo(() => {
    if (!markdownContent) return []
    const mdWarnings = validateMarkdown(markdownContent)
    const encWarnings = detectEncodingIssues(markdownContent)
    return [...mdWarnings, ...encWarnings]
  }, [markdownContent])

  // Reset dismissal when warnings count changes (new errors appeared)
  useEffect(() => {
    setDismissedWarnings(0)
  }, [warnings.length])

  // ── Scroll sync (reactive: fires when both refs are ready & toggle is on) ──
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

  // ── Dark mode ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [darkMode])

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleContentChange = useCallback((value: string) => {
    setMarkdownContent(value)
  }, [])

  const handleClear = useCallback(() => {
    setMarkdownContent('')
  }, [])

  const handleOpenDeepFix = useCallback(() => {
    setShowDeepFix(true)
  }, [])

  const handleDeepFixApply = useCallback((fixed: string) => {
    setMarkdownContent(fixed)
  }, [])

  const handleSmartFormat = useCallback(() => {
    setShowSmartFormat(true)
  }, [])

  const handleSmartFormatApply = useCallback(() => {
    setMarkdownContent(prev => smartFormatText(prev))
    setShowSmartFormat(false)
  }, [])

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900 transition-colors">
      <Toolbar
        previewId={previewId}
        onClear={handleClear}
        onSmartFormat={handleSmartFormat}
        onDeepFix={handleOpenDeepFix}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(v => !v)}
        scrollSyncEnabled={scrollSyncEnabled}
        onToggleScrollSync={() => setScrollSyncEnabled(v => !v)}
      />

      {/* ── Deep Fix Modal ────────────────────────────────────────── */}
      {showDeepFix && (
        <DeepFixModal
          content={markdownContent}
          onApply={handleDeepFixApply}
          onClose={() => setShowDeepFix(false)}
        />
      )}

      {/* ── Smart Format Modal ────────────────────────────────────── */}
      {showSmartFormat && (
        <SmartFormatModal
          onApply={handleSmartFormatApply}
          onClose={() => setShowSmartFormat(false)}
        />
      )}

      {/* ── Validation warnings ─────────────────────────────────────────── */}
      {warnings.length > 0 && dismissedWarnings < warnings.length && (
        <div className="flex items-start gap-2 px-4 py-2 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 text-sm">
          <span className="mt-0.5 shrink-0" title="警告">
            ⚠️
          </span>
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
        <div className="w-full md:w-1/2 h-1/2 md:h-full border-r border-gray-200 dark:border-gray-700 flex flex-col">
          <div className="shrink-0 px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-400">
            Markdown 编辑器
          </div>
          <div className="flex-1 min-h-0">
            <EditorPanel
              value={markdownContent}
              placeholderText={DEFAULT_CONTENT}
              onChange={handleContentChange}
              onScrollContainerReady={setEditorScrollEl}
            />
          </div>
        </div>
        <div className="w-full md:w-1/2 h-1/2 md:h-full flex flex-col">
          <div className="shrink-0 px-3 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-400">
            实时预览
          </div>
          <div className="flex-1 min-h-0 relative">
            {!markdownContent && (
              <div className="absolute top-4 right-4 text-xs font-semibold px-2 py-1 bg-green-100 text-green-700 rounded-md z-10 opacity-70 pointer-events-none">
                示例预览模式
              </div>
            )}
            <PreviewPanel
              content={markdownContent || DEFAULT_CONTENT}
              previewId={previewId}
              onScrollContainerReady={setPreviewScrollEl}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
