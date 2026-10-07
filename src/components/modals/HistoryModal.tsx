import { useCallback, useEffect, useState } from 'react'
import { loadHistory, deleteHistory, clearHistory, formatHistoryTime, type HistoryEntry } from '../../core/history'
import { getSupabase, accountEnabled, getAuthUser } from '../../core/account'

interface HistoryModalProps {
  /** 当前是否已登录（账号体系启用时，未登录不允许使用历史） */
  authed: boolean
  /** 未登录点击「去登录」回调 */
  onRequireAuth: () => void
  onRestore: (entry: HistoryEntry) => void
  onClose: () => void
}

interface CloudEntry {
  id: string
  title: string
  content_md: string
  format: string
  created_at: string
}

/**
 * 历史记录：云端（账号）+ 本地 双 Tab。
 * 云端满足甲方清单：列表、搜索、排序、查看（恢复到编辑器可再次导出）、
 * 重命名、删除单条、批量删除、清空；服务端 RLS 按 user_id 隔离。
 * 需求：历史是登录后才有的能力——未登录不展示、不产生任何历史。
 */
export default function HistoryModal({ authed, onRequireAuth, onRestore, onClose }: HistoryModalProps) {
  const [tab, setTab] = useState<'cloud' | 'local'>('local')
  const [cloudReady, setCloudReady] = useState(false)

  useEffect(() => {
    if (!accountEnabled) return
    void getAuthUser().then((u) => {
      if (u) { setTab('cloud'); setCloudReady(true) }
    })
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">🕘 历史记录</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg">✕</button>
        </div>
        {accountEnabled && !authed ? (
          // 未登录：不展示任何历史（需求——未登录不存在历史）
          <div className="py-10 text-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-900/40 text-2xl">🔐</span>
            <p className="mt-4 text-sm font-medium text-gray-800 dark:text-gray-100">历史记录为登录用户专属功能</p>
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              登录后编辑内容自动保存、导出记录云端同步，任意设备都能查看
            </p>
            <button
              onClick={onRequireAuth}
              className="mt-5 px-6 py-2.5 text-sm font-semibold rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-sm transition-all"
            >
              登录 / 注册
            </button>
          </div>
        ) : (
          <>
            {accountEnabled && cloudReady && (
              <div className="flex gap-1 mb-3">
                {(['cloud', 'local'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${tab === t ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 font-medium' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                  >
                    {t === 'cloud' ? '☁️ 云端（随账号）' : '💻 本地'}
                  </button>
                ))}
              </div>
            )}
            {tab === 'cloud' ? <CloudPane onRestore={onRestore} /> : <LocalPane onRestore={onRestore} />}
          </>
        )}
      </div>
    </div>
  )
}

// ── 云端历史 ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 15
const btnSmall = 'px-2.5 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50'
const btnSmallDanger = 'px-2.5 py-1 text-xs rounded-md border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50'
const btnGhost = 'shrink-0 text-gray-300 hover:text-blue-500 dark:hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all'

function CloudPane({ onRestore }: { onRestore: (entry: HistoryEntry) => void }) {
  const [rows, setRows] = useState<CloudEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [asc, setAsc] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    try {
      const supabase = await getSupabase()
      let query = supabase.from('histories').select('id, title, content_md, format, created_at', { count: 'exact' }).eq('status', 'ok')
      if (q) query = query.ilike('title', `%${q}%`)
      const { data, count, error } = await query
        .order('created_at', { ascending: asc })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
      if (error) throw new Error(error.message)
      setRows((data ?? []) as CloudEntry[])
      setTotal(count ?? 0)
    } catch (e) {
      setErr((e as Error).message)
    }
  }, [q, asc, page])
  useEffect(() => { void load() }, [load])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn(); setSelected(new Set()); await load() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const rename = (entry: CloudEntry) => {
    const title = window.prompt('重命名历史记录：', entry.title)
    if (!title || title === entry.title) return
    void run(async () => { const supabase = await getSupabase(); await supabase.from('histories').update({ title: title.slice(0, 120) }).eq('id', entry.id) })
  }
  const removeOne = (id: string) => { void run(async () => { const supabase = await getSupabase(); await supabase.from('histories').delete().eq('id', id) }) }
  const removeSelected = () => {
    if (selected.size === 0) return
    if (!window.confirm(`删除选中的 ${selected.size} 条云端历史？`)) return
    void run(async () => { const supabase = await getSupabase(); await supabase.from('histories').delete().in('id', [...selected]) })
  }
  const clearAll = () => {
    if (!window.confirm(`清空全部 ${total} 条云端历史？此操作不可恢复。`)) return
    void run(async () => { const supabase = await getSupabase(); await supabase.from('histories').delete().neq('id', '00000000-0000-0000-0000-000000000000') })
  }
  const reexport = (entry: CloudEntry) => {
    onRestore({ id: entry.id, title: entry.title, content: entry.content_md, time: Date.now() } as HistoryEntry)
  }
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      <div className="flex gap-2 mb-3 items-center flex-wrap">
        <input
          className="flex-1 min-w-[160px] rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm"
          placeholder="搜索标题…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1) }}
        />
        <button className={btnSmall} onClick={() => setAsc(!asc)} title="切换排序方向">
          {asc ? '↑ 最早优先' : '↓ 最新优先'}
        </button>
        {selected.size > 0 && <button className={btnSmallDanger} disabled={busy} onClick={removeSelected}>删除选中（{selected.size}）</button>}
        {total > 0 && <button className={btnSmallDanger} disabled={busy} onClick={clearAll}>清空全部</button>}
      </div>
      {err && <p className="text-sm text-red-500 mb-2">{err}</p>}
      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        {rows.length === 0 && !err && <p className="text-sm text-gray-400 text-center py-10">云端还没有历史记录——登录后每次导出会自动保存到这里</p>}
        {rows.map((entry) => (
          <div key={entry.id} className="group flex items-center gap-2.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-600 transition-colors">
            <input type="checkbox" className="shrink-0 accent-blue-600" checked={selected.has(entry.id)} onChange={() => toggle(entry.id)} />
            <button className="flex-1 text-left min-w-0" onClick={() => reexport(entry)} title="载入编辑器，可再次导出">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{entry.title}</p>
              <p className="text-xs text-gray-400">
                {new Date(entry.created_at).toLocaleString()} · {entry.format.toUpperCase()} · {Math.round(entry.content_md.length / 100) / 10}k 字符
              </p>
            </button>
            <button className={btnGhost} onClick={() => rename(entry)} title="重命名">✏️</button>
            <button className={btnGhost} onClick={() => removeOne(entry.id)} title="删除">🗑</button>
          </div>
        ))}
      </div>
      {total > PAGE_SIZE && (
        <div className="flex gap-2 items-center pt-3 mt-3 text-sm">
          <button className={btnSmall} disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
          <span className="text-xs text-gray-400">第 {page} 页 / 共 {Math.ceil(total / PAGE_SIZE)} 页（{total} 条）</span>
          <button className={btnSmall} disabled={page * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>下一页</button>
        </div>
      )}
      <p className="text-xs text-gray-400 pt-3 mt-3 border-t border-gray-100 dark:border-gray-700">🔒 云端历史按账号隔离（服务端 RLS），仅本人可见；每次导出自动保存</p>
    </>
  )
}

