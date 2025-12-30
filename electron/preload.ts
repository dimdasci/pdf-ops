import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  saveApiKey: (key: string) => ipcRenderer.invoke('save-api-key', key),
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  readFileBuffer: (path: string) => ipcRenderer.invoke('read-file-buffer', path),
  saveMarkdownFile: (content: string) => ipcRenderer.invoke('save-markdown-file', content),
});
