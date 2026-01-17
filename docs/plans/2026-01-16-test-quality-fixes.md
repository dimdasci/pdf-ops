# Test Quality Fixes Implementation Plan

> **Status:** ✅ COMPLETED (2026-01-17)
>
> All 13 tasks completed. PR created: https://github.com/dimdasci/pdf-ops/pull/5

**Goal:** Remove dead/fluff tests, strengthen weak assertions, and add infrastructure for reliable test selectors.

**Architecture:** Direct fixes to existing test files - remove low-value tests, improve assertions, add data-testid attributes to components for selector reliability.

**Tech Stack:** Vitest, @testing-library/react, Playwright, React

---

## Phase 1: Remove Dead/Fluff Tests

### Task 1: Remove Fluff Tests from SettingsModal

**Files:**

- Modify: `tests/components/SettingsModal.test.tsx`

**Step 1: Read the file to locate fluff tests**

Read `tests/components/SettingsModal.test.tsx` to find the exact line numbers for:

- `renders modal content in document.body via portal`
- `displays provider descriptions`
- `displays security notice about encrypted storage`

**Step 2: Remove the fluff tests**

Delete the three test blocks that only verify static text content. These tests provide no confidence in functionality.

**Step 3: Run tests to verify nothing broke**

Run: `npm run test:components -- --testPathPattern=SettingsModal`
Expected: All remaining tests pass

**Step 4: Commit**

```bash
git add tests/components/SettingsModal.test.tsx
git commit -m "$(cat <<'EOF'
test: remove fluff tests from SettingsModal

Remove tests that only verify static text content:
- Portal z-index class assertion
- Provider description text
- Security notice text

These provide no functional confidence and add maintenance burden.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Remove Dead Test from Workspace

**Files:**

- Modify: `tests/components/Workspace.test.tsx`

**Step 1: Read the file to locate the dead test**

Read `tests/components/Workspace.test.tsx` to find the test named `calls saveMarkdownFile when save button is clicked`.

**Step 2: Remove the incomplete test**

Delete the test block. It claims to test button click behavior but never clicks the button or asserts the mock was called.

**Step 3: Run tests to verify nothing broke**

Run: `npm run test:components -- --testPathPattern=Workspace`
Expected: All remaining tests pass

**Step 4: Commit**

```bash
git add tests/components/Workspace.test.tsx
git commit -m "$(cat <<'EOF'
test: remove incomplete save button test from Workspace

Test claimed to verify saveMarkdownFile call but never
clicked the button or asserted the mock. Dead code.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Remove Fluff Tests from effect-wrapper

**Files:**

- Modify: `tests/unit/effect-wrapper.test.ts`

**Step 1: Read the file to locate fluff tests**

Read `tests/unit/effect-wrapper.test.ts` to find tests that only assert `schedule` is truthy:

- `creates schedule with configured max attempts`
- `uses default config when not provided`

**Step 2: Remove the fluff tests**

Delete both test blocks. Asserting `expect(schedule).toBeDefined()` provides zero confidence.

**Step 3: Run tests to verify nothing broke**

Run: `npm run test:unit`
Expected: All remaining tests pass

**Step 4: Commit**

```bash
git add tests/unit/effect-wrapper.test.ts
git commit -m "$(cat <<'EOF'
test: remove fluff schedule creation tests

Tests only asserted schedule was truthy without verifying
actual behavior. The exponential backoff test provides
real coverage of schedule functionality.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Strengthen Weak Assertions

### Task 4: Strengthen Exponential Backoff Test

**Files:**

- Modify: `tests/unit/effect-wrapper.test.ts`

**Step 1: Read the current test**

Read `tests/unit/effect-wrapper.test.ts` to find the `exponential backoff increases delays` test.

**Step 2: Strengthen the assertions**

Replace the weak `retryTimes.length >= 2` assertion with actual delay verification:

```typescript
// Verify exponential timing pattern
expect(retryTimes.length).toBeGreaterThanOrEqual(3)
const delay1 = retryTimes[1] - retryTimes[0]
const delay2 = retryTimes[2] - retryTimes[1]

// First delay should be ~1000ms (baseDelay)
expect(delay1).toBeGreaterThanOrEqual(900)
expect(delay1).toBeLessThanOrEqual(1100)

// Second delay should be ~2000ms (baseDelay * factor)
expect(delay2).toBeGreaterThanOrEqual(1800)
expect(delay2).toBeLessThanOrEqual(2200)

// Verify exponential growth: delay2 should be ~2x delay1
expect(delay2).toBeGreaterThan(delay1 * 1.5)
```

**Step 3: Run test to verify**

Run: `npm run test:unit`
Expected: Test passes with stronger assertions

**Step 4: Commit**

```bash
git add tests/unit/effect-wrapper.test.ts
git commit -m "$(cat <<'EOF'
test: strengthen exponential backoff assertions

