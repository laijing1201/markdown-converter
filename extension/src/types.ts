/**
 * MarkDoc 浏览器扩展 —— 共享类型定义。
 *
 * 架构总原则：
 *   AI 页面 → Platform Adapter（平台选择器只活在这里）
 *           → Normalized ChatMessage[]
 *           → chatDocument（统一导出文档）
 *           → MarkDoc 网页版核心（src/core/*，DOCX / PDF Renderer）
 *   exporter 永远不依赖具体 AI 平台的 DOM。
 */

import type { DocSettings } from '../../src/core/templates'

// ─── 平台消息模型 ─────────────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant' | 'system' | 'unknown'

export interface ChatImage {
  src: string
  alt?: string
}

export interface ChatAttachment {
  name: string
  kind: 'file' | 'image' | 'unknown'
}

export interface ChatMessage {
  id: string
  role: ChatRole
  /** 提取出的 Markdown（assistant 期望总是有；user 一般是纯文本） */
  markdown?: string
  /** 原始 HTML（保留给调试/高级用途，不参与默认导出） */
  html?: string
  /** 纯文本兜底 */
  text: string
  images?: ChatImage[]
  attachments?: ChatAttachment[]
  metadata?: {
    platform?: string
    timestamp?: string
    /** 本条消息中收集到的引用/来源链接（外部 URL） */
    sources?: Array<{ url: string; text: string }>
  }
  /** 对应的 DOM 元素（仅内容脚本内存中使用，绝不序列化） */
  element?: HTMLElement
}

// ─── Adapter 接口 ─────────────────────────────────────────────────────────────

export type AdapterMaturity = 'stable' | 'experimental'

export interface ChatPlatformAdapter {
  id: string
  name: string
  maturity: AdapterMaturity
  /** Adapter 版本（selector/提取逻辑改版时递增；诊断信息携带） */
  readonly version: number

  /** 当前 hostname / DOM 是否匹配本平台 */
  detect(): boolean

  /** 对话标题（可能为空串；由调用方兜底） */
  getConversationTitle(): string

  /** 提取全部消息（保持对话顺序） */
  getMessages(): Promise<ChatMessage[]>

  /** 从一个消息容器元素提取（可能是单条或一组问答） */
  getMessageFromElement(element: HTMLElement): Promise<ChatMessage[]>

  /** 观察新增消息（SPA / 流式输出），返回取消函数 */
  observeNewMessages?(callback: (message: ChatMessage, element: HTMLElement) => void): () => void

  /** 当前是否有回答正在生成（流式输出中） */
  isGenerating?(): boolean

  /** 消息根元素选择器（UI 注入与多选模式使用），平台选择器集中在此 */
  getMessageElements(): HTMLElement[]
}

export interface AdapterSelectorReport {
  adapter: string
  hits: Record<string, number>
}

// ─── 导出任务（content script → exporter 页）────────────────────────────────

export type ExportTarget = 'docx' | 'pdf'
export type ChatExportMode = 'answer' | 'qa' | 'selection' | 'conversation'
export type ConversationStyle = 'dialogue' | 'article'

export interface ChatDocOptions {
  mode: ChatExportMode
  /** conversation 模式的文档风格：对话模式 / 内容整理模式 */
  conversationStyle: ConversationStyle
  /** 是否包含用户消息（对话模式） */
  includeUserMessages: boolean
  /** 是否附加来源链接列表 */
  includeSources: boolean
  conversationTitle: string
  platformName: string
}

export interface ChatDocStats {
  messages: number
  userMessages: number
  assistantMessages: number
  formulas: number
  tables: number
  images: number
  codeBlocks: number
  mermaidBlocks: number
  links: number
}

export interface ExportJob {
  id: string
  target: ExportTarget
  markdown: string
  /** 文件名主体（不含扩展名），如 ChatGPT-反向传播原理 */
  documentTitle: string
  settings: DocSettings
  platform: string
  sourceUrl: string
  mode: ChatExportMode
  stats: ChatDocStats
  createdAt: number
}

// ─── 「在 MarkDoc 中编辑」临时导入 ───────────────────────────────────────────

export interface ExtImportPayload {
  id: string
  markdown: string
  documentTitle: string
  platform: string
  sourceUrl: string
  createdAt: number
}

// ─── 扩展快速设置 ─────────────────────────────────────────────────────────────

export interface ExtQuickSettings {
  /** 默认导出格式（快捷键 / popup 单键导出） */
  defaultTarget: ExportTarget
  templateId: string
  includeToc: boolean
  includePageNumbers: boolean
  includeUserMessages: boolean
  includeSources: boolean
  /** 整段对话的文档风格 */
  conversationStyle: ConversationStyle
  /** MarkDoc 网页版地址（「在 MarkDoc 中编辑」桥接） */
  markdocUrl: string
}

export const DEFAULT_QUICK_SETTINGS: ExtQuickSettings = {
  defaultTarget: 'docx',
  templateId: 'general',
  includeToc: false,
  includePageNumbers: true,
  includeUserMessages: true,
  includeSources: true,
  conversationStyle: 'dialogue',
  markdocUrl: 'https://laijing1201.github.io/markdown-converter',
}

// ─── Content script ↔ background / popup 消息协议 ────────────────────────────

export interface ContentStateResponse {
  supported: boolean
  adapterId: string
  platformName: string
  maturity: AdapterMaturity | null
  title: string
  userCount: number
  assistantCount: number
  generating: boolean
  /** 扩展版本（popup 展示 + 诊断） */
  extensionVersion: string
  /** Adapter 版本 */
  adapterVersion: number
  /** Adapter 体检结果（P4C 第三节） */
  health?: import('./health').AdapterHealth
  /** 疑似 DOM 改版（上次能识别、现在 0 消息） */
  regression?: boolean
  error?: string
}

export type ContentActionRequest =
  | { type: 'MARKDOC_GET_STATE' }
  | { type: 'MARKDOC_EXPORT_LAST'; target: ExportTarget }
  | { type: 'MARKDOC_OPEN_SELECTION' }
  | { type: 'MARKDOC_EXPORT_CONVERSATION'; target: ExportTarget; style: ConversationStyle }
  | { type: 'MARKDOC_PING' }
  | { type: 'MARKDOC_GET_DIAGNOSTICS' }

// ─── 平台注册表（manifest matches 与之保持一致）──────────────────────────────

export const SUPPORTED_HOSTS = [
  'chatgpt.com',
  'chat.openai.com',
  'chat.deepseek.com',
  'claude.ai',
  'gemini.google.com',
  'kimi.com',
  'www.kimi.com',
] as const

export const MARKDOC_WEB_HOST_DEFAULT = 'laijing1201.github.io'
