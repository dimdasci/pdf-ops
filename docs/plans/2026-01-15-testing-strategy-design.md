# Testing Strategy Design

## Overview

This document defines the testing strategy for the PDF Translator application, covering both the conversion workflow and the application layer (React components, Electron IPC, user workflows).

## Goals

- Provide meaningful feedback to developer agents during implementation
- Avoid mocked tests that provide no real value
- Test each layer with appropriate tools and frequency
- Balance test maintenance burden against actual value delivered

## Testing Pyramid

```
               /\
              /  \         WORKFLOW (1-2 tests)
             / $$ \        Real Electron + Real LLM
            /──────\       Pre-merge, nightly
           /        \
          /          \     IPC INTEGRATION (5-10 tests)
         / Playwright \    Real Electron IPC
        /──────────────\   Every PR
       /                \
      /   COMPONENTS     \ (20-30 tests)
     /  Vitest + RTL      \ Mock Electron bridge only
    /──────────────────────\ Pre-commit
   /                        \
  /      EFFECT UNIT         \ (10-15 tests)
 /    @effect/vitest          \ TestClock, pure logic
/______________________________\ Pre-commit
```

**Existing E2E tests** (conversion.test.ts, pipeline.test.ts) remain separate as accuracy benchmarks.

## Layer 1: Effect Unit Tests

**Purpose:** Test Effect machinery (retry logic, error classification, rate limiting) without waiting for real delays or calling LLMs.

**Tooling:**

- `@effect/vitest` - Effect-native test utilities
- `TestClock` - Control time to test schedules instantly

**What to test:**

| Test                                         | Why Valuable                                                |
| -------------------------------------------- | ----------------------------------------------------------- |
| `classifyError()` returns correct error type | Pure logic, catches regressions when error patterns change  |
| Retry schedule respects exponential backoff  | TestClock advances time instantly, verifies math is correct |
| Rate limiter enforces concurrency limit      | Verifies semaphore logic without real delays                |
| `isRetryableError()` for edge cases          | Documents which errors trigger retries                      |

**What NOT to test:**

- Effect library internals (trust the library)
- Actual LLM responses (that's E2E's job)

**Run frequency:** Every commit (pre-commit hook)

## Layer 2: React Component Tests

**Purpose:** Test React behavior and user interactions without launching Electron.

**Tooling:**

- Vitest (already installed)
- `@testing-library/react` - User-centric testing
- `@testing-library/user-event` - Realistic interactions
- `jsdom` environment

**The Electron mock:**

```typescript
// tests/setup/electron-mock.ts
export const createElectronMock = () => ({
  getFilePath: (file: File) => `/mock/path/${file.name}`,
  readFileBuffer: async () => new Uint8Array([]),
  getApiKeys: async () => ({ gemini: '', anthropic: '' }),
  saveApiKeys: async () => {},
  saveMarkdownFile: async () => true,
})
```

This mock is justified because:

1. Real IPC is tested in Layer 3
2. It's a stable boundary (our own API contract)
3. Keeps component tests fast (~50ms each)

**What to test per component:**

| Component       | Test Cases                                                                  |
| --------------- | --------------------------------------------------------------------------- |
| `DropZone`      | Accepts PDF files, rejects non-PDF, shows drag feedback                     |
| `SettingsModal` | Loads keys on open, saves on click, validates inputs                        |
| `Workspace`     | Shows loading state, displays conversion progress, enables export when done |

**What NOT to test:**

- "Does it render" tests (zero value)
- CSS classes or styling
- Third-party components (ReactMarkdown, pdf.js)

**Run frequency:** Every commit (pre-commit hook)

## Layer 3: Electron IPC Integration Tests

**Purpose:** Test that main process and renderer communicate correctly through real IPC - no mocks.

**Tooling:**

- Playwright with `@playwright/test`
- Electron fixture (`_electron as electron`)

**How it works:**

Playwright launches the actual Electron app and provides handles to both processes:

```typescript
const electronApp = await electron.launch({
  args: ['dist-electron/main.js'],
  env: { NODE_ENV: 'test' },
})
const window = await electronApp.firstWindow()

// Execute code in renderer
const result = await window.evaluate(async () => {
  return window.electronAPI.getApiKeys()
})

// Execute code in main process
await electronApp.evaluate(async ({ dialog }) => {
  dialog.showSaveDialog = async () => ({
    canceled: false,
    filePath: '/tmp/test.md',
  })
})
```

**What to test:**

