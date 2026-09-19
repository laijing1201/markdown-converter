/**
 * Adapter Health 系统（P4C 第三节 / 第八节）：
 *
 *   - computeAdapterHealth：对当前页面做结构化体检（识别 / 容器 / 消息计数 /
 *     公式 / 表格 / 代码 / selector 命中层级 / 置信度 / 警告）。
 *   - Popup 与 content script 据此显示「页面识别正常」或「⚠ 页面结构可能已更新」，
 *     而不是等用户点击导出后才发现什么都没有。
 *   - DOM 改版检测：对比 storage 中上次健康快照（按 hostname），消息数从 >0 跌到 0
 *     判定为疑似改版 → MD-EXT-010。
 *
 * 本模块不读取任何聊天正文，只产生计数与结构结论。
 */

import type { ChatPlatformAdapter, ChatMessage } from './types'

export type ExtractionConfidence = 'high' | 'medium' | 'low'

/** 结构性 selector 组：这些组 miss 才构成改版嫌疑（P4C 第八节） */
const STRUCTURAL_GROUPS = new Set(['turn', 'assistantMarkdown', 'messageRoot'])

export interface AdapterHealth {
  platform: string
  adapterId: string
  adapterVersion: number
  detected: boolean
  conversationFound: boolean
  messageContainerFound: boolean
  userMessages: number
  assistantMessages: number
  mathDetected: number
  tablesDetected: number
  codeBlocksDetected: number
  imagesDetected: number
  generating: boolean
  extractionConfidence: ExtractionConfidence
  /** 结构性警告（不含内容），如 primary-selector-miss:assistantMarkdown */
  warnings: string[]
}

/** selector 组报告：每组命中到哪一级（primary / fallback / miss） */
export type SelectorLevel = 'primary' | 'fallback' | 'miss'

export interface SelectorGroupReport {
  group: string
  level: SelectorLevel
  /** 实际命中的选择器（诊断用；只是 CSS 选择器字符串，无内容） */
  selector: string | null
}

// ─── selector 命中层级判定 ─────────────────────────────────────────────────────

/**
 * adapters 暴露的组元数据：group → 选择器链（index 0 = primary）。
 * hits 为 adapter 记录的 selector → 命中次数。
 */
export function groupLevel(selectors: string[], hits: Map<string, number>): SelectorGroupReport {
  for (let i = 0; i < selectors.length; i++) {
    const count = hits.get(selectors[i]) ?? 0
    if (count > 0) {
      return { group: '', level: i === 0 ? 'primary' : 'fallback', selector: selectors[i] }
    }
  }
  return { group: '', level: 'miss', selector: null }
}

export function reportGroups(
  groups: Record<string, string[]>,
  hits: Map<string, number>,
): Record<string, SelectorGroupReport> {
  const out: Record<string, SelectorGroupReport> = {}
  for (const [group, selectors] of Object.entries(groups)) {
    const r = groupLevel(selectors, hits)
    r.group = group
    out[group] = r
  }
  return out
}

// ─── Markdown 结构计数（与导出统计同一口径，不取正文）──────────────────────────

export interface MarkdownFeatureCounts {
  math: number
  tables: number
  codeBlocks: number
  images: number
}

