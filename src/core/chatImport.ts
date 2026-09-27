/**
 * AI 对话分享链接导入（需求 P1-4）：
 *   粘贴 DeepSeek / ChatGPT / Kimi / 豆包 / 元宝 / 文心一言 / 通义千问 的
 *   对话分享链接 → 抓取页面 → 提取对话消息 → 还原为 Markdown。
 *
 * 抓取分两条路：
 *   1. 部署了 Supabase 时走 Edge Function 代理（import-link）——分享页几乎都有
 *      CORS 限制且需要服务端 UA，直连必败；
 *   2. 未部署时尝试浏览器直连（个别允许 CORS 的场景可用），失败给出可操作的提示。
 *
 * 提取分三层兜底（对平台 DOM/JSON 改版鲁棒）：
 *   A. JSON 遍历（__NEXT_DATA__ / 内嵌 JSON），找 {role, content:{parts}} 结构；
 *   B. RSC flight 流正则（"role":"…","content":{"content_type":"text","parts":[…]}）；
 *   C. 通用 HTML → Markdown（服务端渲染的分享页直接转）。
 * 全部失败返回 null，由调用方给出「平台改版/需登录，请手动复制」的明确提示。
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './account/config'

// ─── 平台识别 ────────────────────────────────────────────────────────────────

export type ChatPlatformId =
  | 'chatgpt' | 'deepseek' | 'kimi' | 'doubao' | 'yuanbao' | 'yiyan' | 'tongyi'

export interface ChatPlatformInfo {
  id: ChatPlatformId
  label: string
  /** 可抓取的 hostname（含子域匹配由实现完成） */
  hosts: string[]
}

export const CHAT_PLATFORMS: ChatPlatformInfo[] = [
  { id: 'chatgpt', label: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'] },
  { id: 'deepseek', label: 'DeepSeek', hosts: ['chat.deepseek.com'] },
  { id: 'kimi', label: 'Kimi', hosts: ['kimi.moonshot.cn', 'www.kimi.com', 'kimi.com'] },
  { id: 'doubao', label: '豆包', hosts: ['www.doubao.com', 'doubao.com'] },
  { id: 'yuanbao', label: '腾讯元宝', hosts: ['yuanbao.tencent.com'] },
  { id: 'yiyan', label: '文心一言', hosts: ['yiyan.baidu.com'] },
  { id: 'tongyi', label: '通义千问', hosts: ['tongyi.aliyun.com', 'www.tongyi.com'] },
]

export function platformLabel(id: ChatPlatformId): string {
  return CHAT_PLATFORMS.find((p) => p.id === id)?.label ?? id
}

function matchPlatform(hostname: string): ChatPlatformInfo | null {
  const host = hostname.toLowerCase()
  return CHAT_PLATFORMS.find((p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) ?? null
}

/** 解析并识别单个链接；不支持的域名 / 非法 URL 返回 null */
export function detectChatPlatform(rawUrl: string): { url: URL; platform: ChatPlatformInfo } | null {
  const trimmed = rawUrl.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  const platform = matchPlatform(url.hostname)
  if (!platform) return null
  return { url, platform }
}

/** 把用户粘贴的一段文本拆成候选链接（一行一个，也容忍空格/中文标点分隔） */
export function parseChatLinks(text: string): string[] {
  return text
    .split(/[\s，,；;]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\/|^[a-z0-9.-]+\.[a-z]{2,}\//i.test(s))
}

// ─── 抓取 ────────────────────────────────────────────────────────────────────

export class ChatImportError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message)
    this.name = 'ChatImportError'
  }
}

export interface FetchedPage {
  html: string
  /** html 经哪条路抓到：proxy=Edge Function，direct=浏览器直连 */
  via: 'proxy' | 'direct'
  finalUrl: string
}

