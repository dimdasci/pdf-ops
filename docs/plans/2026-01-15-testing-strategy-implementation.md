# Testing Strategy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the 4-layer testing pyramid for PDF Translator: Effect unit tests, React component tests, Electron IPC integration tests, and full workflow E2E tests.

**Architecture:** Add testing infrastructure in layers - start with fast unit tests (Effect logic with TestClock), then component tests (Vitest + RTL with mocked Electron bridge), then IPC integration (Playwright + real Electron), finally workflow tests (real LLM calls). Each layer tests what others cannot.

**Tech Stack:** @effect/vitest, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom, @playwright/test, jsdom, vitest

---

## Phase 1: Infrastructure Setup

### Task 1: Install Testing Dependencies

**Files:**

- Modify: `package.json`

**Step 1: Install dev dependencies**

Run:

```bash
npm install -D @effect/vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom @playwright/test
```

**Step 2: Verify installation**

Run: `npm ls @effect/vitest @testing-library/react @playwright/test`
Expected: All three packages listed without errors

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore: add testing dependencies for new test layers

- @effect/vitest for Effect unit tests with TestClock
- @testing-library/react + user-event + jest-dom for component tests
- @playwright/test for Electron IPC and workflow tests
- jsdom for component test environment

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Create Vitest Component Configuration

**Files:**

- Create: `tests/vitest.component.config.ts`

**Step 1: Write the failing test (verify config is missing)**

Run: `npx vitest run --config tests/vitest.component.config.ts 2>&1 | head -5`
Expected: Error about config file not found

**Step 2: Create vitest component config**

Create `tests/vitest.component.config.ts`:

```typescript
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/components/**/*.test.tsx',
    ],
    setupFiles: ['./tests/setup/component.setup.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
```

**Step 3: Verify config loads**

Run: `npx vitest run --config tests/vitest.component.config.ts --passWithNoTests`
Expected: "No test files found" (not a config error)

**Step 4: Commit**

```bash
git add tests/vitest.component.config.ts
git commit -m "$(cat <<'EOF'
chore: add vitest config for unit and component tests

- jsdom environment for React component testing
- Includes tests/unit/ and tests/components/ directories
- Uses component.setup.ts for test setup

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Create Component Test Setup File

**Files:**

- Create: `tests/setup/component.setup.ts`

**Step 1: Create setup file**

Create `tests/setup/component.setup.ts`:

```typescript
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock window.electronAPI for component tests
const mockElectronAPI = {
  getFilePath: vi.fn((file: File) => `/mock/path/${file.name}`),
  readFileBuffer: vi.fn(async () => new Uint8Array([])),
  getApiKey: vi.fn(async () => null),
  saveApiKey: vi.fn(async () => true),
  getApiKeys: vi.fn(async () => ({ gemini: '', anthropic: '' })),
  saveApiKeys: vi.fn(async () => true),
  getProviderKey: vi.fn(async () => null),
  saveProviderKey: vi.fn(async () => true),
  saveMarkdownFile: vi.fn(async () => true),
}

// Attach to window
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})

// Export for test access
export { mockElectronAPI }
```

**Step 2: Verify setup loads**

Run: `npx vitest run --config tests/vitest.component.config.ts --passWithNoTests`
Expected: No errors, "No test files found"

**Step 3: Commit**

```bash
git add tests/setup/component.setup.ts
git commit -m "$(cat <<'EOF'
chore: add component test setup with Electron mock

- Imports jest-dom matchers for Vitest
- Auto-cleanup after each test
- Mocks window.electronAPI with vi.fn() for verification

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Create Playwright Configuration

**Files:**

- Create: `playwright.config.ts`

**Step 1: Create playwright config**

Create `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: [
    'integration/**/*.test.ts',
    'workflows/**/*.test.ts',
  ],
  timeout: 60000,
  retries: 1,
  workers: 1, // Electron tests must run serially
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'integration',
      testMatch: 'integration/**/*.test.ts',
      timeout: 30000,
    },
    {
      name: 'workflows',
      testMatch: 'workflows/**/*.test.ts',
      timeout: 300000, // 5 min for LLM calls
    },
  ],
})
```

**Step 2: Verify config loads**

Run: `npx playwright test --list 2>&1 | head -5`
Expected: "no tests found" or empty list (not a config error)

**Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "$(cat <<'EOF'
chore: add Playwright config for integration and workflow tests

- Serial execution (workers: 1) for Electron stability
- 30s timeout for integration, 5min for workflow tests
- Trace on first retry for debugging

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Create Test Directory Structure

**Files:**

- Create: `tests/unit/.gitkeep`
- Create: `tests/components/.gitkeep`
- Create: `tests/integration/.gitkeep`
- Create: `tests/workflows/.gitkeep`

**Step 1: Create directories**

Run:

```bash
mkdir -p tests/unit tests/components tests/integration tests/workflows && touch tests/unit/.gitkeep tests/components/.gitkeep tests/integration/.gitkeep tests/workflows/.gitkeep
```

**Step 2: Verify structure**

Run: `ls -la tests/`
Expected: unit/, components/, integration/, workflows/ directories exist

**Step 3: Commit**

