import type { PlatformAdapter } from './types'
import { detectPlatformCapabilities, getDesktopApi } from './capabilities'

/** Blob → base64（分块 btoa，避免数 MB 的 DOCX/PDF 触发栈溢出） */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  const chunk = 0x8000
  let out = ''
  for (let i = 0; i < buf.length; i += chunk) {
    out += String.fromCharCode(...buf.subarray(i, i + chunk))
  }
  return btoa(out)
}

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const chunk = 0x8000
  let out = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(out)
}

/**
 * Electron 桌面平台：原生对话框 + fs 写盘（经 preload IPC）。
 * 导出产物与 Web 完全同源（同一 buildDocxBlob / buildPdf 的 Blob），
 * 差别只在「落到哪里」。
 */
export const electronAdapter: PlatformAdapter = {
  capabilities: detectPlatformCapabilities(),

  async saveOrDownload(blob: Blob, filename: string) {
    const api = getDesktopApi()
    if (!api) {
      // 理论不可达（capabilities 已判定 desktop）；兜底走浏览器下载
      const { saveAs } = await import('file-saver')
      saveAs(blob, filename)
      return
    }
    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.') + 1) : ''
    const description = ext.toUpperCase() === 'PDF' ? 'PDF 文档' : 'Word 文档'
    await api.saveFile({
      base64: await blobToBase64(blob),
      defaultName: filename,
      description,
      ext,
    })
  },

  async openMarkdownFile() {
    const api = getDesktopApi()
    if (!api) return null
    return api.openMarkdown()
  },

  async saveMarkdownFile(filename: string, content: string) {
    const api = getDesktopApi()
    if (!api) return null
    return api.saveFile({
      base64: textToBase64(content),
      defaultName: filename.endsWith('.md') ? filename : `${filename}.md`,
      description: 'Markdown 文档',
      ext: 'md',
    })
  },
}
