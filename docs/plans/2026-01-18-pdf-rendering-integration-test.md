# PDF Rendering Integration Test Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Playwright integration test that verifies PDF rendering works end-to-end in the real Electron app, preventing regression of the ArrayBuffer detachment bug.

**Architecture:** Create a new test file `tests/integration/pdf-rendering.test.ts` that launches Electron, loads a real PDF via file path injection, verifies the canvas renders non-blank content, and captures console errors to detect worker/buffer issues.

**Tech Stack:** Playwright, Electron, TypeScript, existing test fixtures

---

## Context

### The Bug We're Preventing

```
DataCloneError: Failed to execute 'postMessage' on 'Worker': ArrayBuffer at index 0 is already detached.
```

This occurs when:

1. Same ArrayBuffer passed to both `BrowserPdfService.load()` and `pdfjsLib.getDocument()`
2. pdf.js transfers buffer to Web Worker (detaches it)
3. Second consumer fails because buffer is already detached
4. React StrictMode double-invokes effects, triggering the issue

### Why Existing Tests Miss This

- Component tests mock `pdfjs-dist` and `BrowserPdfService` - no real Workers
- Integration tests only test IPC, not full Workspace rendering
- jsdom has no real Web Workers

### Test Strategy

Test the **real** Electron app with **real** PDF files and **real** Web Workers.

---

## Task 1: Create PDF Rendering Test File

**Files:**

- Create: `tests/integration/pdf-rendering.test.ts`

**Step 1: Create test file with imports and setup**

```typescript
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
```

**Step 2: Save file and verify it compiles**

Run: `cd /Users/dim/working/apps/pdf-translator/.worktrees/bugfixes-pipeline-redesign && npx tsc --noEmit tests/integration/pdf-rendering.test.ts 2>&1 || echo "Expected - will fix in next step"`

Expected: Type errors (test body missing) - that's fine for now

---

## Task 2: Add Test for PDF Loading Without Console Errors

**Files:**

- Modify: `tests/integration/pdf-rendering.test.ts`

**Step 1: Add the core test case**

Append to the file:

```typescript
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
})
```

**Step 2: Run test to verify it fails (test event not wired up yet)**

Run: `cd /Users/dim/working/apps/pdf-translator/.worktrees/bugfixes-pipeline-redesign && npm run build && npx playwright test tests/integration/pdf-rendering.test.ts --project=integration`

Expected: FAIL - test event not handled in app

---

## Task 3: Add Test Event Handler to App.tsx

**Files:**

- Modify: `src/App.tsx`

**Step 1: Read current App.tsx to understand structure**

Run: `head -50 src/App.tsx`

**Step 2: Add test event listener in App.tsx useEffect**

Find the App component and add inside a useEffect:

```typescript
useEffect(() => {
  // Test helper: allow integration tests to load PDFs programmatically
  const handleTestLoadPdf = (event: CustomEvent<{ filePath: string }>) => {
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      handleFileSelect(event.detail.filePath)
    }
  }

  window.addEventListener('test:load-pdf', handleTestLoadPdf as EventListener)
  return () => {
    window.removeEventListener('test:load-pdf', handleTestLoadPdf as EventListener)
  }
}, [])
```

**Step 3: Rebuild and run test**

Run: `npm run build && npx playwright test tests/integration/pdf-rendering.test.ts --project=integration`

Expected: Test should now load the PDF

---

## Task 4: Add Canvas Content Verification

**Files:**

- Modify: `tests/integration/pdf-rendering.test.ts`

**Step 1: Add test that verifies canvas has rendered content**

Add new test case:

```typescript
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
```

**Step 2: Run test**

Run: `npx playwright test tests/integration/pdf-rendering.test.ts --project=integration`

Expected: PASS - canvas should have content

---

## Task 5: Add Page Navigation Test

**Files:**

- Modify: `tests/integration/pdf-rendering.test.ts`

**Step 1: Add test for page navigation**

```typescript
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
```

**Step 2: Run all tests**

Run: `npx playwright test tests/integration/pdf-rendering.test.ts --project=integration`

Expected: All 3 tests PASS

---

## Task 6: Add Error Scenario Test (Regression Prevention)

**Files:**

- Modify: `tests/integration/pdf-rendering.test.ts`

**Step 1: Add test that specifically checks for the fixed bug pattern**

```typescript
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
```

**Step 2: Run final test suite**

Run: `npx playwright test tests/integration/pdf-rendering.test.ts --project=integration -v`

Expected: All 4 tests PASS

---

## Task 7: Commit and Push

**Step 1: Format and lint**

Run: `npm run format && npm run lint:fix`

**Step 2: Run full test suite**

Run: `npm run test:unit && npm run test:components && npx playwright test --project=integration`

Expected: All tests pass

**Step 3: Commit**

```bash
git add tests/integration/pdf-rendering.test.ts src/App.tsx
git commit -m "$(cat <<'EOF'
test: add PDF rendering integration tests

Add Playwright tests that verify PDF rendering works end-to-end:
- Loads real PDF without ArrayBuffer detachment errors
- Verifies canvas renders visible content
- Tests page navigation
- Regression test for React StrictMode double-invoke bug

These tests catch the ArrayBuffer detachment bug that component tests
miss because they mock pdfjs-dist and don't use real Web Workers.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

**Step 4: Push**

Run: `git push`

---

## Verification Checklist

- [ ] `tests/integration/pdf-rendering.test.ts` exists with 4 test cases
- [ ] `src/App.tsx` has test event listener for `test:load-pdf`
- [ ] All integration tests pass: `npx playwright test --project=integration`
- [ ] No TypeScript errors: `npm run typecheck`
- [ ] Committed and pushed to PR branch

---

## Files Summary

| File                                      | Action | Purpose                                              |
| ----------------------------------------- | ------ | ---------------------------------------------------- |
| `tests/integration/pdf-rendering.test.ts` | Create | New test file with 4 test cases                      |
| `src/App.tsx`                             | Modify | Add test event listener for programmatic PDF loading |