```bash
git add tests/unit/.gitkeep tests/components/.gitkeep tests/integration/.gitkeep tests/workflows/.gitkeep
git commit -m "$(cat <<'EOF'
chore: create test directory structure

- tests/unit/ for Effect logic tests
- tests/components/ for React component tests
- tests/integration/ for Electron IPC tests
- tests/workflows/ for full E2E tests

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Update Package.json Scripts

**Files:**

- Modify: `package.json`

**Step 1: Read current scripts**

Read `package.json` to see current test scripts.

**Step 2: Add new test scripts**

Add to `package.json` scripts section:

```json
{
  "scripts": {
    "test:unit": "vitest run --config tests/vitest.component.config.ts --testPathPattern=unit",
    "test:components": "vitest run --config tests/vitest.component.config.ts --testPathPattern=components",
    "test:integration": "playwright test --project=integration",
    "test:workflow": "RUN_WORKFLOW_TESTS=1 playwright test --project=workflows",
    "test": "npm run test:unit && npm run test:components",
    "test:ci": "npm run test && npm run test:integration"
  }
}
```

Note: Preserve existing `test:e2e` and `test:e2e:watch` scripts.

**Step 3: Verify scripts run**

Run: `npm run test -- --passWithNoTests`
Expected: Both unit and components pass (no tests yet)

**Step 4: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
chore: add npm scripts for new test layers

- test:unit - Effect logic tests
- test:components - React component tests
- test:integration - Electron IPC tests
- test:workflow - Full E2E with real LLM
- test - Runs unit + components (pre-commit)
- test:ci - Runs test + integration (CI pipeline)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Layer 1 - Effect Unit Tests

### Task 7: Create Effect Wrapper Test File Structure

**Files:**

- Create: `tests/unit/effect-wrapper.test.ts`

**Step 1: Create test file with imports**

Create `tests/unit/effect-wrapper.test.ts`:

```typescript
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, Ref, TestClock } from 'effect'

// Import from effect-wrapper (adjust path based on actual exports)
import {
  APIError,
  classifyError,
  createRetrySchedule,
  isRetryableError,
  RateLimitError,
  TimeoutError,
} from '../../src/lib/pipeline/effect-wrapper'

describe('Effect Wrapper', () => {
  describe('classifyError', () => {
    // Tests will be added in subsequent tasks
  })

  describe('isRetryableError', () => {
    // Tests will be added in subsequent tasks
  })

  describe('Retry Schedule', () => {
    // Tests will be added in subsequent tasks
  })
})
```

**Step 2: Verify test file is discovered**

Run: `npm run test:unit -- --passWithNoTests`
Expected: Test file found but no tests run yet

**Step 3: Commit**

```bash
git add tests/unit/effect-wrapper.test.ts
git commit -m "$(cat <<'EOF'
test: scaffold Effect wrapper test file

- Imports @effect/vitest test utilities
- Imports Effect, TestClock, Fiber, Ref for time control
- Sets up describe blocks for each test category

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Test classifyError - Rate Limit Detection

**Files:**

- Modify: `tests/unit/effect-wrapper.test.ts`

**Step 1: Write the failing test**

Add to `describe('classifyError')`:

```typescript
it.effect('returns RateLimitError for rate limit messages', () =>
  Effect.gen(function*() {
    const error = new Error('rate limit exceeded')
    const result = classifyError(error)

    assert.ok(result._tag === 'RateLimitError')
  }))

it.effect('returns RateLimitError for 429 status', () =>
  Effect.gen(function*() {
    const error = new Error('HTTP 429 Too Many Requests')
    const result = classifyError(error)

    assert.ok(result._tag === 'RateLimitError')
  }))
```

**Step 2: Run test to verify it fails or passes**

Run: `npm run test:unit`
Expected: Tests pass if classifyError is correctly implemented, or fail with specific error message

**Step 3: If tests fail, examine classifyError implementation**

Read `src/lib/pipeline/effect-wrapper.ts` to understand the actual error classification logic and adjust tests to match.

**Step 4: Commit when tests pass**

```bash
git add tests/unit/effect-wrapper.test.ts
git commit -m "$(cat <<'EOF'
test: add classifyError tests for rate limit detection

- Verifies 'rate limit' message patterns
- Verifies HTTP 429 status detection

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Test classifyError - Timeout Detection

**Files:**

- Modify: `tests/unit/effect-wrapper.test.ts`

**Step 1: Write the failing test**

Add to `describe('classifyError')`:

```typescript
it.effect('returns TimeoutError for timeout messages', () =>
  Effect.gen(function*() {
    const error = new Error('Request timeout after 30s')
    const result = classifyError(error)

    assert.ok(result._tag === 'TimeoutError')
  }))

it.effect('returns TimeoutError for ETIMEDOUT', () =>
  Effect.gen(function*() {
    const error = new Error('ETIMEDOUT')
    const result = classifyError(error)

    assert.ok(result._tag === 'TimeoutError')
  }))
```

**Step 2: Run test to verify**

Run: `npm run test:unit`
Expected: Tests pass

**Step 3: Commit**

```bash
git add tests/unit/effect-wrapper.test.ts
git commit -m "$(cat <<'EOF'
test: add classifyError tests for timeout detection

