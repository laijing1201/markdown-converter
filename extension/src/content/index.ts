/**
 * Content script 入口（AI 平台页面）：
 *   1. 探测平台 Adapter（未识别平台则静默退出）
 *   2. 注入 Shadow DOM UI（悬浮球 / 单条回答导出按钮 / 多选模式）
 *   3. 响应 popup 与 background（快捷键）的导出指令
 *   4. Adapter 体检 + DOM 改版检测：识别失败时主动告知用户（绝不静默失败）
 *
 * 崩溃保护（P4C 第三十五节）：main 全程 try/catch 边界，任何异常
 * 只影响 MarkDoc 自身 UI，绝不波及 AI 网站页面。
 *
 * SPA 容错：MutationObserver 只看新增节点 + WeakSet 防重复注入 + debounce。
 */

import type { ChatMessage, ChatPlatformAdapter, ContentActionRequest, ContentStateResponse, ConversationStyle, ExportTarget } from '../types'
import { detectAdapter } from '../adapters/registry'
import { ChatUI, type UIMenuItem } from './chatUi'
import {
  editInMarkDoc,
  exportConversation,
  exportQa,
  exportSelection,
  exportSingleAnswer,
  type ActionContext,
} from './actions'
import { buildDiagnostics } from './diagnostics'
import { computeAdapterHealth, isDomRegression, nextSnapshot, type HealthCapableAdapter, type AdapterHealth } from '../health'
import { MarkDocExtError, userMessageOf, codeOf } from '../errors'
import { EXT_VERSION, adapterVersionOf } from '../version'
import { loadHealthSnapshot, saveHealthSnapshot } from '../storage'

const detected = detectAdapter()
if (detected) {
  try {
    void main(detected)
  } catch (err) {
    // 注入边界：MarkDoc 初始化失败绝不影响 AI 网站
    console.error('[MarkDoc] 初始化失败', err)
  }
}

