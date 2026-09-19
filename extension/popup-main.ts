/**
 * Popup 逻辑：平台状态 → 快速导出 → 快速设置。
 * 不塞入高级设置（规范二十一节）：复杂排版去网页版。
 */

import type { ContentStateResponse } from './src/types'
import { loadQuickSettings, saveQuickSettings } from './src/storage'
import { TEMPLATE_CONFIGS, TEMPLATE_ORDER, type TemplateId } from '../src/core/templates'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab ?? null
}

function sendToTab<T>(tabId: number, message: unknown): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (res: T) => {
        void chrome.runtime.lastError // 未注入时触发，忽略
        resolve(chrome.runtime.lastError ? null : (res ?? null))
      })
    } catch {
      resolve(null)
    }
  })
}

const MATURITY_LABEL = { stable: '✅ 已支持', experimental: '🧪 实验性' } as const

/** Popup 状态机（P4C 第二十二节）：
 *   支持+正常 → ✅ / 疑似改版 → ⚠ 卡片 / 无对话 → 提示 / 不支持 → 引导 / 生成中 → 提示 */
function showCard(name: 'state' | 'degraded' | 'unsupported' | 'none'): void {
  $('state-card').classList.toggle('hidden', name !== 'state')
  $('degraded-card').classList.toggle('hidden', name !== 'degraded')
  $('unsupported-card').classList.toggle('hidden', name !== 'unsupported')
  // 主操作在正常与降级（仍要尝试）时都可用
  $('main-card').classList.toggle('hidden', name === 'unsupported')
}

async function copyDiagnostics(tabId: number): Promise<void> {
  const res = await sendToTab<{ diagnostics: string }>(tabId, { type: 'MARKDOC_GET_DIAGNOSTICS' })
  const text = res?.diagnostics ?? 'diagnostics unavailable'
  try {
    await navigator.clipboard.writeText(text)
    $('degraded-msg').textContent = '诊断信息已复制到剪贴板（不含聊天内容），欢迎粘贴到 issue 反馈。'
  } catch {
    // 剪贴板失败兜底：弹层选择复制
    window.prompt('复制诊断信息（不含聊天内容）', text)
  }
}

