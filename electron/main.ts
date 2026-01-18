import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import fs from 'fs'
import path from 'path'

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require('electron-squirrel-startup')) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Check if we are in dev mode
  const isDev = process.env.NODE_ENV === 'development'

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Block unwanted navigation
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Only allow navigation to app's own URLs
    if (!url.startsWith('file://') && !url.includes('localhost')) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // External links open in browser
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' } // Never open new Electron windows
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// --- IPC Handlers ---

// API Keys structure
interface ApiKeys {
  gemini?: string
  anthropic?: string
}

const getConfigPath = () => path.join(app.getPath('userData'), 'config.enc')

const loadApiKeys = (): ApiKeys => {
  try {
    const configPath = getConfigPath()
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath)

      if (safeStorage.isEncryptionAvailable()) {
        const decrypted = safeStorage.decryptString(data)
        return JSON.parse(decrypted)
      }

      // Fallback: try parsing as plain JSON (test/CI)
      if (process.env.NODE_ENV === 'test' || process.env.CI) {
        try {
          return JSON.parse(data.toString())
        } catch {
          // File might be encrypted from a previous run, ignore
        }
      }
    }
  } catch (e) {
    console.error('Failed to load API keys', e)
  }
  return {}
}

const saveApiKeys = (keys: ApiKeys): boolean => {
  const configPath = getConfigPath()

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(JSON.stringify(keys))
    fs.writeFileSync(configPath, encrypted)
    return true
  }

  // Fallback: unencrypted storage for test/CI environments only
  if (process.env.NODE_ENV === 'test' || process.env.CI) {
    fs.writeFileSync(configPath, JSON.stringify(keys))
    console.warn('SafeStorage unavailable - using unencrypted storage (test/CI only)')
    return true
  }

  console.warn('SafeStorage not available, cannot save keys securely.')
  return false
}

// Legacy handler for backward compatibility
ipcMain.handle('save-api-key', async (_event, key: string) => {
  const keys = loadApiKeys()
  keys.gemini = key
  return saveApiKeys(keys)
})

ipcMain.handle('get-api-key', async () => {
  const keys = loadApiKeys()
  return keys.gemini || null
})

// New handlers for multiple providers
ipcMain.handle('save-api-keys', async (_event, keys: ApiKeys) => {
  const existing = loadApiKeys()
  const merged = { ...existing, ...keys }
  return saveApiKeys(merged)
})

ipcMain.handle('get-api-keys', async () => {
  return loadApiKeys()
})

ipcMain.handle('save-provider-key', async (_event, provider: string, key: string) => {
  const keys = loadApiKeys()
  ;(keys as Record<string, string>)[provider] = key
  return saveApiKeys(keys)
})

ipcMain.handle('get-provider-key', async (_event, provider: string) => {
  const keys = loadApiKeys()
  return (keys as Record<string, string>)[provider] || null
})

// File System handlers
ipcMain.handle('read-file-buffer', async (event, filePath: string) => {
  return fs.readFileSync(filePath)
})

ipcMain.handle('save-markdown-file', async (event, content: string) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })

  if (!canceled && filePath) {
    fs.writeFileSync(filePath, content)
    return true
  }
  return false
})

// External link handler
ipcMain.handle('open-external', async (_, url: string) => {
  // Validate URL before opening
  if (url.startsWith('http://') || url.startsWith('https://')) {
    await shell.openExternal(url)
    return true
  }
  return false
})
