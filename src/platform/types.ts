import type { PlatformCapabilities } from './capabilities'

/**
 * 平台适配器：core 导出器产出 Blob 后，「怎么保存」由这里决定。
 * Web = 浏览器下载；Electron = 原生另存为对话框 + 写盘。
 */
export interface PlatformAdapter {
  readonly capabilities: PlatformCapabilities
  /** 保存/下载导出产物（DOCX、PDF…）。永不抛出取消类错误。 */
  saveOrDownload(blob: Blob, filename: string): Promise<void>
  /** 打开本地 Markdown / 纯文本；平台不支持时返回 null */
  openMarkdownFile(): Promise<{ name: string; content: string } | null>
  /** 保存 Markdown 文本；平台不支持时返回 null */
  saveMarkdownFile(filename: string, content: string): Promise<'saved' | 'cancelled' | null>
}
