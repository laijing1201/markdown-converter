/**
 * ChatGPT Adapter（chatgpt.com / chat.openai.com）—— 稳定支持。
 *
 * DOM 依赖说明（2025-2026 观测，集中管理，改版只改这里）：
 *   - 每一轮对话包裹在 [data-testid^="conversation-turn"] 里
 *   - 消息正文 [data-message-author-role="user|assistant"][data-message-id]
 *   - assistant 渲染容器 .markdown（markdown 类名，非哈希）
 *   - 公式 KaTeX（annotation[encoding="application/x-tex"] 可恢复 LaTeX）
 *   - 用户消息 .whitespace-pre-wrap 纯文本
 * 每组选择器都提供 fallback，主选择器失效时自动降级。
 */

import type { ChatMessage, ChatPlatformAdapter } from '../types'
import { extractMarkdown } from '../extraction/domToMarkdown'
import { elementId, isVisible, queryAll, queryFirst, textOf } from './dom'

const selectors = {
  /** 每一轮对话（user+assistant 一组） */
  turn: [
    '[data-testid^="conversation-turn"]',
    'article[data-testid*="turn"]',
    'article',
  ],
  /** assistant 正文（渲染后的 markdown 容器） */
  assistantMarkdown: [
    '[data-message-author-role="assistant"] .markdown',
    '[data-message-author-role="assistant"] .markdown.prose',
    '[data-message-author-role="assistant"]',
    '.agent-turn .markdown',
  ],
  /** assistant 正文（无 role 标注时的兜底：turn 内的 markdown 容器） */
  assistantMarkdownLoose: [
    '.markdown.prose',
    '.markdown',
  ],
  /** 用户消息文本 */
  userMessage: [
    '[data-message-author-role="user"] .whitespace-pre-wrap',
    '[data-message-author-role="user"]',
    'div[data-testid="send-button"] ~ *', // 不会被命中，占位保持链完整
  ],
  /** 用户消息（loose） */
  userMessageLoose: [
    '[data-message-author-role="user"]',
    '.whitespace-pre-wrap',
  ],
  /** 侧栏当前对话标题 */
  conversationTitle: [
    'nav[aria-label="Chat history"] a[aria-current="page"]',
    'nav a[aria-current="page"]',
    'h1',
  ],
  /** 生成中指示（停止按钮） */
  generating: [
    '[data-testid="stop-button"]',
    'button[aria-label*="Stop"]',
    'button[aria-label*="停止"]',
  ],
}

export class ChatGptAdapter implements ChatPlatformAdapter {
  id = 'chatgpt'
  name = 'ChatGPT'
  maturity = 'stable' as const
  readonly version = 1

  /** selector 命中情况（诊断输出用，绝不包含消息内容） */
  private hits = new Map<string, number>()

  /** selector 组元数据（健康检查 / 诊断用：index 0 = primary） */
  getSelectorGroups(): Record<string, string[]> {
    return {
      turn: selectors.turn,
      assistantMarkdown: selectors.assistantMarkdown,
      userMessage: selectors.userMessage,
      conversationTitle: selectors.conversationTitle,
    }
  }

  getSelectorHits(): Map<string, number> {
    return this.hits
  }

  detect(): boolean {
    const host = location.hostname
    return host === 'chatgpt.com' || host === 'chat.openai.com' || host.endsWith('.chatgpt.com')
  }

  getConversationTitle(): string {
    const el = queryFirst(document, selectors.conversationTitle, this.hits)
    if (!el) return ''
    const title = textOf(el)
    // h1 fallback 时去掉站点后缀
    return title.replace(/\s*[-|]\s*ChatGPT\s*$/i, '').trim()
  }

  isGenerating(): boolean {
    return queryFirst(document, selectors.generating, this.hits) !== null
  }

  /** 提取一个 turn 里的所有消息（一般 1 条，user turn 可能含附件） */
  async getMessageFromElement(turn: HTMLElement): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = []
    const roleEl = turn.querySelector('[data-message-author-role]') || turn
    const role = roleEl.getAttribute('data-message-author-role')
    const messageId = roleEl.getAttribute('data-message-id') || elementId(turn, 'chatgpt')

    if (role === 'user') {
      const bodyEl =
        queryFirst(turn, selectors.userMessage, this.hits) ??
        queryFirst(turn, selectors.userMessageLoose, this.hits)
      const text = bodyEl ? (bodyEl.textContent || '').trim() : textOf(turn)
      messages.push({
        id: messageId,
        role: 'user',
        text,
        markdown: text,
        metadata: { platform: this.id },
        element: turn,
      })
      return messages
    }

    // assistant（或 role 缺失时按结构判断：turn 内含 .markdown 视为 assistant）
    const bodyEl = queryFirst(turn, selectors.assistantMarkdown, this.hits) ?? queryFirst(turn, selectors.assistantMarkdownLoose, this.hits)
    if (!bodyEl) return messages
    const extract = extractMarkdown(bodyEl)
    const text = (bodyEl.textContent || '').trim()
    const msg: ChatMessage = {
      id: messageId,
      role: 'assistant',
      markdown: extract.markdown,
      html: bodyEl.innerHTML,
      text,
      metadata: {
        platform: this.id,
        sources: extract.links,
      },
      element: turn,
    }
    if (extract.images.length > 0) msg.images = extract.images
    messages.push(msg)
    return messages
  }

  async getMessages(): Promise<ChatMessage[]> {
    this.hits.clear()
    const turns = this.getMessageElements()
    const messages: ChatMessage[] = []
    for (const turn of turns) {
      if (!isVisible(turn)) continue
      const extracted = await this.getMessageFromElement(turn)
      messages.push(...extracted)
    }
    return messages
  }

  getMessageElements(): HTMLElement[] {
    return queryAll(document, selectors.turn, this.hits).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.querySelector('[data-message-author-role], .markdown') !== null,
    )
  }

  observeNewMessages(callback: (message: ChatMessage, element: HTMLElement) => void): () => void {
    const processed = new WeakSet<Element>()
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const scan = async () => {
      if (stopped) return
      for (const turn of this.getMessageElements()) {
        if (processed.has(turn)) continue
        processed.add(turn)
        const extracted = await this.getMessageFromElement(turn)
        for (const msg of extracted) {
          if (msg.element) callback(msg, msg.element)
        }
      }
    }

    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void scan(), 400)
    }

    const observer = new MutationObserver((mutations) => {
      // 只关心新增节点，不做全树查询
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue
          const el = node as Element
          if (el.matches?.('[data-testid^="conversation-turn"], article') || el.querySelector?.('[data-testid^="conversation-turn"], article')) {
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

  /** 诊断信息（规范三十一节：只含结构信息，不含聊天正文） */
  diagnose(): Record<string, unknown> {
    return {
      adapter: this.id,
      hostname: location.hostname,
      selectorHits: Object.fromEntries(this.hits),
      turnCount: this.getMessageElements().length,
      generating: this.isGenerating(),
    }
  }
}