- Verifies 'timeout' message patterns
- Verifies ETIMEDOUT error detection

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Test classifyError - API Error with Status Code

**Files:**

- Modify: `tests/unit/effect-wrapper.test.ts`

**Step 1: Write the failing test**

Add to `describe('classifyError')`:

```typescript
it.effect('returns APIError with status code for HTTP errors', () =>
  Effect.gen(function*() {
    const error = new Error('Request failed with status: 500')
    const result = classifyError(error)

    assert.ok(result._tag === 'APIError')
    if (result._tag === 'APIError') {
      assert.strictEqual(result.statusCode, 500)
      assert.strictEqual(result.isRetryable, true)
    }
  }))

it.effect('returns APIError with isRetryable=false for 4xx', () =>
  Effect.gen(function*() {
    const error = new Error('Request failed with status: 400')
    const result = classifyError(error)

    assert.ok(result._tag === 'APIError')
    if (result._tag === 'APIError') {
      assert.strictEqual(result.statusCode, 400)
      assert.strictEqual(result.isRetryable, false)
    }
  }))
```

**Step 2: Run test to verify**

Run: `npm run test:unit`
Expected: Tests pass

**Step 3: Commit**

```bash
git add tests/unit/effect-wrapper.test.ts
git commit -m "$(cat <<'EOF'
test: add classifyError tests for API error status codes

- Verifies 5xx errors marked as retryable
- Verifies 4xx errors marked as non-retryable

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Test isRetryableError - Edge Cases

**Files:**

- Modify: `tests/unit/effect-wrapper.test.ts`

**Step 1: Write the failing test**

Add to `describe('isRetryableError')`:

```typescript
it.effect('returns true for RateLimitError', () =>
  Effect.gen(function*() {
    const error = new RateLimitError('rate limit', 5000)
    assert.strictEqual(isRetryableError(error), true)
  }))

it.effect('returns true for retryable APIError', () =>
  Effect.gen(function*() {
    const error = new APIError('server error', 500, true)
    assert.strictEqual(isRetryableError(error), true)
  }))

it.effect('returns false for non-retryable APIError', () =>
  Effect.gen(function*() {
    const error = new APIError('bad request', 400, false)
    assert.strictEqual(isRetryableError(error), false)
  }))

it.effect('returns true for network errors', () =>
  Effect.gen(function*() {
    const patterns = ['ECONNRESET', 'ENOTFOUND', 'network error']
    for (const pattern of patterns) {
      const error = new Error(pattern)
      assert.strictEqual(isRetryableError(error), true, `Expected "${pattern}" retryable`)
    }
  }))

it.effect('returns false for auth errors', () =>
  Effect.gen(function*() {
    const error = new Error('Invalid API key')
    assert.strictEqual(isRetryableError(error), false)
  }))
```

**Step 2: Run test to verify**

Run: `npm run test:unit`
Expected: Tests pass

**Step 3: Commit**

```bash
git add tests/unit/effect-wrapper.test.ts
git commit -m "$(cat <<'EOF'
test: add isRetryableError edge case tests

- Verifies RateLimitError always retryable
- Verifies APIError respects isRetryable flag
- Verifies network errors are retryable
- Verifies auth errors are not retryable

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Test Retry Schedule with TestClock

**Files:**

- Modify: `tests/unit/effect-wrapper.test.ts`

**Step 1: Write the test for exponential backoff**

Add to `describe('Retry Schedule')`:

```typescript
it.scoped('exponential backoff respects configured delays', () =>
  Effect.gen(function*() {
    const retryTimes: number[] = []
    const startTime = yield* TestClock.currentTimeMillis
    let attemptCount = 0

    const failingEffect = Effect.gen(function*() {
      attemptCount++
      const currentTime = yield* TestClock.currentTimeMillis
      retryTimes.push(currentTime - startTime)
      return yield* Effect.fail(new Error('rate limit'))
    })

    const schedule = createRetrySchedule({
      baseDelay: 1000,
      maxDelay: 30000,
      maxAttempts: 4,
      factor: 2,
    })

    const retriedEffect = Effect.retry(failingEffect, schedule)
    const fiber = yield* Effect.fork(retriedEffect)

    // Advance time for each retry
    yield* TestClock.adjust('0 millis')
    yield* TestClock.adjust('1 second')
    yield* TestClock.adjust('2 seconds')
    yield* TestClock.adjust('4 seconds')

    yield* Fiber.await(fiber)

    // Verify exponential timing
    assert.strictEqual(retryTimes[0], 0) // First attempt immediate
    assert.ok(retryTimes[1] >= 1000, `2nd attempt at ${retryTimes[1]}ms`)
    assert.ok(retryTimes[2] >= 3000, `3rd attempt at ${retryTimes[2]}ms`)
    assert.ok(retryTimes[3] >= 7000, `4th attempt at ${retryTimes[3]}ms`)
  }))
```

**Step 2: Run test to verify**

Run: `npm run test:unit`
Expected: Test passes, verifying exponential backoff math

**Step 3: Commit**

