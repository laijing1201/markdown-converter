import { useCallback, useMemo, useState } from 'react'
import {
  detectChatPlatform,
  importChatLinks,
  ChatImportError,
  platformLabel,
  type ImportLinkResult,
} from '../../core/chatImport'

interface ImportLinkModalProps {
  /** markdown：合并后的导入内容；messageCount：消息总条数 */
  onApply: (markdown: string, messageCount: number) => void
  onClose: () => void
}

type LinkStatus =
  | { state: 'pending' }
  | { state: 'fetching' }
  | { state: 'ok'; messages: number; via: 'proxy' | 'direct' }
  | { state: 'fail'; reason: string }

/**
 * AI 对话链接导入弹窗：粘贴一个或多个分享链接（一行一个），
 * 抓取成功后合并为一份 Markdown 交给编辑器。
 */
export default function ImportLinkModal({ onApply, onClose }: ImportLinkModalProps) {
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, LinkStatus>>({})
  const [results, setResults] = useState<ImportLinkResult[]>([])
  const [globalError, setGlobalError] = useState<string | null>(null)

  const lines = useMemo(() => raw.split('\n').map((l) => l.trim()).filter(Boolean), [raw])

  const detected = useMemo(() =>
    lines.map((line) => {
      const hit = detectChatPlatform(line)
      return { line, platform: hit?.platform ?? null, valid: !!hit }
    }),
  [lines])

  const validCount = detected.filter((d) => d.valid).length

  const handleImport = useCallback(async () => {
    const urls = detected.filter((d) => d.valid).map((d) => d.line)
    if (urls.length === 0) return
    setBusy(true)
    setGlobalError(null)
    setResults([])
    setStatuses(Object.fromEntries(urls.map((u) => [u, { state: 'fetching' } as LinkStatus])))
    try {
      const imported = await importChatLinks(urls)
      setResults(imported)
      setStatuses((prev) => {
        const next = { ...prev }
        for (const url of urls) {
          const hit = imported.find((r) => r.url === url)
          next[url] = hit
            ? { state: 'ok', messages: hit.messageCount, via: hit.via }
            : { state: 'fail', reason: '未能提取到对话内容' }
        }
        return next
      })
    } catch (err) {
      const message = err instanceof ChatImportError ? err.message : '导入失败，请稍后重试'
      setGlobalError(message)
      setStatuses((prev) => {
        const next: Record<string, LinkStatus> = {}
        for (const url of urls) next[url] = { state: 'fail', reason: message }
        return next
      })
    } finally {
      setBusy(false)
    }
  }, [detected])

  const handleApply = useCallback(() => {
    if (results.length === 0) return
    const markdown = results.map((r) => r.markdown).join('\n\n---\n\n')
    const messageCount = results.reduce((sum, r) => sum + r.messageCount, 0)
    onApply(markdown, messageCount)
  }, [results, onApply])

  const totalMessages = results.reduce((sum, r) => sum + r.messageCount, 0)

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[560px] max-w-full max-h-[85vh] flex flex-col">
        <div className="px-6 pt-5 pb-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">🔗 AI 对话链接导入</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            粘贴 AI 平台的对话分享链接（一行一个，可多个链接合并导入），自动抓取对话内容转为 Markdown。
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
            支持：ChatGPT · DeepSeek · Kimi · 豆包 · 腾讯元宝 · 文心一言 · 通义千问（需为公开分享链接）
          </p>
        </div>

        <div className="px-6 py-4 overflow-y-auto space-y-3 flex-1">
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={'https://chat.deepseek.com/share/xxxx\nhttps://chatgpt.com/share/xxxx'}
            className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />

          {detected.length > 0 && (
            <ul className="space-y-1.5">
              {detected.map((d, i) => {
                const status = statuses[d.line]
                return (
                  <li
                    key={i}
                    className="text-xs flex items-start gap-2 rounded-md border border-gray-200 dark:border-gray-700 px-2.5 py-1.5"
                  >
                    <span className="shrink-0 mt-0.5">
                      {status?.state === 'fetching' ? '⏳' :
                        status?.state === 'ok' ? '✅' :
                        status?.state === 'fail' ? '❌' :
                        d.valid ? '🔗' : '⚠️'}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-mono truncate text-gray-700 dark:text-gray-200">{d.line}</span>
                      <span className="block text-[11px] text-gray-400 dark:text-gray-500">
                        {status?.state === 'ok'
                          ? `导入成功 · ${status.messages} 条消息 · 经${status.via === 'proxy' ? '抓取服务' : '浏览器直连'}`
                          : status?.state === 'fail'
                            ? status.reason
                            : d.valid
                              ? platformLabel(d.platform!.id)
                              : '不是支持的分享链接，将跳过'}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          {globalError && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md px-3 py-2 flex items-center justify-between gap-2">
              <span>{globalError}</span>
              <button
                onClick={() => void handleImport()}
                className="shrink-0 px-2.5 py-1 rounded-md border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors font-medium"
              >
                重试
              </button>
            </div>
          )}

          <details className="text-xs text-gray-500 dark:text-gray-400">
            <summary className="cursor-pointer select-none text-gray-600 dark:text-gray-300 font-medium">
              各平台如何获取对话分享链接？
            </summary>
            <ul className="mt-1.5 space-y-1 list-disc pl-4">
              <li>ChatGPT：对话右上角「<b>Share / 分享</b>」→「Create link」，复制生成的 chatgpt.com/share/… 链接</li>
              <li>DeepSeek：对话右上角「<b>分享</b>」→ 复制 chat.deepseek.com/share/… 链接</li>
              <li>Kimi：对话右上角「<b>分享</b>」→「创建公开链接」</li>
              <li>豆包 / 腾讯元宝 / 文心一言 / 通义千问：对话右上角「<b>分享</b>」→ 生成公开访问链接后复制</li>
            </ul>
            <p className="mt-1.5">注意：链接必须是<b>公开可访问</b>的分享链接；需要登录才能查看的对话无法抓取。抓取仅转发页面内容，不做存储。</p>
          </details>

          {results.length > 0 && (
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              共抓取 {results.length} 个对话、{totalMessages} 条消息，点击下方「导入到编辑器」完成。
            </p>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            {validCount > 0 ? `已识别 ${validCount} 个链接` : '内容仅在本机处理；抓取经服务端代理转发，不存储'}
          </span>
          <span className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm font-medium rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              取消
            </button>
            {results.length > 0 ? (
              <button
                onClick={handleApply}
                data-testid="import-link-apply"
                className="px-4 py-1.5 text-sm font-semibold rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                导入到编辑器
              </button>
            ) : (
              <button
                onClick={() => void handleImport()}
                disabled={busy || validCount === 0}
                data-testid="import-link-fetch"
                className="px-4 py-1.5 text-sm font-semibold rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
              >
                {busy ? '抓取中…' : '抓取并转换'}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}