const PROXY_ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/import-link` : ''

async function fetchViaProxy(pageUrl: string): Promise<FetchedPage> {
  let res: Response
  try {
    res = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {}),
      },
      body: JSON.stringify({ url: pageUrl }),
    })
  } catch (err) {
    throw new ChatImportError('抓取服务连接失败', err instanceof Error ? err.message : String(err))
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ChatImportError(`抓取服务返回 ${res.status}`, body.slice(0, 300))
  }
  const data = await res.json() as { html?: string; finalUrl?: string }
  if (!data.html) throw new ChatImportError('抓取服务未返回页面内容')
  return { html: data.html, via: 'proxy', finalUrl: data.finalUrl || pageUrl }
}

async function fetchDirect(pageUrl: string): Promise<FetchedPage> {
  try {
    const res = await fetch(pageUrl, { redirect: 'follow' })
    if (!res.ok) throw new ChatImportError(`页面返回 ${res.status}，链接可能已失效`)
    return { html: await res.text(), via: 'direct', finalUrl: res.url || pageUrl }
  } catch (err) {
    if (err instanceof ChatImportError) throw err
    throw new ChatImportError(
      '浏览器直接抓取被目标站点的跨域限制（CORS）拦截',
      '部署版 MarkDoc 可配置 Supabase 抓取服务；当前环境请手动复制 AI 回复后粘贴到编辑器',
    )
  }
}

/** 抓取分享页 HTML：配置了 Supabase 走代理，否则尝试直连 */
export async function fetchChatPageHtml(pageUrl: string): Promise<FetchedPage> {
  if (PROXY_ENDPOINT) return fetchViaProxy(pageUrl)
  return fetchDirect(pageUrl)
}

// ─── 提取：对话消息 ──────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant' | 'unknown'
  content: string
}

export interface ExtractedConversation {
  title: string
  messages: ChatMessage[]
}

interface PartsLike {
  role?: string
  author?: { role?: string }
  content?: { parts?: unknown[]; text?: unknown }
  parts?: unknown[]
  text?: unknown
}

/** 从任意 JSON 结构里递归收集 {role, content:{parts}} 形状的对话消息 */
function walkForMessages(node: unknown, out: ChatMessage[], depth = 0): void {
  if (!node || depth > 24 || out.length > 500) return
  if (Array.isArray(node)) {
    for (const item of node) walkForMessages(item, out, depth + 1)
    return
  }
  if (typeof node !== 'object') return
  const obj = node as PartsLike
  const role = obj.author?.role ?? obj.role
  const parts = obj.content?.parts ?? obj.parts
  const text = obj.content?.text ?? obj.text
  if (typeof role === 'string' && role !== 'system' && role !== 'tool') {
    let content: string | null = null
    if (Array.isArray(parts)) {
      const joined = parts.filter((p): p is string => typeof p === 'string').join('\n\n').trim()
      if (joined) content = joined
    } else if (typeof text === 'string' && text.trim()) {
      content = text.trim()
    }
    if (content) {
      out.push({ role: role === 'user' || role === 'assistant' ? role : 'unknown', content })
    }
  }
  for (const value of Object.values(obj)) walkForMessages(value, out, depth + 1)
}

/** 从 HTML 里捞出所有内嵌 JSON（<script type="application/json"> / __NEXT_DATA__ 等） */
function collectEmbeddedJson(html: string): unknown[] {
  const out: unknown[] = []
  const re = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>|<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1] ?? m[2] ?? ''))
    } catch { /* 单个 script 损坏不影响其它 */ }
  }
  return out
}

/**
 * RSC flight 流提取（ChatGPT 新版分享页）：消息以
 * "author":{"role":"assistant"} … "parts":["…","…"] 的 JSON 片段散落在
 * self.__next_f.push 调用里，无法整体 JSON.parse，用括号配对截取 parts 数组。
 */
function extractFromFlightStream(html: string): ChatMessage[] {
  const out: ChatMessage[] = []
  const roleRe = /"(?:author"\s*:\s*\{\s*"role"|role)"\s*:\s*"(user|assistant)"/g
  let m: RegExpExecArray | null
  while ((m = roleRe.exec(html))) {
    const role = m[1] as 'user' | 'assistant'
    // 在角色标记之后 4000 字符窗口内找最近的 "parts":[
    const window = html.slice(m.index, m.index + 4000)
    const partsIdx = window.indexOf('"parts":[')
    if (partsIdx < 0) continue
    const arrStart = m.index + partsIdx + '"parts":'.length
    // 括号配对找到数组结束（跳过字符串字面量里的引号）
    let depth = 0
    let inStr = false
    let esc = false
    let end = -1
    for (let i = arrStart; i < html.length && i < arrStart + 200000; i++) {
      const ch = html[i]
      if (esc) { esc = false; continue }
      if (inStr) {
        if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === '[') depth++
      else if (ch === ']') {
        depth--
        if (depth === 0) { end = i + 1; break }
      } else if (ch === '}' && depth === 0) break
    }
    if (end < 0) continue
    try {
      const arr = JSON.parse(html.slice(arrStart, end)) as unknown[]
      const joined = arr.filter((p): p is string => typeof p === 'string').join('\n\n').trim()
      if (joined) out.push({ role, content: joined })
    } catch { /* 段损坏跳过 */ }
    roleRe.lastIndex = end
  }
  return out
}

/** 提取页面标题（og:title / <title>），去掉平台尾巴 */
function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)
    ?? html.match(/<meta[^>]+content="([^"]*)"[^>]+property="og:title"/i)
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const raw = (og?.[1] ?? titleTag?.[1] ?? '').trim()
  return raw
    .replace(/\s*[-|·]\s*(ChatGPT|DeepSeek|Kimi|豆包|腾讯元宝|元宝|文心一言|通义千问|分享对话|Share).*$/i, '')
    .slice(0, 120)
}

// ─── 提取：通用 HTML → Markdown（服务端渲染分享页的兜底）─────────────────────

function htmlToMarkdownLite(el: Element, depth = 0): string {
  if (depth > 30) return ''
  const tag = el.tagName.toLowerCase()
  if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'nav' || tag === 'footer' || tag === 'svg') return ''

  const kids = (): string => Array.from(el.children).map((c) => htmlToMarkdownLite(c, depth + 1)).join('')

  // 行内级渲染：段落里的加粗/斜体/行内代码/链接必须保留，不能整体 textContent
  const inlineOf = (node: Element): string => {
    let out = ''
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) { out += n.textContent ?? ''; return }
      if (n.nodeType !== 1) return
      const c = n as Element
      const t = c.tagName.toLowerCase()
      if (t === 'strong' || t === 'b') out += `**${c.textContent?.trim()}**`
      else if (t === 'em' || t === 'i') out += `*${c.textContent?.trim()}*`
      else if (t === 'code') out += `\`${c.textContent ?? ''}\``
      else if (t === 'a') {
        const href = c.getAttribute('href') ?? ''
        const text = c.textContent?.trim() || href
        out += href.startsWith('http') ? `[${text}](${href})` : text
      } else if (t === 'br') out += '\n'
      else out += c.textContent ?? ''
    })
    return out
  }

  switch (tag) {
    case 'h1': return `\n\n# ${el.textContent?.trim()}\n`
    case 'h2': return `\n\n## ${el.textContent?.trim()}\n`
    case 'h3': return `\n\n### ${el.textContent?.trim()}\n`
    case 'h4': case 'h5': case 'h6': return `\n\n#### ${el.textContent?.trim()}\n`
    case 'p': return `\n\n${inlineOf(el).trim()}`
    case 'br': return '\n'
    case 'pre': {
      const code = el.querySelector('code')?.textContent ?? el.textContent ?? ''
      const lang = /language-([\w-]+)/.exec(el.querySelector('code')?.className || '')?.[1] ?? ''
      return `\n\n\`\`\`${lang}\n${code.replace(/\n$/, '')}\n\`\`\`\n`
    }
    case 'ul':
    case 'ol':
      return `\n${Array.from(el.children).map((li, i) => {
        const marker = tag === 'ol' ? `${i + 1}. ` : '- '
        return `\n${'  '.repeat(depth > 2 ? 1 : 0)}${marker}${li.textContent?.trim() || ''}`
      }).join('')}\n`
    case 'blockquote': return `\n\n> ${el.textContent?.trim().replace(/\n+/g, '\n> ')}\n`
    case 'table': {
      const rows = Array.from(el.querySelectorAll('tr'))
      if (!rows.length) return ''
      const cells = (tr: Element) => Array.from(tr.children).map((td) => (td.textContent ?? '').trim().replace(/\|/g, '\\|'))
      const head = cells(rows[0])
      const lines = [
        `\n\n| ${head.join(' | ')} |`,
        `| ${head.map(() => '---').join(' | ')} |`,
        ...rows.slice(1).map((tr) => `| ${cells(tr).join(' | ')} |`),
      ]
      return lines.join('\n') + '\n'
    }
    case 'a': {
      const href = el.getAttribute('href') ?? ''
      const text = el.textContent?.trim() || href
      return href.startsWith('http') ? `[${text}](${href})` : text
    }
    case 'strong': case 'b': return `**${el.textContent?.trim()}**`
    case 'em': case 'i': return `*${el.textContent?.trim()}*`
    case 'code': return `\`${el.textContent ?? ''}\``
    case 'hr': return '\n\n---\n'
    case 'img': return `![图片](${el.getAttribute('src') ?? ''})`
    case 'div': case 'section': case 'article': case 'main': {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3 && (n.textContent ?? '').trim())
        .map((n) => `\n\n${n.textContent?.trim()}`)
        .join('')
      return own + kids()
    }
    default: return kids()
  }
}