```bash
git add tests/unit/effect-wrapper.test.ts
git commit -m "$(cat <<'EOF'
test: add retry schedule test with TestClock

- Uses TestClock to verify exponential backoff
- Confirms base delay doubles each retry
- No real time delays in test execution

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Test Rate Limiter Concurrency

**Files:**

- Modify: `tests/unit/effect-wrapper.test.ts`

**Step 1: Write the test**

Add new describe block:

```typescript
describe('Rate Limiter', () => {
  it.scoped('enforces concurrency limit', () =>
    Effect.gen(function*() {
      const { createRateLimiter } = await import('../../src/lib/pipeline/effect-wrapper')
      const rateLimiter = yield* createRateLimiter({ concurrency: 2, minDelayMs: 0 })

      const maxConcurrent = yield* Ref.make(0)
      const currentConcurrent = yield* Ref.make(0)

      const task = (id: number) =>
        rateLimiter.withRateLimit(
          Effect.gen(function*() {
            const current = yield* Ref.updateAndGet(currentConcurrent, n => n + 1)
            yield* Ref.update(maxConcurrent, max => Math.max(max, current))
            yield* Effect.sleep('100 millis')
            yield* Ref.update(currentConcurrent, n => n - 1)
            return id
          }),
        )

      const fiber = yield* Effect.fork(
        Effect.all([task(1), task(2), task(3), task(4), task(5)], {
          concurrency: 'unbounded',
        }),
      )

      yield* TestClock.adjust('500 millis')
      const results = yield* Fiber.join(fiber)

      const observedMax = yield* Ref.get(maxConcurrent)
      assert.ok(observedMax <= 2, `Max concurrent was ${observedMax}, expected <= 2`)
      assert.deepStrictEqual(results.sort(), [1, 2, 3, 4, 5])
    }))
})
```

**Step 2: Run test to verify**

Run: `npm run test:unit`
Expected: Test passes, concurrency limited to 2

**Step 3: Commit**

```bash
git add tests/unit/effect-wrapper.test.ts
git commit -m "$(cat <<'EOF'
test: add rate limiter concurrency test

- Verifies semaphore enforces max concurrent operations
- Uses TestClock to avoid real delays
- Confirms all operations complete successfully

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Layer 2 - React Component Tests

### Task 14: Create DropZone Test File

**Files:**

- Create: `tests/components/DropZone.test.tsx`

**Step 1: Write the failing test**

Create `tests/components/DropZone.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DropZone } from '../../src/components/DropZone'

describe('DropZone', () => {
  const mockOnFileSelect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders drop zone with instruction text', () => {
    render(<DropZone onFileSelect={mockOnFileSelect} />)

    expect(screen.getByText(/drop.*pdf/i)).toBeInTheDocument()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test:components`
Expected: Fails - need to verify actual DropZone text content

**Step 3: Read DropZone component to get actual text**

Read `src/components/DropZone.tsx` to find the exact instruction text.

**Step 4: Update test with correct text**

Update the test to match actual component text.

**Step 5: Commit when test passes**

```bash
git add tests/components/DropZone.test.tsx
git commit -m "$(cat <<'EOF'
test: add DropZone render test

- Verifies drop zone renders with instruction text
- Uses @testing-library/react for user-centric testing

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Test DropZone Accepts PDF Files

**Files:**

- Modify: `tests/components/DropZone.test.tsx`

**Step 1: Write the test**

Add to `describe('DropZone')`:

```typescript
it('calls onFileSelect when PDF file is selected', async () => {
  const user = userEvent.setup()
  render(<DropZone onFileSelect={mockOnFileSelect} />)

  const input = screen.getByRole('button') // or however file input is exposed
  const file = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' })

  // Mock the electronAPI.getFilePath
  window.electronAPI.getFilePath = vi.fn().mockReturnValue('/mock/path/test.pdf')

  await user.upload(input, file)

  expect(mockOnFileSelect).toHaveBeenCalledWith('/mock/path/test.pdf')
})
```

**Step 2: Run test to verify**

Run: `npm run test:components`
Expected: Test passes

**Step 3: Commit**

```bash
git add tests/components/DropZone.test.tsx
git commit -m "$(cat <<'EOF'
test: add DropZone PDF file selection test

- Verifies onFileSelect called with file path
- Mocks electronAPI.getFilePath for path resolution

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Test DropZone Rejects Non-PDF Files

**Files:**

- Modify: `tests/components/DropZone.test.tsx`

**Step 1: Write the test**

Add to `describe('DropZone')`:

```typescript
it('does not call onFileSelect for non-PDF files', async () => {
  const user = userEvent.setup()
  render(<DropZone onFileSelect={mockOnFileSelect} />)

  const input = screen.getByRole('button')
  const file = new File(['text content'], 'test.txt', { type: 'text/plain' })

  await user.upload(input, file)

  expect(mockOnFileSelect).not.toHaveBeenCalled()
})
```

**Step 2: Run test to verify**

Run: `npm run test:components`
Expected: Test passes

**Step 3: Commit**

