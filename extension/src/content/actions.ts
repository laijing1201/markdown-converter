/**
 * 导出动作编排（content script 侧）：
 *   选择内容（单条/问答/多选/整段）→ 提取 → buildChatDocument
 *   → stage 导出任务 → 通知 background 打开导出引擎页
 *
 * 「在 MarkDoc 中编辑」走临时导入区（30 分钟 TTL）。
 */

import type {
  ChatDocOptions,
  ChatExportMode,
  ChatMessage,
  ConversationStyle,
  ExportTarget,
} from '../types'
import { buildChatDocument, type AccumulatedStats } from '../extraction/chatDocument'
import type { ExtractResult } from '../extraction/domToMarkdown'
import { extractFormulas } from '../../../src/core/mathSyntax'
import { seedSettingsFromTemplate } from '../../../src/core/templates'
import { loadQuickSettings, stageExportJob, stageImport, recordExportResult } from '../storage'
import { MarkDocExtError } from '../errors'
import type { ChatPlatformAdapter } from '../types'

export interface ActionContext {
  adapter: ChatPlatformAdapter
  platformName: string
  conversationTitle: string
}

/** 由扩展快速设置合成完整 DocSettings（与网页版 DocSettings 同构） */
async function settingsFor(): Promise<{ settings: ReturnType<typeof seedSettingsFromTemplate>; quick: Awaited<ReturnType<typeof loadQuickSettings>> }> {
  const quick = await loadQuickSettings()
  const base = seedSettingsFromTemplate('general')
  const settings = {
    ...base,
    template: quick.templateId,
    includeToc: quick.includeToc,
    includePageNumbers: quick.includePageNumbers,
  }
  return { settings, quick }
}

/** 文件名主体：平台-对话标题（规范第二十六节，交由网页版 filename helper 兜底净化） */
function documentTitleFor(ctx: ActionContext): string {
  const title = ctx.conversationTitle || ''
  const platform = ctx.platformName
  if (!title) return platform
  if (title.toLowerCase().includes(platform.toLowerCase())) return title
  return `${platform}-${title}`
}

async function openExporter(jobId: string): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'MARKDOC_OPEN_EXPORTER', jobId })
}

async function openMarkDocEditor(importId: string, markdocUrl: string): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'MARKDOC_OPEN_EDITOR', importId, markdocUrl })
}

/** 提取并构建导出任务（消息 DOM → Markdown → 统一文档） */
async function stageExport(
  ctx: ActionContext,
  messages: ChatMessage[],
  extracts: ExtractResult[],
  mode: ChatExportMode,
  target: ExportTarget,
  extra?: { conversationStyle?: ConversationStyle; includeUserMessages?: boolean },
): Promise<{ ok: boolean; stats?: AccumulatedStats; reason?: string }> {
  if (messages.length === 0) return { ok: false, reason: '未能提取到消息内容' }
  const quick = await loadQuickSettings()
  const { settings } = await settingsFor()
  const options: ChatDocOptions = {
    mode,
    conversationStyle: extra?.conversationStyle ?? quick.conversationStyle,
    includeUserMessages: extra?.includeUserMessages ?? quick.includeUserMessages,
    includeSources: quick.includeSources,
    conversationTitle: ctx.conversationTitle,
    platformName: ctx.platformName,
  }
  const { markdown, stats } = buildChatDocument(messages, extracts, options)
  if (!markdown.trim()) {
    throw new MarkDocExtError('MD-EXT-003', `mode=${mode} messages=${messages.length} empty-markdown`)
  }

  const jobId = await stageExportJob({
    id: '',
    target,
    markdown,
    documentTitle: documentTitleFor(ctx),
    settings,
    platform: ctx.platformName,
    sourceUrl: location.href,
    mode,
    stats: {
      messages: stats.messages,
      userMessages: stats.userMessages,
      assistantMessages: stats.assistantMessages,
      formulas: stats.formulas,
      tables: stats.tables,
      images: stats.images,
      codeBlocks: stats.codeBlocks,
      mermaidBlocks: stats.mermaidBlocks,
      links: stats.links,
    },
    createdAt: Date.now(),
  }).catch((err) => {
    throw new MarkDocExtError('MD-EXT-009', String(err))
  })
  await openExporter(jobId).catch((err) => {
    throw new MarkDocExtError('MD-EXT-008', `open-exporter: ${String(err)}`)
  })
  await recordExportResult({ target, ok: true, at: Date.now() })
  return { ok: true, stats }
}