/** 通用 HTML 提取：找最像对话正文的容器，转成 Markdown 文本（单条 assistant 消息） */
function extractFromHtml(html: string): ExtractedConversation | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, nav, header, footer, noscript, iframe, button, form').forEach((n) => n.remove())
  const container =
    doc.querySelector('article') ??
    doc.querySelector('[class*="markdown" i]') ??
    doc.querySelector('[class*="message" i]') ??
    doc.querySelector('main') ??
    doc.body
  if (!container) return null
  const md = htmlToMarkdownLite(container)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (md.length < 40) return null
  return { title: extractTitle(html), messages: [{ role: 'assistant', content: md }] }
}

// ─── 对外入口 ────────────────────────────────────────────────────────────────

/**
 * 从分享页 HTML 提取对话。platform 传 'generic' 时只用通用 HTML 提取。
 * 提取不到任何消息时返回 null（调用方给出明确失败提示）。
 */
export function extractConversation(html: string, platform: ChatPlatformId | 'generic'): ExtractedConversation | null {
  const title = extractTitle(html)

  if (platform !== 'generic') {
    // A. 内嵌 JSON 遍历
    const messages: ChatMessage[] = []
    for (const json of collectEmbeddedJson(html)) {
      walkForMessages(json, messages)
    }
    if (messages.length === 0) {
      // B. RSC flight 流（ChatGPT 分享页）
      messages.push(...extractFromFlightStream(html))
    }
    if (messages.length > 0) {
      return { title, messages: mergeAdjacent(messages) }
    }
  }

  // C. 通用 HTML（平台 JSON 结构改版 / 服务端渲染页共用兜底）
  return extractFromHtml(html)
}

