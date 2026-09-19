import { loadHistory, deleteHistory, clearHistory, formatHistoryTime, type HistoryEntry } from '../../core/history'
import { useState } from 'react'

interface HistoryModalProps {
  onRestore: (entry: HistoryEntry) => void
  onClose: () => void
}

export default function HistoryModal({ onRestore, onClose }: HistoryModalProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => loadHistory())

  const handleDelete = (id: string) => {
    deleteHistory(id)
    setEntries(loadHistory())
  }

  const handleClear = () => {
    clearHistory()
    setEntries([])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">🕘 本地历史</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg">
            ✕
          </button>
        </div>

        {entries.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">还没有历史记录，编辑内容后会自动保存在浏览器本地</p>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
                >
                  <button
                    onClick={() => onRestore(entry)}
                    className="flex-1 text-left min-w-0"
                    title="恢复这份文档"
                  >
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{entry.title}</p>
                    <p className="text-xs text-gray-400">{formatHistoryTime(entry.time)} · {Math.round(entry.content.length / 100) / 10}k 字符</p>
                  </button>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="shrink-0 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="删除"
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center pt-3 mt-3 border-t border-gray-100 dark:border-gray-700">
              <span className="text-xs text-gray-400">🔒 仅保存在浏览器本地，不上传</span>
              <button
                onClick={handleClear}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                清空全部
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