```bash
git add tests/components/DropZone.test.tsx
git commit -m "$(cat <<'EOF'
test: add DropZone PDF-only validation test

- Verifies non-PDF files are rejected
- onFileSelect not called for invalid files

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Test DropZone Drag Feedback

**Files:**

- Modify: `tests/components/DropZone.test.tsx`

**Step 1: Write the test**

Add to `describe('DropZone')`:

```typescript
it('shows visual feedback during drag over', async () => {
  render(<DropZone onFileSelect={mockOnFileSelect} />)

  const dropZone = screen.getByTestId('drop-zone') // or appropriate selector

  // Simulate drag enter
  fireEvent.dragEnter(dropZone, {
    dataTransfer: { types: ['Files'] },
  })

  // Check for visual feedback class or style
  expect(dropZone).toHaveClass('drag-over') // or appropriate indicator
})
```

**Step 2: Run test to verify**

Run: `npm run test:components`
Expected: Test passes (may need adjustment based on actual implementation)

**Step 3: Commit**

```bash
git add tests/components/DropZone.test.tsx
git commit -m "$(cat <<'EOF'
test: add DropZone drag feedback test

- Verifies visual feedback during drag over
- Tests isDragOver state changes

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: Create SettingsModal Test File

**Files:**

- Create: `tests/components/SettingsModal.test.tsx`

**Step 1: Write the test**

Create `tests/components/SettingsModal.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from '../../src/components/SettingsModal'

describe('SettingsModal', () => {
  const mockOnClose = vi.fn()
  const mockOnKeysChanged = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    window.electronAPI.getApiKeys = vi.fn().mockResolvedValue({
      gemini: 'existing-gemini-key',
      anthropic: 'existing-anthropic-key',
    })
  })

  it('loads existing API keys on open', async () => {
    render(
      <SettingsModal
        isOpen={true}
        onClose={mockOnClose}
        onKeysChanged={mockOnKeysChanged}
      />,
    )

    await waitFor(() => {
      expect(window.electronAPI.getApiKeys).toHaveBeenCalled()
    })

    // Verify keys are displayed in inputs
    const geminiInput = screen.getByLabelText(/gemini/i)
    expect(geminiInput).toHaveValue('existing-gemini-key')
  })
})
```

**Step 2: Run test to verify**

Run: `npm run test:components`
Expected: Test passes

**Step 3: Commit**

```bash
git add tests/components/SettingsModal.test.tsx
git commit -m "$(cat <<'EOF'
test: add SettingsModal load keys test

- Verifies getApiKeys called on modal open
- Verifies keys displayed in input fields

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Test SettingsModal Save Keys

**Files:**

- Modify: `tests/components/SettingsModal.test.tsx`

**Step 1: Write the test**

Add to `describe('SettingsModal')`:

```typescript
it('saves API keys when save button clicked', async () => {
  const user = userEvent.setup()
  window.electronAPI.saveApiKeys = vi.fn().mockResolvedValue(true)

  render(
    <SettingsModal
      isOpen={true}
      onClose={mockOnClose}
      onKeysChanged={mockOnKeysChanged}
    />,
  )

  await waitFor(() => {
    expect(screen.getByLabelText(/gemini/i)).toBeInTheDocument()
  })

  // Clear and enter new key
  const geminiInput = screen.getByLabelText(/gemini/i)
  await user.clear(geminiInput)
  await user.type(geminiInput, 'new-gemini-key')

  // Click save
  const saveButton = screen.getByRole('button', { name: /save/i })
  await user.click(saveButton)

  await waitFor(() => {
    expect(window.electronAPI.saveApiKeys).toHaveBeenCalledWith(
      expect.objectContaining({ gemini: 'new-gemini-key' }),
    )
  })
})
```

**Step 2: Run test to verify**

Run: `npm run test:components`
Expected: Test passes

**Step 3: Commit**

```bash
git add tests/components/SettingsModal.test.tsx
git commit -m "$(cat <<'EOF'
test: add SettingsModal save keys test

- Verifies saveApiKeys called on save click
- Verifies new key values passed correctly

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: Test SettingsModal Input Validation

**Files:**

- Modify: `tests/components/SettingsModal.test.tsx`

**Step 1: Write the test**

Add to `describe('SettingsModal')`:

```typescript
it('shows validation status for API keys', async () => {
  render(
    <SettingsModal
      isOpen={true}
      onClose={mockOnClose}
      onKeysChanged={mockOnKeysChanged}
    />,
  )

  await waitFor(() => {
    expect(screen.getByLabelText(/gemini/i)).toBeInTheDocument()
  })

  // Look for validation status indicators
  // This depends on actual implementation - adjust selectors
  const statusIndicator = screen.queryByTestId('gemini-status')
  expect(statusIndicator).toBeInTheDocument()
})
```

**Step 2: Run test to verify**

Run: `npm run test:components`
Expected: Test passes (may need selector adjustment)

**Step 3: Commit**

```bash
git add tests/components/SettingsModal.test.tsx
git commit -m "$(cat <<'EOF'
test: add SettingsModal validation status test

- Verifies validation indicators are displayed
- Tests status for each provider key

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 21: Create Workspace Test File

**Files:**

- Create: `tests/components/Workspace.test.tsx`

**Step 1: Write the test**

Create `tests/components/Workspace.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Workspace } from '../../src/components/Workspace'