export function countMarkdownFeatures(markdown: string): MarkdownFeatureCounts {
  const math = (markdown.match(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]+\$/g) || []).length
  const tableRows = (markdown.match(/^\|.+\|\s*$/gm) || []).length
  const tables = tableRows >= 2 ? 1 : 0
  const codeBlocks = (markdown.match(/^```/gm) || []).length / 2
  const images = (markdown.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length
  return { math, tables, codeBlocks: Math.floor(codeBlocks), images }
}

function countsOfMessages(messages: ChatMessage[]): MarkdownFeatureCounts {
  const acc: MarkdownFeatureCounts = { math: 0, tables: 0, codeBlocks: 0, images: 0 }
  for (const msg of messages) {
    const c = countMarkdownFeatures(msg.markdown || msg.text || '')
    acc.math += c.math
    acc.tables += c.tables
    acc.codeBlocks += c.codeBlocks
    acc.images += c.images
  }
  return acc
}

// ─── 健康检查主入口 ───────────────────────────────────────────────────────────

/** Adapter 需暴露的 selector 组元数据（选择器链仍只在 adapter 内部定义） */
export interface HealthCapableAdapter extends ChatPlatformAdapter {
  getSelectorGroups(): Record<string, string[]>
  getSelectorHits(): Map<string, number>
}

export async function computeAdapterHealth(adapter: HealthCapableAdapter): Promise<AdapterHealth> {
  const warnings: string[] = []
  let detected = false
  try {
    detected = adapter.detect()
  } catch {
    detected = false
  }
  if (!detected) warnings.push('adapter-not-detected')

  // 顺序注意：getMessages 内部会重置 selector 命中记录，
  // title/elements 的命中统计必须在它之后采集
  let messages: ChatMessage[] = []
  try {
    messages = await adapter.getMessages()
  } catch {
    warnings.push('message-extraction-error')
  }

  let title = ''
  try {
    title = adapter.getConversationTitle()
  } catch { /* 标题失败不算致命 */ }

  let elements: HTMLElement[] = []
  try {
    elements = adapter.getMessageElements()
  } catch {
    warnings.push('message-elements-error')
  }

  const userMessages = messages.filter((m) => m.role === 'user').length
  const assistantMessages = messages.filter((m) => m.role === 'assistant').length

  // selector 命中层级：主选择器失效 → 降级警告
  let report: Record<string, SelectorGroupReport> = {}
  try {
    report = reportGroups(adapter.getSelectorGroups(), adapter.getSelectorHits())
  } catch { /* 报告失败不影响健康结论 */ }
  for (const r of Object.values(report)) {
    if (r.level === 'fallback') warnings.push(`selector-fallback:${r.group}`)
    // miss 只对「结构性组」报警；userMessage/title 组可能本来就无内容可命中
    if (r.level === 'miss' && STRUCTURAL_GROUPS.has(r.group)) warnings.push(`selector-miss:${r.group}`)
  }

  const counts = countsOfMessages(messages)

  const conversationFound = !!title || elements.length > 0
  const messageContainerFound = elements.length > 0

  // 置信度：
  //   low    —— 页面识别但没有任何消息容器 / 消息
  //   medium —— 有消息，但存在 fallback / miss
  //   high   —— 主选择器全部命中且有消息
  let extractionConfidence: ExtractionConfidence
  if (!messageContainerFound || (userMessages + assistantMessages === 0)) {
    extractionConfidence = 'low'
    if (conversationFound || detected) warnings.push('no-messages-found')
  } else if (
    Object.values(report).some((r) => r.level !== 'primary') ||
    messages.some((m) => !m.markdown && m.role === 'assistant')
  ) {
    extractionConfidence = 'medium'
  } else {
    extractionConfidence = 'high'
  }

  let generating = false
  try {
    generating = !!adapter.isGenerating?.()
  } catch { /* ignore */ }

  return {
    platform: adapter.name,
    adapterId: adapter.id,
    adapterVersion: adapter.version ?? 0,
    detected,
    conversationFound,
    messageContainerFound,
    userMessages,
    assistantMessages,
    mathDetected: counts.math,
    tablesDetected: counts.tables,
    codeBlocksDetected: counts.codeBlocks,
    imagesDetected: counts.images,
    generating,
    extractionConfidence,
    warnings: Array.from(new Set(warnings)),
  }
}

// ─── DOM 改版检测（第八节）────────────────────────────────────────────────────

export interface HealthSnapshot {
  /** 上次识别到的消息总数 */
  messageCount: number
  /** 上次成功识别时间（epoch ms） */
  at: number
}

/**
 * 判定是否疑似 DOM 改版：
 *   - 上次快照里消息数 ≥ minPrevious（说明这里曾经能正常识别）；
 *   - 本次 health 为 low（0 消息）且页面仍处于对话路由（有标题或 URL 含对话特征）。
 * 满足 → 用户必须看到「网站结构可能已更新」，不能静默失败。
 */
export function isDomRegression(
  health: AdapterHealth,
  snapshot: HealthSnapshot | null,
  options?: { minPrevious?: number },
): boolean {
  const minPrevious = options?.minPrevious ?? 5
  if (!health.detected) return false
  if (!snapshot || snapshot.messageCount < minPrevious) return false
  const nowZero = health.userMessages + health.assistantMessages === 0
  const onConversation = health.conversationFound
  return nowZero && onConversation
}

/** 快照更新策略：只有成功识别到消息时才记录（避免把改版状态当成基线） */
export function nextSnapshot(health: AdapterHealth, current: HealthSnapshot | null): HealthSnapshot | null {
  const count = health.userMessages + health.assistantMessages
  if (count > 0) return { messageCount: count, at: Date.now() }
  return current
}
