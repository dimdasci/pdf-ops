import { contextBridge, ipcRenderer, webUtils } from 'electron'

interface ApiKeys {
  gemini?: string
  anthropic?: string
}

contextBridge.exposeInMainWorld('electronAPI', {
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  // Legacy handlers (backward compatibility)
  saveApiKey: (key: string) => ipcRenderer.invoke('save-api-key', key),
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  // New multi-provider handlers
  saveApiKeys: (keys: ApiKeys) => ipcRenderer.invoke('save-api-keys', keys),
  getApiKeys: () => ipcRenderer.invoke('get-api-keys') as Promise<ApiKeys>,
  saveProviderKey: (provider: string, key: string) =>
    ipcRenderer.invoke('save-provider-key', provider, key),
  getProviderKey: (provider: string) =>
    ipcRenderer.invoke('get-provider-key', provider) as Promise<string | null>,
  // File system handlers
  readFileBuffer: (path: string) => ipcRenderer.invoke('read-file-buffer', path),
  saveMarkdownFile: (content: string) => ipcRenderer.invoke('save-markdown-file', content),
  // External link handler
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
})
