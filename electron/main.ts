import { app, BrowserWindow, ipcMain, safeStorage, dialog } from 'electron';
import path from 'path';
import fs from 'fs';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

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
  });

  // Check if we are in dev mode
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC Handlers ---

ipcMain.handle('save-api-key', async (event, key: string) => {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(key);
    // In a real app, store this in a file or system keychain.
    // For this prototype, we'll store it in a local config file in userData.
    const configPath = path.join(app.getPath('userData'), 'config.enc');
    fs.writeFileSync(configPath, encrypted);
    return true;
  } else {
    // Fallback or error if encryption not available
    console.warn('SafeStorage not available, cannot save key securely.');
    return false;
  }
});

ipcMain.handle('get-api-key', async () => {
  try {
     const configPath = path.join(app.getPath('userData'), 'config.enc');
     if (fs.existsSync(configPath)) {
       const encrypted = fs.readFileSync(configPath);
       if (safeStorage.isEncryptionAvailable()) {
         return safeStorage.decryptString(encrypted);
       }
     }
  } catch (e) {
    console.error('Failed to retrieve API key', e);
  }
  return null;
});

// File System handlers
ipcMain.handle('read-file-buffer', async (event, filePath: string) => {
    return fs.readFileSync(filePath);
});

ipcMain.handle('save-markdown-file', async (event, content: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
        filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    
    if (!canceled && filePath) {
        fs.writeFileSync(filePath, content);
        return true;
    }
    return false;
});