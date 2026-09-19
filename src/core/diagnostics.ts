/**
 * 「复制诊断信息」—— 用于用户反馈 bug。
 *
 * 只包含与排版问题排查相关的环境/统计信息：
 *   应用版本、构建版本、浏览器、操作系统、当前模板、
 *   文档统计（字符/标题/公式/表格/图片/代码块/分页符）、
 *   检查结果（错误/警告数与类型）、最近一次导出状态。
 *
 * 绝不包含：正文内容、公式原文、图片内容、历史文档。
 */

import { APP_VERSION, BUILD_COMMIT } from '../version'
import type { PreflightResult } from './preflight'
import { getTemplateLabel } from './templates'

export interface DiagnosticInput {
  templateId: string
  markdown: string
  preflight: PreflightResult | null
  /** 最近一次导出状态：ok=成功 fail=失败 null=本次会话尚未导出 */
  lastExport: 'ok' | 'fail' | null
}

function parseBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge'
  if (/OPR\//.test(ua)) return 'Opera'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Chrome\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return '未知浏览器'
}

function parseOS(ua: string): string {
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Mac OS X/.test(ua)) return 'macOS'
  if (/Android/.test(ua)) return 'Android'
  if (/iPhone|iPad/.test(ua)) return 'iOS'
  if (/Linux/.test(ua)) return 'Linux'
  return '未知系统'
}

export function buildDiagnostics(input: DiagnosticInput): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const stats = input.preflight?.stats
  const issues = input.preflight?.issues ?? []
  const errors = issues.filter((i) => i.level === 'error').length
  const warns = issues.length - errors
  const warnTypes = [...new Set(
    issues
      .filter((i) => i.level === 'warn')
      .map((i) => {
        // 只取类型短语，不携带正文/行号细节
        if (i.message.includes('公式')) return '公式问题'
        if (i.message.includes('图片')) return '图片问题'
        if (i.message.includes('表格')) return '表格过宽'
        if (i.message.includes('Mermaid')) return 'Mermaid 失败'
        if (i.message.includes('标题')) return '标题问题'
        if (i.message.includes('历史') || i.message.includes('存储')) return '本地存储'
        if (i.message.includes('网络图片')) return '外链图片'
        if (i.message.includes('视频')) return '不支持的媒体'
        return '其他'
      }),
  )]

  const lines = [
    'MarkDoc 诊断信息（不含文档内容）',
    `版本: v${APP_VERSION}${BUILD_COMMIT ? ` · build ${BUILD_COMMIT}` : ''}`,
    `时间: ${new Date().toISOString()}`,
    `浏览器: ${parseBrowser(ua)}`,
    `操作系统: ${parseOS(ua)}`,
    `UserAgent: ${ua}`,
    `模板: ${getTemplateLabel(input.templateId)}`,
    `文档字符数: ${input.markdown.length}`,
  ]

  if (stats) {
    lines.push(
      `统计: 标题 ${stats.headings} · 公式 ${stats.math} · 表格 ${stats.tables} · 图片 ${stats.images} · 代码块 ${stats.codeBlocks} · 分页符 ${stats.pagebreaks}`,
    )
  }
  lines.push(`导出前检查: 错误 ${errors} · 警告 ${warns}${warnTypes.length ? `（${warnTypes.join('、')}）` : ''}`)
  lines.push(`最近一次导出: ${input.lastExport === 'ok' ? '成功' : input.lastExport === 'fail' ? '失败' : '未导出'}`)

  return lines.join('\n')
}
