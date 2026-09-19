/**
 * Normalized ChatMessage[] → 统一导出文档（Markdown）。
 *
 * 支持四种导出形态（对应规范 八/九/十/十一 节）：
 *   - answer:      单条 AI 回答
 *   - qa:          一组问答（问题 → 回答）
 *   - selection:   多选消息（保持对话顺序，带角色标签）
 *   - conversation: 整段对话（A 对话模式 / B 内容整理模式）
 *
 * 产物仍是「一份正常文档」，不是聊天截图：用户消息与 AI 回复以
 * 标题层级组织，公式/代码/表格原样进入 MarkDoc 渲染管线。
 */

import type { ChatDocOptions, ChatDocStats, ChatMessage } from '../types'
import type { ExtractResult } from './domToMarkdown'

/** 提取结果统计的累加器 */
export interface AccumulatedStats extends ChatDocStats {
  degradedFormulas: number
}

export function emptyStats(): AccumulatedStats {
  return {
    messages: 0,
    userMessages: 0,
    assistantMessages: 0,
    formulas: 0,
    tables: 0,
    images: 0,
    codeBlocks: 0,
    mermaidBlocks: 0,
    links: 0,
    degradedFormulas: 0,
  }
}

export function accumulateStats(stats: AccumulatedStats, extract: ExtractResult, msg: ChatMessage): void {
  stats.messages++
  if (msg.role === 'user') stats.userMessages++
  if (msg.role === 'assistant') stats.assistantMessages++
  stats.formulas += extract.formulas
  stats.degradedFormulas += extract.formulasDegraded
  stats.tables += extract.tables
  stats.images += extract.images.length
  stats.codeBlocks += extract.codeBlocks
  stats.mermaidBlocks += extract.mermaidBlocks
  stats.links += extract.links.length
}

/** 把内容里的标题整体降级 n 级（嵌入角色标题下时避免层级冲突） */
export function demoteHeadings(markdown: string, levels: number): string {
  if (levels <= 0) return markdown
  return markdown.replace(/^(#{1,6})(\s)/gm, (_m, hashes: string, space: string) => {
    return '#'.repeat(Math.min(6, hashes.length + levels)) + space
  })
}

/** 收集消息中的外部来源链接（去重、过滤平台内部链接） */
export function collectSources(messages: ChatMessage[]): Array<{ url: string; text: string }> {
  const seen = new Set<string>()
  const out: Array<{ url: string; text: string }> = []
  for (const msg of messages) {
    for (const link of msg.metadata?.sources ?? []) {
      if (!/^https?:/i.test(link.url)) continue
      if (seen.has(link.url)) continue
      seen.add(link.url)
      out.push(link)
    }
  }
  return out
}

/** 生成「来源」附录（规范第十九节：允许降级为列表，但不能丢明显存在的来源链接） */
function sourcesSection(messages: ChatMessage[]): string {
  const sources = collectSources(messages)
  if (sources.length === 0) return ''
  const lines = sources.slice(0, 50).map((s, i) => `${i + 1}. [${s.text || s.url}](${s.url})`)
  return `## 来源\n\n${lines.join('\n')}`
}

/** 单条消息体（含用户/助手内容） */
function messageBody(msg: ChatMessage): string {
  if (msg.role === 'user') return (msg.markdown || msg.text).trim()
  return (msg.markdown || msg.text).trim()
}

/**
 * 构建导出文档。
 * 返回 markdown 与统计；调用方负责文件名与渲染。
 */
export function buildChatDocument(
  messages: ChatMessage[],
  extracts: ExtractResult[],
  options: ChatDocOptions,
): { markdown: string; stats: AccumulatedStats } {
  const stats = emptyStats()
  messages.forEach((msg, i) => {
    if (extracts[i]) accumulateStats(stats, extracts[i], msg)
  })

  const parts: string[] = []
  const roleLabel = (msg: ChatMessage) => (msg.role === 'user' ? '用户' : msg.role === 'assistant' ? 'AI 助手' : '消息')

  switch (options.mode) {
    case 'answer': {
      const assistant = messages.find((m) => m.role === 'assistant') ?? messages[messages.length - 1]
      if (assistant) parts.push(messageBody(assistant))
      if (options.includeSources) {
        const src = sourcesSection(messages)
        if (src) parts.push(src)
      }
      break
    }

    case 'qa': {
      const user = messages.find((m) => m.role === 'user')
      const assistant = messages.find((m) => m.role === 'assistant')
      if (user) parts.push(`## 问题\n\n${messageBody(user)}`)
      if (assistant) parts.push(`## 回答\n\n${demoteHeadings(messageBody(assistant), 1)}`)
      if (options.includeSources) {
        const src = sourcesSection(messages)
        if (src) parts.push(src)
      }
      break
    }

    case 'selection': {
      // 保持原对话顺序；相邻同角色消息合并展示
      for (const msg of messages) {
        parts.push(`### ${roleLabel(msg)}\n\n${demoteHeadings(messageBody(msg), 2)}`)
      }
      if (options.includeSources) {
        const src = sourcesSection(messages)
        if (src) parts.push(src)
      }
      break
    }

    case 'conversation': {
      if (options.conversationStyle === 'article') {
        // 内容整理模式：去掉角色标签，主要保留 AI 内容，用标题层级组织
        const assistants = messages.filter((m) => m.role === 'assistant')
        const bodies = assistants
          .map((m) => messageBody(m))
          .filter(Boolean)
          .map((body) => {
            // 若正文自身使用 h1，整体降一级避免与文档标题冲突
            return /^#\s/m.test(body) ? demoteHeadings(body, 1) : body
          })
        if (bodies.length > 0) parts.push(bodies.join('\n\n'))
      } else {
        // 对话模式：用户 / AI 交替，带角色标题
        for (const msg of messages) {
          if (msg.role === 'user' && !options.includeUserMessages) continue
          parts.push(`### ${roleLabel(msg)}\n\n${demoteHeadings(messageBody(msg), 2)}`)
        }
      }
      if (options.includeSources) {
        const src = sourcesSection(messages)
        if (src) parts.push(src)
      }
      break
    }
  }

  return { markdown: parts.filter((p) => p.trim()).join('\n\n'), stats }
}
