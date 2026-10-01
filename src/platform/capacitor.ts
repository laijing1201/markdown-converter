import type { PlatformAdapter } from './types'
import { WEB_CAPABILITIES, type PlatformCapabilities } from './capabilities'
import { webAdapter } from './web'

/**
 * Capacitor 安卓壳平台：与 Web / Electron 并列的第四端适配器。
 *
 * 安卓 WebView 不响应 `<a download>`（没有挂下载管理器），所以导出
 * Word / PDF / 批量 ZIP 走：写应用缓存目录 → 系统分享面板
 * （「保存到文件」即等同下载，也可直接发微信 / 邮件）。
 * 打开本地 Markdown 走通用 `<input type="file">`，Capacitor 会桥接
 * 系统文件选择器，无需特殊处理。
 *
 * core 导出器依旧只产出 Blob，感知不到自己跑在安卓里——平台差异
 * 全部收敛在这一层（与 web.ts / electron.ts 同一契约）。
 */

/** 是否运行在 Capacitor 原生壳内（@capacitor/core 注入 window.Capacitor） */
export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform()
}

export const capacitorCapabilities: PlatformCapabilities = {
  ...WEB_CAPABILITIES,
  desktop: false,
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new Error('读取导出内容失败'))
    reader.readAsDataURL(blob)
  })
}

/** 用户主动关闭分享面板：不算导出失败，静默返回 */
function isShareCancel(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /cancel|dismiss|aborted/i.test(msg)
}

export const capacitorAdapter: PlatformAdapter = {
  capabilities: capacitorCapabilities,

  async saveOrDownload(blob: Blob, filename: string) {
    try {
      const [{ Filesystem, Directory }, { Share }] = await Promise.all([
        import('@capacitor/filesystem'),
        import('@capacitor/share'),
      ])
      const base64 = await blobToBase64(blob)
      // 不传 encoding = 按 base64 二进制写入，保留 DOCX/PDF 字节
      const { uri } = await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Cache,
        recursive: true,
      })
      await Share.share({
        title: filename,
        // file:// URI 由 Filesystem 写入后返回；安卓按扩展名推断 MIME
        url: uri,
        dialogTitle: '保存或分享文档',
      })
    } catch (err) {
      if (isShareCancel(err)) return
      // 插件异常（如升级后桥接失效）→ 回退浏览器下载路径
      console.warn('[MarkDoc] 安卓分享导出失败，回退浏览器下载', err)
      await webAdapter.saveOrDownload(blob, filename)
    }
  },

  async openMarkdownFile() {
    return null
  },

  async saveMarkdownFile() {
    return null
  },
}
