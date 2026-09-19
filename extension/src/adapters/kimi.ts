/**
 * Kimi Adapter（kimi.com / www.kimi.com）—— 🧪 实验性支持。
 *
 * Kimi（Moonshot）的 DOM 主要靠结构特征：
 *   - assistant 消息带 .markdown-body 或 .segment-assistant
 *   - 用户消息为纯文本气泡
 * 平台改版时只需更新本文件的选择器表。
 */

import type { ChatMessage, ChatPlatformAdapter } from '../types'
import { extractMarkdown } from '../extraction/domToMarkdown'
import { elementId, isVisible, queryAll, queryFirst, textOf } from './dom'

const selectors = {
  assistant: [
    '.segment-assistant .markdown-body',
    '.markdown-body',
    '.segment-assistant',
  ],
  user: [
    '.segment-user',
    'div[class*="user-content"]',
  ],
  turn: [
    '.segment-assistant',
    '.segment-user',
  ],
  conversationTitle: [
    'a[aria-current="page"]',
    'h1',
  ],
  generating: [
    'button[aria-label*="停止"]',
    'div[class*="stop"]',
  ],
}

export class KimiAdapter implements ChatPlatformAdapter {
  id = 'kimi'
  name = 'Kimi'
  maturity = 'experimental' as const
  readonly version = 1

  private hits = new Map<string, number>()

  detect(): boolean {
    const host = location.hostname
    return host === 'kimi.com' || host === 'www.kimi.com' || host.endsWith('.kimi.com')
  }

  getConversationTitle(): string {
    const el = queryFirst(document, selectors.conversationTitle)
    return el ? textOf(el) : document.title.replace(/\s*[-|]\s*Kimi\s*$/i, '').trim()
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
          id: elementId(turn, 'kimi'),
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
          id: elementId(turn, 'kimi'),
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