/** 相邻同角色消息合并（JSON 遍历常把长回答拆成多段 parts 对象） */
function mergeAdjacent(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const msg of messages) {
    const prev = out[out.length - 1]
    if (prev && prev.role === msg.role) prev.content = `${prev.content}\n\n${msg.content}`
    else out.push({ ...msg })
  }
  return out
}

/** 对话 → Markdown（用户/AI 交替、以标题分层，公式与代码原样保留） */
export function conversationToMarkdown(conv: ExtractedConversation, platform: ChatPlatformInfo): string {
  const blocks: string[] = []
  blocks.push(`# ${conv.title || `${platform.label} 对话`}`)
  blocks.push(`> 来源：${platform.label} 对话分享链接 · 导入于 ${new Date().toISOString().slice(0, 10)}`)
  conv.messages.forEach((msg, i) => {
    const heading = msg.role === 'user' ? '### 🙋 用户' : msg.role === 'assistant' ? '### 🤖 AI' : '### 💬 消息'
    blocks.push(`${heading}（${i + 1}）\n\n${msg.content.trim()}`)
  })
  return blocks.join('\n\n')
}

export interface ImportLinkResult {
  url: string
  platform: ChatPlatformInfo
  markdown: string
  messageCount: number
  via: 'proxy' | 'direct'
}

/**
 * 单链接完整流程：抓取 → 提取 → Markdown。
 * 抛出 ChatImportError 时 message 面向用户可直接展示。
 */
export async function importChatLink(rawUrl: string): Promise<ImportLinkResult> {
  const detected = detectChatPlatform(rawUrl)
  if (!detected) {
    throw new ChatImportError('无法识别的链接：请粘贴 AI 平台的对话分享链接')
  }
  const { url, platform } = detected
  const page = await fetchChatPageHtml(url.href)
  const conv = extractConversation(page.html, platform.id)
  if (!conv || conv.messages.length === 0) {
    throw new ChatImportError(
      `未能从 ${platform.label} 分享页中提取到对话内容`,
      '分享页可能需要登录访问、已过期，或平台结构发生变化——可手动复制 AI 回复粘贴到编辑器',
    )
  }
  return {
    url: url.href,
    platform,
    markdown: conversationToMarkdown(conv, platform),
    messageCount: conv.messages.length,
    via: page.via,
  }
}

/** 多链接合并导入：按输入顺序拼接，每个链接一个小节 */
export async function importChatLinks(urls: string[]): Promise<ImportLinkResult[]> {
  const results: ImportLinkResult[] = []
  const failures: string[] = []
  for (const url of urls) {
    try {
      results.push(await importChatLink(url))
    } catch (err) {
      failures.push(url)
      if (results.length === 0 && urls.length === 1) throw err
    }
  }
  if (results.length === 0 && failures.length > 0) {
    throw new ChatImportError(`全部 ${failures.length} 个链接导入失败，请检查链接是否为公开分享链接`)
  }
  return results
}
