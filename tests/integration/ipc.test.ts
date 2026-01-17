import { _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

// ESM-compatible __dirname equivalent
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Task 24: Test file structure with Electron launch
let electronApp: ElectronApplication
let window: Page

test.beforeAll(async () => {
  // Launch Electron app with the built main.js
  electronApp = await electron.launch({
    args: [
      '--no-sandbox',
      '--disable-gpu',
      path.join(__dirname, '../../dist-electron/main.js'),
    ],
    env: { ...process.env, NODE_ENV: 'test' },
  })

  // Wait for the first window to open
  window = await electronApp.firstWindow()

  // Wait for the app to be fully loaded
  await window.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  if (electronApp) {
    await electronApp.close()
  }
})

test.describe('IPC Communication', () => {
  // Task 25: Test saveApiKeys/getApiKeys round trip
  test.describe('API Key Storage', () => {
    test('saveApiKeys and getApiKeys round trip works correctly', async () => {
      // Generate unique test keys to avoid interference from other test runs
      const testKeys = {
        gemini: `test-gemini-key-${Date.now()}`,
        anthropic: `test-anthropic-key-${Date.now()}`,
      }

      // Save the API keys through IPC
      const saveResult = await window.evaluate(async keys => {
        return await window.electronAPI.saveApiKeys(keys)
      }, testKeys)

      expect(saveResult).toBe(true)

      // Retrieve the API keys through IPC
      const retrievedKeys = await window.evaluate(async () => {
        return await window.electronAPI.getApiKeys()
      })

      expect(retrievedKeys).toEqual(testKeys)
    })

    test('saveProviderKey and getProviderKey work for individual providers', async () => {
      const testKey = `test-individual-key-${Date.now()}`
      const provider = 'gemini'

      // Save individual provider key
      const saveResult = await window.evaluate(
        async ({ provider, key }) => {
          return await window.electronAPI.saveProviderKey(provider, key)
        },
        { provider, key: testKey },
      )

      expect(saveResult).toBe(true)

      // Retrieve individual provider key
      const retrievedKey = await window.evaluate(async provider => {
        return await window.electronAPI.getProviderKey(provider)
      }, provider)

      expect(retrievedKey).toBe(testKey)
    })

    test('legacy saveApiKey and getApiKey handlers work', async () => {
      const testKey = `test-legacy-key-${Date.now()}`

      // Save using legacy handler
      const saveResult = await window.evaluate(async key => {
        return await window.electronAPI.saveApiKey(key)
      }, testKey)

      expect(saveResult).toBe(true)

      // Retrieve using legacy handler
      const retrievedKey = await window.evaluate(async () => {
        return await window.electronAPI.getApiKey()
      })

      expect(retrievedKey).toBe(testKey)
    })

    test('getProviderKey returns null for non-existent provider', async () => {
      const nonExistentProvider = `non-existent-provider-${Date.now()}`

      const result = await window.evaluate(async provider => {
        return await window.electronAPI.getProviderKey(provider)
      }, nonExistentProvider)

      expect(result).toBeNull()
    })
  })

  // Task 26: Test readFileBuffer with real PDF fixture
  test.describe('File System Operations', () => {
    test('readFileBuffer reads PDF fixture correctly', async () => {
      const fixturePath = path.join(__dirname, '../fixtures/arxiv-roadmap/source.pdf')

      // Read the file through IPC
      const buffer = await window.evaluate(async filePath => {
        const result = await window.electronAPI.readFileBuffer(filePath)
        // Return array length and first few bytes to verify it's a PDF
        return {
          length: result.length,
          // PDF magic bytes: %PDF (0x25 0x50 0x44 0x46)
          header: Array.from(result.slice(0, 4)),
        }
      }, fixturePath)

      // Verify we got data back
      expect(buffer.length).toBeGreaterThan(0)

      // Verify PDF magic bytes
      // %PDF = [37, 80, 68, 70] in decimal
      expect(buffer.header).toEqual([37, 80, 68, 70])
    })

    test('readFileBuffer returns correct file size', async () => {
      const fixturePath = path.join(__dirname, '../fixtures/arxiv-roadmap/source.pdf')

      // Get expected file size from Node.js fs
      const fs = await import('fs')
      const expectedSize = fs.statSync(fixturePath).size

      // Read through IPC and compare sizes
      const actualSize = await window.evaluate(async filePath => {
        const result = await window.electronAPI.readFileBuffer(filePath)
        return result.length
      }, fixturePath)

      expect(actualSize).toBe(expectedSize)
    })
  })

  // Task 27: Test error handling for invalid file paths
  test.describe('Error Handling', () => {
    test('readFileBuffer throws error for non-existent file', async () => {
      const invalidPath = '/path/to/nonexistent/file.pdf'

      // Attempt to read non-existent file and capture the error
      const result = await window.evaluate(async filePath => {
        try {
          await window.electronAPI.readFileBuffer(filePath)
          return { success: true, error: null }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }, invalidPath)

      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
      // Error should mention the file doesn't exist (ENOENT)
      expect(result.error).toMatch(/ENOENT|no such file|not found/i)
    })

    test('readFileBuffer throws error for directory path', async () => {
      const directoryPath = path.join(__dirname, '../fixtures')

      const result = await window.evaluate(async dirPath => {
        try {
          await window.electronAPI.readFileBuffer(dirPath)
          return { success: true, error: null }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }, directoryPath)

      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
      // Error should indicate it's a directory (EISDIR)
      expect(result.error).toMatch(/EISDIR|directory|illegal operation/i)
    })

    test('readFileBuffer handles empty path gracefully', async () => {
      const result = await window.evaluate(async () => {
        try {
          await window.electronAPI.readFileBuffer('')
          return { success: true, error: null }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })
  })
})