// Mock pdf.js to avoid canvas issues in jsdom
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn().mockReturnValue({
    promise: Promise.resolve({
      numPages: 3,
      getPage: vi.fn().mockResolvedValue({
        getViewport: vi.fn().mockReturnValue({ width: 600, height: 800 }),
        render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
      }),
    }),
  }),
}))

describe('Workspace', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    window.electronAPI.readFileBuffer = vi.fn().mockResolvedValue(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]), // PDF header
    )
  })

  it('shows loading state while PDF loads', () => {
    render(<Workspace filePath="/test/doc.pdf" onClose={mockOnClose} />)

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })
})
```

**Step 2: Run test to verify**

Run: `npm run test:components`
Expected: Test passes

**Step 3: Commit**

```bash
git add tests/components/Workspace.test.tsx
git commit -m "$(cat <<'EOF'
test: add Workspace loading state test

- Mocks pdf.js to avoid canvas issues
- Verifies loading state displayed initially

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: Test Workspace PDF Display

**Files:**

- Modify: `tests/components/Workspace.test.tsx`

**Step 1: Write the test**

Add to `describe('Workspace')`:

```typescript
it('displays PDF page count after loading', async () => {
  render(<Workspace filePath="/test/doc.pdf" onClose={mockOnClose} />)

  await waitFor(() => {
    expect(screen.getByText(/3.*pages?/i)).toBeInTheDocument()
  })
})
```

**Step 2: Run test to verify**

Run: `npm run test:components`
Expected: Test passes

**Step 3: Commit**

```bash
git add tests/components/Workspace.test.tsx
git commit -m "$(cat <<'EOF'
test: add Workspace PDF page count test

- Verifies page count displayed after load
- Uses mocked pdf.js with 3 pages

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: Test Workspace Export Button

**Files:**

- Modify: `tests/components/Workspace.test.tsx`

**Step 1: Write the test**

Add to `describe('Workspace')`:

```typescript
it('enables export button when conversion complete', async () => {
  // This test may need adjustment based on actual state management
  render(<Workspace filePath="/test/doc.pdf" onClose={mockOnClose} />)

  await waitFor(() => {
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
  })

  // Export button should exist but may be disabled initially
  const exportButton = screen.getByRole('button', { name: /export/i })
  expect(exportButton).toBeInTheDocument()
})
```

**Step 2: Run test to verify**

Run: `npm run test:components`
Expected: Test passes

**Step 3: Commit**

```bash
git add tests/components/Workspace.test.tsx
git commit -m "$(cat <<'EOF'
test: add Workspace export button test

- Verifies export button exists in UI
- Foundation for export workflow tests

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Layer 3 - Electron IPC Integration Tests

### Task 24: Create IPC Test File

**Files:**

- Create: `tests/integration/ipc.test.ts`

**Step 1: Write the test structure**

Create `tests/integration/ipc.test.ts`:

```typescript
import { _electron as electron, ElectronApplication, expect, Page, test } from '@playwright/test'
import path from 'path'

let electronApp: ElectronApplication
let window: Page

test.beforeAll(async () => {
  // Build app first (assumes npm run build was run)
  electronApp = await electron.launch({
    args: [path.join(__dirname, '../../dist-electron/main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  })
  window = await electronApp.firstWindow()
})

test.afterAll(async () => {
  await electronApp.close()
})

test.describe('IPC Handlers', () => {
  test('getApiKeys returns empty object initially', async () => {
    const result = await window.evaluate(async () => {
      return window.electronAPI.getApiKeys()
    })

    expect(result).toEqual({ gemini: '', anthropic: '' })
  })
})
```

**Step 2: Build the app**

Run: `npm run build`
Expected: App builds successfully

**Step 3: Run test to verify**

Run: `npm run test:integration`
Expected: Test passes

**Step 4: Commit**

```bash
git add tests/integration/ipc.test.ts
git commit -m "$(cat <<'EOF'
test: add IPC integration test for getApiKeys

- Launches real Electron app with Playwright
- Tests actual IPC communication
- Verifies initial empty API keys state

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 25: Test IPC saveApiKeys/getApiKeys Round Trip

**Files:**

- Modify: `tests/integration/ipc.test.ts`

**Step 1: Write the test**

Add to `test.describe('IPC Handlers')`:

```typescript
test('saveApiKeys and getApiKeys round trip', async () => {
  const testKeys = {
    gemini: 'test-gemini-key-123',
    anthropic: 'test-anthropic-key-456',
  }

  // Save keys
  const saveResult = await window.evaluate(async keys => {
    return window.electronAPI.saveApiKeys(keys)
  }, testKeys)

  expect(saveResult).toBe(true)

  // Retrieve keys
  const getResult = await window.evaluate(async () => {
    return window.electronAPI.getApiKeys()
  })

  expect(getResult).toEqual(testKeys)
})
```

**Step 2: Run test to verify**

Run: `npm run test:integration`
Expected: Test passes

**Step 3: Commit**

```bash
git add tests/integration/ipc.test.ts
git commit -m "$(cat <<'EOF'
test: add IPC round-trip test for API keys

- Saves keys via saveApiKeys IPC
- Retrieves and verifies via getApiKeys
- Tests encrypted storage works correctly

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 26: Test IPC readFileBuffer