Replace weak length check with actual delay verification:
- First delay ~1000ms (baseDelay)
- Second delay ~2000ms (baseDelay * factor)
- Verify exponential growth pattern

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Fix Validation Status Test in SettingsModal

**Files:**

- Modify: `tests/components/SettingsModal.test.tsx`

**Step 1: Read the current test**

Read `tests/components/SettingsModal.test.tsx` to find the `resets validation status when key changes` test.

**Step 2: Fix the test logic**

The test should first verify status appears, THEN verify it clears. Update to:

```typescript
it('resets validation status when key changes', async () => {
  const user = userEvent.setup()

  // Mock successful validation
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ candidates: [{ content: 'test' }] }),
  })

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

  // Enter a key and validate
  const geminiInput = screen.getByLabelText(/gemini/i)
  await user.clear(geminiInput)
  await user.type(geminiInput, 'test-api-key')

  // Click validate button
  const validateButton = screen.getByRole('button', { name: /validate.*gemini/i })
  await user.click(validateButton)

  // Wait for validation status to appear
  await waitFor(() => {
    expect(screen.getByTestId('gemini-status')).toBeInTheDocument()
  })

  // Now change the key
  await user.type(geminiInput, '-modified')

  // Verify status is cleared
  await waitFor(() => {
    expect(screen.queryByTestId('gemini-status')).not.toBeInTheDocument()
  })
})
```

**Step 3: Run test to verify**

Run: `npm run test:components -- --testPathPattern=SettingsModal`
Expected: Test passes

**Step 4: Commit**

```bash
git add tests/components/SettingsModal.test.tsx
git commit -m "$(cat <<'EOF'
test: fix validation status test to verify positive case first

Test now properly verifies:
1. Validation status appears after clicking validate
2. Status clears when key changes

Previously only tested the negative case.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Improve Save Button Test in Workspace

**Files:**

- Modify: `tests/components/Workspace.test.tsx`

**Step 1: Read the current test**

Read `tests/components/Workspace.test.tsx` to find the `renders save button in toolbar` test.

**Step 2: Improve the assertion**

Replace weak `buttons.length >= 3` with specific save button check:

```typescript
it('renders save button in toolbar', async () => {
  render(<Workspace filePath="/test/doc.pdf" onClose={mockOnClose} />)

  await waitFor(() => {
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
  })

  // Find save button by accessible name or icon
  const saveButton = screen.getByRole('button', { name: /save|export/i })
  expect(saveButton).toBeInTheDocument()
})
```

**Step 3: Run test to verify**

Run: `npm run test:components -- --testPathPattern=Workspace`
Expected: Test passes

**Step 4: Commit**

```bash
git add tests/components/Workspace.test.tsx
git commit -m "$(cat <<'EOF'
test: improve save button test with specific selector

Replace generic button count check with accessible name query.
More reliable and documents expected button behavior.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Add data-testid Attributes

### Task 7: Add data-testid to DropZone

**Files:**

- Modify: `src/components/DropZone.tsx`

**Step 1: Read the component**

Read `src/components/DropZone.tsx` to understand the structure.

**Step 2: Add data-testid attributes**

Add to key elements:

- Main drop zone container: `data-testid="drop-zone"`
- File input: `data-testid="file-input"`

**Step 3: Run tests to verify nothing broke**

Run: `npm run test:components -- --testPathPattern=DropZone`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/components/DropZone.tsx
git commit -m "$(cat <<'EOF'
feat: add data-testid attributes to DropZone

- drop-zone: main container for drag events
- file-input: hidden file input element

Improves test selector reliability.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Add data-testid to SettingsModal

**Files:**

- Modify: `src/components/SettingsModal.tsx`

**Step 1: Read the component**

Read `src/components/SettingsModal.tsx` to understand the structure.

**Step 2: Add data-testid attributes**

Add to key elements:

- Modal container: `data-testid="settings-modal"`
- Gemini input: `data-testid="gemini-key-input"`
- Anthropic input: `data-testid="anthropic-key-input"`
- Gemini status indicator: `data-testid="gemini-status"`
- Anthropic status indicator: `data-testid="anthropic-status"`
- Save button: `data-testid="save-settings"`

**Step 3: Run tests to verify nothing broke**

Run: `npm run test:components -- --testPathPattern=SettingsModal`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "$(cat <<'EOF'
feat: add data-testid attributes to SettingsModal

- settings-modal: modal container
- gemini-key-input, anthropic-key-input: API key fields
- gemini-status, anthropic-status: validation indicators
- save-settings: save button

