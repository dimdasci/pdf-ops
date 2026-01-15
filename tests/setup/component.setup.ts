import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// Type definition matching the preload script
interface ApiKeys {
  gemini?: string
  anthropic?: string
}

// Mock window.electronAPI for component tests
// This matches the interface exposed in electron/preload.ts
const mockElectronAPI = {
  // File path utility
  getFilePath: vi.fn((file: File) => `/mock/path/${file.name}`),

  // Legacy API key handlers (backward compatibility)
  saveApiKey: vi.fn(async (_key: string) => undefined),
  getApiKey: vi.fn(async () => null as string | null),

  // New multi-provider API key handlers
  saveApiKeys: vi.fn(async (_keys: ApiKeys) => undefined),
  getApiKeys: vi.fn(async () => ({ gemini: '', anthropic: '' }) as ApiKeys),
  saveProviderKey: vi.fn(async (_provider: string, _key: string) => undefined),
  getProviderKey: vi.fn(async (_provider: string) => null as string | null),

  // File system handlers
  readFileBuffer: vi.fn(async (_path: string) => new Uint8Array([])),
  saveMarkdownFile: vi.fn(async (_content: string) => undefined),
}

// Attach to window
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})

// Export for test access - allows tests to configure mock behavior
export { mockElectronAPI }
export type { ApiKeys }