// ── 本地历史 ─────────────────────────────────────────────────────────────────
function LocalPane({ onRestore }: { onRestore: (entry: HistoryEntry) => void }) {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => loadHistory())
  return (
    <>
      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        {entries.length === 0 && <p className="text-sm text-gray-400 text-center py-10">还没有本地历史，编辑内容后会自动保存在浏览器本地</p>}
        {entries.map((entry) => (
          <div key={entry.id} className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-600 transition-colors">
            <button onClick={() => onRestore(entry)} className="flex-1 text-left min-w-0" title="恢复这份文档">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{entry.title}</p>
              <p className="text-xs text-gray-400">{formatHistoryTime(entry.time)} · {Math.round(entry.content.length / 100) / 10}k 字符</p>
            </button>
            <button
              onClick={() => { deleteHistory(entry.id); setEntries(loadHistory()) }}
              className="shrink-0 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              title="删除"
            >🗑</button>
          </div>
        ))}
      </div>
      <div className="flex justify-between items-center pt-3 mt-3 border-t border-gray-100 dark:border-gray-700">
        <span className="text-xs text-gray-400">🔒 仅保存在浏览器本地，不上传</span>
        <button className="text-xs text-gray-400 hover:text-red-500 transition-colors" onClick={() => { clearHistory(); setEntries([]) }}>清空全部</button>
      </div>
    </>
  )
}
