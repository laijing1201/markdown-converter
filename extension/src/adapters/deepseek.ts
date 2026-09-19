/**
 * DeepSeek Adapter（chat.deepseek.com）—— 稳定支持。
 *
 * DOM 依赖说明（集中管理，改版只改这里）：
 *   - assistant 渲染容器 .ds-markdown.ds-markdown--block（DeepSeek 设计系统前缀，
 *     相对稳定）；内部 .ds-markdown--block 下逐块渲染
 *   - 公式 KaTeX / MathJax（annotation / script[type^=math/tex] 可恢复 LaTeX）
 *   - 用户消息：DeepSeek 用户气泡没有语义化 role 属性，按对话结构识别：
 *     用户消息在独立容器里、不含 .ds-markdown，靠容器层级 + 文本特征兜底
 *   - 代码块 pre > code.language-xxx；Mermaid 保留源码
 *
 * 注意：DeepSeek 不是 ChatGPT Adapter 的复制——提取路径、role 判定、
 * 用户消息定位完全独立实现。
 */

import type { ChatMessage, ChatPlatformAdapter } from '../types'
import { extractMarkdown } from '../extraction/domToMarkdown'
import { elementId, isVisible, queryAll, queryFirst, textOf } from './dom'

const selectors = {
  /** assistant 渲染块（设计系统 class，比哈希类稳定） */
  assistantMarkdown: [
    '.ds-markdown.ds-markdown--block',
    '.ds-markdown',
    'div[class*="_ds_markdown"]',
  ],
  /** 用户消息：容器内不含 .ds-markdown 的文本气泡 */
  userMessageFallback: [
    'div[class*="ds-message"]',
    'div[class*="chat-input"] ~ div',
  ],
  /** 页面标题（SPA 内通常是 document.title 或侧栏激活项） */
  conversationTitle: [
    'a[aria-current="page"]',
    'div[class*="sidebar"] .active',
  ],
  /** 生成中指示（停止按钮 / 光标闪烁） */
  generating: [
    '[data-testid="stop-button"]',
    'div[class*="stop"]',
    '.ds-button--stop',
  ],
}

/** 判断元素是否是用户消息容器（无 markdown 渲染、且不是输入区/按钮区） */
function looksLikeUserMessage(el: HTMLElement): boolean {
  if (el.querySelector('.ds-markdown')) return false
  if (el.closest('textarea, [contenteditable="true"]')) return false
  if (el.querySelector('button, textarea')) return false
  const text = textOf(el)
  if (!text) return false
  // 用户气泡通常较短且无复杂结构
  if (el.querySelector('table, pre, h1, h2, h3')) return false
  return true
}

export class DeepSeekAdapter implements ChatPlatformAdapter {
  id = 'deepseek'
  name = 'DeepSeek'
  maturity = 'stable' as const
  readonly version = 1

  private hits = new Map<string, number>()

  /** selector 组元数据（健康检查 / 诊断用：index 0 = primary） */
  getSelectorGroups(): Record<string, string[]> {
    return {
      assistantMarkdown: selectors.assistantMarkdown,
      userMessage: selectors.userMessageFallback,
      conversationTitle: selectors.conversationTitle,
    }
  }

  getSelectorHits(): Map<string, number> {
    return this.hits
  }

  detect(): boolean {
    return location.hostname === 'chat.deepseek.com' || location.hostname.endsWith('.deepseek.com')
  }

  getConversationTitle(): string {
    const el = queryFirst(document, selectors.conversationTitle, this.hits)
    const title = el ? textOf(el) : ''
    if (title) return title
    // document.title 兜底（DeepSeek 标题形如「对话标题 - DeepSeek」）
    return document.title.replace(/\s*[-|]\s*DeepSeek\s*$/i, '').trim()
  }

  isGenerating(): boolean {
    return queryFirst(document, selectors.generating, this.hits) !== null
  }

