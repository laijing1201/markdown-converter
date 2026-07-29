import React, { useCallback, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import { keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { EditorState } from '@codemirror/state'

interface EditorPanelProps {
  value: string
  placeholderText?: string
  onChange: (value: string) => void
  onScrollContainerReady: (el: HTMLElement | null) => void
}

export default function EditorPanel({ value, placeholderText = "# 在此输入 Markdown 内容...", onChange, onScrollContainerReady }: EditorPanelProps) {
  const viewRef = useRef<EditorView | null>(null)

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
        ]}
        placeholder={placeholderText}
        className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:h-full"
      />
    </div>
  )
}
