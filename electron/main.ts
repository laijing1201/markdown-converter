import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

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
    icon: join(_dirname, '../../public/vite.svg'), // Using existing vite svg
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // For simpler migration, we disable isolation. In strict prod, contextBridge is better.
      webSecurity: false,      // To allow local file access if needed
    },
  })

  // Remove default menu for a cleaner look
  mainWindow.setMenuBarVisibility(false)

  // Wait, vite-plugin-electron uses VITE_DEV_SERVER_URL in dev mode
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    // Open DevTools in dev mode to debug white screen
    mainWindow.webContents.openDevTools()
  } else {
    // Load the index.html from dist
    mainWindow.loadFile(join(_dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(createWindow)

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

// IPC: Handle PDF Export
ipcMain.handle('export-pdf', async (event, filename: string) => {
  if (!mainWindow) return false
  
  try {
    // Let user choose save path
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出 PDF',
      defaultPath: `${filename}.pdf`,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
    })

    if (!filePath) return false // User canceled

    // Generate PDF buffer
    // we use standard printToPDF options
    const pdfData = await mainWindow.webContents.printToPDF({
      marginsType: 0, // No margins, let CSS handle it
      printBackground: true,
      printSelectionOnly: false,
      landscape: false,
      pageSize: 'A4',
      scaleFactor: 100
    })

    // Write file
    const fs = await import('fs')
    fs.writeFileSync(filePath, pdfData)
    return true
  } catch (error) {
    console.error('PDF export failed:', error)
    return false
  }
})
