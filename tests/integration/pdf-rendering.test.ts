import { _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let electronApp: ElectronApplication
let window: Page
let consoleErrors: string[] = []

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [
      '--no-sandbox',
      '--disable-gpu',
      path.join(__dirname, '../../dist-electron/main.js'),
    ],
    env: { ...process.env, NODE_ENV: 'test' },
  })

  window = await electronApp.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // Capture console errors
  window.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text())
    }
  })
})

test.beforeEach(() => {
  consoleErrors = []
})

test.afterAll(async () => {
  if (electronApp) {
    await electronApp.close()
  }
})

test.describe('PDF Rendering', () => {
  test('loads PDF without ArrayBuffer detachment errors', async () => {
    const fixturePath = path.join(__dirname, '../fixtures/arxiv-roadmap/source.pdf')

    // Inject the file path into the app by simulating file selection
    // We'll use evaluate to directly call the app's file handling
    await window.evaluate(async filePath => {
      // Dispatch a custom event that App.tsx listens for, or directly set state
      // Since we can't easily trigger drag-drop, we'll use the window's exposed API
      const event = new CustomEvent('test:load-pdf', { detail: { filePath } })
      window.dispatchEvent(event)
    }, fixturePath)

    // Wait for the Workspace to appear (indicates PDF loaded)
    await window.waitForSelector('[data-testid="page-count"]', { timeout: 10000 })

    // Check for ArrayBuffer detachment errors
    const detachmentErrors = consoleErrors.filter(err =>
      err.includes('ArrayBuffer') && err.includes('detached')
    )

    expect(detachmentErrors).toHaveLength(0)
  })

  test('renders PDF page to canvas with visible content', async () => {
    const fixturePath = path.join(__dirname, '../fixtures/arxiv-roadmap/source.pdf')

    await window.evaluate(async filePath => {
      const event = new CustomEvent('test:load-pdf', { detail: { filePath } })
      window.dispatchEvent(event)
    }, fixturePath)

    // Wait for canvas to be present
    const canvas = await window.waitForSelector('canvas', { timeout: 10000 })

    // Wait a bit for rendering to complete
    await window.waitForTimeout(1000)

    // Get canvas dimensions and check it has size
    const dimensions = await canvas.evaluate((el: HTMLCanvasElement) => ({
      width: el.width,
      height: el.height,
    }))

    expect(dimensions.width).toBeGreaterThan(0)
    expect(dimensions.height).toBeGreaterThan(0)

    // Check canvas has non-transparent pixels (actually rendered something)
    const hasContent = await canvas.evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext('2d')
      if (!ctx) return false
      const imageData = ctx.getImageData(0, 0, el.width, el.height)
      // Check if any pixel is not fully transparent
      for (let i = 3; i < imageData.data.length; i += 4) {
        if (imageData.data[i] > 0) return true // alpha > 0
      }
      return false
    })

    expect(hasContent).toBe(true)
  })

  test('can navigate between PDF pages', async () => {
    const fixturePath = path.join(__dirname, '../fixtures/arxiv-roadmap/source.pdf')

    await window.evaluate(async filePath => {
      const event = new CustomEvent('test:load-pdf', { detail: { filePath } })
      window.dispatchEvent(event)
    }, fixturePath)

    // Wait for page count to show
    await window.waitForSelector('[data-testid="page-count"]', { timeout: 10000 })

    // Verify we're on page 1
    const pageText = await window.locator('text=Page 1').first()
    await expect(pageText).toBeVisible()

    // Click Next button
    await window.click('button:has-text("Next")')

    // Verify page changed
    await window.waitForSelector('text=Page 2', { timeout: 5000 })

    // No errors during navigation
    const detachmentErrors = consoleErrors.filter(err =>
      err.includes('ArrayBuffer') || err.includes('detached')
    )
    expect(detachmentErrors).toHaveLength(0)
  })

  test('handles React StrictMode double-invoke without errors', async () => {
    // This test verifies the ArrayBuffer cloning fix works
    // by loading multiple PDFs in sequence (simulates StrictMode re-renders)

    const fixturePath = path.join(__dirname, '../fixtures/arxiv-roadmap/source.pdf')

    // Load PDF first time
    await window.evaluate(async filePath => {
      const event = new CustomEvent('test:load-pdf', { detail: { filePath } })
      window.dispatchEvent(event)
    }, fixturePath)

    await window.waitForSelector('[data-testid="page-count"]', { timeout: 10000 })

    // Go back to drop zone
    await window.click('button:has(svg)') // Back button (ArrowLeft icon)

    // Wait for drop zone to appear
    await window.waitForSelector('[data-testid="drop-zone"]', { timeout: 5000 })

    // Load PDF again (simulates what StrictMode does)
    await window.evaluate(async filePath => {
      const event = new CustomEvent('test:load-pdf', { detail: { filePath } })
      window.dispatchEvent(event)
    }, fixturePath)

    await window.waitForSelector('[data-testid="page-count"]', { timeout: 10000 })

    // Verify no ArrayBuffer errors occurred
    const bufferErrors = consoleErrors.filter(err =>
      err.includes('ArrayBuffer')
      || err.includes('detached')
      || err.includes('DataCloneError')
    )

    expect(bufferErrors).toHaveLength(0)
  })
})
