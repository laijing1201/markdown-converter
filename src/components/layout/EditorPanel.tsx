import React, { useCallback, useMemo, useRef, useImperativeHandle, forwardRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import { keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { EditorState } from '@codemirror/state'
import { repairAiMarkdown, type RepairFix } from '../../core/repair'

export interface EditorHandle {
  /** 在光标处插入文本片段（如分页符）并聚焦编辑器 */
  insertSnippet: (text: string) => void
}

interface EditorPanelProps {
  value: string
  placeholderText?: string
  onChange: (value: string) => void
  onScrollContainerReady: (el: HTMLElement | null) => void
  /** 粘贴内容被自动修复后回调（用于 toast 提示） */
  onRepaired?: (fixes: RepairFix[]) => void
  /** 拖入 .md/.txt 文件整体替换内容 */
  onReplaceContent?: (content: string) => void
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const EditorPanel = forwardRef<EditorHandle, EditorPanelProps>(function EditorPanel(
  {
    value,
    placeholderText = "# 在此输入 Markdown 内容...",
    onChange,
    onScrollContainerReady,
    onRepaired,
    onReplaceContent,
  },
  ref,
) {
  const viewRef = useRef<EditorView | null>(null)

  const insertSnippet = useCallback((text: string) => {
    const view = viewRef.current
    if (!view) return
    view.dispatch(view.state.replaceSelection(text))
    view.focus()
  }, [])

  useImperativeHandle(ref, () => ({ insertSnippet }), [insertSnippet])

  // Use CodeMirror's onCreateEditor to reliably get the scroll DOM.
  // querySelector('.cm-scroller') in a callback ref misses CodeMirror's async init.
  const handleCreateEditor = useCallback((view: EditorView, _state: EditorState) => {
    viewRef.current = view
    onScrollContainerReady(view.scrollDOM)
  }, [onScrollContainerReady])

  const handleChange = useCallback(
    (val: string) => {
      onChange(val)
    },
    [onChange],
  )

  // 回调通过 ref 透传，保证事件扩展只创建一次、不随渲染重建
  const cbRef = useRef({ onRepaired, onReplaceContent })
  cbRef.current = { onRepaired, onReplaceContent }

  const insertImages = useCallback(async (view: EditorView, files: File[]) => {
    for (const file of files) {
      try {
        const dataUrl = await readFileAsDataURL(file)
        const md = `![${file.name || '图片'}](${dataUrl})\n`
        view.dispatch(view.state.replaceSelection(md))
      } catch {
        // 单张失败不影响其余
      }
    }
  }, [])

  // ── 粘贴：自动修复 AI 格式 / 插入截图 ────────────────────────────────────
  const eventHandlers = useMemo(
    () =>
      EditorView.domEventHandlers({
        paste: (event, view) => {
          const dt = event.clipboardData
          if (!dt) return false

          const images = Array.from(dt.files || []).filter((f) => f.type.startsWith('image/'))
          if (images.length > 0) {
            event.preventDefault()
            void insertImages(view, images)
            return true
          }

          const text = dt.getData('text/plain')
          if (!text) return false

          const { fixed, fixes } = repairAiMarkdown(text)
          if (fixes.length === 0) return false

          event.preventDefault()
          view.dispatch(view.state.replaceSelection(fixed))
          cbRef.current.onRepaired?.(fixes)
          return true
        },

        drop: (event, view) => {
          const dt = event.dataTransfer
          if (!dt || !dt.files || dt.files.length === 0) return false
          event.preventDefault()

          const files = Array.from(dt.files)
          const docFile = files.find((f) => /\.(md|markdown|txt)$/i.test(f.name))
          if (docFile) {
            void docFile.text().then((text) => {
              cbRef.current.onReplaceContent?.(text)
            })
            return true
          }

          const images = files.filter((f) => f.type.startsWith('image/'))
          if (images.length > 0) {
            void insertImages(view, images)
          }
          return true
        },
      }),
    [insertImages],
  )

  return (
    <div className="h-full">
      <CodeMirror
        value={value}
        onChange={handleChange}
        onCreateEditor={handleCreateEditor}
        height="100%"
        theme={oneDark}
        extensions={[
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          history(),
          eventHandlers,
        ]}
        placeholder={placeholderText}
        className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:h-full"
      />
    </div>
  )
})

export default EditorPanel
