/**
 * 扩展错误代码体系（P4C 第十节）：
 *   - console 保留详细 stack；
 *   - 用户界面只显示友好中文 + 错误代码；
 *   - 诊断信息携带错误代码，绝不携带聊天内容。
 */

export type ExtErrorCode =
  | 'MD-EXT-001' // UnsupportedPage
  | 'MD-EXT-002' // ConversationNotFound
  | 'MD-EXT-003' // MessageExtractionFailed
  | 'MD-EXT-004' // MathExtractionFailed
  | 'MD-EXT-005' // ImageFetchFailed
  | 'MD-EXT-006' // DocxExportFailed
  | 'MD-EXT-007' // PdfExportFailed
  | 'MD-EXT-008' // BridgeFailed
  | 'MD-EXT-009' // StorageFailed
  | 'MD-EXT-010' // AdapterOutdated
  | 'MD-EXT-011' // QuotaExceeded

export interface ErrorInfo {
  /** 稳定的英文代号（诊断用） */
  name: string
  /** 用户可见的友好中文描述 */
  userMessage: string
}

export const ERROR_INFO: Record<ExtErrorCode, ErrorInfo> = {
  'MD-EXT-001': {
    name: 'UnsupportedPage',
    userMessage: '当前页面不是支持的 AI 对话页面。',
  },
  'MD-EXT-002': {
    name: 'ConversationNotFound',
    userMessage: '未找到可导出的对话内容，请确认页面已加载出消息。',
  },
  'MD-EXT-003': {
    name: 'MessageExtractionFailed',
    userMessage: '消息内容提取失败。网站结构可能已更新，请复制诊断信息反馈。',
  },
  'MD-EXT-004': {
    name: 'MathExtractionFailed',
    userMessage: '部分数学公式未能还原，可能以文本形式导出。',
  },
  'MD-EXT-005': {
    name: 'ImageFetchFailed',
    userMessage: '部分图片下载失败，可能以占位符导出。',
  },
  'MD-EXT-006': {
    name: 'DocxExportFailed',
    userMessage: 'Word 生成失败，请重试；若持续出现请复制诊断信息反馈。',
  },
  'MD-EXT-007': {
    name: 'PdfExportFailed',
    userMessage: 'PDF 生成失败，请重试；若持续出现请复制诊断信息反馈。',
  },
  'MD-EXT-008': {
    name: 'BridgeFailed',
    userMessage: '与 MarkDoc 网页版的通信失败，请确认已安装扩展并重试。',
  },
  'MD-EXT-009': {
    name: 'StorageFailed',
    userMessage: '扩展存储不可用，请重启浏览器后重试。',
  },
  'MD-EXT-010': {
    name: 'AdapterOutdated',
    userMessage: 'MarkDoc 可能无法完整识别当前页面，网站结构可能已更新。',
  },
  'MD-EXT-011': {
    name: 'QuotaExceeded',
    userMessage: '免费试用已结束，请注册并登录 MarkDoc 后继续使用。',
  },
}

/** 携带错误代码的异常：console 保留 stack，UI 只取 code + 用户文案 */
export class MarkDocExtError extends Error {
  readonly code: ExtErrorCode
  /** 补充细节（只进诊断/console，不进用户文案） */
  readonly detail?: string

  constructor(code: ExtErrorCode, detail?: string) {
    super(`[${code}] ${ERROR_INFO[code].name}${detail ? `: ${detail}` : ''}`)
    this.name = 'MarkDocExtError'
    this.code = code
    this.detail = detail
  }

  get userMessage(): string {
    return `${ERROR_INFO[this.code].userMessage}（${this.code}）`
  }
}

/** 任意异常 → 用户可见文案（未知错误也给出可反馈的代码位） */
export function userMessageOf(err: unknown): string {
  if (err instanceof MarkDocExtError) return err.userMessage
  return '导出过程出现异常，请重试；若持续出现请复制诊断信息反馈。'
}

/** 任意异常 → 错误代码（未知异常返回 null） */
export function codeOf(err: unknown): ExtErrorCode | null {
  return err instanceof MarkDocExtError ? err.code : null
}