  async getMessageFromElement(root: HTMLElement): Promise<ChatMessage[]> {
    // 1) assistant 渲染块（容器内部；容器自身命中选择器时直接作为内容）
    let markdownEl = queryFirst(root, selectors.assistantMarkdown, this.hits)
    const selfIsMarkdown = selectors.assistantMarkdown.some((s) => {
      try {
        return root.matches(s)
      } catch {
        return false
      }
    })
    if (!markdownEl && selfIsMarkdown) markdownEl = root
    if (markdownEl) {
      const extract = extractMarkdown(markdownEl)
      const text = (markdownEl.textContent || '').trim()
      return [
        {
          id: markdownEl.getAttribute('data-message-id') || elementId(markdownEl, 'deepseek'),
          role: 'assistant',
          markdown: extract.markdown,
          html: markdownEl.innerHTML,
          text,
          metadata: { platform: this.id, sources: extract.links },
          element: root,
        },
      ]
    }

    // 2) 用户消息（纯文本）
    if (looksLikeUserMessage(root)) {
      const text = textOf(root)
      return [
        {
          id: elementId(root, 'deepseek'),
          role: 'user',
          text,
          markdown: text,
          metadata: { platform: this.id },
          element: root,
        },
      ]
    }

    // 3) 容器型根：下钻找子消息
    const inner = root.querySelector<HTMLElement>('.ds-markdown, [data-message-id]')
    if (inner && inner !== root) return this.getMessageFromElement(inner)
    return []
  }

  async getMessages(): Promise<ChatMessage[]> {
    this.hits.clear()
    const roots = this.getMessageElements()
    const messages: ChatMessage[] = []
    for (const root of roots) {
      if (!isVisible(root)) continue
      messages.push(...(await this.getMessageFromElement(root)))
    }
    return messages
  }

  /**
   * 消息根定位策略：
   *   先找所有 assistant 块 → 取其「消息容器」祖先；
   *   再在主列表容器里找用户消息容器。
   * 这样即使容器 class 变化，assistant 块仍能锚定消息位置。
   */
  getMessageElements(): HTMLElement[] {
    const roots: HTMLElement[] = []
    const seen = new WeakSet<HTMLElement>()

    const markdowns = queryAll(document, selectors.assistantMarkdown, this.hits)
    for (const md of markdowns) {
      // 向上找 2~4 层，找到同时包住 user/assistant 的列表子级
      let container: HTMLElement | null = md.closest<HTMLElement>('[data-message-id]')
      if (!container) {
        let p: HTMLElement | null = md.parentElement
        for (let i = 0; i < 4 && p; i++) {
          const prev = p.parentElement?.firstElementChild
          if (p.parentElement && p.parentElement.childElementCount > 1 && prev) {
            container = p
            break
          }
          p = p.parentElement
        }
      }
      const target = (container ?? md) as HTMLElement
      if (!seen.has(target)) {
        seen.add(target)
        roots.push(target)
      }
    }

    // 用户消息：在主内容列里找文本型容器（按 DOM 顺序插入）
    const main = markdowns[0]?.closest('div[class*="flex"]')?.parentElement ?? document.body
    const candidates = queryAll(main, selectors.userMessageFallback, this.hits)
    // 只保留最内层候选：外层容器若已包含另一个候选则跳过（避免重复提取）
    for (const c of candidates) {
      const el = c as HTMLElement
      if (seen.has(el)) continue
      const containsOther = candidates.some(
        (other) => other !== el && el.contains(other),
      )
      if (containsOther) continue
      if (looksLikeUserMessage(el)) {
        seen.add(el)
        roots.push(el)
      }
    }

    // 按 DOM 顺序排序，保证对话顺序
    roots.sort((a, b) => {
      const pos = a.compareDocumentPosition(b)
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    })
    return roots
  }

  observeNewMessages(callback: (message: ChatMessage, element: HTMLElement) => void): () => void {
    const processed = new WeakSet<Element>()
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const scan = async () => {
      if (stopped) return
      for (const root of this.getMessageElements()) {
        if (processed.has(root)) continue
        processed.add(root)
        for (const msg of await this.getMessageFromElement(root)) {
          if (msg.element) callback(msg, msg.element)
        }
      }
    }

    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void scan(), 400)
    }

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue
          const el = node as Element
          if (el.matches?.('.ds-markdown, [data-message-id], div[class*="ds-"]') || el.querySelector?.('.ds-markdown')) {
            schedule()
            return
          }
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    void scan()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      observer.disconnect()
    }
  }

  diagnose(): Record<string, unknown> {
    return {
      adapter: this.id,
      hostname: location.hostname,
      selectorHits: Object.fromEntries(this.hits),
      messageCount: this.getMessageElements().length,
      generating: this.isGenerating(),
    }
  }
}