**Files:**

- Modify: `tests/integration/ipc.test.ts`

**Step 1: Write the test**

Add to `test.describe('IPC Handlers')`:

```typescript
test('readFileBuffer returns correct bytes for test PDF', async () => {
  const testPdfPath = path.join(__dirname, '../fixtures/arxiv-roadmap/source.pdf')

  const result = await window.evaluate(async filePath => {
    const buffer = await window.electronAPI.readFileBuffer(filePath)
    // Return first 4 bytes (PDF magic number)
    return Array.from(buffer.slice(0, 4))
  }, testPdfPath)

  // PDF files start with %PDF (0x25 0x50 0x44 0x46)
  expect(result).toEqual([0x25, 0x50, 0x44, 0x46])
})
```

**Step 2: Run test to verify**

Run: `npm run test:integration`
Expected: Test passes

**Step 3: Commit**

```bash
git add tests/integration/ipc.test.ts
git commit -m "$(cat <<'EOF'
test: add IPC readFileBuffer test

- Reads actual PDF fixture file
- Verifies PDF magic number in response
- Tests file system access from renderer

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 27: Test IPC Error Handling

**Files:**

- Modify: `tests/integration/ipc.test.ts`

**Step 1: Write the test**

Add to `test.describe('IPC Handlers')`:

```typescript
test('readFileBuffer returns error for invalid path', async () => {
  const invalidPath = '/nonexistent/path/to/file.pdf'

  const result = await window.evaluate(async filePath => {
    try {
      await window.electronAPI.readFileBuffer(filePath)
      return { success: true }
    } catch (error) {
      return { success: false, message: (error as Error).message }
    }
  }, invalidPath)

  expect(result.success).toBe(false)
  expect(result.message).toContain('ENOENT')
})
```

**Step 2: Run test to verify**

Run: `npm run test:integration`
Expected: Test passes

**Step 3: Commit**

```bash
git add tests/integration/ipc.test.ts
git commit -m "$(cat <<'EOF'
test: add IPC error handling test

- Verifies invalid path returns error
- Tests error propagation across IPC boundary
- Confirms app doesn't crash on bad input

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Layer 4 - Workflow Tests

### Task 28: Create Workflow Test File

**Files:**

- Create: `tests/workflows/conversion-workflow.test.ts`

**Step 1: Write the test**

Create `tests/workflows/conversion-workflow.test.ts`:

```typescript
import { _electron as electron, ElectronApplication, expect, Page, test } from '@playwright/test'
import path from 'path'

// Skip unless RUN_WORKFLOW_TESTS is set
test.skip(({}, testInfo) => {
  return !process.env.RUN_WORKFLOW_TESTS
}, 'Skipping workflow tests - set RUN_WORKFLOW_TESTS=1 to run')

let electronApp: ElectronApplication
let window: Page

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [path.join(__dirname, '../../dist-electron/main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  })
  window = await electronApp.firstWindow()
})

test.afterAll(async () => {
  await electronApp.close()
})

test.describe('Conversion Workflow', () => {
  test('complete conversion workflow', async () => {
    // 1. Enter API key in settings
    await window.click('[data-testid="settings-button"]')
    await window.fill('[data-testid="gemini-key-input"]', process.env.GEMINI_API_KEY!)
    await window.click('[data-testid="save-settings"]')

    // 2. Load test PDF
    const testPdfPath = path.join(__dirname, '../fixtures/arxiv-roadmap/source.pdf')
    // Trigger file selection via IPC (since we can't interact with system dialogs)
    await window.evaluate(async filePath => {
      // Simulate file selection - actual implementation depends on app architecture
      window.dispatchEvent(new CustomEvent('file-selected', { detail: filePath }))
    }, testPdfPath)

    // 3. Wait for PDF to load
    await expect(window.locator('[data-testid="page-count"]')).toHaveText(/4 pages/i, {
      timeout: 10000,
    })

    // 4. Start conversion
    await window.click('[data-testid="convert-button"]')

    // 5. Wait for completion (up to 5 minutes)
    await expect(window.locator('[data-testid="conversion-status"]')).toHaveText(/complete/i, {
      timeout: 300000,
    })

    // 6. Verify markdown output
    const markdownContent = await window.locator('[data-testid="markdown-output"]').textContent()
    expect(markdownContent!.length).toBeGreaterThan(1000)

    // 7. Verify export button is enabled
    await expect(window.locator('[data-testid="export-button"]')).toBeEnabled()
  })
})
```

**Step 2: Run test (with API key)**

Run: `RUN_WORKFLOW_TESTS=1 npm run test:workflow`
Expected: Test passes (requires valid API key in environment)

**Step 3: Commit**

