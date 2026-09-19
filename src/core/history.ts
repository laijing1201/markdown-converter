/**
 * 本地历史记录 —— 纯 localStorage，不登录、不上传。
 *
 * v2 结构：{ schemaVersion: 2, entries: [...] }，读取时自动迁移 v1（裸数组）。
 * 配额不足时先丢弃较早的一半重试一次；仍失败则记录友好错误信息，
 * 由 App（自动保存后）或 preflight（导出前）取用并提示，绝不静默吞掉，
 * 也绝不影响 Word 导出。
 */

export interface HistoryEntry {
  id: string
  time: number
  title: string
  content: string
}

const KEY = 'markdoc.history.v2'
const SCHEMA_VERSION = 2
const MAX_ENTRIES = 20

let lastError: string | null = null

/** 取出并清空最近一次保存失败的友好提示（无错误返回 null） */
export function consumeHistoryError(): string | null {
  const err = lastError
  lastError = null
  return err
}

function isValidEntry(e: unknown): e is HistoryEntry {
  if (!e || typeof e !== 'object') return false
  const entry = e as Partial<HistoryEntry>
  return typeof entry.id === 'string' && typeof entry.content === 'string' && typeof entry.time === 'number'
}

/** v1 裸数组 → v2 包装结构 */
function migrate(raw: unknown): HistoryEntry[] {
  if (Array.isArray(raw)) return raw.filter(isValidEntry)
  if (raw && typeof raw === 'object') {
    const obj = raw as { schemaVersion?: unknown; entries?: unknown }
    if (obj.schemaVersion === SCHEMA_VERSION && Array.isArray(obj.entries)) {
      return obj.entries.filter(isValidEntry)
    }
  }
  return []
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    return migrate(JSON.parse(raw))
  } catch {
    return []
  }
}

function persist(list: HistoryEntry[]): boolean {
  const write = (entries: HistoryEntry[]) =>
    localStorage.setItem(KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, entries }))
  try {
    write(list)
    lastError = null
    return true
  } catch (err) {
    console.warn('history persist failed, retrying with fewer entries', err)
    // 配额不足：丢弃较早的一半再试一次
    try {
      const keep = Math.max(1, Math.floor(list.length / 2))
      write(list.slice(0, keep))
      lastError = '存储空间不足，已自动清理较早的历史记录'
      return true
    } catch (err2) {
      console.warn('history persist retry failed', err2)
      lastError = '浏览器本地存储空间不足，历史记录暂时无法保存（不影响导出）'
      return false
    }
  }
}

/** 保存当前内容；与最近一条相同或内容为空时跳过。失败时返回 false 并记录错误 */
export function saveToHistory(content: string): boolean {
  if (!content.trim()) return true
  try {
    const list = loadHistory()
    if (list.length > 0 && list[0].content === content) return true
    const entry: HistoryEntry = {
      id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      time: Date.now(),
      title: makeTitle(content),
      content,
    }
    return persist([entry, ...list].slice(0, MAX_ENTRIES))
  } catch (err) {
    console.warn('saveToHistory failed', err)
    lastError = '历史记录保存失败'
    return false
  }
}

export function deleteHistory(id: string): void {
  persist(loadHistory().filter((e) => e.id !== id))
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY)
  } catch { /* ignore */ }
}

function makeTitle(content: string): string {
  const firstLine = content
    .split('\n')
    .map((l) => l.replace(/^#{1,6}\s+/, '').replace(/[*`>]/g, '').trim())
    .find((l) => l.length > 0)
  if (!firstLine) return '未命名文档'
  return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine
}

export function formatHistoryTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
