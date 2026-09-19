import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readFile, writeFile } from 'fs/promises'

const _dirname = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url))

// Disable hardware acceleration for better compatibility on some Windows machines
// app.disableHardwareAcceleration()

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'MarkDoc',
    icon: join(_dirname, '../../public/vite.svg'),
    webPreferences: {
      // 渲染层与 Node 隔离：桌面能力只经 preload 的 contextBridge 白名单暴露
      nodeIntegration: false,
      contextIsolation: true,
      // ESM preload（preload.mjs）要求关闭 sandbox；
      // 暴露面仍只有 preload.ts 里的三个 ipcRenderer.invoke 包装
      sandbox: false,
      // PDF 导出的字体在 file:// 下走 XHR 回退，需要放开同源限制（见 src/core/pdf/fonts.ts）
      webSecurity: false,
      preload: join(_dirname, 'preload.mjs'),
    },
  })

  // Remove default menu for a cleaner look
  mainWindow.setMenuBarVisibility(false)

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    // Load the index.html from dist
    mainWindow.loadFile(join(_dirname, '../dist/index.html'))
  }

  // 冒烟回归（MARKDOC_SMOKE=1）：加载页面后校验 preload 桥 + React 挂载，然后自动退出
  if (process.env.MARKDOC_SMOKE === '1') {
    mainWindow.webContents.on('did-fail-load', (_event, code, desc) => {
      console.error(`[MarkDoc smoke] load failed: ${code} ${desc}`)
      app.exit(1)
    })
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow?.webContents
        .executeJavaScript(
          `!!window.markdocDesktop && !!document.getElementById('root') && document.getElementById('root').children.length > 0`,
        )
        .then((ok) => {
          console.log(`[MarkDoc smoke] preload bridge + react mount ok=${ok}`)
          app.exit(ok ? 0 : 1)
        })
        .catch((err) => {
          console.error('[MarkDoc smoke] evaluate failed:', err)
          app.exit(1)
        })
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

function registerIpc() {
  // 原生对话框打开本地 Markdown / 纯文本
  ipcMain.handle('markdoc:open-file', async () => {
    if (!mainWindow) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '打开 Markdown 文件',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (canceled || filePaths.length === 0) return null
    const filePath = filePaths[0]
    try {
      const content = await readFile(filePath, 'utf-8')
      const name = filePath.split(/[\\/]/).pop() || 'document.md'
      return { name, content }
    } catch (err) {
      console.error('[MarkDoc] open file failed:', err)
      return null
    }
  })

  // 原生「另存为」+ 写盘（内容为 base64，由渲染层编码好的 DOCX/PDF/Markdown）
  ipcMain.handle(
    'markdoc:save-file',
    async (_event, payload: { base64: string; defaultName: string; description: string; ext: string }) => {
      if (!mainWindow) return 'cancelled'
      const { base64, defaultName, description, ext } = payload ?? {}
      if (typeof base64 !== 'string' || !defaultName) return 'cancelled'
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: '保存文件',
        defaultPath: defaultName,
        filters: ext
          ? [{ name: description || ext.toUpperCase(), extensions: [ext] }]
          : [{ name: 'All Files', extensions: ['*'] }],
      })
      if (canceled || !filePath) return 'cancelled'
      await writeFile(filePath, Buffer.from(base64, 'base64'))
      return 'saved'
    },
  )
}