| IPC Handler                  | Test Case                             |
| ---------------------------- | ------------------------------------- |
| `readFileBuffer`             | Returns correct bytes for test PDF    |
| `getApiKeys` / `saveApiKeys` | Round-trip preserves values           |
| `saveMarkdownFile`           | Creates file at chosen path           |
| Error cases                  | Invalid path returns error, not crash |

**What NOT to test:**

- Electron's IPC mechanism itself
- OS keychain internals (trust keytar)
- Window lifecycle (unless custom logic)

**Prerequisite:** App must be built (`npm run build`) before tests run.

**Run frequency:** Every PR (CI pipeline)

## Layer 4: Workflow Tests (Full E2E)

**Purpose:** Verify the complete user journey works end-to-end with real LLM calls.

**Tooling:**

- Same Playwright + Electron setup as Layer 3
- Real API keys from environment

**The critical workflow to test:**

```
Settings → Load PDF → Convert → Verify Output → Export
```

One comprehensive test provides more value than many shallow ones:

```typescript
test('complete conversion workflow', async () => {
  // 1. Open settings, enter API key, save
  // 2. Drop/select a small test PDF (arxiv-roadmap, 4 pages)
  // 3. Click Convert, wait for completion (up to 5 min)
  // 4. Verify markdown has reasonable content (>1000 chars)
  // 5. Export to file, verify file exists
})
```

**Cost and flakiness controls:**

| Control       | Approach                                                           |
| ------------- | ------------------------------------------------------------------ |
| **Cost**      | Use smallest fixture (4 pages), skip unless `RUN_WORKFLOW_TESTS=1` |
| **Flakiness** | Allow 1 retry, generous timeout (5 min)                            |
| **CI budget** | Run only pre-merge and nightly, not every push                     |

**What to test:**

- Happy path: Full conversion succeeds
- Error recovery: Invalid API key shows error, allows retry
- State persistence: Settings survive app restart

**What NOT to test:**

- LLM output quality (existing E2E benchmarks cover this)
- Every UI state and button

**Run frequency:** Pre-merge gate + nightly regression

## File Structure

```
tests/
├── e2e/                          # EXISTING - keep as-is
│   ├── conversion.test.ts        # Accuracy benchmarks
│   └── pipeline.test.ts
├── unit/                         # NEW - Effect logic
│   └── effect-wrapper.test.ts
├── components/                   # NEW - React components
│   ├── DropZone.test.tsx
│   ├── SettingsModal.test.tsx
│   └── Workspace.test.tsx
├── integration/                  # NEW - Electron IPC
│   └── ipc.test.ts
├── workflows/                    # NEW - Full E2E
│   └── conversion-workflow.test.ts
├── setup/
│   ├── vitest.setup.ts           # EXISTING
│   ├── component.setup.ts        # NEW
│   └── electron-mock.ts          # NEW
├── vitest.config.ts              # EXISTING - E2E benchmarks
└── vitest.component.config.ts    # NEW - Components + Unit
playwright.config.ts              # NEW - Integration + Workflows
```

## Dependencies

```bash
npm install -D @effect/vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom @playwright/test
```

## NPM Scripts

```json
{
  "scripts": {
    "test:unit": "vitest run --config tests/vitest.component.config.ts --testPathPattern=unit",
    "test:components": "vitest run --config tests/vitest.component.config.ts --testPathPattern=components",
    "test:integration": "playwright test tests/integration/",
    "test:workflow": "RUN_WORKFLOW_TESTS=1 playwright test tests/workflows/",
    "test:e2e": "vitest run --config tests/vitest.config.ts",
    "test": "npm run test:unit && npm run test:components",
    "test:ci": "npm run test && npm run test:integration"
  }
}
```

## Execution Schedule

| Test Suite        | Trigger                | Duration | Cost      |
| ----------------- | ---------------------- | -------- | --------- |
| Unit + Components | Pre-commit hook        | ~5 sec   | Free      |
| Integration       | CI on every PR         | ~30 sec  | Free      |
| Workflow          | Pre-merge + nightly    | ~5 min   | API calls |
| E2E Benchmarks    | Manual / accuracy work | ~15 min  | API calls |

## Key Principles

1. **Each layer tests something the others cannot** - no duplicate coverage
2. **Mock only at boundaries** - Electron bridge mock is justified, LLM mocks are not
3. **Real API calls for quality gates** - existing E2E benchmarks validate accuracy
4. **Cost control** - expensive tests run less frequently
5. **Fast feedback loop** - unit and component tests run pre-commit
