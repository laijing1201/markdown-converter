import { useCallback, useMemo, useState } from 'react'
import { useEscapeClose } from './useEscapeClose'
import {
  detectChatPlatform,
  importChatLinksWithReport,
  parseChatLinks,
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
  | { state: 'fail'; reason: string; hint?: string }

interface LineItem {
  /** 行内提取出的链接（无链接的行原样保留用于提示） */
  url: string | null
  /** 原始行文本 */
  raw: string
}

/**
 * AI 对话链接导入弹窗：粘贴一个或多个分享链接（一行一个，容忍行内混排文字），
 * 抓取成功后合并为一份 Markdown 交给编辑器。失败逐条给出原因与建议。
 */
export default function ImportLinkModal({ onApply, onClose }: ImportLinkModalProps) {
  useEscapeClose(onClose)
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, LinkStatus>>({})
  const [results, setResults] = useState<ImportLinkResult[]>([])
  const [globalError, setGlobalError] = useState<string | null>(null)

  // 逐行提取链接（一行可含多个）并去重（统一规范为绝对 URL）
  const items = useMemo(() => {
    const seen = new Set<string>()
    const out: LineItem[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      const found = parseChatLinks(line)
      if (found.length > 0) {
        for (const u of found) {
          const href = detectChatPlatform(u)?.url.href ?? u
          if (seen.has(href)) continue
          seen.add(href)
          out.push({ url: href, raw: line.trim() })
        }
      } else {
        out.push({ url: null, raw: line.trim() })
      }
    }
    return out
  }, [raw])

  const urls = useMemo(() => items.map((it) => it.url).filter((u): u is string => !!u), [items])
  const validCount = urls.length

  const runImport = useCallback(async (targets: string[]) => {
    if (targets.length === 0) return
    setBusy(true)
    setGlobalError(null)
    setStatuses((prev) => {
      const next = { ...prev }
      for (const u of targets) next[u] = { state: 'fetching' }
      return next
    })
    const { results: imported, failures } = await importChatLinksWithReport(targets)
    setStatuses((prev) => {
      const next = { ...prev }
      for (const u of targets) {
        const hit = imported.find((r) => r.url === u)
        if (hit) {
          next[u] = { state: 'ok', messages: hit.messageCount, via: hit.via }
        } else {
          const f = failures.find((x) => x.url === u)
          next[u] = { state: 'fail', reason: f?.error.message ?? '未能提取到对话内容', hint: f?.error.detail }
        }
      }
      return next
    })
    setResults((prev) => {
      // 保留仍有效的旧成功结果（部分重试时不丢失已抓到的对话）
      const kept = prev.filter((r) => targets.some((t) => r.url === t) === false)
      return [...kept, ...imported]
    })
    if (imported.length === 0 && failures.length > 0) {
      setGlobalError(
        failures.length === 1
          ? failures[0].error.message
          : `${failures.length} 个链接全部导入失败（原因见各条目），可重试或手动复制内容`,
      )
    }
    setBusy(false)
  }, [])

  const handleImport = useCallback(() => void runImport(urls), [runImport, urls])

  const failedUrls = Object.entries(statuses)
    .filter(([, s]) => s.state === 'fail')
    .map(([u]) => u)

  const handleRetryFailed = useCallback(() => {
    if (failedUrls.length > 0) void runImport(failedUrls)
  }, [failedUrls, runImport])

  const handleApply = useCallback(() => {
    if (results.length === 0) return
    const markdown = results.map((r) => r.markdown).join('\n\n---\n\n')
    const messageCount = results.reduce((sum, r) => sum + r.messageCount, 0)
    onApply(markdown, messageCount)
  }, [results, onApply])

  const totalMessages = results.reduce((sum, r) => sum + r.messageCount, 0)
  const okCount = Object.values(statuses).filter((s) => s.state === 'ok').length

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[560px] max-w-full max-h-[85vh] flex flex-col">
        <div className="px-6 pt-5 pb-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">🔗 AI 对话链接导入</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            粘贴 AI 平台的对话分享链接（一行一个，可多个链接合并导入），自动抓取对话内容转为 Markdown。
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
            支持：ChatGPT · DeepSeek · Kimi · 豆包 · 腾讯元宝 · 文心一言 · 通义千问（需为<b>公开</b>分享链接；
            DeepSeek 走官方接口最稳，其余平台受页面结构与人机验证影响，失败会给出原因）
          </p>
        </div>

        <div className="px-6 py-4 overflow-y-auto space-y-3 flex-1">
          <textarea
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value)
              // 编辑内容后清空上一轮结果，避免导入到已删除的链接
              setResults([])
              setStatuses({})
              setGlobalError(null)
            }}
            rows={4}
            spellCheck={false}
            placeholder={'https://chat.deepseek.com/share/xxxx\nhttps://chatgpt.com/share/xxxx'}
            className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />

          {items.length > 0 && (
            <ul className="space-y-1.5">
              {items.map((it, i) => {
                const status = it.url ? statuses[it.url] : undefined
                const platform = it.url ? detectChatPlatform(it.url)?.platform ?? null : null
                return (
                  <li
                    key={i}
                    className="text-xs flex items-start gap-2 rounded-md border border-gray-200 dark:border-gray-700 px-2.5 py-1.5"
                  >
                    <span className="shrink-0 mt-0.5">
                      {status?.state === 'fetching' ? '⏳' :
                        status?.state === 'ok' ? '✅' :
                        status?.state === 'fail' ? '❌' :
                        it.url ? '🔗' : '⚠️'}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-mono truncate text-gray-700 dark:text-gray-200">
                        {it.url ?? it.raw}
                      </span>
                      <span className="block text-[11px] text-gray-400 dark:text-gray-500">
                        {status?.state === 'ok'
                          ? `导入成功 · ${status.messages} 条消息 · 经${status.via === 'proxy' ? '抓取服务' : '浏览器直连'}`
                          : status?.state === 'fail'
                            ? status.reason
                            : it.url
                              ? platformLabel(platform!.id)
                              : '本行没有可识别的链接，已跳过'}
                      </span>
                      {status?.state === 'fail' && status.hint && (
                        <span className="block text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                          建议：{status.hint}
                        </span>
                      )}
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
                onClick={handleRetryFailed}
                disabled={busy}
                className="shrink-0 px-2.5 py-1 rounded-md border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors font-medium disabled:opacity-50"
              >
                重试失败的链接
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
            <p className="mt-1.5">注意：链接必须是<b>公开可访问</b>的分享链接；需要登录才能查看的对话、启用人机验证的页面无法抓取（会明确提示原因）。抓取仅转发页面内容，不做存储。</p>
          </details>

          {results.length > 0 && (
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              共抓取 {results.length} 个对话、{totalMessages} 条消息{okCount > 0 && failedUrls.length > 0 ? `（另有 ${failedUrls.length} 个链接失败，可重试）` : ''}，点击下方「导入到编辑器」完成。
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
                onClick={handleImport}
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
