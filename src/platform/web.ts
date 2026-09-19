import type { PlatformAdapter } from './types'
import { detectPlatformCapabilities } from './capabilities'

/**
 * Web 平台：Blob → 浏览器下载（file-saver）。
 * 打开/另存本地路径属于桌面版能力，返回 null 由 UI 提示「桌面版功能」。
 */
export const webAdapter: PlatformAdapter = {
  capabilities: detectPlatformCapabilities(),

  async saveOrDownload(blob: Blob, filename: string) {
    // file-saver 为 UMD 包，动态 import 以兼容 Node/测试环境
    const { saveAs } = await import('file-saver')
    saveAs(blob, filename)
  },

  async openMarkdownFile() {
    return null
  },

  async saveMarkdownFile() {
    return null
  },
}