async function refreshState(): Promise<void> {
  const tab = await getActiveTab()
  let state: ContentStateResponse | null = null
  if (tab?.id) state = await sendToTab<ContentStateResponse>(tab.id, { type: 'MARKDOC_GET_STATE' })

  const supported = !!state?.supported
  $('ext-version').textContent = `v${state?.extensionVersion ?? ''}`

  if (!supported || !state) {
    showCard('unsupported')
    // 主流 AI 域名但 content script 未注入（刚安装/待刷新）
    const host = tab?.url ? safeHost(tab.url) : ''
    const knownHost = /^(chat\.openai\.com|chatgpt\.com|chat\.deepseek\.com|claude\.ai|gemini\.google\.com|(www\.)?kimi\.com)$/.test(host)
    $('unsupported-msg').textContent = knownHost
      ? 'MarkDoc 尚未在此页面加载。'
      : '当前网站暂不支持直接导出。'
    $('unsupported-refresh-hint').classList.toggle('hidden', !knownHost)
    return
  }

  const health = state.health
  const total = (state.userCount ?? 0) + (state.assistantCount ?? 0)
  const regression = !!state.regression || health?.extractionConfidence === 'low' || (health?.warnings ?? []).includes('no-messages-found')

  $('platform-name').textContent = state.platformName
  const badge = $('platform-badge')
  badge.textContent = MATURITY_LABEL[state.maturity ?? 'stable']
  badge.classList.toggle('experimental', state.maturity === 'experimental')

  if (regression && !state.generating) {
    // 疑似 DOM 改版：显著警告 + 诊断复制（第八节）
    showCard('degraded')
    $('degraded-platform').textContent = `⚠ ${state.platformName} 页面结构可能已更新`
    $('degraded-msg').textContent = total > 0
      ? `识别到 ${total} 条消息，但部分结构未按预期命中。导出可能不完整，欢迎复制诊断信息反馈。`
      : 'MarkDoc 无法完整识别当前页面的对话内容，网站结构可能已经更新。可以复制诊断信息反馈（不含聊天内容），或仍要尝试导出。'
    const tabId = tab?.id
    $('btn-copy-diagnostics').onclick = () => tabId && void copyDiagnostics(tabId)
    $('btn-try-anyway').onclick = () => window.close()
    return
  }

  showCard('state')
  $('conversation-title').textContent = state.title ? `当前对话：《${state.title}》` : '未识别到对话标题'
  $('conversation-stats').textContent = total === 0
    ? '当前页面没有可导出的对话'
    : `检测到 ${state.userCount} 条用户消息 / ${state.assistantCount} 条 AI 消息`
  $('generating-tip').classList.toggle('hidden', !state.generating)
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

async function act(tabId: number | undefined, message: unknown): Promise<void> {
  if (!tabId) return
  await sendToTab(tabId, message)
  window.close()
}

async function initTemplateSelect(): Promise<void> {
  const select = $('template-select') as HTMLSelectElement
  const quick = await loadQuickSettings()
  // 系统 + 自定义模板（TemplateStorage 统一接口，当前实现为 chrome.storage.local）
  select.innerHTML = ''
  for (const id of TEMPLATE_ORDER) {
    const opt = document.createElement('option')
    opt.value = id
    opt.textContent = TEMPLATE_CONFIGS[id as TemplateId].name
    select.appendChild(opt)
  }
  const custom = (await chrome.storage.local.get('markdoc.ext.customTemplates.v1'))['markdoc.ext.customTemplates.v1'] as
    | Array<{ id: string; name: string }>
    | undefined
  for (const t of custom ?? []) {
    const opt = document.createElement('option')
    opt.value = t.id
    opt.textContent = `${t.name}（自定义）`
    select.appendChild(opt)
  }
  select.value = quick.templateId
  select.addEventListener('change', async () => {
    quick.templateId = select.value
    await saveQuickSettings(quick)
  })
}

async function initSettings(): Promise<void> {
  const quick = await loadQuickSettings()
  const bind = (id: string, key: keyof typeof quick, invert = false) => {
    const el = $(id) as HTMLInputElement
    el.checked = Boolean(quick[key])
    el.addEventListener('change', async () => {
      ;(quick as unknown as Record<string, unknown>)[key] = invert ? !el.checked : el.checked
      await saveQuickSettings(quick)
    })
  }
  bind('opt-user-messages', 'includeUserMessages')
  bind('opt-sources', 'includeSources')
  bind('opt-toc', 'includeToc')
  bind('opt-pagenum', 'includePageNumbers')

  const radios = document.querySelectorAll<HTMLInputElement>('input[name="default-target"]')
  radios.forEach((r) => {
    r.checked = r.value === quick.defaultTarget
    r.addEventListener('change', async () => {
      if (r.checked) {
        quick.defaultTarget = r.value as 'docx' | 'pdf'
        await saveQuickSettings(quick)
      }
    })
  })
}

async function main(): Promise<void> {
  await refreshState()
  await initTemplateSelect()
  await initSettings()

  const tab = await getActiveTab()
  const tabId = tab?.id

  // 不支持页面：打开 MarkDoc
  $('btn-open-markdoc').addEventListener('click', async () => {
    const quick = await loadQuickSettings()
    await chrome.tabs.create({ url: quick.markdocUrl })
    window.close()
  })

  // 扩展设置页（Options）
  $('link-options').addEventListener('click', (e) => {
    e.preventDefault()
    chrome.runtime.openOptionsPage()
  })

  if (!tabId) return

  // 主操作（送内容脚本执行；格式取默认设置）
  const quick = await loadQuickSettings()
  $('btn-export-last').addEventListener('click', () => void act(tabId, { type: 'MARKDOC_EXPORT_LAST', target: quick.defaultTarget }))
  $('btn-selection').addEventListener('click', () => void act(tabId, { type: 'MARKDOC_OPEN_SELECTION' }))
  $('btn-conv-dialogue').addEventListener('click', () => void act(tabId, { type: 'MARKDOC_EXPORT_CONVERSATION', target: quick.defaultTarget, style: 'dialogue' }))
  $('btn-conv-article').addEventListener('click', () => void act(tabId, { type: 'MARKDOC_EXPORT_CONVERSATION', target: quick.defaultTarget, style: 'article' }))

  // Word / PDF 明确按钮：导出整段对话（最常见批量诉求）
  $('btn-export-word').addEventListener('click', () => void act(tabId, { type: 'MARKDOC_EXPORT_CONVERSATION', target: 'docx', style: quick.conversationStyle }))
  $('btn-export-pdf').addEventListener('click', () => void act(tabId, { type: 'MARKDOC_EXPORT_CONVERSATION', target: 'pdf', style: quick.conversationStyle }))

  $('link-settings-url').addEventListener('click', (e) => {
    e.preventDefault()
    const url = window.prompt('MarkDoc 网页版地址（用于「在 MarkDoc 中编辑」）', quick.markdocUrl)
    if (url && /^https?:\/\//.test(url)) {
      quick.markdocUrl = url
      void saveQuickSettings(quick)
    }
  })
}

void main()
