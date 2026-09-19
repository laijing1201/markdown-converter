/**
 * Electron preload —— 通过 contextBridge 暴露最小桌面 API。
 *
 * 只暴露三个方法（打开 Markdown / 另存为写盘），
 * 不暴露 fs、shell 等任意能力；渲染进程安全模型见 main.ts webPreferences。
 */
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  isDesktop: true as const,
  openMarkdown: () => ipcRenderer.invoke('markdoc:open-file'),
  saveFile: (payload: { base64: string; defaultName: string; description: string; ext: string }) =>
    ipcRenderer.invoke('markdoc:save-file', payload),
}

export type MarkdocDesktopPreloadApi = typeof api

contextBridge.exposeInMainWorld('markdocDesktop', api)
