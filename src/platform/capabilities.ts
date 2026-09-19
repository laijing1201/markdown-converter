/**
 * 平台能力探测 —— 三端（Web / Electron Desktop / Extension）统一入口。
 *
 * 转换器（DOCX/PDF exporter）只负责产出 Blob，永远不感知运行环境；
 * 「文件落到哪里」由 platform adapter 决定。React 组件里不要再出现
 * `if (window.markdocDesktop)`，统一注入 capabilities / adapter。
 */

export interface PlatformCapabilities {
  /** Electron 桌面版（preload 注入 window.markdocDesktop） */
  desktop: boolean
  /** 原生对话框打开本地 Markdown */
  openLocalFile: boolean
  /** 原生「另存为」写盘（桌面版） */
  nativeSave: boolean
  /** 浏览器下载（Blob → 下载栏），Web / Extension 都可用 */
  browserDownload: boolean
  exportDocx: boolean
  exportPdf: boolean
}

/** Electron preload（electron/preload.ts）注入的桥接对象 */
export interface MarkdocDesktopApi {
  isDesktop: true
  openMarkdown(): Promise<{ name: string; content: string } | null>
  /**
   * 原生另存为对话框 + 写盘。base64 为文件内容；
   * 返回 'saved' / 'cancelled'（用户取消保存对话框）。
   */
  saveFile(payload: {
    base64: string
    defaultName: string
    description: string
    ext: string
  }): Promise<'saved' | 'cancelled'>
}

declare global {
  interface Window {
    markdocDesktop?: MarkdocDesktopApi
  }
}

export function getDesktopApi(): MarkdocDesktopApi | null {
  if (typeof window === 'undefined') return null
  return window.markdocDesktop ?? null
}

const WEB_CAPABILITIES: PlatformCapabilities = {
  desktop: false,
  openLocalFile: false,
  nativeSave: false,
  browserDownload: true,
  exportDocx: true,
  exportPdf: true,
}

const DESKTOP_CAPABILITIES: PlatformCapabilities = {
  desktop: true,
  openLocalFile: true,
  nativeSave: true,
  browserDownload: true,
  exportDocx: true,
  exportPdf: true,
}

export function detectPlatformCapabilities(): PlatformCapabilities {
  return getDesktopApi() ? DESKTOP_CAPABILITIES : WEB_CAPABILITIES
}