```bash
git add tests/workflows/conversion-workflow.test.ts
git commit -m "$(cat <<'EOF'
test: add complete conversion workflow E2E test

- Full user journey: Settings -> Load PDF -> Convert -> Export
- Uses real LLM API calls
- 5-minute timeout for conversion
- Skipped unless RUN_WORKFLOW_TESTS=1

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 29: Test Workflow Error Recovery

**Files:**

- Modify: `tests/workflows/conversion-workflow.test.ts`

**Step 1: Write the test**

Add to `test.describe('Conversion Workflow')`:

```typescript
test('shows error and allows retry with invalid API key', async () => {
  // 1. Enter invalid API key
  await window.click('[data-testid="settings-button"]')
  await window.fill('[data-testid="gemini-key-input"]', 'invalid-key-12345')
  await window.click('[data-testid="save-settings"]')

  // 2. Try to convert
  const testPdfPath = path.join(__dirname, '../fixtures/arxiv-roadmap/source.pdf')
  await window.evaluate(async filePath => {
    window.dispatchEvent(new CustomEvent('file-selected', { detail: filePath }))
  }, testPdfPath)

  await window.click('[data-testid="convert-button"]')

  // 3. Verify error shown
  await expect(window.locator('[data-testid="error-message"]')).toBeVisible({
    timeout: 30000,
  })

  // 4. Verify can open settings to fix
  await expect(window.locator('[data-testid="settings-button"]')).toBeEnabled()
})
```

**Step 2: Run test**

Run: `RUN_WORKFLOW_TESTS=1 npm run test:workflow`
Expected: Test passes

**Step 3: Commit**

```bash
git add tests/workflows/conversion-workflow.test.ts
git commit -m "$(cat <<'EOF'
test: add workflow error recovery test

- Tests invalid API key shows error
- Verifies user can access settings to fix
- Tests graceful error handling

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6: Finalization

### Task 30: Update Pre-commit Hook

**Files:**

- Modify: `.husky/pre-commit`

**Step 1: Read current hook**

Read `.husky/pre-commit` to see current configuration.

**Step 2: Add unit and component tests**

Update `.husky/pre-commit` to run fast tests:

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Type checking
npm run typecheck

# Formatting
npm run format

# Linting
npm run lint

# Fast tests (unit + components)
npm run test
```

**Step 3: Verify hook runs**

Run: `git stash && git stash pop` (trigger hook manually is tricky, just commit)

**Step 4: Commit**

```bash
git add .husky/pre-commit
git commit -m "$(cat <<'EOF'
chore: add unit and component tests to pre-commit hook

- Runs test:unit and test:components before commit
- Fast feedback loop (~5 seconds)
- Catches regressions early

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 31: Create CI Workflow File

**Files:**

- Create: `.github/workflows/test.yml`

**Step 1: Create workflow file**

Create `.github/workflows/test.yml`:

```yaml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  unit-and-component:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test

  integration:
    runs-on: ubuntu-latest
    needs: unit-and-component
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: xvfb-run --auto-servernum npm run test:integration

  workflow:
    runs-on: ubuntu-latest
    needs: integration
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: xvfb-run --auto-servernum npm run test:workflow
        env:
          RUN_WORKFLOW_TESTS: '1'
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

**Step 2: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "$(cat <<'EOF'
ci: add GitHub Actions test workflow

- Unit + Component tests on every PR
- Integration tests after unit pass
- Workflow tests on main branch only (with secrets)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 32: Final Verification

**Step 1: Run all fast tests**

Run: `npm run test`
Expected: All unit and component tests pass

**Step 2: Run integration tests**

Run: `npm run build && npm run test:integration`
Expected: All IPC tests pass

**Step 3: Run full test suite summary**

Run: `npm run test:ci`
Expected: All tests pass

**Step 4: Create summary commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat: complete testing strategy implementation

Implements 4-layer testing pyramid:
- Layer 1: Effect unit tests with @effect/vitest and TestClock
- Layer 2: React component tests with @testing-library/react
- Layer 3: Electron IPC integration tests with Playwright
- Layer 4: Full workflow E2E tests with real LLM calls

Test counts:
- Unit: 10-15 tests (Effect logic)
- Components: 20-30 tests (React UI)
- Integration: 5-10 tests (IPC handlers)
- Workflow: 1-2 tests (full user journey)

Run frequency:
- Pre-commit: unit + components (~5s)
- PR: + integration (~30s)
- Main merge: + workflow (~5min)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Appendix: Test Data Dependencies

**Test Fixtures Required:**

- `tests/fixtures/arxiv-roadmap/source.pdf` - Already exists (4 pages)
- `tests/fixtures/arxiv-roadmap/expected.json` - Already exists

**Environment Variables:**

- `GEMINI_API_KEY` - Required for workflow tests
- `RUN_WORKFLOW_TESTS=1` - Enables workflow test suite

**Build Prerequisites:**

- `npm run build` must complete before integration/workflow tests
- `dist-electron/main.js` must exist

---

## Quick Reference: NPM Scripts

| Script                     | Purpose                         | When to Run         |
| -------------------------- | ------------------------------- | ------------------- |
| `npm run test:unit`        | Effect logic tests              | Pre-commit          |
| `npm run test:components`  | React component tests           | Pre-commit          |
| `npm run test`             | Unit + Components               | Pre-commit          |
| `npm run test:integration` | Electron IPC tests              | Every PR            |
| `npm run test:ci`          | Unit + Components + Integration | CI pipeline         |
| `npm run test:workflow`    | Full E2E with LLM               | Pre-merge + nightly |
| `npm run test:e2e`         | Existing accuracy benchmarks    | Manual              |
