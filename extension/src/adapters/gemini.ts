/**
 * Gemini Adapter（gemini.google.com）—— 🧪 实验性支持。
 *
 * Gemini 用 Angular 自定义元素渲染消息：
 *   - <user-query> / <model-response> / <message-content>
 *   - 公式渲染后一般无原始 LaTeX（降级为文本兜底）
 */

import type { ChatMessage, ChatPlatformAdapter } from '../types'
import { extractMarkdown } from '../extraction/domToMarkdown'
import { elementId, isVisible, queryAll, queryFirst, textOf } from './dom'

const selectors = {
  user: ['user-query .query-text', 'user-query'],
  assistant: ['model-response .markdown', 'model-response message-content', 'model-response'],
  turn: ['model-response', 'user-query'],
  conversationTitle: ['div[aria-current]', 'h1'],
  generating: ['button[aria-label*="Stop"]', 'button[aria-label*="停止"]'],
}

export class GeminiAdapter implements ChatPlatformAdapter {
  id = 'gemini'
  name = 'Gemini'
  maturity = 'experimental' as const
  readonly version = 1

  private hits = new Map<string, number>()

  detect(): boolean {
    return location.hostname === 'gemini.google.com' || location.hostname.endsWith('.gemini.google.com')
  }

  getConversationTitle(): string {
    const el = queryFirst(document, selectors.conversationTitle)
    return el ? textOf(el) : document.title.replace(/\s*[-|]\s*Gemini\s*$/i, '').trim()
  }

  isGenerating(): boolean {
    return queryFirst(document, selectors.generating) !== null
  }

  async getMessageFromElement(turn: HTMLElement): Promise<ChatMessage[]> {
    const assistantEl = queryFirst(turn, selectors.assistant, this.hits)
    if (assistantEl) {
      const extract = extractMarkdown(assistantEl)
      return [
        {
          id: elementId(turn, 'gemini'),
          role: 'assistant',
          markdown: extract.markdown,
          html: assistantEl.innerHTML,
          text: (assistantEl.textContent || '').trim(),
          metadata: { platform: this.id, sources: extract.links },
          element: turn,
        },
      ]
    }
    const userEl = queryFirst(turn, selectors.user, this.hits)
    if (userEl) {
      const text = textOf(userEl)
      return [
        {
          id: elementId(turn, 'gemini'),
          role: 'user',
          text,
          markdown: text,
          metadata: { platform: this.id },
          element: turn,
        },
      ]
    }
    return []
  }

  async getMessages(): Promise<ChatMessage[]> {
    this.hits.clear()
    const out: ChatMessage[] = []
    for (const el of queryAll(document, selectors.turn)) {
      if (!isVisible(el)) continue
      out.push(...(await this.getMessageFromElement(el as HTMLElement)))
    }
    return out
  }

  getMessageElements(): HTMLElement[] {
    return queryAll(document, selectors.turn).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && isVisible(el),
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
        for (const msg of await this.getMessageFromElement(turn)) {
          if (msg.element) callback(msg, msg.element)
        }
      }
    }
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void scan(), 500)
    }
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          schedule()
          return
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
}