async function main(adapter: ChatPlatformAdapter): Promise<void> {
  const ui = new ChatUI()

  // 观察到的消息（对话顺序）；element → message 映射
  const messageCache: ChatMessage[] = []
  const roleByElement = new Map<HTMLElement, ChatMessage>()

  const ctx: ActionContext = {
    adapter,
    platformName: adapter.name,
    conversationTitle: '',
  }

  const refreshTitle = () => {
    try {
      ctx.conversationTitle = adapter.getConversationTitle()
    } catch {
      ctx.conversationTitle = ''
    }
  }
  refreshTitle()

  // ── Adapter 体检 + DOM 改版检测 ───────────────────────────────────────────
  const computeHealth = async (): Promise<AdapterHealth | null> => {
    try {
      return await computeAdapterHealth(adapter as HealthCapableAdapter)
    } catch {
      return null
    }
  }

  let lastRegressionNotified = false
  const checkRegression = async (health: AdapterHealth | null): Promise<boolean> => {
    if (!health) return false
    try {
      const hostname = location.hostname
      const snapshot = await loadHealthSnapshot(hostname)
      const regression = isDomRegression(health, snapshot)
      const next = nextSnapshot(health, snapshot)
      if (next) await saveHealthSnapshot(hostname, next)
      if (regression && !lastRegressionNotified) {
        lastRegressionNotified = true
        const diag = await buildDiagnostics(adapter, 'dom-regression', { errorCode: 'MD-EXT-010' })
        void ui.showError(
          `MarkDoc 无法完整识别当前 ${adapter.name} 页面，网站结构可能已经更新。` +
          '欢迎复制诊断信息反馈，帮助我们尽快适配（信息不含聊天内容）。',
          diag,
        )
      }
      return regression
    } catch {
      return false
    }
  }

  // ── 消息出现 → 注入导出按钮 ────────────────────────────────────────────────
  const streamingElements = new WeakSet<HTMLElement>()

  const attachTo = (msg: ChatMessage, element: HTMLElement) => {
    if (msg.role !== 'assistant') return
    if (roleByElement.has(element)) {
      // 该回答可能正在流式更新：刷新生成状态标记
      refreshStreamingBadge(element)
      return
    }
    roleByElement.set(element, msg)
    messageCache.push(msg)
    if (adapter.isGenerating?.()) streamingElements.add(element)
    ui.attachMessageButton(element, (el) => void handleMessageButton(el))
    if (streamingElements.has(element)) ui.setMessageStreaming(element, true)
  }

  const refreshStreamingBadge = (element: HTMLElement) => {
    const generating = !!adapter.isGenerating?.()
    if (generating) {
      streamingElements.add(element)
      ui.setMessageStreaming(element, true)
    } else if (streamingElements.has(element)) {
      streamingElements.delete(element)
      ui.setMessageStreaming(element, false)
    }
  }

  try {
    const existing = await adapter.getMessages()
    for (const msg of existing) {
      if (msg.element) attachTo(msg, msg.element)
    }
    // 初次体检：识别异常（含 DOM 改版）立刻告知用户
    const health = await computeHealth()
    await checkRegression(health)
  } catch (err) {
    console.warn('[MarkDoc] 初始消息扫描失败', err)
  }

  const unobserve = adapter.observeNewMessages?.((msg, element) => {
    refreshTitle()
    attachTo(msg, element)
    ui.pruneRemoved()
    ui.refreshPositions()
    // 生成结束的时机无从事件获知，借助 observer 节流刷新生成标记
    try {
      if (!adapter.isGenerating?.()) {
        for (const el of Array.from(roleByElement.keys())) {
          if (streamingElements.has(el)) {
            streamingElements.delete(el)
            ui.setMessageStreaming(el, false)
          }
        }
      }
    } catch { /* ignore */ }
  })

  // SPA 路由切换：URL 变化时刷新标题、重扫消息并重置多选状态
  let lastUrl = location.href
  const urlTimer = setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      refreshTitle()
      // 换聊天后：清空旧缓存，避免「读取旧 conversation / 导出错对话」
      messageCache.length = 0
      roleByElement.clear()
      if (ui.isSelectionMode()) ui.exitSelectionMode()
      void (async () => {
        try {
          for (const msg of await adapter.getMessages()) {
            if (msg.element) attachTo(msg, msg.element)
          }
          ui.refreshPositions()
          await checkRegression(await computeHealth())
        } catch { /* 容错 */ }
      })()
    }
  }, 1500)

  // hover 委托：显示对应消息的导出按钮
  let hoverThrottle = 0
  document.addEventListener(
    'mouseover',
    (e) => {
      const now = Date.now()
      if (now - hoverThrottle < 80) return
      hoverThrottle = now
      ui.handleHover(e.target)
    },
    { passive: true },
  )

  // ── 流式生成检查（P4C 第十一节）──────────────────────────────────────────
  const guardGenerating = async (): Promise<boolean> => {
    if (adapter.isGenerating?.()) {
      return await ui.confirmGenerating()
    }
    return true
  }

  // ── 单条消息菜单 ──────────────────────────────────────────────────────────
  const handleMessageButton = async (element: HTMLElement) => {
    const msg = roleByElement.get(element)
    if (!msg) return
    refreshTitle()
    const items: UIMenuItem[] = [
      { label: '导出 Word', icon: '📝', onClick: () => void runGuarded(() => exportSingleAnswer(ctx, msg, 'docx')) },
      { label: '导出 PDF', icon: '📕', onClick: () => void runGuarded(() => exportSingleAnswer(ctx, msg, 'pdf')) },
      'separator',
      { label: '导出问答（问题 + 回答）', icon: '💬', onClick: () => void runGuarded(() => exportQaFor(msg, 'docx')) },
      'separator',
      { label: '在 MarkDoc 中编辑', icon: '✏️', onClick: () => void runGuarded(async () => editInMarkDoc(ctx, [msg], 'answer')) },
    ]
    const title = ctx.conversationTitle ? `《${ctx.conversationTitle}》` : adapter.name
    ui.showMessageMenu(element, title, items)
  }

  const exportQaFor = async (assistantMsg: ChatMessage, target: ExportTarget) => {
    // 找这条回答之前最近的用户消息（按缓存顺序）
    const idx = messageCache.findIndex((m) => m.id === assistantMsg.id)
    let user: ChatMessage | null = null
    for (let i = idx - 1; i >= 0; i--) {
      if (messageCache[i].role === 'user') {
        user = messageCache[i]
        break
      }
    }
    return exportQa(ctx, assistantMsg, target, user)
  }

  const runGuarded = async (fn: () => Promise<{ ok: boolean; reason?: string }>) => {
    if (!(await guardGenerating())) return
    try {
      const res = await fn()
      if (!res.ok && res.reason) {
        void ui.showError(res.reason, await buildDiagnostics(adapter, 'export-failed'))
      } else if (res.ok) {
        ui.toast('📤 已交给 MarkDoc 导出引擎…')
      }
    } catch (err) {
      console.error('[MarkDoc] export failed', err)
      void ui.showError(
        userMessageOf(err),
        await buildDiagnostics(adapter, 'export-error', { errorCode: codeOf(err) ?? undefined, error: err }),
      )
    }
  }

  // ── 悬浮球 ────────────────────────────────────────────────────────────────
  ui.showLauncher(() => {
    const quickTitle = ctx.conversationTitle ? `当前对话：《${ctx.conversationTitle}》` : `当前平台：${adapter.name}`
    void adapter.getMessages().then((all) => {
      const users = all.filter((m) => m.role === 'user').length
      const assistants = all.filter((m) => m.role === 'assistant').length
      const items: UIMenuItem[] = [
        { label: `导出最近回答（${all.length > 0 ? '有内容' : '未识别到消息'}）`, icon: '⚡', onClick: () => void exportLast('docx') },
        { label: '选择消息…', icon: '☑️', onClick: () => void enterSelection() },
        'separator',
        { label: '导出整段对话（对话模式）', icon: '💬', onClick: () => void exportWhole('docx', 'dialogue') },
        { label: '导出整段对话（内容整理模式）', icon: '📄', onClick: () => void exportWhole('docx', 'article') },
        'separator',
        { label: '在 MarkDoc 中编辑整段对话', icon: '✏️', onClick: () => void runGuarded(async () => editInMarkDoc(ctx, all, 'conversation')) },
      ]
      ui.showLauncherMenu(items, `${quickTitle} · ${users} 条用户 / ${assistants} 条 AI`)
    })
  })

  const lastAssistant = (): ChatMessage | null => {
    for (let i = messageCache.length - 1; i >= 0; i--) {
      if (messageCache[i].role === 'assistant') return messageCache[i]
    }
    return null
  }

  const exportLast = async (target: ExportTarget) => {
    refreshTitle()
    const msg = lastAssistant()
    if (!msg) {
      void ui.showError(
        userMessageOf(new MarkDocExtError('MD-EXT-002', `platform=${adapter.id} last-answer`)),
        await buildDiagnostics(adapter, 'export-last-empty', { errorCode: 'MD-EXT-002' }),
      )
      return { ok: false as const }
    }
    return runGuarded(() => exportSingleAnswer(ctx, msg, target))
  }

  const exportWhole = async (target: ExportTarget, style: ConversationStyle) => {
    refreshTitle()
    return runGuarded(async () => {
      const all = await adapter.getMessages()
      if (all.length === 0) throw new MarkDocExtError('MD-EXT-002', `platform=${adapter.id} whole`)
      return exportConversation(ctx, all, target, style)
    })
  }

  // ── 多选模式 ──────────────────────────────────────────────────────────────
  const enterSelection = async () => {
    refreshTitle()
    const all = await adapter.getMessages()
    if (all.length === 0) {
      void ui.showError(
        '当前页面没有可导出的对话消息。若页面确实有消息，网站结构可能已更新。',
        await buildDiagnostics(adapter, 'selection-empty', { errorCode: 'MD-EXT-002' }),
      )
      return
    }
    const elements = all.map((m) => m.element).filter((el): el is HTMLElement => !!el)
    const byElement = new Map(elements.map((el, i) => [el, all[i]]))

    ui.enterSelectionMode(elements, new Set(), {
      onToggle: () => { /* 状态在 UI 内维护 */ },
      onChange: (selected) => {
        ui.updateSelectionCount(selected.length, elements.length)
      },
    })

    const selectedMessages = (): ChatMessage[] =>
      ui.getSelectedInOrder().map((el) => byElement.get(el)).filter((m): m is ChatMessage => !!m)

    ui.showSelectionBar(
      { count: 0, total: elements.length },
      {
        onSelectAll: () => {
          for (const el of elements) ui.selectMessage?.(el, true)
        },
        onSelectNone: () => {
          for (const el of elements) ui.selectMessage?.(el, false)
        },
        onSelectUsers: () => {
          for (const el of elements) ui.selectMessage?.(el, byElement.get(el)?.role === 'user')
        },
        onSelectAssistants: () => {
          for (const el of elements) ui.selectMessage?.(el, byElement.get(el)?.role === 'assistant')
        },
        onInvert: () => {
          for (const el of elements) {
            const cur = ui.isMessageSelected?.(el) ?? false
            ui.selectMessage?.(el, !cur)
          }
        },
        onExportWord: () => void finishSelection('docx'),
        onExportPdf: () => void finishSelection('pdf'),
        onEditInMarkDoc: () => void finishSelection('edit'),
        onExit: () => ui.exitSelectionMode(),
      },
    )

    const finishSelection = async (target: ExportTarget | 'edit') => {
      const selected = selectedMessages()
      if (selected.length === 0) {
        ui.toast('请先勾选至少一条消息')
        return
      }
      ui.exitSelectionMode()
      if (target === 'edit') {
        await runGuarded(() => editInMarkDoc(ctx, selected, 'selection'))
      } else {
        await runGuarded(() => exportSelection(ctx, selected, target))
      }
    }
  }

  // ── 响应 popup / background ───────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((request: ContentActionRequest, _sender, sendResponse) => {
    switch (request?.type) {
      case 'MARKDOC_PING':
        sendResponse({ pong: true })
        return false
      case 'MARKDOC_GET_STATE': {
        void (async () => {
          refreshTitle()
          let regression = false
          let health: AdapterHealth | null = null
          let counts = { user: 0, assistant: 0, total: messageCache.length }
          try {
            health = await computeHealth()
            if (health) {
              counts = {
                user: health.userMessages,
                assistant: health.assistantMessages,
                total: health.userMessages + health.assistantMessages,
              }
            } else {
              const all = await adapter.getMessages()
              counts = {
                user: all.filter((m) => m.role === 'user').length,
                assistant: all.filter((m) => m.role === 'assistant').length,
                total: all.length,
              }
            }
            regression = await checkRegression(health)
          } catch { /* 用缓存计数兜底 */ }
          const response: ContentStateResponse = {
            supported: true,
            adapterId: adapter.id,
            platformName: adapter.name,
            maturity: adapter.maturity,
            title: ctx.conversationTitle,
            userCount: counts.user,
            assistantCount: counts.assistant,
            generating: !!adapter.isGenerating?.(),
            extensionVersion: EXT_VERSION,
            adapterVersion: adapterVersionOf(adapter.id),
            health: health ?? undefined,
            regression,
          }
          sendResponse(response)
        })()
        return true // async sendResponse
      }
      case 'MARKDOC_GET_DIAGNOSTICS': {
        void (async () => {
          try {
            const diag = await buildDiagnostics(adapter, 'popup-request')
            sendResponse({ diagnostics: diag })
          } catch (err) {
            sendResponse({ diagnostics: `diagnostics-failed: ${String(err)}` })
          }
        })()
        return true
      }
      case 'MARKDOC_EXPORT_LAST':
        void exportLast(request.target).catch((err) => console.error('[MarkDoc] export-last failed', err))
        sendResponse({ started: true })
        return false
      case 'MARKDOC_OPEN_SELECTION':
        void enterSelection()
        sendResponse({ started: true })
        return false
      case 'MARKDOC_EXPORT_CONVERSATION':
        void exportWhole(request.target, request.style)
        sendResponse({ started: true })
        return false
      default:
        return false
    }
  })

  window.addEventListener('pagehide', () => {
    unobserve?.()
    clearInterval(urlTimer)
  })

  // E2E 测试钩子（仅当 URL 带 markdoc-e2e 参数时启用；生产页面不可见）：
  // content script 运行在隔离世界，页面主世界看不到 window 上的钩子，
  // 因此用 window postMessage 桥接驱动导出动作。
  if (location.search.includes('markdoc-e2e=1')) {
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return
      const data = event.data as { source?: string; id?: number; action?: string; args?: unknown[] } | null
      if (!data || data.source !== 'markdoc-e2e') return
      const args = (data.args ?? []) as any[]
      void (async () => {
        let result: unknown = null
        try {
          switch (data.action) {
            case 'ping':
              result = { ready: true }
              break
            case 'state':
              result = {
                supported: true,
                platform: adapter.name,
                title: ctx.conversationTitle,
                cached: messageCache.length,
                adapterVersion: adapter.version,
              }
              break
            case 'health':
              result = await computeHealth()
              break
            case 'exportLast':
              result = await exportLast(args[0] as ExportTarget)
              break
            case 'exportConversation':
              result = await exportWhole(args[0] as ExportTarget, args[1] as ConversationStyle)
              break
            case 'openSelection':
              result = await enterSelection()
              break
            case 'editInMarkDoc':
              result = await editInMarkDoc(ctx, messageCache, (args[0] as 'answer' | 'conversation') ?? 'conversation')
              break
            default:
              result = { error: `unknown action: ${data.action}` }
          }
        } catch (err) {
          result = {
            error: err instanceof Error ? err.message : String(err),
            code: codeOf(err) ?? undefined,
          }
        }
        window.postMessage({ source: 'markdoc-ext-e2e', id: data.id, result }, location.origin)
      })()
    })
    window.postMessage({ source: 'markdoc-ext-e2e', ready: true }, location.origin)
  }
}
