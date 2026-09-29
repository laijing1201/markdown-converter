// ═══════════════════════════════════════════════════════════════════════════
// AI 对话分享链接抓取代理 ——「链接导入」功能的服务端取页面端点
//
//   POST /functions/v1/import-link
//   body: { url: string, raw?: boolean }
//     raw=false（默认）→ 返回 { kind:'html', html, finalUrl }，提取在浏览器端完成
//     raw=true          → 返回 { kind:'json', body, finalUrl }，页面本身是 JSON API
//                         （DeepSeek 分享页是 SPA 空壳，对话正文必须走
//                          /api/v0/share/content JSON 接口，浏览器端无法跨域直调）
//
// 安全约束：
//   - 仅接受 https 且 hostname 在 AI 平台白名单内的 URL（防 SSRF）
//   - 重定向后仍校验最终 host（follow 手动实现）
//   - 响应体上限 5 MB、抓取超时 15s
//   - 不存储任何页面内容（无 DB 写入），只做一次性转发
//
// 部署：supabase functions deploy import-link
// ═══════════════════════════════════════════════════════════════════════════

import { corsHeaders, json } from '../_shared/cors.ts'

const ALLOWED_HOSTS = new Set([
  'chatgpt.com', 'chat.openai.com',
  'chat.deepseek.com',
  'kimi.moonshot.cn', 'www.kimi.com', 'kimi.com',
  'www.doubao.com', 'doubao.com',
  'yuanbao.tencent.com',
  'yiyan.baidu.com',
  'tongyi.aliyun.com', 'www.tongyi.com',
])

const MAX_HTML_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return [...ALLOWED_HOSTS].some((h) => host === h || host.endsWith(`.${h}`))
}

function badRequest(message: string, status = 400) {
  return json({ error: message }, status)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return badRequest('Method not allowed', 405)

  let target: URL
  let raw = false
  try {
    const body = await req.json() as { url?: string; raw?: boolean }
    if (!body.url) return badRequest('缺少 url 参数')
    raw = body.raw === true
    target = new URL(body.url)
  } catch {
    return badRequest('请求体不是合法 JSON 或 url 非法')
  }
  if (target.protocol !== 'https:') return badRequest('仅支持 https 链接')
  if (!hostAllowed(target.hostname)) return badRequest('该域名不在支持的平台白名单内')

  // 手动 follow，确保每一跳都落在白名单内
  let current = target
  let html = ''
  let status = 0
  for (let hop = 0; hop < 5; hop++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(current.href, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          // 分享页对无 UA 请求常返回 403；带常规浏览器 UA
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      })
    } catch (err) {
      clearTimeout(timer)
      return json({ error: `抓取失败：${err instanceof Error ? err.message : '网络错误'}` }, 502)
    }
    clearTimeout(timer)
    status = res.status

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) break
      try {
        const next = new URL(loc, current.href)
        if (!hostAllowed(next.hostname)) return json({ error: '重定向跳出了支持的平台白名单' }, 400)
        current = next
        continue
      } catch {
        break
      }
    }

    const len = Number(res.headers.get('content-length') ?? '0')
    if (len > MAX_HTML_BYTES) return json({ error: '页面过大，不是有效的分享页' }, 413)
    html = await res.text()
    if (html.length > MAX_HTML_BYTES) html = html.slice(0, MAX_HTML_BYTES)
    break
  }

  if (status !== 200) return json({ error: `分享页返回 ${status}，链接可能已失效或需要登录`, status }, 200)
  if (!html) return json({ error: '页面内容为空' }, 200)

  if (raw) return json({ kind: 'json', body: html, finalUrl: current.href })
  return json({ kind: 'html', html, finalUrl: current.href })
})