Improves test selector reliability for E2E and component tests.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Add data-testid to Workspace

**Files:**

- Modify: `src/components/Workspace.tsx`

**Step 1: Read the component**

Read `src/components/Workspace.tsx` to understand the structure.

**Step 2: Add data-testid attributes**

Add to key elements:

- Page count display: `data-testid="page-count"`
- Convert button: `data-testid="convert-button"`
- Export/save button: `data-testid="export-button"`
- Conversion status: `data-testid="conversion-status"`
- Markdown output: `data-testid="markdown-output"`
- Error message: `data-testid="error-message"`
- Settings button (if present): `data-testid="settings-button"`

**Step 3: Run tests to verify nothing broke**

Run: `npm run test:components -- --testPathPattern=Workspace`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/components/Workspace.tsx
git commit -m "$(cat <<'EOF'
feat: add data-testid attributes to Workspace

- page-count: PDF page count display
- convert-button: start conversion
- export-button: save markdown
- conversion-status: progress/complete indicator
- markdown-output: converted content
- error-message: error display

Enables reliable E2E workflow testing.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Update Tests to Use data-testid

### Task 10: Update DropZone Tests

**Files:**

- Modify: `tests/components/DropZone.test.tsx`

**Step 1: Update selectors**

Replace className-based selectors with data-testid:

```typescript
// Before
const dropZone = container.querySelector('.border-2')

// After
const dropZone = screen.getByTestId('drop-zone')
```

**Step 2: Run tests to verify**

Run: `npm run test:components -- --testPathPattern=DropZone`
Expected: All tests pass

**Step 3: Commit**

```bash
git add tests/components/DropZone.test.tsx
git commit -m "$(cat <<'EOF'
test: update DropZone tests to use data-testid selectors

Replace fragile className queries with reliable testid selectors.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Update SettingsModal Tests

**Files:**

- Modify: `tests/components/SettingsModal.test.tsx`

**Step 1: Update selectors**

Replace label-based selectors with data-testid where appropriate:

```typescript
// For validation status checks
expect(screen.getByTestId('gemini-status')).toBeInTheDocument()
```

**Step 2: Run tests to verify**

Run: `npm run test:components -- --testPathPattern=SettingsModal`
Expected: All tests pass

**Step 3: Commit**

```bash
git add tests/components/SettingsModal.test.tsx
git commit -m "$(cat <<'EOF'
test: update SettingsModal tests to use data-testid selectors

Use testid for status indicators and buttons where labels
may change. Keep accessible queries for form inputs.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Update Workflow Tests

**Files:**

- Modify: `tests/workflows/conversion-workflow.test.ts`

**Step 1: Update selectors to use data-testid**

The workflow tests already use data-testid selectors. Verify they match the attributes added to components:

```typescript
await window.click('[data-testid="settings-button"]')
await window.fill('[data-testid="gemini-key-input"]', process.env.GEMINI_API_KEY!)
await window.click('[data-testid="save-settings"]')
await expect(window.locator('[data-testid="page-count"]')).toHaveText(/4 pages/i)
await window.click('[data-testid="convert-button"]')
await expect(window.locator('[data-testid="conversion-status"]')).toHaveText(/complete/i)
```

**Step 2: Run workflow test (if API key available)**

Run: `RUN_WORKFLOW_TESTS=1 npm run test:workflow` (optional, requires API key)

**Step 3: Commit**

```bash
git add tests/workflows/conversion-workflow.test.ts
git commit -m "$(cat <<'EOF'
test: verify workflow tests use correct data-testid selectors

Align workflow test selectors with data-testid attributes
added to components.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Final Verification

### Task 13: Run All Tests

**Step 1: Run unit and component tests**

Run: `npm run test`
Expected: All tests pass

**Step 2: Build the app**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Run integration tests**

Run: `npm run test:integration`
Expected: All IPC tests pass

**Step 4: Commit final state**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: complete test quality improvements

Summary of changes:
- Removed 4 fluff/dead tests (~50 lines)
- Strengthened 3 weak assertions
- Added data-testid attributes to all components
- Updated test selectors for reliability

Test quality is now higher with fewer but more meaningful tests.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

| Phase | Tasks | Description                         |
| ----- | ----- | ----------------------------------- |
| 1     | 1-3   | Remove dead/fluff tests (~50 lines) |
| 2     | 4-6   | Strengthen weak assertions          |
| 3     | 7-9   | Add data-testid to components       |
| 4     | 10-12 | Update tests to use data-testid     |
| 5     | 13    | Final verification                  |

**Total Tasks:** 13
**Estimated Removed Code:** ~50 lines of fluff tests
**Estimated Added Code:** ~30 lines of data-testid attributes