/** 提取单条消息（返回 extract 结果供统计） */
async function extractMessage(ctx: ActionContext, msg: ChatMessage): Promise<{ msg: ChatMessage; extract: ExtractResult } | null> {
  if (!msg.element) return null
  const fromElement = await ctx.adapter.getMessageFromElement(msg.element)
  const fresh = fromElement.find((m) => m.role === msg.role) ?? fromElement[0]
  if (!fresh) return null
  // 重新提取时同步拿 extract 统计：用 markdown 长度差异判断不现实，
  // 因此 adapter 在提取时已带 metadata.sources；这里直接构造空 extract 由 markdown 统计替代
  return { msg: fresh, extract: extractOf(fresh) }
}

/** 从消息的 markdown 统计（复用网页版核心的公式提取，保证与导出侧一致） */
function extractOf(msg: ChatMessage): ExtractResult {
  const markdown = msg.markdown || ''
  const formulas = extractFormulas(markdown)
  const codeFences = (markdown.match(/^```/gm) || []).length
  return {
    markdown,
    formulas: formulas.length,
    formulasDegraded: 0,
    codeBlocks: codeFences / 2,
    mermaidBlocks: (markdown.match(/^```mermaid/gm) || []).length,
    tables: (markdown.match(/^\|.+\|\s*$/gm) || []).length > 0 ? 1 : 0,
    images: (markdown.match(/!\[[^\]]*\]\(([^)]+)\)/g) || []).map((m) => ({ src: m, alt: '' })),
    links: (markdown.match(/(?<!!)\[[^\]]+\]\((https?:[^)]+)\)/g) || []).map((m) => {
      const url = m.slice(m.indexOf('(') + 1, -1)
      return { url, text: '' }
    }),
  }
}

// ─── 对外动作 ────────────────────────────────────────────────────────────────

/** 导出单条回答 */
export async function exportSingleAnswer(
  ctx: ActionContext,
  msg: ChatMessage,
  target: ExportTarget,
): Promise<{ ok: boolean; reason?: string }> {
  const extracted = await extractMessage(ctx, msg)
  if (!extracted) throw new MarkDocExtError('MD-EXT-003', 'answer: element/extract missing')
  return stageExport(ctx, [extracted.msg], [extracted.extract], 'answer', target)
}

/** 导出一组问答（这条回答 + 它前面的用户问题） */
export async function exportQa(
  ctx: ActionContext,
  msg: ChatMessage,
  target: ExportTarget,
  userMessage: ChatMessage | null,
): Promise<{ ok: boolean; reason?: string }> {
  const extracted = await extractMessage(ctx, msg)
  if (!extracted) throw new MarkDocExtError('MD-EXT-003', 'qa: element/extract missing')
  const messages: ChatMessage[] = []
  const extracts: ExtractResult[] = []
  if (userMessage) {
    messages.push(userMessage)
    extracts.push(extractOf(userMessage))
  }
  messages.push(extracted.msg)
  extracts.push(extracted.extract)
  return stageExport(ctx, messages, extracts, 'qa', target)
}

/** 导出多选消息 */
export async function exportSelection(
  ctx: ActionContext,
  messages: ChatMessage[],
  target: ExportTarget,
): Promise<{ ok: boolean; reason?: string }> {
  const extracts = messages.map((m) => extractOf(m))
  return stageExport(ctx, messages, extracts, 'selection', target)
}

/** 导出整段对话 */
export async function exportConversation(
  ctx: ActionContext,
  messages: ChatMessage[],
  target: ExportTarget,
  style: ConversationStyle,
): Promise<{ ok: boolean; reason?: string }> {
  const extracts = messages.map((m) => extractOf(m))
  return stageExport(ctx, messages, extracts, 'conversation', target, {
    conversationStyle: style,
  })
}

/** 在 MarkDoc 网页版中继续编辑 */
export async function editInMarkDoc(
  ctx: ActionContext,
  messages: ChatMessage[],
  mode: ChatExportMode = 'answer',
  style?: ConversationStyle,
): Promise<{ ok: boolean; reason?: string }> {
  const quick = await loadQuickSettings()
  const extracts = messages.map((m) => extractOf(m))
  const options: ChatDocOptions = {
    mode,
    conversationStyle: style ?? quick.conversationStyle,
    includeUserMessages: quick.includeUserMessages,
    includeSources: quick.includeSources,
    conversationTitle: ctx.conversationTitle,
    platformName: ctx.platformName,
  }
  const { markdown } = buildChatDocument(messages, extracts, options)
  if (!markdown.trim()) throw new MarkDocExtError('MD-EXT-003', `mode=${mode} empty-markdown (edit)`)
  const importId = await stageImport({
    markdown,
    documentTitle: documentTitleFor(ctx),
    platform: ctx.platformName,
    sourceUrl: location.href,
  })
  await openMarkDocEditor(importId, quick.markdocUrl).catch((err) => {
    throw new MarkDocExtError('MD-EXT-008', `open-editor: ${String(err)}`)
  })
  return { ok: true }
}

export { settingsFor }
