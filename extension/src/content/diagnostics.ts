/**
 * 诊断信息构建（P4C 第九节）：
 *
 *   ✅ 允许包含：Web 核心版本 / 扩展版本 / manifest 版本 / 浏览器 / 平台 /
 *      hostname / adapter 版本 / selector 命中与失效层级 / 消息与要素计数 /
 *      最近导出目标与结果 / 错误代码 / stack hash / 时间戳。
 *   ⛔ 严禁包含：聊天正文、用户提问、AI 回答、公式内容、代码内容、
 *      图片内容、文件内容 —— 本模块只做结构计数，从不读取 textContent。
 */

import { APP_VERSION } from '../../../src/version'
import { EXT_VERSION, adapterVersionOf } from '../version'
import type { ChatPlatformAdapter } from '../types'
import { computeAdapterHealth, type HealthCapableAdapter } from '../health'
import { loadLastExport } from '../storage'

/** FNV-1a 32bit：同一异常栈得到稳定 hash，便于去重聚类（不泄露原文） */
export function stackHash(stack: string | undefined): string | null {
  if (!stack) return null
  let hash = 0x811c9dc5
  for (let i = 0; i < stack.length; i++) {
    hash ^= stack.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 压缩 error stack 为单行（保留前 3 帧文件:行号，不含消息参数） */
function compactStack(err: unknown): { hash: string | null; frames: string } {
  if (!(err instanceof Error) || !err.stack) return { hash: null, frames: '' }
  const frames = err.stack
    .split('\n')
    .filter((line) => line.includes('at '))
    .slice(0, 3)
    .map((line) => line.trim().replace(/\s+at\s+/, ''))
    .join(' | ')
  return { hash: stackHash(err.stack), frames }
}

export async function buildDiagnostics(
  adapter: ChatPlatformAdapter | null,
  scenario: string,
  extra?: { errorCode?: string; error?: unknown },
): Promise<string> {
  const lines: string[] = [
    `scenario: ${scenario}`,
    `time: ${new Date().toISOString()}`,
    `markdoc-web: ${APP_VERSION}`,
    `markdoc-extension: ${EXT_VERSION}`,
    `manifest-version: ${chrome.runtime.getManifest?.().version ?? 'dev'}`,
    `browser: ${navigator.userAgent}`,
    `hostname: ${location.hostname}`,
    `platform: ${adapter?.name ?? 'unknown'}`,
    `adapter-id: ${adapter?.id ?? 'unknown'}`,
    `adapter-version: ${adapter ? adapterVersionOf(adapter.id) : 'unknown'}`,
  ]

  if (extra?.errorCode) lines.push(`error-code: ${extra.errorCode}`)
  const stack = compactStack(extra?.error)
  if (stack.hash) lines.push(`stack-hash: ${stack.hash}`)
  if (stack.frames) lines.push(`stack-frames: ${stack.frames}`)

  // 结构计数 + selector 命中（健康检查只统计数量，不读取内容）
  if (adapter) {
    try {
      const health = await computeAdapterHealth(adapter as HealthCapableAdapter)
      lines.push(
        `health: detected=${health.detected} conversation=${health.conversationFound} container=${health.messageContainerFound}`,
      )
      lines.push(
        `messages: user=${health.userMessages} assistant=${health.assistantMessages}`,
      )
      lines.push(
        `elements: math=${health.mathDetected} tables=${health.tablesDetected} code=${health.codeBlocksDetected} images=${health.imagesDetected}`,
      )
      lines.push(`confidence: ${health.extractionConfidence}`)
      if (health.warnings.length > 0) lines.push(`warnings: ${health.warnings.join(',')}`)
      const groups = (adapter as HealthCapableAdapter).getSelectorGroups?.()
      const hits = (adapter as HealthCapableAdapter).getSelectorHits?.()
      if (groups && hits) {
        for (const [group, selectors] of Object.entries(groups)) {
          const hit = selectors.map((s) => `${s}:${hits.get(s) ?? 0}`).join(' ')
          lines.push(`selectors[${group}]: ${hit}`)
        }
      }
    } catch {
      lines.push('health: unavailable')
    }
  }

  try {
    const last = await loadLastExport()
    if (last) {
      lines.push(`last-export: target=${last.target} ok=${last.ok} code=${last.errorCode ?? '-'} at=${new Date(last.at).toISOString()}`)
    }
  } catch { /* ignore */ }

  lines.push('privacy: 本诊断不含任何聊天内容/公式/代码/图片')
  return lines.join('\n')
}
