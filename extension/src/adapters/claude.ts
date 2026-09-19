/**
 * Claude Adapter（claude.ai）—— 🧪 实验性支持。
 *
 * Claude 的 DOM 无稳定 data-testid，靠 aria 属性与结构特征：
 *   - 用户消息 div[data-testid="user-message"]
 *   - assistant 消息 div.font-claude-message / [data-is-streaming]
 * 平台改版时只需更新本文件的选择器表。
 */

import type { ChatMessage, ChatPlatformAdapter } from '../types'
import { extractMarkdown } from '../extraction/domToMarkdown'
import { elementId, isVisible, queryAll, queryFirst, textOf } from './dom'

const selectors = {
  turn: [
    'div[data-test-render-count]',
    'div.flex.flex-col.items-stretch > div',
  ],
  assistant: [
    'div.font-claude-message',
    'div[data-is-streaming] .font-claude-message',
    '.claude-message-content',
  ],
  user: [
    'div[data-testid="user-message"]',
    'div.bg-bg-000 .font-user-message',
  ],
  conversationTitle: [
    'a[aria-current="page"]',
    'h1',
  ],
  generating: [
    'button[aria-label*="Stop"]',
    'div[data-is-streaming="true"]',
  ],
}

export class ClaudeAdapter implements ChatPlatformAdapter {
  id = 'claude'
  name = 'Claude'
  maturity = 'experimental' as const
  readonly version = 1

  private hits = new Map<string, number>()

  detect(): boolean {
    return location.hostname === 'claude.ai' || location.hostname.endsWith('.claude.ai')
  }

  getConversationTitle(): string {
    const el = queryFirst(document, selectors.conversationTitle)
    return el ? textOf(el) : document.title.replace(/\s*[-|]\s*Claude\s*$/i, '').trim()
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
          id: elementId(turn, 'claude'),
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
          id: elementId(turn, 'claude'),
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
    for (const turn of queryAll(document, selectors.turn)) {
      if (!isVisible(turn)) continue
      out.push(...(await this.getMessageFromElement(turn as HTMLElement)))
    }
    return out
  }

  getMessageElements(): HTMLElement[] {
    return queryAll(document, selectors.turn).filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && (el.querySelector(selectors.assistant.join(',')) !== null || el.querySelector(selectors.user.join(',')) !== null),
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
