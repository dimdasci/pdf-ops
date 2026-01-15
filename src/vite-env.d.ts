/// <reference types="vite/client" />

interface ApiKeys {
  gemini?: string
  anthropic?: string
}

interface Window {
  electronAPI: {
    getFilePath: (file: File) => string
    // Legacy handlers (backward compatibility)
    saveApiKey: (key: string) => Promise<boolean>
    getApiKey: () => Promise<string | null>
    // Multi-provider handlers
    saveApiKeys: (keys: ApiKeys) => Promise<boolean>
    getApiKeys: () => Promise<ApiKeys>
    saveProviderKey: (provider: string, key: string) => Promise<boolean>
    getProviderKey: (provider: string) => Promise<string | null>
    // File system handlers
    readFileBuffer: (path: string) => Promise<Uint8Array>
    saveMarkdownFile: (content: string) => Promise<boolean>
  }
}
